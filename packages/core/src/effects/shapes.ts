/**
 * Shape masks (v0.3): a picture shows only inside a shape — circle, star, heart, blob… Each shape
 * is a signed distance field (negative inside, positive outside, in units of the shape's radius),
 * drawn exactly in the compositor shader (render/shaders/composite.wgsl, `shapeDistance`) so it
 * stays sharp at any size and costs no textures. {@link shapeDistance} is the same maths in
 * TypeScript, for the picker's previews and tests — keep the two in step.
 *
 * A preset is a family plus up to three numbers. Shapes either keep their proportions (they fit
 * the smaller side of the picture, centred) or stretch to the picture's box (`stretch`).
 */

/** Shape families (the shader's `shape.x`). */
export const ShapeFamily = {
  none: 0,
  polygon: 1,
  star: 2,
  roundedBox: 3,
  ellipse: 4,
  heart: 5,
  cross: 6,
  ring: 7,
  flower: 8,
  squircle: 9,
  crescent: 10,
  arrow: 11,
  cog: 12,
  blob: 13,
  bubble: 14,
  cloud: 15,
} as const;

/** One mask shape. */
export interface ShapePreset {
  id: string;
  /** Picker group. */
  category: 'basic' | 'polygons' | 'stars' | 'flowers' | 'organic' | 'symbols';
  family: number;
  /** Family parameters (see each family in {@link shapeDistance}). */
  a: number;
  b: number;
  c: number;
  /** Turned by this many degrees (clockwise). */
  rotation: number;
  /** Stretches to the picture's box instead of keeping its proportions. */
  stretch: boolean;
}

const preset = (
  id: string,
  category: ShapePreset['category'],
  family: number,
  a = 0,
  b = 0,
  c = 0,
  rotation = 0,
  stretch = false,
): ShapePreset => ({ id, category, family, a, b, c, rotation, stretch });

