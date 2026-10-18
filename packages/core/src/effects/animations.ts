import type { ItemAnimation } from '../model/schema';
import { FLICKS_PER_SECOND, type Time } from '../model/time';
import { MaskShape, noFx, resetFx, type LayerFx } from './colour';
import { ANIMATION_PRESETS } from './presets';

/**
 * Entrance (`in`), exit (`out`) and repeating (`loop`) animations of lane items (text, stickers,
 * picture-in-picture). Evaluated from the item's own time into an {@link AnimationState} — a
 * transform on top of the item's own plus shader extras (opacity, blur, local masks, colour,
 * 3D turns) — which the compositor applies identically in preview and export. Pure, and
 * allocation-free with a reused state. Ids, labels and groups are the catalogue's
 * (effects/presets.ts, `ANIMATION_PRESETS`); this module only holds the motion.
 */

/** The state of an animated item this frame, on top of its own transform. */
export interface AnimationState {
  /** Shift in canvas widths / heights (y down). */
  dx: number;
  dy: number;
  /** Scale (uniform × along the item's own axes) around the pivot. */
  scale: number;
  scaleX: number;
  scaleY: number;
  /** Extra clockwise rotation, degrees, around the pivot. */
  rotate: number;
  /** Pivot of scale and rotation in the item's box (−1…1; 0, 0 = centre). */
  pivotX: number;
  pivotY: number;
  /** Multiplies the item's opacity. */
  opacity: number;
  /** Blur strength 0…1. */
  blur: number;
  /** Text: fraction of characters / words shown (1 = all). */
  reveal: number;
  /** Text: what `reveal` counts (null = no reveal). */
  revealBy: 'char' | 'word' | null;
  /**
   * Shader extras: local masks (wipes, circles), colour mix, RGB split, 3D turn (`pivotX/Y` in
   * the item's box −1…1; the compositor converts them to screen units).
   */
  fx: LayerFx;
}

/** A fresh state with nothing animated. */
export function restingState(): AnimationState {
  return resetState({ fx: noFx() } as AnimationState);
}

/** Resets a state to nothing animated, in place (no allocation). */
export function resetState(s: AnimationState): AnimationState {
  s.dx = 0;
  s.dy = 0;
  s.scale = 1;
  s.scaleX = 1;
  s.scaleY = 1;
  s.rotate = 0;
  s.pivotX = 0;
  s.pivotY = 0;
  s.opacity = 1;
  s.blur = 0;
  s.reveal = 1;
  s.revealBy = null;
  resetFx(s.fx);
  return s;
}

// ── curves ────────────────────────────────────────────────────────────────

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const outCubic = (k: number) => 1 - (1 - k) ** 3;
const inOut = (k: number) => k * k * (3 - 2 * k);
/** Ease-out with an overshoot of ~10 % (back). */
const outBack = (k: number) => {
  const c = 1.70158;
  return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
};
/** Damped spring settling at 1. */
const spring = (k: number) =>
  k >= 1 ? 1 : 1 - Math.cos(k * Math.PI * 3) * Math.exp(-6 * k) * (1 - k);
/** A ball dropped onto the floor: 0 → 1 with three shrinking bounces. */
function bounceOut(k: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
  return n * (k -= 2.625 / d) * k + 0.984375;
}
function hash(n: number): number {
  const s = Math.sin(n * 91.7 + 47.3) * 43758.5453;
  return s - Math.floor(s);
}

/** Fades in over the first `part` of an entrance. */
const fadeIn = (s: AnimationState, k: number, part = 0.6) => (s.opacity *= clamp01(k / part));

// ── in / out ──────────────────────────────────────────────────────────────

/**
 * An entrance at `k` (0 = not yet visible, 1 = in place). Exits play the same functions backwards
 * (k from 1 to 0), so every exit mirrors an entrance.
 */
type Apply = (s: AnimationState, k: number) => void;

