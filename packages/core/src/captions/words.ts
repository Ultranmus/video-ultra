/**
 * What a "word" is on screen, for every language (DECISIONS #164): words are separated by
 * spaces, except in scripts written without them (Chinese, Japanese, Thai, Lao, Khmer, Myanmar),
 * where each character is a word. Punctuation stays with the word before it (an opening mark
 * with the word after). Captions, the word highlight and line wrapping all use this one rule,
 * so their words always line up. Pure; tested.
 */

const NO_SPACE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const SPACE = /^\s+$/u;
const MARK = /^[\p{P}\p{S}]+$/u;

let segmenter: Intl.Segmenter | null | undefined;

/** The characters of `text` as the reader sees them (a letter with its accents is one). */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
    segmenter = Seg ? new Seg(undefined, { granularity: 'grapheme' }) : null;
  }
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/** Whether a character belongs to a script written without spaces (Chinese, Thai…). */
export function isNoSpace(char: string): boolean {
  return NO_SPACE.test(char);
}

/** Each shown word of `text` as [first, end) grapheme indices into `graphemes(text)`. */
export function wordSpans(
  text: string,
  chars: readonly string[] = graphemes(text),
): [number, number][] {
  const spans: [number, number][] = [];
  let from = -1;
  // The open word is one character of a no-space script (only punctuation may follow it).
  let single = false;
  // The open word so far is only punctuation (an opening quote: it joins the word after).
  let marks = false;
  const close = (at: number) => {
    if (from >= 0) spans.push([from, at]);
    from = -1;
  };
  chars.forEach((ch, k) => {
    if (SPACE.test(ch)) return close(k);
    if (isNoSpace(ch)) {
      if (from >= 0 && !marks) close(k);
      if (from < 0) from = k;
      single = true;
      marks = false;
      return;
    }
    const mark = MARK.test(ch);
    if (from < 0) {
      from = k;
      single = false;
      marks = mark;
      return;
    }
    if (single && !mark) {
      close(k);
      from = k;
      single = false;
      marks = false;
      return;
    }
    if (!mark) marks = false;
  });
  close(chars.length);
  return spans;
}

/** The words of `text` as the screen shows them. */
export function captionWords(text: string): string[] {
  const chars = graphemes(text);
  return wordSpans(text, chars).map(([a, b]) => chars.slice(a, b).join(''));
}

/** Two pieces of text joined as shown: a space, except next to a no-space script. */
export function joinWords(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const last = graphemes(a).at(-1) ?? '';
  const first = graphemes(b)[0] ?? '';
  return isNoSpace(last) || isNoSpace(first) ? a + b : `${a} ${b}`;
}

/** Words joined into the text that shows them (see {@link joinWords}). */
export function joinCaptionWords(words: readonly string[]): string {
  return words.reduce((text, word) => joinWords(text, word), '');
}

/** How wide `text` reads, in Latin-letter widths: a no-space-script character counts two. */
export function textWidth(text: string): number {
  let n = 0;
  for (const ch of graphemes(text)) n += isNoSpace(ch) ? 2 : 1;
  return n;
}
