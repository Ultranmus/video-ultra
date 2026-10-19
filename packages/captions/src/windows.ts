import type { TranscriptWord } from '@video-ultra/core';

/**
 * Long sound is heard in windows the model can take (30 s), overlapping by 2 s so a word cut at
 * one window's edge is whole in the next. Each word is kept from the window where it sits
 * furthest from an edge: a window owns [its start + 1 s, its start + 29 s) — the first from 0,
 * the last to the end. Pure; tested.
 */

/** Window length the model takes (s). */
export const WINDOW_SECONDS = 30;
/** How far each window starts after the previous (s): 2 s of overlap. */
export const STEP_SECONDS = 28;

/** The part of window `index` whose words are kept (seconds on the whole sound's clock). */
export function ownedSpan(index: number, isLast: boolean): { from: number; to: number } {
  const start = index * STEP_SECONDS;
  return {
    from: index === 0 ? 0 : start + (WINDOW_SECONDS - STEP_SECONDS) / 2,
    to: isLast ? Infinity : start + STEP_SECONDS + (WINDOW_SECONDS - STEP_SECONDS) / 2,
  };
}

/**
 * Words of one window (times relative to the window) → the words it owns, on the whole sound's
 * clock, tidied: trimmed text, no empties, times clamped so each word ends after it starts.
 */
export function keepWords(
  words: readonly TranscriptWord[],
  index: number,
  isLast: boolean,
  /** Length of the window's sound (s): the model pads short ones and may "hear" words past it. */
  length = WINDOW_SECONDS,
): TranscriptWord[] {
  const offset = index * STEP_SECONDS;
  const span = ownedSpan(index, isLast);
  const out: TranscriptWord[] = [];
  for (const w of words) {
    const text = w.text.trim();
    if (!text || w.start >= length) continue;
    // Sound descriptions the model sometimes writes ("[music]", "(applause)", "♪").
    if (/^[[(♪].*[\])♪]$|^[♪\s]+$/u.test(text)) continue;
    const start = Math.max(0, w.start + offset);
    const end = Math.max(
      start + 0.01,
      Math.min(length, Number.isFinite(w.end) ? w.end : w.start + 0.3) + offset,
    );
    const mid = (start + Math.min(end, start + 1)) / 2;
    if (mid < span.from || mid >= span.to) continue;
    out.push({ text, start, end });
  }
  return out;
}

/**
 * Cuts a stream of PCM pieces into overlapping model windows, keeping only what the next window
 * needs (memory stays flat however long the sound is).
 */
export async function* windowsOf(
  pieces: AsyncIterable<Float32Array>,
  sampleRate: number,
): AsyncGenerator<{ index: number; audio: Float32Array; isLast: boolean }> {
  const size = WINDOW_SECONDS * sampleRate;
  const step = STEP_SECONDS * sampleRate;
  let buffer = new Float32Array(size);
  let filled = 0;
  let index = 0;
  let pending: { index: number; audio: Float32Array } | null = null;
  for await (const piece of pieces) {
    let offset = 0;
    while (offset < piece.length) {
      const n = Math.min(size - filled, piece.length - offset);
      buffer.set(piece.subarray(offset, offset + n), filled);
      filled += n;
      offset += n;
      if (filled === size) {
        if (pending) yield { ...pending, isLast: false };
        pending = { index: index++, audio: buffer };
        // The next window starts with this one's last 2 s.
        const next = new Float32Array(size);
        next.set(buffer.subarray(step), 0);
        buffer = next;
        filled = size - step;
      }
    }
  }
  // The rest (more than the overlap that's already in the previous window).
  const tail = filled > size - step || !pending ? buffer.slice(0, filled) : null;
  if (pending) yield { ...pending, isLast: !tail || tail.length === 0 };
  if (tail && tail.length > 0) yield { index, audio: tail, isLast: true };
}

/** 20 ms frames at 16 kHz. */
const FRAME = 320;

/**
 * Which 20 ms frames of a window have sound loud enough to be speech (a quiet room, wind and
 * hum don't): louder than −44 dBFS and well above the window's own noise floor. Pure; tested.
 */
export function activeFrames(audio: Float32Array): Uint8Array {
  const n = Math.floor(audio.length / FRAME);
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) sum += audio[i]! * audio[i]!;
    rms[f] = Math.sqrt(sum / FRAME);
  }
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(n * 0.1)] ?? 0;
  const threshold = Math.max(0.006, floor * 3);
  const out = new Uint8Array(n);
  for (let f = 0; f < n; f++) out[f] = rms[f]! > threshold ? 1 : 0;
  return out;
}

/** Share of frames with sound (0…1). */
export function activeShare(active: Uint8Array): number {
  let k = 0;
  for (const a of active) k += a;
  return active.length ? k / active.length : 0;
}

/** Drops words said where there was no sound at all (times relative to the window, s). */
export function wordsWithSound<W extends { start: number; end: number }>(
  words: readonly W[],
  active: Uint8Array,
): W[] {
  return words.filter((w) => {
    const a = Math.max(0, Math.floor((w.start * 16_000) / FRAME) - 2);
    const b = Math.min(active.length, Math.ceil((w.end * 16_000) / FRAME) + 2);
    for (let f = a; f < b; f++) if (active[f]) return true;
    return false;
  });
}

/**
 * When the model's word timing collapses (every word stamped within half a second while the
 * window has much more sound — seen on real Hindi: all words at 29.8–30 s), the words would be
 * dropped as sitting outside the window's own span. Instead they're laid over the frames that
 * have sound, in order, each taking room in proportion to its length: rough timing beats no
 * captions, and the user can nudge them. Words with believable timing come back unchanged.
 */
export function spreadCollapsed<W extends { text: string; start: number; end: number }>(
  words: readonly W[],
  active: Uint8Array,
): W[] {
  if (words.length < 3) return [...words];
  const first = words[0]!.start;
  const last = words.at(-1)!.end;
  const voiced: number[] = [];
  for (let f = 0; f < active.length; f++) if (active[f]) voiced.push(f);
  const voicedSeconds = (voiced.length * FRAME) / 16_000;
  if (last - first > 0.5 || voicedSeconds < 2) return [...words];
  const weights = words.map((w) => Math.max(1, Array.from(w.text.trim()).length));
  const total = weights.reduce((a, b) => a + b, 0);
  const at = (share: number) => {
    const f = voiced[Math.min(voiced.length - 1, Math.floor(share * voiced.length))]!;
    return (f * FRAME) / 16_000;
  };
  let done = 0;
  return words.map((w, i) => {
    const start = at(done / total);
    done += weights[i]!;
    const end = Math.max(start + 0.05, at(done / total - 1e-9) + FRAME / 16_000);
    return { ...w, start, end };
  });
}
