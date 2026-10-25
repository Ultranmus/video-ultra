import { captionsSetup } from '../speech/config';
import { geminiCaptions } from './gemini';
import { transcriptionCaptions } from './transcription';
import { SAMPLE_RATE } from './wav';

/**
 * The playground's captions endpoint (DECISIONS #163, #164), for `createCaptionsEndpoint`: one
 * piece of sound in (32-bit float samples, 16 kHz, mono, at most 31 s), `?language=` an ISO
 * code or `auto`; answers `{ words, language }` (`CaptionsEndpointReply`). The service is the
 * first one set up (`captionsSetup`): a speech-to-text service (Groq / OpenAI…, real word
 * times), else Gemini (words only; the editor times them from the sound). 501 without either
 * (the editor then captions English on the device). The keys stay here.
 */
export async function POST(request: Request): Promise<Response> {
  const setup = captionsSetup();
  if (!setup) return new Response('No captions service configured', { status: 501 });
  const language = new URL(request.url).searchParams.get('language') ?? 'auto';
  const samples = new Float32Array(await request.arrayBuffer());
  const seconds = samples.length / SAMPLE_RATE;
  if (seconds === 0 || seconds > 31) return new Response('Send 0–31 s of sound', { status: 400 });
  const params = new URL(request.url).searchParams;
  const hints = {
    context: (params.get('context') ?? '').slice(0, 300),
    vocabulary: (params.get('vocabulary') ?? '').slice(0, 400),
  };
  const reply =
    setup.kind === 'transcription'
      ? await transcriptionCaptions(samples, language, setup, hints, request.signal)
      : await geminiCaptions(samples, language, setup.key, hints, request.signal);
  return reply instanceof Response ? reply : Response.json(reply);
}
