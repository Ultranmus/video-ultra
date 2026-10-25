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
  createCaptionsEndpoint({ endpoint: '/api/captions', fetch, retryWait: 10 }).transcribe({
    audio: pieces(audio),
    duration: audio.length / RATE,
    language,
    signal: new AbortController().signal,
  });

describe('createCaptionsEndpoint', () => {
  it('cuts pieces at a pause between 25 and 30 s and places each piece’s words', async () => {
    const server = fakeServer((_l, _s, n) => ({
      words: [{ text: `piece${n}`, start: 1, end: 1.5 }],
      language: 'en',
    }));
    const result = await run(server.fetch, speech(60.5));
    const [first, second] = server.calls.map((c) => c.seconds);
    // The bursts are silent from .7 to 1 s of every second: the cut lands in one of those gaps.
    expect(first).toBeGreaterThanOrEqual(25);
    expect(first).toBeLessThanOrEqual(30);
    expect((first! % 1) + 1e-9).toBeGreaterThanOrEqual(0.7);
    expect(first! + second!).toBeCloseTo(60.5, 5);
    expect(result.words.map((w) => w.text)).toEqual(['piece1', 'piece2']);
    // At its place in the video (moved onto the voice when its time fell in a gap).
    expect(result.words[1]!.start).toBeGreaterThanOrEqual(first! + 1 - 1e-9);
    expect(result.words[1]!.start).toBeLessThan(first! + 1.3);
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

  it('Detect decides by vote, then asks every piece for that language', async () => {
    const server = fakeServer((language, _s, n) => ({
      words: [{ text: `w${n}`, start: 0, end: 1 }],
      // Piece by piece, the service would hear English, then Spanish, Spanish, Spanish.
      language: language === 'auto' ? (n === 1 ? 'en' : 'es') : language,
    }));
    const result = await run(server.fetch, speech(120), 'auto');
    // Three pieces vote (en, es, es): Spanish. The English one is asked again (same length as
    // the first piece); every later piece is asked for Spanish straight away.
    const asked = server.calls.map((c) => c.language);
    expect(asked.slice(0, 3)).toEqual(['auto', 'auto', 'auto']);
    expect(asked.slice(3).every((l) => l === 'es')).toBe(true);
    expect(server.calls[3]!.seconds).toBe(server.calls[0]!.seconds);
    expect(result.language).toBe('es');
    expect(result.words).toHaveLength(server.calls.length - 1);
  });

  it('a doubtful piece doesn’t vote, and doubtful words are dropped', async () => {
    const server = fakeServer((language, _s, n) =>
      n === 1
        ? { words: [{ text: 'made', start: 0, end: 0.5, confidence: 0.1 }], language: 'nn' }
        : {
            words: [{ text: `w${n}`, start: 0, end: 1, confidence: 0.9 }],
            language: language === 'auto' ? 'en' : language,
          },
    );
    const result = await run(server.fetch, speech(60), 'auto');
    expect(result.language).toBe('en');
    expect(result.words.map((w) => w.text)).not.toContain('made');
  });

  it('speech heard nowhere clearly makes no captions, and isn’t called another language', async () => {
    // A doubtful "translation" in every piece (Whisper on speech buried in room noise).
    const server = fakeServer(() => ({
      words: [{ text: 'Kami', start: 0, end: 1, confidence: 0.4 }],
      language: 'ms',
    }));
    expect(await run(server.fetch, speech(60), 'en')).toEqual({ words: [], language: 'en' });
    expect((await run(server.fetch, speech(60), 'auto')).words).toEqual([]);
  });

  it('leaves out words a service timed past the end of the piece', async () => {
    const server = fakeServer(() => ({
      words: [
        { text: 'in', start: 0.2, end: 0.6 },
        { text: 'beyond', start: 5, end: 5.5 },
      ],
      language: 'en',
    }));
    const result = await run(server.fetch, speech(2));
    expect(result.words.map((w) => w.text)).toEqual(['in']);
  });

  it('sends the words before as context and the names to listen for', async () => {
    const urls: string[] = [];
    const fetch = (async (url: string) => {
      urls.push(url);
      return Response.json({ words: [{ text: 'Ultranmus', start: 0, end: 1 }], language: 'en' });
    }) as typeof globalThis.fetch;
    await createCaptionsEndpoint({ endpoint: '/api/captions', fetch, parallel: 1 }).transcribe({
      audio: pieces(speech(60)),
      duration: 60,
      language: 'en',
      vocabulary: ['Ultranmus', 'video-ultra'],
      signal: new AbortController().signal,
    });
    const second = new URL(urls[1]!, 'http://x').searchParams;
    expect(second.get('vocabulary')).toBe('Ultranmus, video-ultra');
    expect(second.get('context')).toBe('Ultranmus');
  });

  it('retries a busy service, then says it is busy', async () => {
    const ok = fakeServer(() => ({ words: ['hi'], language: 'en' }), [503]);
    await expect(run(ok.fetch, speech(2))).resolves.toMatchObject({ words: [{ text: 'hi' }] });
    expect(ok.calls).toHaveLength(2);
    const busy = fakeServer(() => ({ words: [], language: 'en' }), [429, 429, 429, 429, 429]);
    await expect(run(busy.fetch, speech(2))).rejects.toMatchObject({ status: 429 });
    expect(busy.calls).toHaveLength(5);
  });

  it('Detect writes Hindi rather than Urdu (spoken alike) unless the browser says Urdu', async () => {
    const server = fakeServer((language) => ({
      words: [{ text: language === 'hi' ? 'नमस्ते' : 'نمستے', start: 0, end: 1 }],
      language: language === 'auto' ? 'ur' : language,
    }));
    const result = await run(server.fetch, speech(2), 'auto');
    expect(server.calls.map((c) => c.language)).toEqual(['auto', 'hi']);
    expect(result).toMatchObject({ language: 'hi', words: [{ text: 'नमस्ते' }] });
  });
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