const slide =
  (x: number, y: number, distance = 0.35): Apply =>
  (s, k) => {
    const e = 1 - outCubic(k);
    s.dx += x * distance * e;
    s.dy += y * distance * e;
    fadeIn(s, k, 0.5);
  };

const wipe =
  (x: number, y: number, invert = false): Apply =>
  (s, k) => {
    const fx = s.fx;
    fx.mask = MaskShape.linear;
    fx.maskLocal = true;
    fx.maskDirX = x;
    fx.maskDirY = y;
    fx.maskSoft = 0.08;
    const e = inOut(k);
    fx.maskProgress = invert ? 1 - e : e;
    fx.maskInvert = invert;
  };

const APPLY = {
  fade: (s, k) => (s.opacity *= inOut(k)),
  rise: slide(0, 1, 0.08),
  drop: slide(0, -1, 0.08),
  fromLeft: slide(-1, 0),
  fromRight: slide(1, 0),
  fromTop: slide(0, -1),
  fromBottom: slide(0, 1),
  zoomIn: (s, k) => {
    s.scale *= 0.3 + 0.7 * outCubic(k);
    fadeIn(s, k);
  },
  shrinkIn: (s, k) => {
    s.scale *= 1 + 0.8 * (1 - outCubic(k));
    fadeIn(s, k);
  },
  pop: (s, k) => {
    s.scale *= Math.max(0, outBack(k));
    fadeIn(s, k, 0.2);
  },
  bounce: (s, k) => {
    s.dy -= 0.25 * (1 - bounceOut(k));
    fadeIn(s, k, 0.15);
  },
  spin: (s, k) => {
    const e = outCubic(k);
    s.rotate -= 180 * (1 - e);
    s.scale *= e;
    fadeIn(s, k, 0.3);
  },
  blur: (s, k) => {
    s.blur = Math.max(s.blur, 1 - inOut(k));
    s.opacity *= inOut(k);
  },
  wipeRight: wipe(1, 0),
  wipeUp: wipe(0, -1),
  wipeRightOut: wipe(1, 0, true),
  wipeUpOut: wipe(0, -1, true),
  typewriter: (s, k) => {
    s.revealBy = 'char';
    s.reveal = Math.min(s.reveal, k);
  },
  words: (s, k) => {
    s.revealBy = 'word';
    s.reveal = Math.min(s.reveal, k);
  },
  stomp: (s, k) => {
    // Falls onto the screen from big, squashes on impact, settles.
    const drop = clamp01(k / 0.45);
    s.scale *= 1 + 1.5 * (1 - drop * drop);
    const impact = clamp01((k - 0.45) / 0.55);
    if (k > 0.45) {
      const wobble = Math.sin(impact * Math.PI * 3) * (1 - impact) * 0.18;
      s.scaleX *= 1 + wobble;
      s.scaleY *= 1 - wobble;
    }
    s.opacity *= clamp01(k / 0.15);
  },
  tumble: (s, k) => {
    const e = outCubic(k);
    s.rotate += 360 * (1 - e);
    s.dy -= 0.2 * (1 - e);
    s.scale *= 0.5 + 0.5 * e;
    fadeIn(s, k, 0.4);
  },
  flicker: (s, k) => {
    if (k >= 1) return;
    const on = hash(Math.floor(k * 16)) < 0.25 + 0.75 * k;
    s.opacity *= on ? clamp01(0.4 + k) : 0;
  },
  floatIn: (s, k) => {
    const e = outCubic(k);
    s.dy += 0.05 * (1 - e);
    s.blur = Math.max(s.blur, 0.6 * (1 - e));
    s.opacity *= inOut(k);
  },
  floatUp: (s, k) => {
    const e = outCubic(k);
    s.dy -= 0.05 * (1 - e);
    s.blur = Math.max(s.blur, 0.6 * (1 - e));
    s.opacity *= inOut(k);
  },
  flip: (s, k) => {
    const fx = s.fx;
    fx.rotAxis = 1;
    fx.rotAngle = 90 * (1 - outCubic(k));
    fx.rotDistance = 2.5;
    s.opacity *= clamp01(k / 0.1);
  },
  swing: (s, k) => {
    const fx = s.fx;
    fx.rotAxis = 2;
    fx.rotAngle = 90 * (1 - spring(k));
    fx.rotDistance = 2.5;
    fx.pivotY = -1;
    s.opacity *= clamp01(k / 0.1);
  },
  stretch: (s, k) => {
    s.scaleX *= Math.max(0, outBack(k));
    s.scaleY *= 0.6 + 0.4 * outCubic(k);
    fadeIn(s, k, 0.3);
  },
  grow: (s, k) => {
    s.scaleY *= Math.max(0, outBack(k));
    s.pivotY = 1;
    fadeIn(s, k, 0.2);
  },
  circle: (s, k) => {
    const fx = s.fx;
    fx.mask = MaskShape.circle;
    fx.maskLocal = true;
    fx.maskProgress = inOut(k);
    fx.maskSoft = 0.05;
  },
  glitch: (s, k) => {
    const step = Math.floor(k * 14);
    const g = 1 - k;
    s.dx += (hash(step) - 0.5) * 0.04 * g;
    s.fx.split = 0.04 * g;
    s.opacity *= k >= 1 || hash(step + 7) < 0.3 + 0.7 * k ? 1 : 0;
  },
  elastic: (s, k) => {
    s.scale *= Math.max(0, spring(k));
    fadeIn(s, k, 0.15);
  },
  roll: (s, k) => {
    const e = outCubic(k);
    s.dx -= 0.5 * (1 - e);
    s.rotate -= 360 * (1 - e);
    fadeIn(s, k, 0.3);
  },
  fly: (s, k) => {
    s.dy += 1.1 * (1 - outCubic(k));
  },
  flyUp: (s, k) => {
    s.dy -= 1.1 * (1 - outCubic(k));
  },
} satisfies Record<string, Apply>;

