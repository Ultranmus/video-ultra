import { describe, expect, it } from 'vitest';
import type { ItemAnimation } from '../model/schema';
import { fromSeconds } from '../model/time';
import {
  ANIMATION_IDS,
  animationSpans,
  animationState,
  restingState,
  type AnimationState,
} from './animations';
import { MaskShape } from './colour';
import { ANIMATION_CATEGORIES, ANIMATION_PRESETS, findAnimationPreset } from './presets';

const s = fromSeconds;

/** True when the state leaves the item as it is. */
function resting(st: AnimationState): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  return (
    near(st.dx, 0) &&
    near(st.dy, 0) &&
    near(st.scale * st.scaleX, 1) &&
    near(st.scale * st.scaleY, 1) &&
    near(st.rotate % 360, 0) &&
    near(st.opacity, 1) &&
    st.blur < 1e-4 &&
    st.reveal >= 1 - 1e-4 &&
    st.fx.split < 1e-4 &&
    st.fx.flash < 1e-4 &&
    (st.fx.rotAxis === 0 || near(st.fx.rotAngle, 0)) &&
    (st.fx.mask === 0 ||
      (st.fx.maskInvert ? st.fx.maskProgress <= 1e-4 : st.fx.maskProgress >= 1 - 1e-4))
  );
}

describe('animation catalogue', () => {
  const bySlot = (slot: string) => ANIMATION_PRESETS.filter((p) => p.slot === slot);

  it('has 25+ entrances, 20+ exits, 10+ loops, ids unique across slots', () => {
    expect(bySlot('in').length).toBeGreaterThanOrEqual(25);
    expect(bySlot('out').length).toBeGreaterThanOrEqual(20);
    expect(bySlot('loop').length).toBeGreaterThanOrEqual(10);
    const ids = ANIMATION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has the asked-for kinds', () => {
    for (const id of [
      'fade-in',
      'rise-in',
      'drop-in',
      'slide-left-in',
      'slide-right-in',
      'slide-top-in',
      'slide-bottom-in',
      'zoom-in',
      'pop-in',
      'bounce-in',
      'spin-in',
      'blur-in',
      'wipe-right-in',
      'typewriter-in',
      'words-in',
      'stomp-in',
      'tumble-in',
      'flicker-in',
    ])
      expect(findAnimationPreset('in', id), id).toBeDefined();
    for (const id of [
      'pulse',
      'wiggle',
      'float',
      'spin',
      'blink',
      'heartbeat',
      'shake',
      'sway',
      'breathe',
      'glow',
    ])
      expect(findAnimationPreset('loop', id), id).toBeDefined();
    expect(findAnimationPreset('in', 'typewriter-in')!.textOnly).toBe(true);
    expect(findAnimationPreset('out', 'fade-in')).toBeUndefined();
  });

  it('has motion for every catalogue entry and nothing else, in the same order', () => {
    for (const slot of ['in', 'out', 'loop'] as const)
      expect(ANIMATION_IDS[slot], slot).toEqual(bySlot(slot).map((p) => p.id));
  });

  it('uses known categories and gives entrances and exits a length', () => {
    const cats = ANIMATION_CATEGORIES.map((c) => c.id);
    for (const p of ANIMATION_PRESETS) {
      expect(cats, p.id).toContain(p.category);
      if (p.slot !== 'loop') expect(p.defaultDuration, p.id).toBeGreaterThan(0);
    }
  });
});

describe('every entrance and exit', () => {
  const clips = ANIMATION_PRESETS.filter((p) => p.slot !== 'loop');
  it.each(clips)('$id ends (entrance) / starts (exit) at rest, and moves in between', (p) => {
    const duration = s(4);
    const animation: ItemAnimation = { [p.slot]: { type: p.id, duration: s(1) } };
    const isText = true;
    if (p.slot === 'in') {
      expect(resting(animationState(animation, s(1), duration, isText)), 'after').toBe(true);
      expect(resting(animationState(animation, s(0.99999), duration, isText)), 'end').toBe(true);
      expect(resting(animationState(animation, s(0.3), duration, isText)), 'during').toBe(false);
    } else {
      expect(resting(animationState(animation, s(3), duration, isText)), 'before').toBe(true);
      expect(resting(animationState(animation, s(3.00001), duration, isText)), 'start').toBe(true);
      expect(resting(animationState(animation, s(3.7), duration, isText)), 'during').toBe(false);
    }
  });
});

