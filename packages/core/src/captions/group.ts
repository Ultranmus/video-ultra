import type { TranscriptWord } from './transcriber';
import { fromSeconds, type Time } from '../model/time';
import type { CaptionWord } from '../model/schema';
import { captionWords, graphemes, joinCaptionWords, joinWords, textWidth } from './words';

/**
 * Timed words → captions people can read (v0.2 A1): a caption ends at a sentence end, a pause,
 * or when it gets too long to read at a glance. Pure; tested.
 */

/** Options of {@link groupCaptions}. */
export interface GroupOptions {
  /**
   * Most characters on screen at once (one line ≈ 32; a Chinese / Japanese character counts
   * two). Default 32.
   */
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
  /** Its words were heard with little confidence: worth checking. */
  unsure?: boolean;
}

/** Captions whose words average a confidence under this are marked to check. */
export const UNSURE_BELOW = 0.6;

function unsureOf(words: readonly { confidence?: number }[]): boolean {
  const known = words.filter((w) => typeof w.confidence === 'number');
  if (!known.length) return false;
  return known.reduce((n, w) => n + w.confidence!, 0) / known.length < UNSURE_BELOW;
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
  let current: ShownWord[] = [];
  const flush = () => {
    if (!current.length) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    const start = offset + fromSeconds(first.start);
    const end = Math.max(offset + fromSeconds(last.end), start + fromSeconds(0.4));
    out.push({
      ...(unsureOf(current) ? { unsure: true } : {}),
      start,
      end,
      text: joinCaptionWords(current.map((w) => w.text)),
      words: current.map((w) => ({
        text: w.text,
        start: Math.max(0, offset + fromSeconds(w.start) - start),
        end: Math.max(0, offset + fromSeconds(w.end) - start),
      })),
    });
    current = [];
  };
  for (const word of shownWords(words)) {
    const text = word.text;
    const prev = current[current.length - 1];
    if (prev) {
      const chars = textWidth(joinCaptionWords([...current.map((w) => w.text), text]));
      const long = chars > maxChars || word.end - current[0]!.start > maxSeconds;
      // Characters of one word ("首先") stay together unless the line gets far too long.
      const inside = !!prev.joinsNext && chars <= maxChars + 8;
      if (!inside && (word.start - prev.end >= pause || long || SENTENCE_END.test(prev.text)))
        flush();
    }
    current.push({
      text,
      start: word.start,
      end: Math.max(word.end, word.start),
      ...(word.confidence !== undefined ? { confidence: word.confidence } : {}),
      ...(word.joinsNext ? { joinsNext: true as const } : {}),
    });
  }
  flush();
  // A lone word (a pause at a comma) joins the caption after it when that's close and still fits.
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]!;
    const b = out[i + 1]!;
    const close = b.start - a.end <= fromSeconds(1);
    const fits =
      textWidth(joinWords(a.text, b.text)) <= maxChars &&
      b.end - a.start <= fromSeconds(maxSeconds + 1);
    if (a.words.length === 1 && close && fits && !SENTENCE_END.test(a.text)) {
      const shift = b.start - a.start;
      out.splice(i, 2, {
        ...(a.unsure || b.unsure ? { unsure: true } : {}),
        start: a.start,
        end: b.end,
        text: joinWords(a.text, b.text),
        words: [
          ...a.words,
          ...b.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift })),
        ],
      });
      i--;
    }
  }
  // Captions never overlap: each ends by the time the next starts.
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]!;
    const b = out[i + 1]!;
    if (a.end > b.start) a.end = Math.max(a.start + 1, b.start);
  }
  return out;
}

/**
 * The words as the screen shows them (DECISIONS #164): a transcript word of a script written
 * without spaces ("你好") becomes one word per character, its time shared out by length, so a
 * caption's words always match what's drawn.
 */
/** A word as shown; `joinsNext`: the next one is another character of the same transcript word. */
type ShownWord = TranscriptWord & { joinsNext?: true };

function shownWords(words: readonly TranscriptWord[]): ShownWord[] {
  const out: ShownWord[] = [];
  for (const word of words) {
    const parts = captionWords(word.text);
    const sure = word.confidence !== undefined ? { confidence: word.confidence } : {};
    if (parts.length === 1)
      out.push({ text: parts[0]!, start: word.start, end: word.end, ...sure });
    if (parts.length < 2) continue;
    const sizes = parts.map((p) => graphemes(p).length);
    const total = sizes.reduce((a, b) => a + b, 0);
    let at = 0;
    parts.forEach((text, i) => {
      const start = word.start + ((word.end - word.start) * at) / total;
      at += sizes[i]!;
      const end = word.start + ((word.end - word.start) * at) / total;
      out.push(
        i < parts.length - 1
          ? { text, start, end, joinsNext: true, ...sure }
          : { text, start, end, ...sure },
      );
    });
  }
  return out;
}