type ApplyId = keyof typeof APPLY;

interface ClipSpec {
  /** An `ANIMATION_PRESETS` id. */
  id: string;
  apply: ApplyId;
}

// prettier-ignore
const IN: readonly ClipSpec[] = [
  { id: 'fade-in', apply: 'fade' },
  { id: 'rise-in', apply: 'rise' },
  { id: 'drop-in', apply: 'drop' },
  { id: 'slide-left-in', apply: 'fromLeft' },
  { id: 'slide-right-in', apply: 'fromRight' },
  { id: 'slide-top-in', apply: 'fromTop' },
  { id: 'slide-bottom-in', apply: 'fromBottom' },
  { id: 'zoom-in', apply: 'zoomIn' },
  { id: 'shrink-in', apply: 'shrinkIn' },
  { id: 'pop-in', apply: 'pop' },
  { id: 'bounce-in', apply: 'bounce' },
  { id: 'spin-in', apply: 'spin' },
  { id: 'blur-in', apply: 'blur' },
  { id: 'wipe-right-in', apply: 'wipeRight' },
  { id: 'wipe-up-in', apply: 'wipeUp' },
  { id: 'typewriter-in', apply: 'typewriter' },
  { id: 'words-in', apply: 'words' },
  { id: 'stomp-in', apply: 'stomp' },
  { id: 'tumble-in', apply: 'tumble' },
  { id: 'flicker-in', apply: 'flicker' },
  { id: 'float-in', apply: 'floatIn' },
  { id: 'flip-in', apply: 'flip' },
  { id: 'swing-in', apply: 'swing' },
  { id: 'stretch-in', apply: 'stretch' },
  { id: 'grow-in', apply: 'grow' },
  { id: 'circle-in', apply: 'circle' },
  { id: 'glitch-in', apply: 'glitch' },
  { id: 'elastic-in', apply: 'elastic' },
  { id: 'roll-in', apply: 'roll' },
  { id: 'fly-in', apply: 'fly' },
];