describe('animation maths', () => {
  const duration = s(4);

  it('fade in: 0 → ½ → 1, exits mirror entrances', () => {
    const a: ItemAnimation = {
      in: { type: 'fade-in', duration: s(1) },
      out: { type: 'fade-out', duration: s(1) },
    };
    expect(animationState(a, 0, duration, false).opacity).toBe(0);
    expect(animationState(a, s(0.5), duration, false).opacity).toBeCloseTo(0.5);
    expect(animationState(a, s(2), duration, false).opacity).toBe(1);
    expect(animationState(a, s(3.5), duration, false).opacity).toBeCloseTo(0.5);
    expect(animationState(a, s(4) - 1, duration, false).opacity).toBeLessThan(1e-6);
  });

  it('slides come from their side and settle', () => {
    const from = (type: string, t: number) =>
      animationState({ in: { type, duration: s(1) } }, s(t), duration, false);
    expect(from('slide-left-in', 0).dx).toBeLessThan(-0.3);
    expect(from('slide-right-in', 0).dx).toBeGreaterThan(0.3);
    expect(from('slide-top-in', 0).dy).toBeLessThan(-0.3);
    expect(from('slide-bottom-in', 0).dy).toBeGreaterThan(0.3);
    expect(Math.abs(from('slide-left-in', 0.5).dx)).toBeLessThan(
      Math.abs(from('slide-left-in', 0).dx),
    );
    const out = animationState(
      { out: { type: 'slide-left-out', duration: s(1) } },
      s(4) - 1,
      duration,
      false,
    );
    expect(out.dx).toBeLessThan(-0.3);
  });

  it('pop overshoots before settling', () => {
    const scales = Array.from(
      { length: 50 },
      (_, i) =>
        animationState({ in: { type: 'pop-in', duration: s(1) } }, s(i / 50), duration, false)
          .scale,
    );
    expect(scales[0]).toBeCloseTo(0, 9);
    expect(Math.max(...scales)).toBeGreaterThan(1.05);
  });

  it('clamps entrance and exit to the item (the exit gets what is left)', () => {
    const a: ItemAnimation = {
      in: { type: 'fade-in', duration: s(2) },
      out: { type: 'fade-out', duration: s(2) },
    };
    expect(animationSpans(a, s(3))).toEqual({ inDuration: s(2), outDuration: s(1) });
    expect(animationSpans(a, s(1))).toEqual({ inDuration: s(1), outDuration: 0 });
    // Short item: the entrance runs over the whole item; no exit.
    expect(animationState(a, s(0.5), s(1), false).opacity).toBeCloseTo(0.5);
  });

  it('typewriter and word reveals count up on text, fall back to a fade elsewhere', () => {
    const a: ItemAnimation = { in: { type: 'typewriter-in', duration: s(1) } };
    const text = animationState(a, s(0.25), duration, true);
    expect(text.revealBy).toBe('char');
    expect(text.reveal).toBeCloseTo(0.25);
    expect(text.opacity).toBe(1);
    const sticker = animationState(a, s(0.25), duration, false);
    expect(sticker.revealBy).toBe(null);
    expect(sticker.opacity).toBeCloseTo(0.156, 2);
    const back = animationState(
      { out: { type: 'typewriter-out', duration: s(1) } },
      s(3.75),
      duration,
      true,
    );
    expect(back.reveal).toBeCloseTo(0.25);
    expect(
      animationState({ in: { type: 'words-in', duration: s(1) } }, s(0.5), duration, true).revealBy,
    ).toBe('word');
  });

  it('wipes and circles mask the item in its own box', () => {
    const w = animationState(
      { in: { type: 'wipe-right-in', duration: s(1) } },
      s(0.5),
      duration,
      false,
    );
    expect(w.fx.mask).toBe(MaskShape.linear);
    expect(w.fx.maskLocal).toBe(true);
    expect(w.fx.maskProgress).toBeCloseTo(0.5);
    const out = animationState(
      { out: { type: 'wipe-right-out', duration: s(1) } },
      s(3.5),
      duration,
      false,
    );
    expect(out.fx.maskInvert).toBe(true);
    expect(out.fx.maskProgress).toBeCloseTo(0.5);
  });

  it('loops follow the item time and speed', () => {
    const spin = (speed: number, t: number) =>
      animationState({ loop: { type: 'spin', speed } }, s(t), duration, false).rotate;
    expect(spin(1, 0.75)).toBeCloseTo(90);
    expect(spin(2, 0.75)).toBeCloseTo(180);
    expect(spin(4, 0)).toBeCloseTo(0);
    // Out-of-range speeds are clamped (0.25–4).
    expect(spin(100, 0.75)).toBeCloseTo(spin(4, 0.75));
    const pulse = animationState({ loop: { type: 'pulse' } }, s(0.25), duration, false);
    expect(pulse.scale).toBeCloseTo(1.08);
  });

  it('loops combine with entrances', () => {
    const a: ItemAnimation = { in: { type: 'fade-in', duration: s(1) }, loop: { type: 'spin' } };
    const st = animationState(a, s(0.75), duration, false);
    expect(st.rotate).toBeCloseTo(90);
    expect(st.opacity).toBeCloseTo(0.84375);
  });

  it('nothing, unknown ids and the middle of an item are at rest', () => {
    expect(resting(animationState(undefined, s(1), duration, false))).toBe(true);
    expect(
      resting(animationState({ in: { type: 'nope', duration: s(1) } }, s(0.5), duration, false)),
    ).toBe(true);
    expect(
      resting(
        animationState(
          { in: { type: 'pop-in', duration: s(1) }, out: { type: 'pop-out', duration: s(1) } },
          s(2),
          duration,
          false,
        ),
      ),
    ).toBe(true);
  });

  it('reuses the state object', () => {
    const out = restingState();
    expect(animationState({ loop: { type: 'pulse' } }, s(0.25), duration, false, out)).toBe(out);
    animationState(undefined, 0, duration, false, out);
    expect(resting(out)).toBe(true);
  });
});
