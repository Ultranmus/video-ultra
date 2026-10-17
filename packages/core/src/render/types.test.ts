import { describe, expect, it } from 'vitest';
import { placementMatrix, type FramePlacement } from './types';

/** Applies the matrix to a unit-quad corner and returns clip-space coordinates. */
function apply(m: Float32Array, qx: number, qy: number): [number, number] {
  return [m[0]! * qx + m[1]! * qy, m[2]! * qx + m[3]! * qy];
}

const landscape: FramePlacement = { rotation: 0, flip: false, width: 1920, height: 1080 };

describe('placementMatrix', () => {
  it('fills a canvas of the same aspect ratio exactly', () => {
    const m = placementMatrix(landscape, 1920, 1080, new Float32Array(4));
    expect(apply(m, -1, -1)).toEqual([-1, 1]); // top-left of the frame → top-left of clip space
    expect(apply(m, 1, 1)).toEqual([1, -1]);
  });

  it('letterboxes a wide frame in a tall canvas', () => {
    const m = placementMatrix(landscape, 1080, 1920, new Float32Array(4));
    const [x, y] = apply(m, 1, 1);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo((-1080 * (1080 / 1920)) / 1920); // contain-fit height in clip units
  });

  it('rotates 90° clockwise: the frame top-left corner lands top-right', () => {
    const m = placementMatrix({ ...landscape, rotation: 90 }, 1080, 1920, new Float32Array(4));
    const [x, y] = apply(m, -1, -1);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(1);
  });

  it('rotates 180°: top-left lands bottom-right', () => {
    const m = placementMatrix({ ...landscape, rotation: 180 }, 1920, 1080, new Float32Array(4));
    const [x, y] = apply(m, -1, -1);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(-1);
  });

  it('flips horizontally', () => {
    const m = placementMatrix({ ...landscape, flip: true }, 1920, 1080, new Float32Array(4));
    const [x] = apply(m, -1, -1);
    expect(x).toBeCloseTo(1);
  });
});
