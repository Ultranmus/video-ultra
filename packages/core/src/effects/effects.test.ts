import { describe, expect, it } from 'vitest';
import type { Direction, Ease } from '../model/schema';
import { colourParams, FILTER_PARAMS, identityColour, isIdentityColour, MaskShape } from './colour';
import {
  ADJUST_KEYS,
  FILTER_CATEGORIES,
  FILTER_PRESETS,
  findTransitionPreset,
  FONT_PRESETS,
  STICKER_EMOJI,
  TRANSITION_CATEGORIES,
  TRANSITION_PRESETS,
} from './presets';
import {
  easeAt,
  fadeOverlay,
  TRANSITION_LOOK_IDS,
  plainLook,
  transitionLook,
  transitionOverlay,
  type TransitionLook,
} from './transitions';

/** The 16 filters shipped in v0.1 (old projects use these ids; their numbers never change). */
const V01_FILTERS = [
  'vivid',
  'warm',
  'cool',
  'golden',
  'bright',
  'punch',
  'teal-orange',
  'film',
  'dream',
  'fade',
  'matte',
  'vintage',
  'moody',
  'mono',
  'noir',
  'sepia',
];

describe('filter library', () => {
  it('has 100+ filters with parameters, unique ids, no "none"', () => {
    expect(FILTER_PRESETS.length).toBeGreaterThanOrEqual(100);
    const ids = FILTER_PRESETS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('none');
    for (const id of ids) expect(FILTER_PARAMS[id], id).toBeDefined();
    expect(Object.keys(FILTER_PARAMS).sort()).toEqual([...ids].sort());
  });

  it('keeps every v0.1 filter id, with the same look', () => {
    for (const id of V01_FILTERS) expect(FILTER_PARAMS[id], id).toBeDefined();
    expect(FILTER_PARAMS.vivid).toEqual({
      saturation: 1.38,
      contrast: 1.12,
      liftR: -0.01,
      liftG: -0.01,
      liftB: -0.01,
    });
    expect(FILTER_PARAMS.sepia!.mono).toBe(1);
  });

  it('puts every filter in a known category, every category used, grouped in order', () => {
    const cats = FILTER_CATEGORIES.map((c) => c.id);
    expect(cats.length).toBeGreaterThanOrEqual(12);
    for (const f of FILTER_PRESETS) expect(cats).toContain(f.category);
    for (const c of cats)
      expect(
        FILTER_PRESETS.some((f) => f.category === c),
        c,
      ).toBe(true);
    const order = FILTER_PRESETS.map((f) => cats.indexOf(f.category));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('only uses parameters of the pipeline, all finite', () => {
    const keys = Object.keys(identityColour());
    for (const [id, p] of Object.entries(FILTER_PARAMS)) {
      for (const [k, v] of Object.entries(p)) {
        expect(keys, `${id}.${k}`).toContain(k);
        expect(Number.isFinite(v), `${id}.${k}`).toBe(true);
      }
      expect(isIdentityColour(colourParams({ id, intensity: 1 }, {})), id).toBe(false);
    }
  });
});

describe('other catalogues', () => {
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

  it('blends filters linearly with intensity (new stages too)', () => {
    const half = colourParams({ id: 'vivid', intensity: 0.5 }, {});
    const full = colourParams({ id: 'vivid', intensity: 1 }, {});
    expect(full.saturation).toBeCloseTo(1.38);
    expect(half.saturation).toBeCloseTo(1.19);
    expect(colourParams({ id: 'mono', intensity: 1 }, {}).saturation).toBe(0);
    expect(colourParams({ id: 'grainy', intensity: 0.5 }, {}).grain).toBeCloseTo(0.2);
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

describe('transition catalogue', () => {
  it('has 60+ presets giving 120+ styles, unique ids, known categories', () => {
    expect(TRANSITION_PRESETS.length).toBeGreaterThanOrEqual(60);
    const styles = TRANSITION_PRESETS.reduce((n, p) => n + (p.directions?.length ?? 1), 0);
    expect(styles).toBeGreaterThanOrEqual(120);
    const ids = TRANSITION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = TRANSITION_CATEGORIES.map((c) => c.id);
    for (const p of TRANSITION_PRESETS) expect(cats).toContain(p.category);
    for (const c of cats)
      expect(
        TRANSITION_PRESETS.some((p) => p.category === c),
        c,
      ).toBe(true);
    for (const p of TRANSITION_PRESETS) {
      if (p.directions) expect(new Set(p.directions).size, p.id).toBe(p.directions.length);
      if (p.defaultDuration !== undefined) expect(p.defaultDuration).toBeGreaterThan(0);
    }
  });

  it('has a look for every catalogue entry and nothing else, in the same order', () => {
    expect(TRANSITION_LOOK_IDS).toEqual(TRANSITION_PRESETS.map((p) => p.id));
  });

  it('still knows every v0.1 id', () => {
    for (const id of ['fade', 'dissolve', 'zoom', 'wipe', 'blur'])
      expect(findTransitionPreset(id)?.id).toBe(id);
    expect(findTransitionPreset('slide-left')?.id).toBe('push');
    expect(findTransitionPreset('slide-up')?.id).toBe('push');
    expect(findTransitionPreset('nope')).toBeUndefined();
  });
});

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** True when a look draws the clip exactly as without a transition. */
function untouched(l: TransitionLook): boolean {
  const fx = l.fx;
  const maskOpen =
    fx.mask === 0 ||
    (!fx.maskInvert && fx.maskProgress >= 1 - 1e-9) ||
    (fx.maskInvert && fx.maskProgress <= 1e-9);
  return (
    l.visible &&
    near(l.opacity, 1) &&
    near(l.scale * l.scaleX, 1) &&
    near(l.scale * l.scaleY, 1) &&
    near(l.rotate % 360, 0) &&
    near(l.dx, 0) &&
    near(l.dy, 0) &&
    Math.abs(fx.blurX) < 1e-6 &&
    fx.split < 1e-6 &&
    (fx.warp === 0 || Math.abs(fx.warpAmount) < 1e-6) &&
    fx.flash < 1e-6 &&
    (fx.rotAxis === 0 || near(fx.rotAngle % 360, 0)) &&
    maskOpen
  );
}

describe('every transition', () => {
  const cases = TRANSITION_PRESETS.flatMap((p) =>
    (p.directions ?? [undefined]).map((direction) => ({ id: p.id, direction })),
  );

  it.each(cases)(
    '$id $direction starts on the outgoing clip and ends on the incoming one',
    ({ id, direction }) => {
      const options = { direction, aspect: 9 / 16 };
      // At the start the outgoing clip is untouched and on screen; at the end the incoming one.
      const out0 = transitionLook(id, 0, 'out', plainLook(), options);
      const in1 = transitionLook(id, 1, 'in', plainLook(), options);
      expect(untouched(out0), `${id} out @0 ${JSON.stringify(out0)}`).toBe(true);
      expect(untouched(in1), `${id} in @1 ${JSON.stringify(in1)}`).toBe(true);
      // No overlay pops in or out at the window's edges.
      expect(transitionOverlay(id, 0, undefined, options).opacity).toBeLessThan(1e-6);
      expect(transitionOverlay(id, 1, undefined, options).opacity).toBeLessThan(1e-6);
      // Mid-window the pair is drawable: something is on screen.
      const outMid = transitionLook(id, 0.5, 'out', plainLook(), options);
      const inMid = transitionLook(id, 0.5, 'in', plainLook(), options);
      const overlay = transitionOverlay(id, 0.5, undefined, options);
      expect(outMid.visible || inMid.visible || overlay.opacity > 0).toBe(true);
      for (const l of [outMid, inMid]) {
        for (const v of [l.opacity, l.scale, l.dx, l.dy, l.rotate, l.fx.maskProgress, l.fx.blurX])
          expect(Number.isFinite(v)).toBe(true);
      }
    },
  );
});

describe('transition maths', () => {
  it('fade goes through black, one clip at a time (v0.1 numbers)', () => {
    expect(transitionLook('fade', 0.25, 'out').visible).toBe(true);
    expect(transitionLook('fade', 0.25, 'in').visible).toBe(false);
    expect(transitionLook('fade', 0.75, 'out').visible).toBe(false);
    expect(fadeOverlay('fade', 0.5)).toBe(1);
    expect(fadeOverlay('fade', 0.25)).toBeCloseTo(0.5);
    expect(fadeOverlay('fade', 0)).toBe(0);
    expect(fadeOverlay('dissolve', 0.5)).toBe(0);
  });

  it('dissolve never dips: outgoing stays solid until the cut', () => {
    expect(transitionLook('dissolve', 0.4, 'out').opacity).toBe(1);
    expect(transitionLook('dissolve', 0.5, 'in').opacity).toBeCloseTo(0.5);
    expect(transitionLook('dissolve', 1, 'out').visible).toBe(false);
  });

  it('v0.1 slides are pushes; both clips move by the same amount', () => {
    const out = transitionLook('slide-left', 0.5, 'out');
    const inn = transitionLook('slide-left', 0.5, 'in');
    expect(out.dx).toBeCloseTo(-0.5);
    expect(inn.dx - out.dx).toBeCloseTo(1);
    expect(transitionLook('slide-up', 0.5, 'out').dy).toBeCloseTo(-0.5);
    expect(transitionLook('slide-up', 1, 'in').dy).toBeCloseTo(0, 9);
  });

  it('direction picks the way, unknown directions fall back to the first one', () => {
    const left = transitionLook('push', 0.5, 'out', plainLook(), { direction: 'left' });
    const right = transitionLook('push', 0.5, 'out', plainLook(), { direction: 'right' });
    const down = transitionLook('push', 0.5, 'out', plainLook(), { direction: 'down' });
    expect(left.dx).toBeCloseTo(-0.5);
    expect(right.dx).toBeCloseTo(0.5);
    expect(down.dy).toBeCloseTo(0.5);
    // `split` only lists left/up; down isn't one of its directions → its first one.
    const split = transitionLook('split', 0.5, 'in', plainLook(), { direction: 'down' });
    expect([split.fx.maskDirX, split.fx.maskDirY]).toEqual([-1, 0]);
  });

  it('wipe reveals the incoming clip left to right with a soft edge (v0.1 numbers)', () => {
    const half = transitionLook('wipe', 0.5, 'in');
    expect(half.fx.mask).toBe(MaskShape.linear);
    expect(half.fx.maskProgress).toBeCloseTo(0.5);
    expect(half.fx.maskSoft).toBeCloseTo(0.04);
    expect([half.fx.maskDirX, half.fx.maskDirY]).toEqual([1, 0]);
    expect(transitionLook('wipe', 0.5, 'out').fx.mask).toBe(0);
  });

  it('blur peaks at the cut', () => {
    expect(transitionLook('blur', 0.5, 'out').fx.blurX).toBeCloseTo(0.02);
    expect(transitionLook('blur', 0.5, 'in').fx.blurX).toBeCloseTo(0.02);
    expect(transitionLook('blur', 1, 'in').fx.blurX).toBe(0);
  });

  it('covers draw the outgoing clip on top only where it should', () => {
    expect(transitionLook('reveal', 0.5, 'out').onTop).toBe(true);
    expect(transitionLook('page-curl', 0.5, 'out').onTop).toBe(true);
    expect(transitionLook('cover', 0.5, 'out').onTop).toBe(false);
  });

  it('the ease option changes the curve, not the end points', () => {
    const p = 0.25;
    const linear = transitionLook('push', p, 'out', plainLook(), { ease: 'linear' }).dx;
    const snappy = transitionLook('push', p, 'out', plainLook(), { ease: 'snappy' }).dx;
    expect(linear).toBeCloseTo(-0.25);
    expect(Math.abs(snappy)).toBeLessThan(Math.abs(linear));
  });

  it('dip to colour uses the colour it is given', () => {
    const o = transitionOverlay('dip-color', 0.5, undefined, { colour: [1, 0, 0.5] });
    expect([o.r, o.g, o.b, o.opacity]).toEqual([1, 0, 0.5, 1]);
  });

  it('unknown types play as a dissolve', () => {
    expect(transitionLook('nope', 0.5, 'in').opacity).toBeCloseTo(0.5);
  });
});

describe('ease curves', () => {
  const eases: Ease[] = ['linear', 'smooth', 'snappy', 'bounce'];
  it.each(eases)('%s starts at 0 and ends at 1', (ease) => {
    expect(easeAt(ease, 0)).toBeCloseTo(0, 9);
    expect(easeAt(ease, 1)).toBeCloseTo(1, 9);
    expect(easeAt(ease, -1)).toBeCloseTo(0, 9);
    expect(easeAt(ease, 2)).toBeCloseTo(1, 9);
  });

  it('linear, smooth and snappy never go back; smooth and snappy are symmetric', () => {
    for (const ease of ['linear', 'smooth', 'snappy'] as const) {
      let last = -1;
      for (let i = 0; i <= 100; i++) {
        const v = easeAt(ease, i / 100);
        expect(v).toBeGreaterThanOrEqual(last - 1e-12);
        last = v;
      }
    }
    for (const t of [0.1, 0.3, 0.45]) {
      expect(easeAt('smooth', t) + easeAt('smooth', 1 - t)).toBeCloseTo(1);
      expect(easeAt('snappy', t) + easeAt('snappy', 1 - t)).toBeCloseTo(1);
    }
    expect(easeAt('snappy', 0.2)).toBeLessThan(easeAt('smooth', 0.2));
  });

  it('bounce overshoots and settles', () => {
    const values = Array.from({ length: 101 }, (_, i) => easeAt('bounce', i / 100));
    expect(Math.max(...values)).toBeGreaterThan(1.02);
    expect(Math.max(...values)).toBeLessThan(1.3);
    expect(values[95]!).toBeCloseTo(1, 1);
  });
});

describe('directions', () => {
  it('every direction of every preset gives a different look', () => {
    for (const p of TRANSITION_PRESETS) {
      if (!p.directions) continue;
      const looks = p.directions.map((d: Direction) =>
        JSON.stringify([
          transitionLook(p.id, 0.4, 'out', plainLook(), { direction: d }),
          transitionLook(p.id, 0.4, 'in', plainLook(), { direction: d }),
          transitionOverlay(p.id, 0.4, undefined, { direction: d }),
        ]),
      );
      expect(new Set(looks).size, p.id).toBe(looks.length);
    }
  });
});
