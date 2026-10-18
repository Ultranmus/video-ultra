import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFORM } from '../model/project';
import { layerBounds, regionPad, regionSmallSize, regionTexel } from './grab';
import { placedGeometry } from './layout';

describe('pixels under a layer', () => {
  it('bounds a turned box, grown by the padding and clipped to the canvas', () => {
    const g = placedGeometry(1000, 500, 200, 100, { ...DEFAULT_TRANSFORM, x: 0.5, y: 0.5 });
    const b = new Int32Array(4);
    expect(layerBounds(g, 1000, 500, 0, b)).toBe(true);
    expect([...b]).toEqual([400, 200, 600, 300]);
    const turned = placedGeometry(1000, 500, 200, 100, { ...DEFAULT_TRANSFORM, rotation: 90 });
    layerBounds(turned, 1000, 500, 2, b);
    expect([...b]).toEqual([448, 148, 552, 352]);
    const edge = placedGeometry(1000, 500, 200, 100, { ...DEFAULT_TRANSFORM, x: 0, y: 0 });
    layerBounds(edge, 1000, 500, 0, b);
    expect([...b]).toEqual([0, 0, 100, 50]);
    const off = placedGeometry(1000, 500, 200, 100, { ...DEFAULT_TRANSFORM, x: 2 });
    expect(layerBounds(off, 1000, 500, 0, b)).toBe(false);
  });

  it('a blurred area scales with the canvas, so preview and export match', () => {
    for (const pixelate of [false, true]) {
      const small = regionTexel(0.5, pixelate, 540);
      const big = regionTexel(0.5, pixelate, 1080);
      expect(big / small).toBeCloseTo(2);
      expect(regionTexel(1, pixelate, 1080)).toBeGreaterThan(regionTexel(0, pixelate, 1080));
    }
    expect(regionTexel(0, false, 100)).toBe(2);
    expect(regionPad(10, false)).toBe(20);
    expect([...regionSmallSize(300, 100, 10, new Int32Array(2))]).toEqual([30, 10]);
    expect([...regionSmallSize(3, 1, 10, new Int32Array(2))]).toEqual([1, 1]);
  });
});