const F = ShapeFamily;
const NUMBER_NAMES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Every mask shape, in picker order (117). */
export const SHAPE_PRESETS: readonly ShapePreset[] = Object.freeze([
  // Basic: fill the picture's box, or keep proportions.
  preset('rectangle-soft', 'basic', F.roundedBox, 0.06, 0, 0, 0, true),
  preset('rectangle-round', 'basic', F.roundedBox, 0.16, 0, 0, 0, true),
  preset('rectangle-rounder', 'basic', F.roundedBox, 0.32, 0, 0, 0, true),
  preset('pill', 'basic', F.roundedBox, 1, 0, 0, 0, true),
  preset('oval', 'basic', F.ellipse, 0, 0, 0, 0, true),
  preset('circle', 'basic', F.ellipse),
  preset('square', 'basic', F.roundedBox, 0),
  preset('square-soft', 'basic', F.roundedBox, 0.1),
  preset('square-round', 'basic', F.roundedBox, 0.25),
  preset('square-rounder', 'basic', F.roundedBox, 0.45),
  preset('squircle', 'basic', F.squircle, 4),
  preset('squircle-soft', 'basic', F.squircle, 3),
  preset('squircle-sharp', 'basic', F.squircle, 6),
  preset('squircle-wide', 'basic', F.squircle, 4, 0, 0, 0, true),
  preset('squircle-wide-soft', 'basic', F.squircle, 3, 0, 0, 0, true),
  // Regular polygons, sharp and rounded (a: sides, c: corner rounding).
  ...NUMBER_NAMES.map((n) => preset(`polygon-${n}`, 'polygons', F.polygon, n)),
  ...NUMBER_NAMES.map((n) => preset(`polygon-${n}-round`, 'polygons', F.polygon, n, 0, 0.18)),
  preset('diamond-wide', 'polygons', F.polygon, 4, 0, 0, 0, true),
  preset('triangle-down', 'polygons', F.polygon, 3, 0, 0, 180),
  preset('triangle-down-round', 'polygons', F.polygon, 3, 0, 0.18, 180),
  preset('square-tilted', 'polygons', F.polygon, 4, 0, 0.08, 45),
  // Stars (a: points, b: sharpness 2 = polygon … a = sharpest, c: rounding).
  ...[4, 5, 6, 7, 8, 9, 10, 12].map((n) => preset(`star-${n}`, 'stars', F.star, n, 2 + n * 0.08)),
  ...[4, 5, 6, 7, 8, 9, 10, 12].map((n) =>
    preset(`star-${n}-soft`, 'stars', F.star, n, Math.max(2.2, n * 0.62)),
  ),
  ...[5, 6, 8].map((n) => preset(`star-${n}-round`, 'stars', F.star, n, 2.4 + n * 0.08, 0.08)),
  preset('burst-16', 'stars', F.star, 16, 9),
  preset('burst-20', 'stars', F.star, 20, 12),
  preset('burst-24', 'stars', F.star, 24, 15),
  preset('sparkle', 'stars', F.star, 4, 3.1),
  // Flowers (a: petals, b: how deep the dips are) and cogs (a: teeth, b: depth).
  ...[3, 4, 5, 6, 7, 8, 9, 10, 12].map((n) => preset(`flower-${n}`, 'flowers', F.flower, n, 0.42)),
  ...[3, 4, 5, 6, 7, 8, 9, 10, 12].map((n) => preset(`scallop-${n}`, 'flowers', F.flower, n, 0.14)),
  ...[16, 20, 24].map((n) => preset(`wavy-${n}`, 'flowers', F.flower, n, 0.08)),
  ...[6, 8, 10, 12, 14, 16].map((n) => preset(`cog-${n}`, 'flowers', F.cog, n, 0.18)),
  // Organic: blobs (a: seed), heart, cloud, crescent, drop.
  ...Array.from({ length: 12 }, (_, i) => preset(`blob-${i + 1}`, 'organic', F.blob, i + 1)),
  preset('heart', 'organic', F.heart),
  preset('heart-tilted', 'organic', F.heart, 0, 0, 0, -15),
  preset('heart-round', 'organic', F.heart, 0, 0, 0.06),
  preset('cloud', 'organic', F.cloud),
  preset('cloud-wide', 'organic', F.cloud, 0, 0, 0, 0, true),
  preset('moon', 'organic', F.crescent, 0.45),
  preset('moon-thin', 'organic', F.crescent, 0.28),
  preset('moon-left', 'organic', F.crescent, 0.45, 0, 0, 180),
  // Symbols: plus / x (a: arm thickness, c: rounding), rings (b: hole), arrows, speech bubbles.
  preset('plus', 'symbols', F.cross, 0.34),
  preset('plus-thin', 'symbols', F.cross, 0.22),
  preset('plus-round', 'symbols', F.cross, 0.3, 0, 0.12),
  preset('x', 'symbols', F.cross, 0.3, 0, 0, 45),
  preset('x-thin', 'symbols', F.cross, 0.2, 0, 0, 45),
  preset('x-round', 'symbols', F.cross, 0.28, 0, 0.1, 45),
  preset('ring', 'symbols', F.ring, 0, 0.55),
  preset('ring-thin', 'symbols', F.ring, 0, 0.75),
  preset('ring-bold', 'symbols', F.ring, 0, 0.3),
  preset('arrow-right', 'symbols', F.arrow, 0.36),
  preset('arrow-left', 'symbols', F.arrow, 0.36, 0, 0, 180),
  preset('arrow-up', 'symbols', F.arrow, 0.36, 0, 0, -90),
  preset('arrow-down', 'symbols', F.arrow, 0.36, 0, 0, 90),
  preset('arrow-wide', 'symbols', F.arrow, 0.36, 0, 0, 0, true),
  preset('bubble', 'symbols', F.bubble, 1),
  preset('bubble-left', 'symbols', F.bubble, -1),
  preset('bubble-wide', 'symbols', F.bubble, 1, 0, 0, 0, true),
]);

const BY_ID = new Map(SHAPE_PRESETS.map((p) => [p.id, p]));

/** The shape preset with this id, or undefined. */
export function shapePreset(id: string): ShapePreset | undefined {
  return BY_ID.get(id);
}

