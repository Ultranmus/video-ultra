import type { TranscribeRequest, Transcriber, TranscriptWord } from '@video-ultra/core';
import { alignWords, isQuiet, quietestCut, snapToVoice, voiceOf, voicedShare } from './align-words';
import { createSpeechDetector, type SpeechDetectorOptions } from './speech-detect';

/** Options of {@link createCaptionsEndpoint}. */
export interface CaptionsEndpointOptions {
  /**
   * Your captions endpoint — your own server, which calls whichever speech service you use and
   * keeps its key (see {@link CaptionsEndpointReply} for what it receives and answers).
   */
  endpoint: string;
  /**
   * Languages your service hears (ISO 639-1), plus `'auto'` if it can detect the language; the
   * Captions panel offers exactly these. Default: the panel's own list and Detect.
   */
  languages?: readonly string[];
  /** Extra request headers (e.g. your app's session token). */
  headers?: Record<string, string>;
  /** Roughly how many seconds of speech it captions per second, for "about N min". Default 8. */
  speed?: number;
  /** Pieces sent at once on long videos (one while the service is busy). Default 3. */
  parallel?: number;
  /**
   * How to find where people speak in a piece. `'detector'` (default where workers run): a small
   * speech detector on the device (`createSpeechDetector`) — tells speech from music and noise;
   * `'loudness'`: by loudness only (no download); or your own (one byte per 20 ms, 1 = speech).
   */
  voice?: 'detector' | 'loudness' | ((sound: Float32Array) => Promise<Uint8Array> | Uint8Array);
  /** Where the speech detector's model and runtime come from (see `createSpeechDetector`). */
  detector?: SpeechDetectorOptions;
  /** For tests / custom transports. Default: the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * First wait before trying a busy service again (ms), doubling each time, four tries more;
   * a `Retry-After` header from your endpoint wins. Default 3000.
   */
  retryWait?: number;
}

/**
 * What your endpoint answers for one piece of sound. It receives a
 * `POST` to `<endpoint>?language=<code>` (an ISO 639-1 code; `hi-Latn` for Hinglish — Hindi in
 * Latin letters, as people type it; or `auto` to detect) whose body is
 * the sound: 32-bit float samples, little-endian, 16 kHz, mono, at most 31 s
 * (`application/octet-stream`). Optional query parameters, to pass on to your service as a hint
 * (e.g. Whisper's `prompt`): `context` — the last words said before this piece; `vocabulary` —
 * names and words that may be said, comma-separated.
 */
export interface CaptionsEndpointReply {
  /**
   * The words said, in order, with punctuation. Give each `start` / `end` (seconds from the start
   * of this piece) when your service has them — the word-by-word highlight follows them. Without
   * times (plain strings, or objects without them) the words are timed from the sound itself,
   * which is close on steady speech but less exact. `confidence` (0…1), when your service has
   * one: words under 0.3 are dropped (likely made up), captions averaging under 0.6 are marked
   * for the person to check.
   */
  words: (string | { text: string; start?: number; end?: number; confidence?: number })[];
  /**
   * The language actually spoken (ISO 639-1). When it isn't the one asked for, answer the words
   * you have (or none): if no piece was in the chosen language, the editor says which language
   * it heard instead of making captions.
   */
  language: string;
}

/**
 * A {@link Transcriber} for your own captions endpoint: any speech
 * service, any language, with the key on your server. Sends the sound in pieces of up to 30 s,
 * cut where it's quietest (no word cut in two; silent pieces aren't sent), up to three at once
 * (one while the service is busy), and turns the replies into timed words: words said in the
 * silence before speech move onto it, made-up and doubtful words are dropped. Detect decides the
 * language from the first pieces with speech and asks for it from then on. When the service's own
 * word times stop well before a piece ends while people still speak, the rest of the piece is
 * asked for once more.
 *
 * ```tsx
 * import { createCaptionsEndpoint } from '@video-ultra/ai';
 * <VideoEditor transcriber={createCaptionsEndpoint({ endpoint: '/api/captions' })} />
 * ```
 */
