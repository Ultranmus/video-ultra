import { FLICKS_PER_SECOND } from '@video-ultra/core';

/** Timecode for people: `0:04.2` (tenths), so digits don't flicker while playing. */
export function formatClock(t: number): string {
  const tenths = Math.floor((Math.max(0, t) / FLICKS_PER_SECOND) * 10);
  const s = Math.floor(tenths / 10);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  const body = `${ss}.${tenths % 10}`;
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${body}` : `${m}:${body}`;
}

/** A duration for labels: `3.4 s`, `1 min 05 s`. */
export function formatDurationShort(t: number): string {
  const seconds = Math.max(0, t) / FLICKS_PER_SECOND;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  return `${m} min ${String(Math.round(seconds % 60)).padStart(2, '0')} s`;
}

/**
 * A language's name in the reader's language (`'hi'` → "Hindi"), from the browser; Hindi in
 * Latin letters (`'hi-Latn'`) is "Hinglish", the name people use.
 */
export function languageName(code: string): string {
  if (code === 'hi-Latn') return 'Hinglish';
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
