import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFORM, NO_CROP } from '../model/project';
import { applyGeometry, layerGeometry, type LayerLook, type LayerMedia } from './layout';

const landscape: LayerMedia = { width: 1920, height: 1080, rotation: 0, flip: false };
const look = (
  overrides: Partial<LayerLook['transform']> = {},
  rest: Partial<LayerLook> = {},
): LayerLook => ({
  transform: { ...DEFAULT_TRANSFORM, ...overrides },
  crop: { ...NO_CROP },
  fit: 'fit',
  ...rest,
});

function corner(g: Float32Array, qx: number, qy: number) {
  const { clip, uv } = applyGeometry(g, qx, qy);
  return {
    clip: clip.map((v) => Math.round(v * 1000) / 1000),
    uv: uv.map((v) => Math.round(v * 1000) / 1000),
  };
}

describe('layerGeometry', () => {
  it('fills a same-shape canvas exactly, texture upright', () => {
    const g = layerGeometry(1920, 1080, landscape, look());
    expect(corner(g, -1, -1)).toEqual({ clip: [-1, 1], uv: [0, 0] }); // top-left
    expect(corner(g, 1, 1)).toEqual({ clip: [1, -1], uv: [1, 1] }); // bottom-right
  });

  it('letterboxes a landscape video in a 9:16 canvas (fit)', () => {
    const g = layerGeometry(1080, 1920, landscape, look());
    const { clip } = corner(g, 1, 1);
    expect(clip[0]).toBe(1);
    expect(clip[1]).toBeCloseTo(-(1080 * (1080 / 1920)) / 1920, 3); // video height / canvas height
  });

  it('covers the canvas with fill (overflows the sides)', () => {
    const g = layerGeometry(1080, 1920, landscape, look({}, { fit: 'fill' }));
    const { clip } = corner(g, 1, 1);
    expect(clip[1]).toBeCloseTo(-1, 3);
    expect(clip[0]).toBeGreaterThan(1);
  });

  it('shows an iPhone portrait video (rotation 90) upright and filling a 9:16 canvas', () => {
    const portrait: LayerMedia = { width: 1920, height: 1080, rotation: 90, flip: false };
    const g = layerGeometry(1080, 1920, portrait, look());
    // Screen top-left shows texture bottom-left (the texture is rotated 90° clockwise for display).
    expect(corner(g, -1, -1)).toEqual({ clip: [-1, 1], uv: [0, 1] });
    expect(corner(g, 1, -1)).toEqual({ clip: [1, 1], uv: [0, 0] });
    expect(corner(g, 1, 1)).toEqual({ clip: [1, -1], uv: [1, 0] });
  });

  it('crops in display orientation', () => {
    const g = layerGeometry(1920, 1080, landscape, {
      ...look(),
      crop: { left: 0.25, top: 0, right: 0.25, bottom: 0 },
    });
    expect(corner(g, -1, -1).uv).toEqual([0.25, 0]);
    expect(corner(g, 1, 1).uv).toEqual([0.75, 1]);
    // Half as wide → fits the height, so it's narrower on screen.
    expect(corner(g, 1, 1).clip[0]).toBeCloseTo(0.5, 3);
  });

  it('places, scales, rotates and flips the item', () => {
    const half = layerGeometry(1920, 1080, landscape, look({ x: 0.25, y: 0.25, scale: 0.5 }));
    expect(corner(half, -1, -1).clip).toEqual([-1, 1]); // top-left quarter of the canvas
    expect(corner(half, 1, 1).clip).toEqual([0, 0]);

    const square: LayerMedia = { width: 1000, height: 1000, rotation: 0, flip: false };
    const turned = layerGeometry(1000, 1000, square, look({ rotation: 90 }));
    // Rotated 90° clockwise: the image's top-left corner is now at the top-right of the screen.
    expect(corner(turned, -1, -1).clip).toEqual([1, 1]);

    const mirrored = layerGeometry(1920, 1080, landscape, look({ flipX: true }));
    expect(corner(mirrored, -1, -1)).toEqual({ clip: [1, 1], uv: [0, 0] }); // texture left edge drawn on the right
  });

  it('applies the file’s own flip in texture space', () => {
    const g = layerGeometry(1920, 1080, { ...landscape, flip: true }, look());
    expect(corner(g, -1, -1)).toEqual({ clip: [-1, 1], uv: [1, 0] });
  });
});
