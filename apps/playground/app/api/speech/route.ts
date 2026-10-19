/**
 * The playground's text-to-speech endpoint: forwards to any OpenAI-compatible `/audio/speech`
 * service so the key stays on the server. `SPEECH_URL` (default OpenAI's), `SPEECH_API_KEY`
 * (falls back to `ASSISTANT_API_KEY`), `SPEECH_MODEL`. Without a key it answers 501 and the
 * editor uses the offline demo voice.
 */
export async function POST(request: Request): Promise<Response> {
  const key = process.env.SPEECH_API_KEY ?? process.env.ASSISTANT_API_KEY;
  if (!key) return new Response('No voice service configured', { status: 501 });
  const body = (await request.json()) as Record<string, unknown>;
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
