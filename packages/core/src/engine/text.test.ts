import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_STYLE } from '../model/project';
import { textItem } from '../test/fixtures';
import { measureTextBox, rasterSize, textFont, textFontPx } from './text';

// A fake monospace font: every character is 0.5 em wide.
const measure = (font: string, text: string) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
  return [...text].length * px * 0.5;
};

describe('text box', () => {
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
