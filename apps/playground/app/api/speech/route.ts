import { GEMINI_VOICES, speechKey, speechProvider } from './config';

/**
 * The playground's text-to-speech endpoint, so the key stays on the server. It takes the
 * editor's OpenAI-style request (`input`, `voice`, `speed`) and either forwards it to an
 * OpenAI-compatible `/audio/speech` service (`SPEECH_URL`, default OpenAI's; `SPEECH_MODEL`,
 * default `tts-1`) or asks Google's Gemini speech models (`SPEECH_MODEL`, else
 * `GEMINI_SPEECH_MODELS` in turn) and answers a WAV. Key: `SPEECH_API_KEY` (falls back to
 * `ASSISTANT_API_KEY`); which service: see `speechProvider`. Without a key it answers 501.
 */
export async function POST(request: Request): Promise<Response> {
  const key = speechKey();
  const provider = speechProvider();
  if (!key || !provider) return new Response('No voice service configured', { status: 501 });
  const body = (await request.json()) as Record<string, unknown>;
  if (provider === 'gemini') return gemini(key, body);
  const upstream = await fetch(process.env.SPEECH_URL ?? 'https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ ...body, model: process.env.SPEECH_MODEL ?? body.model ?? 'tts-1' }),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'audio/mpeg' },
  });
}

/** Gemini speech: one request, raw 16-bit PCM back, wrapped as a WAV. */
async function gemini(key: string, body: Record<string, unknown>): Promise<Response> {
  const text = String(body.input ?? '').slice(0, 4000);
  if (!text.trim()) return new Response('Nothing to say', { status: 400 });
  const voice = GEMINI_VOICES.some((v) => v.id === body.voice) ? String(body.voice) : 'Kore';
  // No speed setting in this API: the pace is asked for in words.
  const speed = Number(body.speed) || 1;
  const pace =
    speed >= 1.4
      ? 'Say quickly'
      : speed > 1.05
        ? 'Say a little faster than usual'
        : speed <= 0.7
          ? 'Say slowly'
          : speed < 0.95
            ? 'Say a little slower than usual'
            : 'Say';
  // Each model has its own daily free allowance: on a used-up one (429), a busy one or no audio,
  // the next is tried. `SPEECH_MODEL` pins one.
  const models = process.env.SPEECH_MODEL ? [process.env.SPEECH_MODEL] : GEMINI_SPEECH_MODELS;
  let failed: Response | undefined;
  let audio: { mimeType?: string; data?: string } | undefined;
  for (const model of models) {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${pace}: ${text}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      },
    );
    if (!upstream.ok) {
      failed = new Response(await upstream.text(), { status: upstream.status });
      if (upstream.status === 429 || upstream.status >= 500) continue;
      return failed;
    }
    const json = (await upstream.json()) as {
      candidates?: {
        content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
      }[];
    };
    audio = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (audio?.data) break;
    failed = new Response('The voice service sent no audio', { status: 502 });
  }
  if (!audio?.data)
    return failed ?? new Response('The voice service sent no audio', { status: 502 });
  const rate = Number(/rate=(\d+)/.exec(audio.mimeType ?? '')?.[1]) || 24000;
  return new Response(new Uint8Array(wav(Buffer.from(audio.data, 'base64'), rate)), {
    headers: { 'content-type': 'audio/wav' },
  });
}

/** Google's speech models, newest first (checked 2026-10-28; each has its own daily allowance). */
const GEMINI_SPEECH_MODELS = [
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
];

/** 16-bit mono PCM → a WAV file. */
function wav(pcm: Buffer, rate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