export function createCaptionsEndpoint(options: CaptionsEndpointOptions): Transcriber {
  const call = options.fetch ?? fetch.bind(globalThis);
  return {
    ...(options.languages ? { languages: options.languages } : {}),
    takesVocabulary: true,
    async check() {
      return { available: true, onDevice: false, speed: options.speed ?? 8 };
    },
    async transcribe(request) {
      // Where people speak: the speech detector (one worker for this job), else by loudness.
      const choice = options.voice ?? (typeof Worker !== 'undefined' ? 'detector' : 'loudness');
      const detector = choice === 'detector' ? createSpeechDetector(options.detector) : null;
      let detecting = !!detector || typeof choice === 'function';
      const voiceIn = async (sound: Float32Array): Promise<Uint8Array> => {
        if (typeof choice === 'function') return choice(sound);
        if (detector && detecting)
          try {
            return await detector.detect(sound);
          } catch {
            // Couldn't load (offline, an old browser): by loudness from here on.
            detecting = false;
            detector.close();
          }
        return voiceOf(sound);
      };
      try {
        return await transcribeWith(request, voiceIn, () => detecting);
      } finally {
        detector?.close();
      }
    },
  };

  /** The job itself, with `voiceIn` finding where people speak in each piece. */
  async function transcribeWith(
    { audio, duration, language, vocabulary, signal, onProgress }: TranscribeRequest,
    voiceIn: (sound: Float32Array) => Promise<Uint8Array>,
    detecting: () => boolean,
  ) {
    const hint = vocabulary?.length ? vocabulary.join(', ').slice(0, 400) : '';
    const results = new Map<number, Heard>();
    let busy = false;
    const hear = async (piece: Piece, as: string): Promise<Heard> => {
      const before = results.get(piece.index - 1);
      const hints = { vocabulary: hint, onBusy: () => (busy = true) };
      const reply = await ask(call, options, piece.sound, as, signal, {
        ...hints,
        context: before ? lastWords(before.words) : '',
      });
      const words = timed(reply.words, piece.sound, piece.voice);
      // The service stopped early (its own times end well before the piece, and the voice goes
      // on): the rest of the piece is asked once more, from the last word (DECISIONS #208).
      const end = words.at(-1)?.end ?? 0;
      if (
        ownTimes(reply.words) &&
        words.length &&
        piece.sound.length / RATE - end > SEEK_MIN_LEFT &&
        voiceAfter(piece.voice, end + 0.5) >= SEEK_MIN_VOICE
      ) {
        const frame = Math.floor(end / FRAME_SECONDS);
        const from = frame * FRAME_SECONDS;
        const rest = piece.sound.subarray(Math.round(from * RATE));
        const more = await ask(call, options, rest, as, signal, {
          ...hints,
          context: lastWords(words),
        });
        for (const w of timed(more.words, rest, piece.voice.subarray(frame)))
          words.push({ ...w, start: w.start + from, end: w.end + from });
      }
      return { start: piece.start, language: reply.language.slice(0, 2).toLowerCase(), words };
    };

    // Detect: the first pieces with speech vote (doubtful ones don't count); then every piece
    // is asked for that language, and earlier ones heard otherwise are asked again.
    let decided: string | null = language === 'auto' ? null : language;
    const voting: { piece: Piece; heard: Heard }[] = [];
    const votes = new Map<string, number>();
    const decide = async (final: boolean) => {
      let best: string | null = null;
      for (const [lang, n] of votes) if (best === null || n > votes.get(best)!) best = lang;
      if (!final && (best === null || votes.get(best)! < 2) && voting.length < 3) return;
      const chosen = alikeChoice(best ?? 'en');
      decided = chosen;
      for (const v of voting)
        results.set(
          v.piece.index,
          v.heard.language === chosen || !v.heard.words.length
            ? v.heard
            : await hear(v.piece, chosen),
        );
      voting.length = 0;
    };

    let done = 0;
    const progress = (seconds: number) => {
      done += seconds;
      onProgress?.({ stage: 'transcribe', fraction: Math.min(1, done / duration) });
    };
    const inFlight = new Set<Promise<void>>();

    onProgress?.({ stage: 'transcribe', fraction: 0 });
    for await (const cut of pieces(audio, duration, signal)) {
      const voice = await voiceIn(cut.sound);
      const piece: Piece = { ...cut, voice };
      const seconds = piece.sound.length / RATE;
      // Nobody speaks, so nothing to send (and nothing to make up): the detector found no
      // speech, or — by loudness, which can't hear speech under music — the piece is quiet.
      if (detecting() ? voicedShare(voice) < MIN_VOICE : isQuiet(piece.sound)) {
        progress(seconds);
        continue;
      }
      if (decided === null) {
        const heard = await hear(piece, 'auto');
        voting.push({ piece, heard });
        const sure = mean(heard.words.map((w) => w.confidence ?? 1));
        if (heard.words.length && sure >= 0.5)
          votes.set(heard.language, (votes.get(heard.language) ?? 0) + 1);
        await decide(false);
        progress(seconds);
        continue;
      }
      // A free slot (one while the service is busy): pieces go out together.
      while (inFlight.size >= (busy ? 1 : (options.parallel ?? PARALLEL)))
        await Promise.race(inFlight);
      const as = decided;
      const job: Promise<void> = hear(piece, as).then((heard) => {
        results.set(piece.index, heard);
        inFlight.delete(job);
        progress(seconds);
      });
      inFlight.add(job);
      // A failure surfaces at the next wait (no unhandled rejection meanwhile).
      job.catch(() => undefined);
    }
    if (decided === null) await decide(true);
    await Promise.all(inFlight);

    // In order. A chosen language that no piece was in: say what was heard instead — judged
    // only on pieces heard with confidence (a doubtful guess at "Malay" isn't evidence).
    const words: TranscriptWord[] = [];
    // The language itself (Hinglish, `hi-Latn`, is Hindi heard).
    const base = language.split('-')[0]!;
    let matched = 0;
    let other: string | null = null;
    let clear = 0;
    for (const index of [...results.keys()].sort((a, b) => a - b)) {
      const heard = results.get(index)!;
      const doubtful =
        heard.words.length > 0 && mean(heard.words.map((w) => w.confidence ?? 1)) < 0.5;
      if (heard.words.length && !doubtful) clear++;
      if (language === 'auto' || heard.language === base || doubtful) matched++;
      else other ??= heard.language;
      for (const w of heard.words)
        words.push({ ...w, start: w.start + heard.start, end: w.end + heard.start });
    }
    if (language !== 'auto' && other && matched === 0) return { words: [], language: other };
    // Nothing heard clearly anywhere (speech buried in noise): no captions rather than guesses.
    if (words.length && clear === 0) return { words: [], language };
    return { words, language: language === 'auto' ? (decided ?? 'en') : language };
  }
}

