import Anthropic from '@anthropic-ai/sdk';
import { speechKey, speechProvider } from '../speech/config';

/**
 * The playground's AI editing endpoint: takes the editor's OpenAI-style chat request and answers
 * in the same shape, so every key stays on the server. Which model, first one set up wins:
 *
 * 1. `ASSISTANT_API_KEY` (+ `ASSISTANT_URL`, default OpenAI's chat completions; `ASSISTANT_MODEL`):
 *    any OpenAI-compatible model.
 * 2. A Google key (the voice key, see `../speech/config`): Gemini through Google's
 *    OpenAI-compatible endpoint — `ASSISTANT_MODEL`, else a few flash models in turn, the next
 *    one when one is busy (Google answers 503 under high demand).
 * 3. Claude (`ANTHROPIC_API_KEY`), also when the first choice fails (busy, rate limited, down).
 *
 * The editor's Stop cancels the request, and that cancels the model's call too.
 *
 * Without any of them it answers 501 and the editor uses the offline demo.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as ChatRequest;
  const openai = process.env.ASSISTANT_API_KEY;
  const google = speechProvider() === 'gemini' ? speechKey() : undefined;
  const claude = !!process.env.ANTHROPIC_API_KEY;

  const signal = request.signal;
  let failed: Response | null = null;
  if (openai || google) {
    const models = process.env.ASSISTANT_MODEL
      ? [process.env.ASSISTANT_MODEL]
      : openai
        ? [body.model]
        : GEMINI_MODELS;
    for (const [i, model] of models.entries()) {
      // A model that hangs (overloaded) gets a time limit while there's another to try.
      const last = i === models.length - 1;
      const attempt = last ? signal : AbortSignal.any([signal, AbortSignal.timeout(MODEL_WAIT_MS)]);
      const upstream = await fetch(
        openai
          ? (process.env.ASSISTANT_URL ?? 'https://api.openai.com/v1/chat/completions')
          : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${openai ?? google}`,
          },
          body: JSON.stringify({ ...body, ...(model ? { model } : {}) }),
          signal: attempt,
        },
      ).catch(() => null);
      if (signal.aborted) return new Response(null, { status: 499 });
      if (upstream?.ok)
        return new Response(upstream.body, { headers: { 'content-type': 'application/json' } });
      failed = upstream
        ? new Response(await upstream.text(), { status: upstream.status })
        : new Response('The assistant is busy', { status: 503 });
      // Only a busy, rate-limited, retired or failing model is worth trying the next one for.
      if (upstream && ![404, 429, 500, 502, 503, 504].includes(upstream.status)) break;
    }
  }
  if (claude) return askClaude(body, signal);
  return failed ?? new Response('No assistant configured', { status: 501 });
}

/**
 * Gemini models to try in turn: the current flash, then the lite one, which stays quick when
 * the others are overloaded (measured 2026-10-24: flash 503 after 11 s or hanging past 60 s,
 * lite 6 s).
 */
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-flash-lite-latest'];
/** How long a model that isn't the last one may take before the next is tried. */
const MODEL_WAIT_MS = 12_000;

/** The editor's request: OpenAI-style chat messages (a system message first). */
interface ChatRequest {
  model?: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
}

/** Asks Claude, answering in the OpenAI chat shape the editor reads. */
async function askClaude(body: ChatRequest, signal: AbortSignal): Promise<Response> {
  const client = new Anthropic();
  const system = body.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const messages: Anthropic.Beta.BetaMessageParam[] = body.messages
    .filter((m): m is { role: 'user' | 'assistant'; content: string } => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  try {
    const response = await client.beta.messages.create(
      {
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        system: `${system}\n\nAnswer with the JSON object only.`,
        messages,
        // If a safety check declines, the API retries on a suitable model within the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal },
    );
    if (response.stop_reason === 'refusal')
      return new Response('The assistant declined this request', { status: 422 });
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return Response.json({ choices: [{ message: { role: 'assistant', content: text } }] });
  } catch (error) {
    const status = error instanceof Anthropic.APIError ? (error.status ?? 502) : 502;
    return new Response(error instanceof Error ? error.message : 'The assistant failed', {
      status,
    });
  }
}
