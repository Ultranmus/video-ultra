/**
 * The playground's AI editing endpoint: forwards the editor's chat request to any
 * OpenAI-compatible model so the API key stays on the server. Configure with environment
 * variables: `ASSISTANT_URL` (default OpenAI's chat completions), `ASSISTANT_API_KEY`,
 * `ASSISTANT_MODEL`. Without a key it answers 501 and the editor uses the offline demo.
 */
export async function POST(request: Request): Promise<Response> {
  const key = process.env.ASSISTANT_API_KEY;
  if (!key) return new Response('No assistant configured', { status: 501 });
  const body = (await request.json()) as Record<string, unknown>;
  const upstream = await fetch(
    process.env.ASSISTANT_URL ?? 'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...body, model: process.env.ASSISTANT_MODEL ?? body.model }),
    },
  );
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
}
