import { describe, expect, it } from 'vitest';
import { snapToVoice } from './align-words';
import { createCaptionsEndpoint } from './captions';

const RATE = 16_000;

/** Speech-like sound: a tone in bursts (voice), silent between them. */
function speech(seconds: number, silentFrom = Infinity): Float32Array {
  const a = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < a.length; i++) {
    const t = i / RATE;
    const voiced = t < silentFrom && t % 1 < 0.7;
    a[i] = voiced ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : 0;
  }
  return a;
}

async function* pieces(a: Float32Array, size = 10 * RATE) {
  for (let i = 0; i < a.length; i += size) yield a.slice(i, i + size);
}

function fakeServer(
  reply: (language: string, seconds: number, n: number) => unknown,
  fail: number[] = [],
) {
  const calls: { language: string; seconds: number }[] = [];
  const statuses = [...fail];
  const fetch = (async (url: string, init: RequestInit) => {
    const language = new URL(url, 'http://x').searchParams.get('language')!;
    const seconds = (init.body as Float32Array).length / RATE;
    calls.push({ language, seconds });
    const status = statuses.shift();
    if (status) return new Response('busy', { status });
    return Response.json(reply(language, seconds, calls.length));
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const run = (fetch: typeof globalThis.fetch, audio: Float32Array, language = 'en') =>
  createCaptionsEndpoint({ endpoint: '/api/captions', fetch }).transcribe({
    audio: pieces(audio),
    duration: audio.length / RATE,
    language,
    signal: new AbortController().signal,
  });

describe('createCaptionsEndpoint', () => {
  it('sends 30 s chunks (a short tail joins the last) and places each piece’s words', async () => {
    const server = fakeServer((_l, _s, n) => ({
      words: [{ text: `piece${n}`, start: 1, end: 1.5 }],
      language: 'en',
    }));
    const result = await run(server.fetch, speech(60.5));
    expect(server.calls.map((c) => c.seconds)).toEqual([30, 30.5]);
    expect(result.words).toEqual([
      { text: 'piece1', start: 1, end: 1.5 },
      { text: 'piece2', start: 31, end: 31.5 },
    ]);
  });

  it('times words from the sound when the service gives only text', async () => {
    const server = fakeServer(() => ({ words: ['one,', 'two.', 'three'], language: 'en' }));
    const { words } = await run(server.fetch, speech(3));
    expect(words.map((w) => w.text)).toEqual(['one,', 'two.', 'three']);
    expect(words.every((w, i) => w.end > w.start && (!i || w.start >= words[i - 1]!.start))).toBe(
      true,
    );
    // Phrase ends sit on the pauses: "two." starts with the second burst.
    expect(words[1]!.start).toBeCloseTo(1, 1);
  });

  it('skips silence, and says which language was heard when it wasn’t the one chosen', async () => {
    const server = fakeServer(() => ({ words: [], language: 'hi' }));
    const result = await run(server.fetch, speech(65, 31), 'fr');
    expect(server.calls).toHaveLength(1);
    expect(result).toEqual({ words: [], language: 'hi' });
  });

  it('keeps every piece when some are in the chosen language (speech that switches)', async () => {
    const server = fakeServer((_l, _s, n) => ({
      words: [{ text: `w${n}`, start: 0, end: 1 }],
      language: n === 1 ? 'hi' : 'en',
    }));
    const result = await run(server.fetch, speech(60), 'hi');
    expect(result.words.map((w) => w.text)).toEqual(['w1', 'w2']);
    expect(result.language).toBe('hi');
  });

  it('retries a busy service, then says it is busy', async () => {
    const ok = fakeServer(() => ({ words: ['hi'], language: 'en' }), [503]);
    await expect(run(ok.fetch, speech(2))).resolves.toMatchObject({ words: [{ text: 'hi' }] });
    expect(ok.calls).toHaveLength(2);
    const busy = fakeServer(() => ({ words: [], language: 'en' }), [429, 429, 429]);
    await expect(run(busy.fetch, speech(2))).rejects.toMatchObject({ status: 429 });
  }, 20_000);
});

describe('snapToVoice', () => {
  // 15 s of silence, then voice in bursts (0.7 s of every second).
  const lead = new Float32Array(25 * RATE);
  lead.set(speech(10), 15 * RATE);

  it('moves words a recogniser stretched over the silence before the speech onto the voice', () => {
    const words = snapToVoice(
      [
        { text: 'Welcome', start: 0, end: 11.98 },
        { text: 'back', start: 11.98, end: 15.6 },
        { text: 'to', start: 15.6, end: 15.7 },
      ],
      lead,
    );
    expect(words[0]!.start).toBeCloseTo(15, 1);
    expect(words[1]!.start).toBeGreaterThan(words[0]!.start);
    expect(words[1]!.end).toBeLessThanOrEqual(15.6 + 1e-9);
    expect(words[2]).toEqual({ text: 'to', start: 15.6, end: 15.7 });
  });

  it('leaves words on the voice, and sound with no voice at all, as they are', () => {
    const onVoice = [{ text: 'hi', start: 15.1, end: 15.5 }];
    expect(snapToVoice(onVoice, lead)).toEqual(onVoice);
    const quiet = [{ text: 'hi', start: 0, end: 2 }];
    expect(snapToVoice(quiet, new Float32Array(3 * RATE))).toEqual(quiet);
  });
});
