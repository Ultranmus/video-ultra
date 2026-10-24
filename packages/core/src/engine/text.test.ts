import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_STYLE } from '../model/project';
import { textItem } from '../test/fixtures';
import {
  measureReveal,
  measureTextBox,
  rasterSize,
  revealCuts,
  textFont,
  textFontPx,
  type RevealCuts,
} from './text';

// A fake monospace font: every character is 0.5 em wide.
const measure = (font: string, text: string) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
  return [...text].length * px * 0.5;
};

describe('text box', () => {
  it('wraps to the wrap width, balancing the lines', () => {
    const item = textItem('t', 0);
    // Font 0.05 × 1000 = 50 px; every character 25 px wide.
    item.style = { ...item.style, size: 0.05, lineHeight: 1 };
    item.text = 'aaaa bbbb cccc dddd eeee';
    item.maxWidth = 0.5; // 500 px on a 1000-wide canvas: 20 characters at most
    const box = measureTextBox(item, 1000, 1000, measure);
    // Greedy would give "aaaa bbbb cccc dddd" (19) + "eeee"; balanced gives 14 + 9.
    expect(box.height).toBeCloseTo(2 * 50);
    expect(box.width).toBeCloseTo(14 * 25);
    delete item.maxWidth;
    expect(measureTextBox(item, 1000, 1000, measure).height).toBeCloseTo(50);
  });

  it('a bigger title keeps its lines; a bigger caption wraps inside the frame (#157)', () => {
    const item = textItem('t', 0);
    item.style = { ...item.style, size: 0.05, lineHeight: 1 };
    item.text = 'aaaa bbbb cccc dddd eeee';
    item.maxWidth = 0.5;
    item.transform.scale = 2; // 100 px font, 50 px a character
    const title = measureTextBox(item, 1000, 1000, measure);
    expect(title.height).toBeCloseTo(2 * 100); // the same two lines as at scale 1
    expect(title.width).toBeCloseTo(14 * 50);
    // Caption: still 500 px wide at most → 10 characters a line.
    const caption = measureTextBox(item, 1000, 1000, measure, true);
    expect(caption.height).toBeCloseTo(3 * 100);
  });

  it('sizes the block from the font size (size × canvas height × scale)', () => {
    const item = textItem('t', 0);
    item.text = 'Hello';
    expect(textFontPx(item, 1920)).toBeCloseTo(0.06 * 1920);
    const box = measureTextBox(item, 1080, 1920, measure);
    const px = 0.06 * 1920;
    expect(box.width).toBeCloseTo(5 * px * 0.5);
    expect(box.height).toBeCloseTo(DEFAULT_TEXT_STYLE.lineHeight * px);
  });

  it('uses the widest line, line height, letter spacing (em) and padding (× font size)', () => {
    const item = textItem('t', 0);
    item.text = 'ab\nabcd';
    item.transform.scale = 2;
    item.style = {
      ...item.style,
      size: 0.05,
      lineHeight: 1.5,
      letterSpacing: 0.1,
      background: { color: '#000', padding: 0.25, radius: 0.2 },
    };
    const px = 0.05 * 1000 * 2;
    const box = measureTextBox(item, 500, 1000, measure);
    expect(box.width).toBeCloseTo(4 * px * 0.5 + 4 * 0.1 * px + 2 * 0.25 * px);
    expect(box.height).toBeCloseTo(2 * 1.5 * px + 2 * 0.25 * px);
  });

  it('builds the CSS font shorthand', () => {
    expect(textFont({ ...DEFAULT_TEXT_STYLE, italic: true }, 40)).toBe('italic 700 40px system-ui');
  });

  it('rounds preview raster sizes to quarter octaves, export exact', () => {
    expect(rasterSize(100, true)).toBe(100);
    const r = rasterSize(100, false);
    expect(r / 100).toBeGreaterThan(0.9);
    expect(r / 100).toBeLessThan(1.1);
    expect(rasterSize(101, false)).toBe(r);
  });
});

describe('typewriter / word reveal', () => {
  // Two lines, 10 px per character, raster 200 px wide; line 2 is centred.
  const layout = measureReveal(
    ['ab cd', 'efg'],
    [0, 35],
    [50, 30],
    '10px x',
    0,
    (_font, text) => [...text].length * 10,
    { width: 200, height: 100, top: 10, lineHeight: 40, rtl: false },
  );
  const cuts = (f: number, by: 'char' | 'word'): RevealCuts =>
    revealCuts(layout, f, by, { line: 0, cutA: 0, cutB: 0, fadeB: 0 });

  it('measures characters and words per line', () => {
    expect(layout.chars).toBe(8);
    expect(layout.words).toBe(3);
    expect([...layout.lines[0]!.charEnd]).toEqual([10, 20, 30, 40, 50]);
    expect([...layout.lines[0]!.wordStart]).toEqual([0, 30]);
    expect([...layout.lines[0]!.wordEnd]).toEqual([20, 50]);
    expect([...layout.lines[1]!.wordEnd]).toEqual([30]);
  });

  it('shows characters one by one, line after line (last one just before the end)', () => {
    expect(cuts(0, 'char')).toEqual({ line: 0, cutA: 0, cutB: 0.05, fadeB: 0 });
    // 3 of 8 characters: "ab " shown, cut after 30 px on line 0.
    expect(cuts(3 / 8, 'char')).toMatchObject({ line: 0, cutA: 0.15 });
    // 6 of 8: line 0 done, "e" on line 1 (starts at 35 px).
    expect(cuts(6 / 8, 'char')).toMatchObject({ line: 1, cutA: 45 / 200 });
    expect(cuts(0.8, 'char')).toMatchObject({ line: 1, cutA: 55 / 200 });
    expect(cuts(0.99, 'char').line).toBe(2);
    expect(cuts(1, 'char').line).toBe(2);
  });

  it('fades words in one after another', () => {
    // 1.5 of 3 words: "ab" shown, "cd" half faded in.
    expect(cuts(0.5, 'word')).toEqual({
      line: 0,
      cutA: 0.15,
      cutB: 0.25,
      fadeB: expect.closeTo(0.5) as number,
    });
    expect(cuts(0.8, 'word')).toMatchObject({ line: 1, cutA: 35 / 200, cutB: 65 / 200 });
  });

  it('mirrors cuts for right-to-left text', () => {
    const rtl = { ...layout, rtl: true };
    const c = revealCuts(rtl, 1 / 8, 'char', { line: 0, cutA: 0, cutB: 0, fadeB: 0 });
    // Line 0 ends at 50 px: the first character sits at its right end.
    expect(c.cutA).toBeCloseTo((200 - 50 + 10) / 200);
  });
});
