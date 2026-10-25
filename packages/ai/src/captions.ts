import type { Transcriber, TranscriptWord } from '@video-ultra/core';
import { alignWords, snapToVoice, voicedShare } from './align-words';

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
  /** For tests / custom transports. Default: the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * What your endpoint answers for one piece of sound (DECISIONS #164). It receives a `POST` to
 * `<endpoint>?language=<code>` (an ISO 639-1 code, or `auto` to detect) whose body is the sound:
 * 32-bit float samples, little-endian, 16 kHz, mono, at most 31 s (`application/octet-stream`).
 */
export interface CaptionsEndpointReply {
  /**
   * The words said, in order, with punctuation. Give each `start` / `end` (seconds from the start
   * of this piece) when your service has them — the word-by-word highlight follows them. Without
   * times (plain strings, or objects without them) the words are timed from the sound itself,
   * which is close on steady speech but less exact.
   */
  words: (string | { text: string; start?: number; end?: number })[];
  /**
   * The language actually spoken (ISO 639-1). When it isn't the one asked for, answer the words
   * you have (or none): if no piece was in the chosen language, the editor says which language
   * it heard instead of making captions.
   */
  language: string;
}

/**
 * A {@link Transcriber} for your own captions endpoint (DECISIONS #164): any speech service, any
 * language, with the key on your server. Sends the sound in 30 s pieces (a short tail joins the
 * last; silent pieces aren't sent), one request at a time so memory stays flat, retries a busy
 * service twice, and adds each piece's words at its place in the video.
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
    async check() {
      return { available: true, onDevice: false, speed: options.speed ?? 8 };
    },
    async transcribe({ audio, duration, language, signal, onProgress }) {
      const words: TranscriptWord[] = [];
      let offset = 0;
      // Pieces in the chosen language, and the language heard in the others.
      let matched = 0;
      let other: string | null = null;
      let detected: string | null = null;
      // The last chunk takes up to a second more, so a tail of a few hundred ms isn't sent alone.
      const chunk = new Float32Array(CHUNK + SAMPLE_RATE);
      let filled = 0;
      const size = () => (duration - offset <= CHUNK / SAMPLE_RATE + 1 ? chunk.length : CHUNK);
      const send = async () => {
        const sound = chunk.subarray(0, filled);
        // Nearly silent (a quiet room, wind): nobody speaks, and nothing to make up.
        if (voicedShare(sound) >= MIN_VOICE) {
          const reply = await ask(call, options, sound, language, signal);
          const heard = reply.language.slice(0, 2).toLowerCase();
          if (language === 'auto' || heard === language) {
            matched++;
            if (reply.words.length) detected ??= heard;
          } else other ??= heard;
          for (const w of timed(reply.words, sound))
            words.push({ text: w.text, start: w.start + offset, end: w.end + offset });
        }
        offset += filled / SAMPLE_RATE;
        filled = 0;
        onProgress?.({ stage: 'transcribe', fraction: Math.min(1, offset / duration) });
      };
      onProgress?.({ stage: 'transcribe', fraction: 0 });
      for await (const piece of audio) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        for (let at = 0; at < piece.length;) {
          const take = Math.min(piece.length - at, size() - filled);
          chunk.set(piece.subarray(at, at + take), filled);
          filled += take;
          at += take;
          if (filled === size()) await send();
        }
      }
      if (filled > 0) await send();
      // Nothing in the chosen language: another one was spoken (the editor says which).
      if (other && matched === 0) return { words: [], language: other };
      return { words, language: language === 'auto' ? (detected ?? 'en') : language };
    },
  };
}

const SAMPLE_RATE = 16_000;
/** 30 s of sound per request. */
const CHUNK = 30 * SAMPLE_RATE;
const MIN_VOICE = 0.04;
/** A busy or rate-limited service gets two more tries, a few seconds apart. */
const RETRY_STATUS = [429, 502, 503, 504];
const RETRY_WAIT_MS = 3000;

/** The reply's words with times: its own, or from the sound when any are missing. */
function timed(words: CaptionsEndpointReply['words'], sound: Float32Array): TranscriptWord[] {
  const list = words
    .map((w) => (typeof w === 'string' ? { text: w } : w))
    .filter((w) => typeof w.text === 'string' && w.text.trim());
  const hasTimes = list.every(
    (w) => typeof w.start === 'number' && typeof w.end === 'number' && w.end >= w.start,
  );
  if (!hasTimes)
    return alignWords(
      list.map((w) => w.text.trim()),
      sound,
    );
  const end = sound.length / SAMPLE_RATE;
  let at = 0;
  const given = list.map((w) => {
    const start = Math.min(end, Math.max(at, w.start!));
    at = start;
    return { text: w.text.trim(), start, end: Math.min(end, Math.max(start, w.end!)) };
  });
  // Recognisers stretch a word back over the silence before it: put it on the voice.
  return snapToVoice(given, sound);
}

async function ask(
  call: typeof fetch,
  options: CaptionsEndpointOptions,
  sound: Float32Array,
  language: string,
  signal: AbortSignal,
): Promise<CaptionsEndpointReply> {
  const url = `${options.endpoint}${options.endpoint.includes('?') ? '&' : '?'}language=${encodeURIComponent(language)}`;
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
    if (attempt >= 2 || !RETRY_STATUS.includes(response.status))
      throw Object.assign(
        new Error(
          response.status === 429 || response.status === 503
            ? 'The captions service is busy — try again in a moment.'
            : `The captions service failed (${response.status}).`,
        ),
        { status: response.status },
      );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, RETRY_WAIT_MS);
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
