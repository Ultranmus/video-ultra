import type { TranscriptWord } from './transcriber';
import { fromSeconds, type Time } from '../model/time';
import type { CaptionWord } from '../model/schema';

/**
 * Timed words → captions people can read (v0.2 A1): a caption ends at a sentence end, a pause,
 * or when it gets too long to read at a glance. Pure; tested.
 */

/** Options of {@link groupCaptions}. */
export interface GroupOptions {
  /** Most characters on screen at once (one line ≈ 32). Default 32. */
  maxChars?: number;
  /** Longest a caption stays (s). Default 3.5. */
  maxSeconds?: number;
  /** A silence this long (s) starts a new caption. Default 0.6. */
  pauseSeconds?: number;
}

/** A caption made from words: its time on the timeline, text, and word times within it. */
export interface GroupedCaption {
  start: Time;
  end: Time;
  text: string;
  words: CaptionWord[];
}

const SENTENCE_END = /[.!?。！？।]["')\]]*$/u;

/**
 * Groups words (seconds, from the start of the sound) into captions, placed at `offset` on the
 * timeline. Words keep their own times; a caption runs from its first word's start to its last
 * word's end (at least 0.4 s).
 */
export function groupCaptions(
  words: readonly TranscriptWord[],
  offset: Time = 0,
  options: GroupOptions = {},
): GroupedCaption[] {
  const maxChars = options.maxChars ?? 32;
  const maxSeconds = options.maxSeconds ?? 3.5;
  const pause = options.pauseSeconds ?? 0.6;
  const out: GroupedCaption[] = [];
  let current: TranscriptWord[] = [];
  const flush = () => {
    if (!current.length) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    const start = offset + fromSeconds(first.start);
    const end = Math.max(offset + fromSeconds(last.end), start + fromSeconds(0.4));
    out.push({
      start,
      end,
      text: current.map((w) => w.text).join(' '),
      words: current.map((w) => ({
        text: w.text,
        start: Math.max(0, offset + fromSeconds(w.start) - start),
        end: Math.max(0, offset + fromSeconds(w.end) - start),
      })),
    });
    current = [];
  };
  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;
    const prev = current[current.length - 1];
    if (prev) {
      const chars = current.reduce((n, w) => n + w.text.length + 1, 0) + text.length;
      const long = chars > maxChars || word.end - current[0]!.start > maxSeconds;
      if (word.start - prev.end >= pause || long || SENTENCE_END.test(prev.text)) flush();
    }
    current.push({ text, start: word.start, end: Math.max(word.end, word.start) });
  }
  flush();
  // Captions never overlap: each ends by the time the next starts.
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]!;
    const b = out[i + 1]!;
    if (a.end > b.start) a.end = Math.max(a.start + 1, b.start);
  }
  return out;
}
