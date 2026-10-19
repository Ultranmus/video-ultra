import { describe, expect, it } from 'vitest';
import { computeScopes, SCOPE_ROWS, VECTOR_SIZE, vectorPoint } from './scopes';

const frame = (
  w: number,
  h: number,
  colour: (x: number, y: number) => [number, number, number],
) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colour(x, y);
      out.set([r, g, b, 255], (y * w + x) * 4);
    }
  return out;
};

describe('scopes', () => {
  it('a left-to-right grey ramp: histogram flat, waveform a rising line, vector centre', () => {
    const w = 256;
    const s = computeScopes(
      frame(w, 4, (x) => [x, x, x]),
      w,
      4,
    );
    expect(s.pixels).toBe(1024);
    // Every level once per row (×4 rows) in each channel and luma.
    for (const c of [0, 1, 2, 3])
      expect(s.histogram.slice(c * 256, c * 256 + 256).every((n) => n === 4)).toBe(true);
    // Column x: all 4 pixels at row top − x/2.
    for (const x of [0, 100, 255]) expect(s.waveform[(SCOPE_ROWS - 1 - (x >> 1)) * w + x]).toBe(4);
    // Greys sit in the vectorscope's centre.
    const c = Math.round(0.5 * (VECTOR_SIZE - 1));
    expect(s.vector[c * VECTOR_SIZE + c]).toBe(1024);
  });

  it('parade splits the channels; pure colours land on their vectorscope targets', () => {
    const s = computeScopes(
      frame(2, 1, (x) => (x === 0 ? [255, 0, 0] : [0, 0, 255])),
      2,
      1,
    );
    const plane = 2 * SCOPE_ROWS;
    // Red pixel (column 0): red trace at the top, green / blue at the bottom.
    expect(s.parade[0 * plane + 0 * 2 + 0]).toBe(1);
    expect(s.parade[1 * plane + (SCOPE_ROWS - 1) * 2 + 0]).toBe(1);
    // Red: up and a little left; blue: right.
    const red = vectorPoint(255, 0, 0);
    const blue = vectorPoint(0, 0, 255);
    expect(red.y).toBeLessThan(0.1);
    expect(red.x).toBeLessThan(0.5);
    expect(blue.x).toBeGreaterThan(0.95);
    const at = (p: { x: number; y: number }) =>
      s.vector[
        Math.round(p.y * (VECTOR_SIZE - 1)) * VECTOR_SIZE + Math.round(p.x * (VECTOR_SIZE - 1))
      ];
    expect(at(red)).toBe(1);
    expect(at(blue)).toBe(1);
  });

  it('a full 256×256 flat frame counts without overflow', () => {
    const s = computeScopes(
      frame(256, 256, () => [10, 200, 30]),
      256,
      256,
    );
    expect(s.histogram[256 + 200]).toBe(65536);
    expect(s.vector.reduce((a, b) => a + b, 0)).toBe(65536);
  });
});