/** A piece of the sound, as sent: its place, start (s), samples and where the voice is. */
interface Piece {
  index: number;
  start: number;
  sound: Float32Array;
  voice: Uint8Array;
}

/** A piece's reply, timed: where the piece starts (s), the language heard, the words. */
interface Heard {
  start: number;
  language: string;
  words: TranscriptWord[];
}

const RATE = 16_000;
/** Pieces are cut between 25 and 30 s, at the quietest moment. */
const CUT_MIN = 25;
const CUT_MAX = 30;
const MIN_VOICE = 0.04;
/** `voice` has one byte per 20 ms. */
const FRAME_SECONDS = 0.02;
/** An early end: the words stop more than this before the piece's end (s)… */
const SEEK_MIN_LEFT = 2;
/** …and at least this much voice follows them (s). */
const SEEK_MIN_VOICE = 3;
const PARALLEL = 3;
/** Words with a confidence under this are dropped (likely made up). */
const DROP_BELOW = 0.3;
/** A busy or rate-limited service gets four more tries, waiting longer each time. */
const RETRY_STATUS = [429, 502, 503, 504];
const RETRIES = 4;
/** Longest wait a `Retry-After` may ask for (ms). */
const RETRY_MAX_MS = 60_000;

/**
 * The sound in pieces of up to 30 s, each ending at the quietest moment between 25 and 30 s;
 * the last one may run to 31 s so a short tail isn't sent alone. Memory: one 31 s buffer.
 */
async function* pieces(
  audio: AsyncIterable<Float32Array>,
  duration: number,
  signal: AbortSignal,
): AsyncGenerator<Omit<Piece, 'voice'>> {
  const buffer = new Float32Array((CUT_MAX + 1) * RATE);
  let filled = 0;
  let start = 0;
  let index = 0;
  const emit = (length: number) => {
    const piece = { index: index++, start, sound: buffer.slice(0, length) };
    buffer.copyWithin(0, length, filled);
    filled -= length;
    start += length / RATE;
    return piece;
  };
  for await (const chunk of audio) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    for (let at = 0; at < chunk.length;) {
      const take = Math.min(chunk.length - at, buffer.length - filled);
      buffer.set(chunk.subarray(at, at + take), filled);
      filled += take;
      at += take;
      // Full enough, with more than a second still to come: cut at the quietest moment.
      const left = duration - start - filled / RATE;
      if (filled >= CUT_MAX * RATE && left > 1)
        yield emit(quietestCut(buffer.subarray(0, filled), CUT_MIN, CUT_MAX));
      else if (filled === buffer.length) yield emit(filled);
    }
  }
  if (filled > 0) yield emit(filled);
}

/** Whether every word of a reply has its own times. */
function ownTimes(words: CaptionsEndpointReply['words']): boolean {
  return (
    words.length > 0 &&
    words.every(
      (w) =>
        typeof w !== 'string' &&
        typeof w.start === 'number' &&
        typeof w.end === 'number' &&
        w.end >= w.start,
    )
  );
}

