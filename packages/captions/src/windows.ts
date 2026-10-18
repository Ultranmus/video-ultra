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
