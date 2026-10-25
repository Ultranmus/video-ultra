import { captionWords } from '@video-ultra/core';
import type { CaptionsEndpointReply } from '@video-ultra/ai';
import { SAMPLE_RATE, wav } from './wav';

/**
 * Captions from Gemini (DECISIONS #163): the words said in a piece, no times — Gemini's word
 * times drift by seconds over a piece (measured), so the editor times the words from the sound
 * (`createCaptionsEndpoint`). A failed call answers its status (a busy one is tried again).
 */
export async function geminiCaptions(
  samples: Float32Array,
  language: string,
  key: string,
  hints: { context: string; vocabulary: string },
  signal: AbortSignal,
): Promise<CaptionsEndpointReply | Response> {
  const seconds = samples.length / SAMPLE_RATE;
  const audio = Buffer.from(wav(samples)).toString('base64');
  let failed: Response | null = null;
  for (const [i, model] of MODELS.entries()) {
    const last = i === MODELS.length - 1;
    const attempt = last ? signal : AbortSignal.any([signal, AbortSignal.timeout(MODEL_WAIT_MS)]);
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt(language, seconds, hints) },
                { inline_data: { mime_type: 'audio/wav', data: audio } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            response_mime_type: 'application/json',
            response_schema: SCHEMA,
          },
        }),
        signal: attempt,
      },
    ).catch(() => null);
    if (signal.aborted) return new Response(null, { status: 499 });
    if (upstream?.ok) {
      const body = (await upstream.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      return clean(text, language);
    }
    const retry = upstream?.headers.get('retry-after');
    failed = upstream
      ? new Response(await upstream.text(), {
          status: upstream.status,
          ...(retry ? { headers: { 'retry-after': retry } } : {}),
        })
      : new Response('The captions service is busy', { status: 503 });
    if (upstream && ![404, 429, 500, 502, 503, 504].includes(upstream.status)) break;
  }
  return failed ?? new Response('The captions service failed', { status: 502 });
}

/** The lite model first (quick; the flash one was overloaded on 2026-10-25), then flash. */
const MODELS = ['gemini-flash-lite-latest', 'gemini-3.8-flash'];
/** How long a model that isn't the last one may take before the next is tried. */
const MODEL_WAIT_MS = 20_000;

const SCHEMA = {
  type: 'OBJECT',
  properties: { language: { type: 'STRING' }, text: { type: 'STRING' } },
  required: ['language', 'text'],
};

function prompt(
  language: string,
  seconds: number,
  hints: { context: string; vocabulary: string },
): string {
  const spoken =
    language === 'auto'
      ? 'Detect the spoken language and write it in its own script.'
      : language === 'hi-Latn'
        ? 'The speech is Hindi, maybe mixed with English; write it in Latin letters the way people type Hindi in chat (Hinglish, e.g. "Tum kaise ho? Main theek hoon"), not translated.'
        : `The speech is in the language with ISO 639-1 code "${language}"; write it in that language's own script.`;
  return [
    `Transcribe the speech in this ${seconds.toFixed(1)}-second recording for video captions.`,
    spoken,
    'Write every spoken word in order, with punctuation.',
    'Write only what is said: no speaker names, no descriptions of sounds or music.',
    'If nobody speaks, the text is empty.',
    ...(hints.vocabulary ? [`Names and words that may be said: ${hints.vocabulary}.`] : []),
    ...(hints.context ? [`Said just before this recording: "${hints.context}".`] : []),
    'Answer with "language" (the ISO 639-1 code of the language actually spoken, even if it is not the one named) and "text".',
  ].join(' ');
}

/** The model's answer as words in order (as captions count them) and the language heard. */
function clean(text: string, language: string): CaptionsEndpointReply {
  let value: { language?: unknown; text?: unknown } = {};
  try {
    value = JSON.parse(text) as typeof value;
  } catch {
    /* not JSON: no words */
  }
  const said = typeof value.text === 'string' ? value.text : '';
  const raw = typeof value.language === 'string' && value.language ? value.language : language;
  const heard = raw === 'auto' ? 'en' : raw.slice(0, 2).toLowerCase();
  // Another language than the one chosen: Gemini then writes it in Latin letters or translates
  // it. No words; the language heard lets the editor say which one to choose.
  if (language !== 'auto' && heard !== language.split('-')[0])
    return { words: [], language: heard };
  return { words: captionWords(said), language: heard };
}
