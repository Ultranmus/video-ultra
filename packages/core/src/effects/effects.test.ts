import { describe, expect, it } from 'vitest';
import { colourParams, FILTER_PARAMS, identityColour, isIdentityColour } from './colour';
import {
  ADJUST_KEYS,
  FILTER_PRESETS,
  FONT_PRESETS,
  STICKER_EMOJI,
  TRANSITION_PRESETS,
} from './presets';
import { fadeOverlay, transitionLook } from './transitions';

describe('preset catalogues', () => {
  it('has 12–16 filters, each with parameters, unique ids, no "none"', () => {
    expect(FILTER_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(FILTER_PRESETS.length).toBeLessThanOrEqual(16);
    const ids = FILTER_PRESETS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('none');
    for (const id of ids) expect(FILTER_PARAMS[id], id).toBeDefined();
    expect(Object.keys(FILTER_PARAMS).sort()).toEqual([...ids].sort());
  });

  it('has the transitions the UI offers', () => {
    expect(TRANSITION_PRESETS.map((t) => t.id)).toEqual([
      'fade',
      'dissolve',
      'slide-left',
      'slide-up',
      'zoom',
      'wipe',
      'blur',
    ]);
  });

  it('lists every adjustment once', () => {
    expect(ADJUST_KEYS.map((a) => a.key)).toEqual([
      'brightness',
      'contrast',
      'saturation',
      'warmth',
      'tint',
      'highlights',
      'shadows',
      'sharpen',
      'vignette',
    ]);
  });

  it('has ~48 distinct emoji and 6–8 fonts', () => {
    expect(STICKER_EMOJI.length).toBe(48);
    expect(new Set(STICKER_EMOJI).size).toBe(48);
    expect(FONT_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(FONT_PRESETS.length).toBeLessThanOrEqual(8);
  });
});

describe('colour parameters', () => {
  it('no filter and no adjustments is the identity', () => {
    expect(isIdentityColour(colourParams(null, {}))).toBe(true);
    expect(isIdentityColour(colourParams({ id: 'vivid', intensity: 0 }, {}))).toBe(true);
    expect(isIdentityColour(colourParams({ id: 'unknown', intensity: 1 }, {}))).toBe(true);
  });

  it('blends filters linearly with intensity', () => {
    const half = colourParams({ id: 'vivid', intensity: 0.5 }, {});
    const full = colourParams({ id: 'vivid', intensity: 1 }, {});
    expect(full.saturation).toBeCloseTo(1.38);
    expect(half.saturation).toBeCloseTo(1.19);
    expect(colourParams({ id: 'mono', intensity: 1 }, {}).saturation).toBe(0);
  });

  it('stacks adjustments on the filter and clamps them', () => {
    const p = colourParams({ id: 'mono', intensity: 1 }, { contrast: 1, saturation: -1 });
    expect(p.contrast).toBeCloseTo(1.1 * 1.5);
    expect(p.saturation).toBe(0);
    const warm = colourParams(null, { warmth: 5 });
    expect(warm.gainR).toBeCloseTo(1.12);
    expect(warm.gainB).toBeCloseTo(0.88);
  });

  it('reuses the output object', () => {
    const out = identityColour();
    expect(colourParams({ id: 'noir', intensity: 1 }, {}, out)).toBe(out);
    colourParams(null, {}, out);
    expect(isIdentityColour(out)).toBe(true);
  });
});

describe('transition looks', () => {
  it('fade goes through black, one clip at a time', () => {
    expect(transitionLook('fade', 0.25, 'out').visible).toBe(true);
    expect(transitionLook('fade', 0.25, 'in').visible).toBe(false);
    expect(transitionLook('fade', 0.75, 'out').visible).toBe(false);
    expect(fadeOverlay('fade', 0.5)).toBe(1);
    expect(fadeOverlay('fade', 0)).toBe(0);
    expect(fadeOverlay('dissolve', 0.5)).toBe(0);
  });

  it('dissolve never dips: outgoing stays solid until the cut', () => {
    expect(transitionLook('dissolve', 0.4, 'out').opacity).toBe(1);
    expect(transitionLook('dissolve', 0.5, 'in').opacity).toBeCloseTo(0.5);
    expect(transitionLook('dissolve', 1, 'out').visible).toBe(false);
  });

  it('slides move both clips by the same amount', () => {
    const out = transitionLook('slide-left', 0.5, 'out');
    const inn = transitionLook('slide-left', 0.5, 'in');
    expect(out.dx).toBeCloseTo(-0.5);
    expect(inn.dx - out.dx).toBeCloseTo(1);
    expect(transitionLook('slide-up', 1, 'in').dy).toBe(0);
  });

  it('wipe reveals the incoming clip left to right', () => {
    expect(transitionLook('wipe', 0, 'in').wipeEdge).toBeLessThan(-1);
    expect(transitionLook('wipe', 1, 'in').wipeEdge).toBeGreaterThan(1);
    expect(transitionLook('wipe', 0.5, 'in').wipeEdge).toBeCloseTo(0);
    expect(transitionLook('wipe', 0.5, 'out').wipe).toBe(false);
  });

  it('blur peaks at the cut', () => {
    expect(transitionLook('blur', 0.5, 'out').blur).toBe(1);
    expect(transitionLook('blur', 0.5, 'in').blur).toBe(1);
    expect(transitionLook('blur', 1, 'in').blur).toBe(0);
  });
});