/** Picker groups, in order. */
export const SHAPE_CATEGORIES = [
  'basic',
  'polygons',
  'stars',
  'flowers',
  'organic',
  'symbols',
] as const;

// ── the distance fields (mirror composite.wgsl) ───────────────────────────────

const PI = Math.PI;
const len = (x: number, y: number) => Math.hypot(x, y);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fract = (v: number) => v - Math.floor(v);
const mod = (x: number, y: number) => x - y * Math.floor(x / y);

/** Exact regular polygon with circumradius `r`, a vertex pointing up. */
function polygon(x: number, y: number, r: number, n: number): number {
  const an = PI / n;
  const bn = mod(Math.atan2(x, -y), 2 * an) - an;
  const l = len(x, y);
  const px = l * Math.cos(bn) - r * Math.cos(an);
  let py = l * Math.abs(Math.sin(bn)) - r * Math.sin(an);
  py += clamp(-py, 0, r * Math.sin(an));
  return len(px, py) * Math.sign(px);
}

/** Star with `n` points, circumradius `r`, sharpness `m` (2 = a polygon … n = sharpest). */
function star(x: number, y: number, r: number, n: number, m: number): number {
  const an = PI / n;
  const en = PI / m;
  const bn = mod(Math.atan2(x, -y), 2 * an) - an;
  const l = len(x, y);
  let px = l * Math.cos(bn) - r * Math.cos(an);
  let py = l * Math.abs(Math.sin(bn)) - r * Math.sin(an);
  const ex = Math.cos(en);
  const ey = Math.sin(en);
  const k = clamp(-(px * ex + py * ey), 0, (r * Math.sin(an)) / ey);
  px += ex * k;
  py += ey * k;
  return len(px, py) * Math.sign(px);
}

