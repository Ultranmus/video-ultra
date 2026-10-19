import { describe, expect, it } from 'vitest';
import { inputSize, matteToRgba, toTensor } from './matte';

describe('background matte maths', () => {
  it('sizes the input: shorter side to 512 in multiples of 32, or a square', () => {
    expect(inputSize(4032, 3024, { resize: 'short', size: 512 })).toEqual({
      width: 672,
      height: 512,
    });
    expect(inputSize(1080, 1920, { resize: 'short', size: 512 })).toEqual({
      width: 512,
      height: 896,
    });
    expect(inputSize(10, 3000, { resize: 'short', size: 512 }).width).toBe(512);
    expect(inputSize(4032, 3024, { resize: 'square', size: 1024 })).toEqual({
      width: 1024,
      height: 1024,
    });
  });

  it('makes planar, normalised RGB', () => {
    const rgba = new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 0, 255]);
    const t = toTensor(rgba, 2, 1, { mean: 0.5, std: 0.5 });
    expect([...t].map((v) => +v.toFixed(3))).toEqual([1, -1, -1, 1, 0.004, -1]);
    expect([...toTensor(rgba, 2, 1, { mean: 0, std: 1 })].map((v) => +v.toFixed(2))).toEqual([
      1, 0, 0, 1, 0.5, 0,
    ]);
  });

  it('turns the matte into alpha', () => {
    expect(
      [...matteToRgba(new Float32Array([0, 0.5, 1.2, -1]))].filter((_, i) => i % 4 === 3),
    ).toEqual([0, 128, 255, 0]);
  });
});
