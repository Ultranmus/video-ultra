import type { CaptionWord, TextItem } from '../model/schema';
import type { Time } from '../model/time';

/**
 * Where a caption's speech is at a moment (v0.2 A6): which word, and how far through it, so the
 * highlight can follow. Words come from the caption's own timings; when the text was typed or
 * edited so they no longer match, its time is shared out by word length. Pure; tested.
 */

/** Words of a caption as the screen shows them (split on spaces). */
export function captionWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Each shown word's start / end relative to the caption's start (flicks). */
export function captionWordTimes(
  item: Pick<TextItem, 'text' | 'duration' | 'words'>,
): CaptionWord[] {
  const shown = captionWords(item.text);
  const words = item.words;
  if (words && words.length === shown.length && words.length > 0)
    return shown.map((text, i) => ({ text, start: words[i]!.start, end: words[i]!.end }));
  const total = shown.reduce((n, w) => n + w.length, 0) || 1;
  let at = 0;
  return shown.map((text) => {
    const start = (at / total) * item.duration;
    at += text.length;
    return { text, start: Math.round(start), end: Math.round((at / total) * item.duration) };
  });
}

/** Where speech is at `local` time: the word being said (−1 before the first) and 0…1 through it. */
export interface SpeechPosition {
  /** Index of the current word; words before it are done. −1 before any word starts. */
  word: number;
  /** 0…1 through the current word (1 between words). */
  progress: number;
  /** Characters of the text done, counting the current word partly (for letter-by-letter). */
  chars: number;
  /** All characters (letters of the words, spaces excluded). */
  totalChars: number;
}

export function speechAt(times: readonly CaptionWord[], local: Time): SpeechPosition {
  let word = -1;
  let progress = 0;
  let chars = 0;
  const totalChars = times.reduce((n, w) => n + Array.from(w.text).length, 0);
  for (let i = 0; i < times.length; i++) {
    const w = times[i]!;
    const len = Array.from(w.text).length;
    if (local < w.start) break;
    word = i;
    if (local >= w.end) {
      progress = 1;
      chars += len;
    } else {
      progress = w.end > w.start ? (local - w.start) / (w.end - w.start) : 1;
      chars += len * progress;
      break;
    }
  }
  return { word, progress, chars, totalChars };
}