function roundedBox(x: number, y: number, bx: number, by: number, r: number): number {
  const qx = Math.abs(x) - bx + r;
  const qy = Math.abs(y) - by + r;
  return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function heart(x0: number, y0: number): number {
  // Unit heart: tip at the bottom; centred in the unit circle.
  const x = Math.abs(x0) * 0.82;
  const y = -y0 * 0.82 + 0.6;
  let d: number;
  if (y + x > 1) d = len(x - 0.25, y - 0.75) - Math.SQRT2 / 4;
  else {
    const m = 0.5 * Math.max(x + y, 0);
    d =
      Math.sqrt(Math.min(x * x + (y - 1) * (y - 1), (x - m) * (x - m) + (y - m) * (y - m))) *
      Math.sign(x - y);
  }
  return d / 0.82;
}

function cross(x0: number, y0: number, t: number, r: number): number {
  let x = Math.abs(x0);
  let y = Math.abs(y0);
  if (y > x) [x, y] = [y, x];
  const bx = 1 - r;
  const by = t - r;
  const qx = x - bx;
  const qy = y - by;
  const k = Math.max(qy, qx);
  const wx = k > 0 ? qx : by - x;
  const wy = k > 0 ? qy : -k;
  return Math.sign(k) * len(Math.max(wx, 0), Math.max(wy, 0)) - r;
}

/** Polar shapes: distance ≈ (length − radius(θ)) scaled down so the edge stays smooth. */
function polar(x: number, y: number, radius: number, k: number): number {
  return (len(x, y) - radius) * k;
}

function hash(n: number): number {
  return fract(Math.sin(n) * 43758.5453);
}

function blobRadius(theta: number, seed: number): number {
  let r = 0.84;
  for (let i = 0; i < 3; i++) {
    const f = [2, 3, 5][i]!;
    const amp = 0.04 + 0.07 * hash(seed * 12.9898 + i * 78.233);
    const ph = 6.2831 * hash(seed * 39.3468 + i * 11.135);
    r += amp * Math.sin(f * theta + ph);
  }
  return r;
}

const CLOUD: readonly [number, number, number][] = [
  [-0.5, 0.18, 0.42],
  [0, -0.12, 0.55],
  [0.5, 0.15, 0.44],
  [-0.2, 0.3, 0.4],
  [0.22, 0.32, 0.4],
];

/**
 * Signed distance from the shape's edge at (x, y) — negative inside. Coordinates: the shape's
 * own space (y down), where proportional shapes fit the unit circle and stretched shapes fill
 * ±`aspect` × ±1. Same maths as the shader.
 */
export function shapeDistance(p: Readonly<ShapePreset>, x: number, y: number, aspect = 1): number {
  const ax = p.stretch ? aspect : 1;
  switch (p.family) {
    case F.polygon:
      return polygon(x, y, 1 - p.c, p.a) - p.c;
    case F.star:
      return star(x, y, 1 - p.c, p.a, p.b) - p.c;
    case F.roundedBox:
      return roundedBox(x, y, ax, 1, Math.min(ax, 1) * Math.min(p.a, 1));
    case F.ellipse: {
      const k = len(x / ax, y);
      return (k - 1) * Math.min(ax, 1);
    }
    case F.heart:
      return heart(x, y) - p.c;
    case F.cross:
      return cross(x, y, p.a, p.c);
    case F.ring:
      return Math.abs(len(x, y) - (1 + p.b) / 2) - (1 - p.b) / 2;
    case F.flower: {
      const t = Math.atan2(x, -y);
      return polar(x, y, 1 - p.b * (0.5 - 0.5 * Math.cos(p.a * t)), 0.7);
    }
    case F.squircle: {
      const n = p.a;
      const sx = Math.abs(x) / ax;
      const sy = Math.abs(y);
      return (Math.pow(Math.pow(sx, n) + Math.pow(sy, n), 1 / n) - 1) * Math.min(ax, 1);
    }
    case F.crescent: {
      const outer = len(x, y) - 1;
      const inner = len(x - p.a * 1.2, y + p.a * 0.25) - 0.95;
      return Math.max(outer, -inner);
    }
    case F.arrow: {
      const sx = x / ax;
      const shaft = roundedBox(sx + 0.3, y, 0.62, p.a, 0) * Math.min(ax, 1);
      const head = polygon(-y, -(sx - 0.18), 0.82, 3) * Math.min(ax, 1);
      return Math.min(shaft, head);
    }
    case F.cog: {
      const t = Math.atan2(x, -y);
      const s = Math.sin(p.a * t);
      const teeth = smoothstep(-0.8, 0.8, s);
      return polar(x, y, 1 - p.b + p.b * teeth, 0.6);
    }
    case F.blob: {
      const t = Math.atan2(x, -y);
      return polar(x, y, blobRadius(t, p.a), 0.8);
    }
    case F.bubble: {
      const body = roundedBox(x, y + 0.18, ax, 0.72, 0.3 * Math.min(ax, 1));
      // The tail: a triangle under the body, towards one side (a = −1 left … 1 right).
      const tx = x - p.a * Math.min(ax, 1) * 0.45;
      const tail = polygon(tx, -(y - 0.6), 0.36, 3);
      return Math.min(body, tail);
    }
    case F.cloud: {
      let d = Infinity;
      for (const [cx, cy, r] of CLOUD) d = Math.min(d, len(x / ax - cx, y - cy) - r);
      return d * Math.min(ax, 1);
    }
    default:
      return -1;
  }
}

/**
 * How much of a point shows (0…1) for a mask: `x, y` in the picture's box (−1…1, y down), the
 * box's width / height, `edge` the anti-aliasing width in shape units, `feather` 0…1.
 */
export function shapeCoverage(
  p: Readonly<ShapePreset>,
  qx: number,
  qy: number,
  boxAspect: number,
  edge: number,
  feather: number,
  invert: boolean,
): number {
  // Into shape space: proportional shapes fit the smaller side; then undo the rotation.
  const k = p.stretch ? 1 : Math.min(boxAspect, 1);
  let x = (qx * boxAspect) / k;
  let y = qy / k;
  if (p.rotation) {
    const r = (-p.rotation * PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  const d = shapeDistance(p, x, y, boxAspect / k);
  const w = Math.max(edge, feather * 0.5);
  const inside = 1 - smoothstep(-w, w * 0.25 + edge, d);
  return invert ? 1 - inside : inside;
}

function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
