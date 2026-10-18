import { easeAt } from '../effects/transitions';
import type { Bezier, Ease, Keyframe, Keyframes, Transform } from './schema';

export type { Bezier, Keyframe, Keyframes } from './schema';
import type { Time } from './time';

/**
 * Keyframes (v0.4, file version 4+): an element's position, size, turn and opacity can change
 * over its time. Each property has its own keyframes — a time (flicks from the item's start) and
 * a value — and the curve to the next one (one of the named timing curves, or a cubic Bézier for
 * the graph editor). Before the first keyframe the value is the first one's; after the last, the
 * last one's. A property without keyframes keeps the item's own transform value.
 */

/** Properties that take keyframes (the transform's). */
export const KEYFRAME_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
/** A property that takes keyframes. */
export type KeyframeProp = (typeof KEYFRAME_PROPS)[number];

/** A cubic Bézier curve's y at x (Newton steps on x(t), then bisection as a fallback). */
export function bezierAt(curve: Readonly<Bezier>, x: number): number {
  const [x1, y1, x2, y2] = curve;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const xAt = (t: number) => ((ax * t + bx) * t + cx) * t;
  let t = x;
  for (let i = 0; i < 6; i++) {
    const err = xAt(t) - x;
    if (Math.abs(err) < 1e-6) return ((ay * t + by) * t + cy) * t;
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 30; i++) {
    const v = xAt(t);
    if (Math.abs(v - x) < 1e-6) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return ((ay * t + by) * t + cy) * t;
}

/** A keyframe curve's progress at 0…1. */
export function curveAt(ease: Ease | Readonly<Bezier> | undefined, p: number): number {
  if (ease === undefined) return easeAt('smooth', p);
  return typeof ease === 'string' ? easeAt(ease, p) : bezierAt(ease, p);
}

/** The value of keyframes at `t` (flicks from the item's start). `list` is in time order. */
export function sampleKeyframes(list: readonly Keyframe[], t: Time): number {
  const n = list.length;
  if (n === 0) return 0;
  if (t <= list[0]!.t) return list[0]!.v;
  if (t >= list[n - 1]!.t) return list[n - 1]!.v;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = list[lo]!;
  const b = list[hi]!;
  const p = (t - a.t) / Math.max(1, b.t - a.t);
  return a.v + (b.v - a.v) * curveAt(a.ease, p);
}

/**
 * The transform at `t` (flicks from the item's start) into `out` (reused — no allocation):
 * keyframed properties sampled, the rest from `base`. Opacity is kept in 0…1, scale above 0.
 */
export function keyedTransform(
  base: Readonly<Transform>,
  keyframes: Readonly<Keyframes> | undefined,
  t: Time,
  out: Transform,
): Transform {
  out.x = base.x;
  out.y = base.y;
  out.scale = base.scale;
  out.rotation = base.rotation;
  out.opacity = base.opacity;
  out.flipX = base.flipX;
  out.flipY = base.flipY;
  if (!keyframes) return out;
  const at = t + (keyframes.shift ?? 0);
  for (const prop of KEYFRAME_PROPS) {
    const list = keyframes[prop];
    if (list && list.length) out[prop] = sampleKeyframes(list, at);
  }
  out.opacity = Math.min(1, Math.max(0, out.opacity));
  out.scale = Math.max(0.001, out.scale);
  return out;
}

/** The value of one keyed property at `t` (flicks from the item's start), or null if not keyed. */
export function keyedValue(
  keyframes: Readonly<Keyframes> | undefined,
  prop: KeyframeProp,
  t: Time,
): number | null {
  const list = keyframes?.[prop];
  return list?.length ? sampleKeyframes(list, t + (keyframes!.shift ?? 0)) : null;
}

/** A keyframe's time as the item sees it (flicks from its start). */
export function keyTime(keyframes: Readonly<Keyframes>, k: Readonly<Keyframe>): Time {
  return k.t - (keyframes.shift ?? 0);
}

/** True when any property has keyframes. */
export function hasKeyframes(keyframes: Readonly<Keyframes> | undefined): boolean {
  return !!keyframes && KEYFRAME_PROPS.some((p) => (keyframes[p]?.length ?? 0) > 0);
}

/**
 * Keyframes for a part of the item that starts `offset` later in its old timing (split, trim
 * from the start): the same keyframes, shifted, so the part plays its share of the motion
 * exactly — even inside a curve.
 */
export function retimeKeyframes(keyframes: Readonly<Keyframes>, offset: Time): Keyframes {
  const shift = (keyframes.shift ?? 0) + offset;
  const { shift: _old, ...rest } = keyframes;
  void _old;
  return shift ? { ...structuredClone(rest), shift } : structuredClone(rest);
}
