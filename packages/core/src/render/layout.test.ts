import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFORM, NO_CROP } from '../model/project';
import {
  applyGeometry,
  layerGeometry,
  moveInBox,
  moveOnCanvas,
  type GeometryMove,
  type LayerLook,
  type LayerMedia,
} from './layout';

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

describe('geometry moves', () => {
  const move = (m: Partial<GeometryMove>): GeometryMove => ({
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    rotate: 0,
    dx: 0,
    dy: 0,
    pivotX: 0.5,
    pivotY: 0.5,
    ...m,
  });
  /** Canvas px of a quad corner. */
  const px = (g: Float32Array, qx: number, qy: number, w: number, h: number) => {
    const { clip } = applyGeometry(g, qx, qy);
    return [
      Math.round(((clip[0] + 1) / 2) * w * 10) / 10,
      Math.round(((1 - clip[1]) / 2) * h * 10) / 10,
    ];
  };

  it('identity moves change nothing', () => {
    const g = layerGeometry(1080, 1920, landscape, look());
    const before = [...g];
    moveOnCanvas(g, 1080, 1920, move({}));
    moveInBox(g, 1080, 1920, move({ pivotX: 0, pivotY: 0 }));
    for (let i = 0; i < 12; i++) expect(g[i]).toBeCloseTo(before[i]!, 6);
  });

  it('scales around a canvas pivot, squeezes along screen axes and shifts', () => {
    const g = layerGeometry(1000, 1000, { ...landscape, width: 1000, height: 1000 }, look());
    moveOnCanvas(g, 1000, 1000, move({ scaleX: 0.5, pivotX: 0 }));
    expect(px(g, -1, -1, 1000, 1000)).toEqual([0, 0]);
    expect(px(g, 1, 1, 1000, 1000)).toEqual([500, 1000]);
    moveOnCanvas(g, 1000, 1000, move({ dx: 0.25, dy: 0.1 }));
    expect(px(g, -1, -1, 1000, 1000)).toEqual([250, 100]);
  });

  it('rotates clockwise on screen without shearing a non-square canvas', () => {
    const g = layerGeometry(1600, 900, landscape, look({ scale: 0.5 }));
    moveOnCanvas(g, 1600, 900, move({ rotate: 90 }));
    // Top-left corner of a 800×450 box centred on (800, 450) goes to the top-right after 90°.
    expect(px(g, -1, -1, 1600, 900)).toEqual([1025, 50]);
  });

  it('moves within its own box: local squash, pivot stays put', () => {
    const g = layerGeometry(
      1000,
      1000,
      { ...landscape, width: 1000, height: 1000 },
      look({ scale: 0.5, rotation: 90 }),
    );
    // Squash along the item's own y (now horizontal on screen) around its bottom edge.
    moveInBox(g, 1000, 1000, move({ scaleY: 0.5, pivotX: 0, pivotY: 1 }));
    const bottom = px(g, 0, 1, 1000, 1000);
    expect(bottom).toEqual([250, 500]);
    const top = px(g, 0, -1, 1000, 1000);
    expect(top).toEqual([500, 500]);
  });
});