/** Exits: entrances played backwards (the label says what the viewer sees). */
// prettier-ignore
const OUT: readonly ClipSpec[] = [
  { id: 'fade-out', apply: 'fade' },
  { id: 'rise-out', apply: 'drop' },
  { id: 'drop-out', apply: 'rise' },
  { id: 'slide-left-out', apply: 'fromLeft' },
  { id: 'slide-right-out', apply: 'fromRight' },
  { id: 'slide-top-out', apply: 'fromTop' },
  { id: 'slide-bottom-out', apply: 'fromBottom' },
  { id: 'shrink-out', apply: 'zoomIn' },
  { id: 'zoom-out', apply: 'shrinkIn' },
  { id: 'pop-out', apply: 'pop' },
  { id: 'bounce-out', apply: 'bounce' },
  { id: 'spin-out', apply: 'spin' },
  { id: 'blur-out', apply: 'blur' },
  { id: 'wipe-right-out', apply: 'wipeRightOut' },
  { id: 'wipe-up-out', apply: 'wipeUpOut' },
  { id: 'typewriter-out', apply: 'typewriter' },
  { id: 'words-out', apply: 'words' },
  { id: 'tumble-out', apply: 'tumble' },
  { id: 'flicker-out', apply: 'flicker' },
  { id: 'float-out', apply: 'floatUp' },
  { id: 'flip-out', apply: 'flip' },
  { id: 'swing-out', apply: 'swing' },
  { id: 'stretch-out', apply: 'stretch' },
  { id: 'circle-out', apply: 'circle' },
  { id: 'glitch-out', apply: 'glitch' },
  { id: 'roll-out', apply: 'roll' },
  { id: 'fly-out', apply: 'flyUp' },
];

// ── loops ─────────────────────────────────────────────────────────────────

interface LoopSpec {
  /** An `ANIMATION_PRESETS` id (slot `loop`). */
  id: string;
  /** Seconds per cycle at speed 1. */
  period: number;
  /** `phase` grows by 1 per cycle (not wrapped); `t` = seconds × speed. */
  apply(s: AnimationState, phase: number, t: number): void;
}

const TAU = Math.PI * 2;
const wave = (phase: number) => Math.sin(TAU * phase);

// prettier-ignore
const LOOPS: readonly LoopSpec[] = [
  { id: 'pulse', period: 1,
    apply: (s, ph) => (s.scale *= 1 + 0.08 * wave(ph)) },
  { id: 'wiggle', period: 0.6,
    apply: (s, ph) => (s.rotate += 7 * wave(ph)) },
  { id: 'float', period: 2.4,
    apply: (s, ph) => (s.dy += 0.015 * wave(ph)) },
  { id: 'spin', period: 3,
    apply: (s, ph) => (s.rotate += 360 * (ph - Math.floor(ph))) },
  { id: 'blink', period: 1,
    apply: (s, ph) => (s.opacity *= ph - Math.floor(ph) < 0.6 ? 1 : 0.1) },
  { id: 'heartbeat', period: 1.1,
    apply: (s, ph) => {
      const f = ph - Math.floor(ph);
      const beat = Math.exp(-((f - 0.1) ** 2) / 0.003) + 0.6 * Math.exp(-((f - 0.32) ** 2) / 0.003);
      s.scale *= 1 + 0.14 * beat;
    } },
  { id: 'shake', period: 0.5,
    apply: (s, _ph, t) => {
      const step = Math.floor(t * 30);
      s.dx += (hash(step) - 0.5) * 0.014;
      s.dy += (hash(step + 31) - 0.5) * 0.01;
      s.rotate += (hash(step + 63) - 0.5) * 4;
    } },
  { id: 'sway', period: 2,
    apply: (s, ph) => {
      s.rotate += 9 * wave(ph);
      s.pivotY = -1;
    } },
  { id: 'breathe', period: 3,
    apply: (s, ph) => {
      const b = 0.5 - 0.5 * Math.cos(TAU * ph);
      s.scale *= 1 + 0.05 * b;
      s.opacity *= 0.85 + 0.15 * b;
    } },
  { id: 'glow', period: 1.6,
    apply: (s, ph) => {
      const g = 0.5 - 0.5 * Math.cos(TAU * ph);
      s.fx.flash = Math.max(s.fx.flash, 0.35 * g);
      s.fx.flashR = s.fx.flashG = s.fx.flashB = 1;
      s.scale *= 1 + 0.025 * g;
    } },
  { id: 'hop', period: 0.8,
    apply: (s, ph) => {
      const f = ph - Math.floor(ph);
      s.dy -= 0.035 * Math.sin(Math.PI * f);
      const squash = Math.max(0, 1 - f / 0.12) + Math.max(0, (f - 0.88) / 0.12);
      s.scaleX *= 1 + 0.08 * squash;
      s.scaleY *= 1 - 0.08 * squash;
      s.pivotY = 1;
    } },
  { id: 'jelly', period: 0.8,
    apply: (s, ph) => {
      s.scaleX *= 1 + 0.07 * wave(ph);
      s.scaleY *= 1 - 0.07 * wave(ph);
    } },
  { id: 'orbit', period: 2,
    apply: (s, ph) => {
      s.dx += 0.012 * Math.cos(TAU * ph);
      s.dy += 0.012 * Math.sin(TAU * ph);
    } },
];