/** Seconds with voice from `from` (s) to the end (`voice`: one byte per 20 ms). */
function voiceAfter(voice: Uint8Array, from: number): number {
  let k = 0;
  for (let f = Math.max(0, Math.ceil(from / FRAME_SECONDS)); f < voice.length; f++) k += voice[f]!;
  return k * FRAME_SECONDS;
}

/** The reply's words with times: its own, or from the sound when any are missing. */
function timed(
  words: CaptionsEndpointReply['words'],
  sound: Float32Array,
  voice: Uint8Array,
): TranscriptWord[] {
  const list = words
    .map((w) => (typeof w === 'string' ? { text: w } : w))
    .filter((w) => typeof w.text === 'string' && w.text.trim())
    // Likely made up (the service says so): dropped.
    .filter((w) => !(typeof w.confidence === 'number' && w.confidence < DROP_BELOW));
  const hasTimes = list.every(
    (w) => typeof w.start === 'number' && typeof w.end === 'number' && w.end >= w.start,
  );
  if (!hasTimes)
    return alignWords(
      list.map((w) => w.text.trim()),
      sound,
      voice,
    );
  const end = sound.length / RATE;
  let at = 0;
  // Words timed past the end of the piece can't be in it (a service's mistake): left out.
  const given = list
    .filter((w) => w.start! < end)
    .map((w) => {
      const start = Math.min(end, Math.max(at, w.start!));
      at = start;
      return {
        text: w.text.trim(),
        start,
        end: Math.min(end, Math.max(start, w.end!)),
        ...(typeof w.confidence === 'number' ? { confidence: w.confidence } : {}),
      };
    });
  // Recognisers stretch a word back over the silence before it: put it on the voice.
  return snapToVoice(unsaid(given), sound, voice);
}

/**
 * Without runs of words nobody could say: three or more in a row each under 50 ms — Whisper
 * squeezes made-up endings ("like, share and subscribe") into the last instant of a piece.
 */
function unsaid(words: TranscriptWord[]): TranscriptWord[] {
  const keep = words.map(() => true);
  for (let i = 0; i < words.length;) {
    let j = i;
    while (j < words.length && words[j]!.end - words[j]!.start < 0.05) j++;
    if (j - i >= 3) keep.fill(false, i, j);
    i = j > i ? j : i + 1;
  }
  return words.filter((_, i) => keep[i]);
}

/** The last words said, as a hint for the next piece (about 200 characters). */
function lastWords(words: readonly TranscriptWord[]): string {
  return words
    .slice(-40)
    .map((w) => w.text)
    .join(' ')
    .slice(-200);
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Hindi or Urdu (spoken alike, written in different scripts): Urdu when the browser is set to
 * Urdu or to Pakistan, else Hindi (DECISIONS #166). Other languages as heard.
 */
function alikeChoice(heard: string): string {
  if (heard !== 'hi' && heard !== 'ur') return heard;
  const langs =
    typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  return langs.some((l) => /^ur\b|-PK$/i.test(l)) ? 'ur' : 'hi';
}

async function ask(
  call: typeof fetch,
  options: CaptionsEndpointOptions,
  sound: Float32Array,
  language: string,
  signal: AbortSignal,
  hints: { context: string; vocabulary: string; onBusy: () => void },
): Promise<CaptionsEndpointReply> {
  const query = new URLSearchParams({ language });
  if (hints.context) query.set('context', hints.context);
  if (hints.vocabulary) query.set('vocabulary', hints.vocabulary);
  const url = `${options.endpoint}${options.endpoint.includes('?') ? '&' : '?'}${query}`;
  for (let attempt = 0; ; attempt++) {
    const response = await call(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', ...(options.headers ?? {}) },
      body: sound.slice(),
      signal,
    });
    if (response.ok) {
      const reply = (await response.json()) as Partial<CaptionsEndpointReply>;
      return {
        words: Array.isArray(reply.words) ? reply.words : [],
        language: typeof reply.language === 'string' && reply.language ? reply.language : language,
      };
    }
    // The status rides along, so the editor can tell "busy, try again" from a real failure.
    if (attempt >= RETRIES || !RETRY_STATUS.includes(response.status))
      throw Object.assign(
        new Error(
          response.status === 429 || response.status === 503
            ? 'The captions service is busy — try again in a moment.'
            : `The captions service failed (${response.status}).`,
        ),
        { status: response.status },
      );
    hints.onBusy();
    const asked = Number(response.headers.get('retry-after'));
    const wait =
      asked > 0 ? Math.min(RETRY_MAX_MS, asked * 1000) : (options.retryWait ?? 3000) * 2 ** attempt;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, wait);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Cancelled', 'AbortError'));
        },
        { once: true },
      );
    });
  }
}
