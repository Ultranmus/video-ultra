import {
  createProject,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  fromSeconds,
  type ImageItem,
  type StickerItem,
  type TextItem,
} from '@video-ultra/core';
import { describe, expect, it } from 'vitest';
import { measureTextBox } from '@video-ultra/core/internal';
import { boxContains, hitStage, itemBox, lockOutline, snapCentre } from './geometry';
import { kindLabel, regionItem } from '../items';
import { DEFAULT_LABELS } from '../labels';

const measure = (_font: string, text: string) => text.length * 10;

function project() {
  const p = createProject({ width: 1080, height: 1920 });
  p.assets.img = {
    id: 'img',
    kind: 'image',
    name: 'a.jpg',
    mimeType: 'image/jpeg',
    size: 1,
    duration: 0,
    width: 1920,
    height: 1080,
    hasAudio: false,
    source: { type: 'url', url: 'x' },
  };
  return p;
}

const image = (patch: Partial<ImageItem> = {}): ImageItem => ({
  id: 'i',
  kind: 'image',
  assetId: 'img',
  start: 0,
  duration: fromSeconds(3),
  transform: { ...DEFAULT_TRANSFORM },
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  fit: 'fit',
  filter: null,
  adjust: {},
  transitionIn: null,
  ...patch,
});

describe('stage geometry', () => {
  it('fits and fills media like the compositor', () => {
    const p = project();
    const fit = itemBox(image(), p, 1080, 1920, measure)!;
    expect(fit.width).toBeCloseTo(1080);
    expect(fit.height).toBeCloseTo(607.5);
    const fill = itemBox(image({ fit: 'fill' }), p, 1080, 1920, measure)!;
    expect(fill.height).toBeCloseTo(1920);
    const cropped = itemBox(
      image({ crop: { left: 0.25, right: 0.25, top: 0, bottom: 0 } }),
      p,
      1080,
      1920,
      measure,
    )!;
    expect(cropped.width / cropped.height).toBeCloseTo(960 / 1080);
  });

  it('sizes emoji stickers as squares of the short side', () => {
    const sticker: StickerItem = {
      id: 's',
      kind: 'sticker',
      start: 0,
      duration: fromSeconds(1),
      assetId: null,
      emoji: '🔥',
      transform: { ...DEFAULT_TRANSFORM, scale: 0.3 },
      filter: null,
      adjust: {},
    };
    const box = itemBox(sticker, project(), 1080, 1920, measure)!;
    expect(box.width).toBeCloseTo(324);
    expect(box.height).toBeCloseTo(324);
  });

  it('measures text blocks with lines and background padding', () => {
    const text: TextItem = {
      id: 't',
      kind: 'text',
      start: 0,
      duration: fromSeconds(1),
      text: 'Hello\nWorld!!',
      style: {
        ...DEFAULT_TEXT_STYLE,
        outline: null,
        background: { color: '#000', padding: 0.5, radius: 0 },
      },
      transform: { ...DEFAULT_TRANSFORM },
      filter: null,
      adjust: {},
    };
    const px = DEFAULT_TEXT_STYLE.size * 1920;
    const size = measureTextBox(text, 1080, 1920, measure);
    expect(size.width).toBeCloseTo(70 + px);
    expect(size.height).toBeCloseTo(2 * 1.2 * px + px);
  });

  it('hit-tests rotated boxes and the topmost item', () => {
    const box = { cx: 100, cy: 100, width: 100, height: 20, rotation: 90 };
    expect(boxContains(box, 100, 140)).toBe(true);
    expect(boxContains(box, 140, 100)).toBe(false);
    const p = project();
    p.tracks[0]!.items.push(image({ id: 'bottom' }));
    p.tracks.push({
      id: 'lane',
      kind: 'overlay',
      muted: false,
      hidden: false,
      locked: false,
      items: [image({ id: 'top', transform: { ...DEFAULT_TRANSFORM, scale: 0.2 } })],
    });
    expect(hitStage(p, 0, 1080, 1920, 540, 960, measure, 0)?.id).toBe('top');
    expect(hitStage(p, 0, 1080, 1920, 540, 800, measure, 0)?.id).toBe('bottom');
    expect(hitStage(p, fromSeconds(5), 1080, 1920, 540, 960, measure, 0)).toBeNull();
  });

  it('snaps to the canvas centre', () => {
    expect(snapCentre(0.503, 0.01)).toEqual({ value: 0.5, snapped: true });
    expect(snapCentre(0.52, 0.01).snapped).toBe(false);
  });

  it('a blurred area is a square on screen, scaled by its transform (v0.2 C3)', () => {
    const p = project();
    const r = regionItem('r', 0, 'blur', 'ellipse', 1080, 1920);
    const box = itemBox(r, p, 1080, 1920, measure)!;
    expect(box.width).toBeCloseTo(box.height);
    expect(box.width).toBeCloseTo(1080 * 0.34);
    const big = itemBox({ ...r, transform: { ...r.transform, scale: 2 } }, p, 1080, 1920, measure)!;
    expect(big.width).toBeCloseTo(box.width * 2);
    expect(kindLabel(DEFAULT_LABELS, 'region', true)).toBe('Blurred area');
    expect(kindLabel(DEFAULT_LABELS, 'image')).toBe('photo');
  });
});

describe('lockOutline', () => {
  const round = (ps: { x: number; y: number }[]) =>
    ps.map((p) => [Math.round(p.x), Math.round(p.y)]);

  it('keeps an upright box inside the frame as is (grown by pad)', () => {
    const box = { cx: 50, cy: 40, width: 20, height: 10, rotation: 0 };
    expect(round(lockOutline(box, 2, 100, 100, 1))).toEqual([
      [38, 33],
      [62, 33],
      [62, 47],
      [38, 47],
    ]);
  });

  it('turns with the item', () => {
    const box = { cx: 50, cy: 50, width: 20, height: 20, rotation: 45 };
    const ps = lockOutline(box, 0, 100, 100, 1);
    expect(ps).toHaveLength(4);
    // A square turned 45°: corners on the axes through the centre.
    expect(round(ps)).toContainEqual([50, 36]);
    expect(round(ps)).toContainEqual([64, 50]);
  });

  it('trims a box bigger than the frame to the frame, every side inside', () => {
    const box = { cx: 50, cy: 50, width: 300, height: 40, rotation: 8 };
    const ps = lockOutline(box, 0, 100, 100, 1);
    expect(ps.length).toBeGreaterThanOrEqual(4);
    for (const p of ps) {
      expect(p.x).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(99 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(99 + 1e-9);
    }
    // Cut along both side edges of the frame.
    expect(ps.some((p) => Math.abs(p.x - 1) < 1e-6)).toBe(true);
    expect(ps.some((p) => Math.abs(p.x - 99) < 1e-6)).toBe(true);
  });

  it('is empty for a box wholly off the frame', () => {
    const box = { cx: 300, cy: 50, width: 20, height: 20, rotation: 0 };
    expect(lockOutline(box, 0, 100, 100, 1)).toEqual([]);
  });
});
