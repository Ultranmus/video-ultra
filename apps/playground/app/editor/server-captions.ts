import type { Transcriber, TranscriptWord } from '@video-ultra/core';
import { alignWords, voicedShare } from './align-words';

/**
 * The playground's captions (DECISIONS #163): every language through the server's captions
 * service (`/api/captions`, Gemini with the server's Google key). The editor's pieces are
 * gathered into 30 s chunks (fewer requests, whole sentences; memory stays flat), one request
 * each. The service gives the words; their times come from the sound (align-words.ts). Silent
 * chunks aren't sent. The editor page uses this only when the server has a key (else English
 * on the device). Not part of the package.
 */
export function createServerCaptions(endpoint = '/api/captions'): Transcriber {
  return {
    async check() {
      // A minute of speech in ~6 s (two requests; measured 2026-10-25, English and Hindi).
      return { available: true, onDevice: false, speed: 8 };
    },
    async transcribe({ audio, duration, language, signal, onProgress }) {
      const words: TranscriptWord[] = [];
      let heard = language;
      let offset = 0;
      // The last chunk takes up to a second more, so a tail of a few hundred ms isn't sent alone.
      const chunk = new Float32Array(CHUNK + SAMPLE_RATE);
      const size = () => (duration - offset <= CHUNK / SAMPLE_RATE + 1 ? chunk.length : CHUNK);
      let filled = 0;
      const send = async () => {
        const sound = chunk.subarray(0, filled);
        // Nearly silent (a quiet room, wind): nobody speaks, and nothing to make up.
        if (voicedShare(sound) >= MIN_VOICE) {
          const answer = await ask(endpoint, sound, language, signal);
          if (language === 'auto' && answer.words.length) heard = answer.language;
          for (const w of alignWords(answer.words, sound))
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
      return { words, language: heard === 'auto' ? 'en' : heard };
    },
  };
}

const SAMPLE_RATE = 16_000;
/** 30 s of sound per request (what the service takes). */
const CHUNK = 30 * SAMPLE_RATE;
const MIN_VOICE = 0.04;
/** A busy or rate-limited service gets two more tries, a few seconds apart. */
const RETRY_STATUS = [429, 503];
const RETRY_WAIT_MS = 3000;

async function ask(
  endpoint: string,
  piece: Float32Array,
  language: string,
  signal: AbortSignal,
): Promise<{ words: string[]; language: string }> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${endpoint}?language=${encodeURIComponent(language)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: piece.slice(),
      signal,
    });
    if (response.ok) return (await response.json()) as { words: string[]; language: string };
    if (attempt >= 2 || !RETRY_STATUS.includes(response.status))
      throw new Error(
        response.status === 429 || response.status === 503
          ? 'The captions service is busy — try again in a moment.'
          : `The captions service failed (${response.status}).`,
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
