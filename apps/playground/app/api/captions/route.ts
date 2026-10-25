import { speechKey, speechProvider } from '../speech/config';

/**
 * The playground's captions service (DECISIONS #163): one piece of sound in (32-bit float
 * samples, 16 kHz, mono, at most 30 s — what the editor's transcriber gets), the words said in
 * it out, from Gemini with the server's Google key. `?language=` is an ISO code or `auto`.
 * Answers `{ words: string[], language }`. No times: Gemini's word times drift by seconds over
 * a piece (measured), so the editor times the words from the sound itself (align-words.ts).
 * 501 without a Google key (the editor then captions English on the device).
 */
export async function POST(request: Request): Promise<Response> {
  const key = speechProvider() === 'gemini' ? speechKey() : undefined;
  if (!key) return new Response('No captions service configured', { status: 501 });
  const language = new URL(request.url).searchParams.get('language') ?? 'auto';
  const samples = new Float32Array(await request.arrayBuffer());
  const seconds = samples.length / SAMPLE_RATE;
  if (seconds === 0 || seconds > 31) return new Response('Send 0–31 s of sound', { status: 400 });
  const audio = Buffer.from(wav(samples)).toString('base64');
  const signal = request.signal;

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
                { text: prompt(language, seconds) },
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
      return Response.json(clean(text, language));
    }
    failed = upstream
      ? new Response(await upstream.text(), { status: upstream.status })
      : new Response('The captions service is busy', { status: 503 });
    if (upstream && ![404, 429, 500, 502, 503, 504].includes(upstream.status)) break;
  }
  return failed ?? new Response('The captions service failed', { status: 502 });
}

const SAMPLE_RATE = 16_000;
/** The lite model first (quick; the flash one was overloaded on 2026-10-25), then flash. */
const MODELS = ['gemini-flash-lite-latest', 'gemini-3.8-flash'];
/** How long a model that isn't the last one may take before the next is tried. */
const MODEL_WAIT_MS = 20_000;

const SCHEMA = {
  type: 'OBJECT',
  properties: { language: { type: 'STRING' }, text: { type: 'STRING' } },
  required: ['language', 'text'],
};

function prompt(language: string, seconds: number): string {
  const spoken =
    language === 'auto'
      ? 'Detect the spoken language and write it in its own script.'
      : `The speech is in the language with ISO 639-1 code "${language}"; write it in that language's own script.`;
  return [
    `Transcribe the speech in this ${seconds.toFixed(1)}-second recording for video captions.`,
    spoken,
    'Write every spoken word in order, with punctuation.',
    'Write only what is said: no speaker names, no descriptions of sounds or music.',
    'If nobody speaks, the text is empty.',
    'Answer with "language" (the ISO 639-1 code of the speech) and "text".',
  ].join(' ');
}

/** The model's answer as words in order (split at spaces) and the language heard. */
function clean(text: string, language: string): { words: string[]; language: string } {
  let value: { language?: unknown; text?: unknown } = {};
  try {
    value = JSON.parse(text) as typeof value;
  } catch {
    /* not JSON: no words */
  }
  const said = typeof value.text === 'string' ? value.text : '';
  const heard = typeof value.language === 'string' && value.language ? value.language : language;
  return {
    words: said.split(/\s+/).filter(Boolean),
    language: heard === 'auto' ? 'en' : heard.slice(0, 2).toLowerCase(),
  };
}

/** 16-bit PCM WAV of 16 kHz mono float samples. */
function wav(samples: Float32Array): ArrayBuffer {
  const out = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(out);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}