const IN_BY_ID = new Map(IN.map((s) => [s.id, s]));
const OUT_BY_ID = new Map(OUT.map((s) => [s.id, s]));
const LOOP_BY_ID = new Map(LOOPS.map((s) => [s.id, s]));
/** Ids with motion, per slot (tests check they match the catalogue). */
export const ANIMATION_IDS: Readonly<Record<'in' | 'out' | 'loop', readonly string[]>> = {
  in: IN.map((s) => s.id),
  out: OUT.map((s) => s.id),
  loop: LOOPS.map((s) => s.id),
};
const TEXT_ONLY = new Set(ANIMATION_PRESETS.filter((p) => p.textOnly).map((p) => p.id));

/**
 * How long the entrance and exit really play for an item of `duration` (flicks): each clamped to
 * the item, the exit to what the entrance leaves.
 */
export function animationSpans(
  animation: ItemAnimation | undefined,
  duration: Time,
): { inDuration: Time; outDuration: Time } {
  const inDuration = Math.max(0, Math.min(animation?.in?.duration ?? 0, duration));
  const outDuration = Math.max(0, Math.min(animation?.out?.duration ?? 0, duration - inDuration));
  return { inDuration, outDuration };
}

/**
 * The animation state at `localTime` (flicks since the item started) of an item `duration` long,
 * into `out` (reused). `isText` enables the text-only presets (others fall back to a fade).
 * Unknown ids do nothing.
 */
export function animationState(
  animation: ItemAnimation | undefined,
  localTime: Time,
  duration: Time,
  isText: boolean,
  out: AnimationState = restingState(),
): AnimationState {
  resetState(out);
  if (!animation) return out;
  const loop = animation.loop ? LOOP_BY_ID.get(animation.loop.type) : undefined;
  if (loop) {
    const speed = Math.max(0.25, Math.min(4, animation.loop?.speed ?? 1));
    const t = (Math.max(0, localTime) / FLICKS_PER_SECOND) * speed;
    loop.apply(out, t / loop.period, t);
  }
  const { inDuration, outDuration } = animationSpans(animation, duration);
  if (animation.in && inDuration > 0 && localTime < inDuration) {
    const spec = IN_BY_ID.get(animation.in.type);
    if (spec) run(spec, out, clamp01(localTime / inDuration), isText);
  } else if (animation.out && outDuration > 0 && localTime > duration - outDuration) {
    const spec = OUT_BY_ID.get(animation.out.type);
    if (spec) run(spec, out, clamp01((duration - localTime) / outDuration), isText);
  }
  return out;
}

function run(spec: ClipSpec, s: AnimationState, k: number, isText: boolean): void {
  if (!isText && TEXT_ONLY.has(spec.id)) APPLY.fade(s, k);
  else APPLY[spec.apply](s, k);
}
