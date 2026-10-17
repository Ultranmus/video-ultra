import type { ColourParams } from './colour';

/**
 * The filter library: every filter is a parameter set of the one colour pipeline
 * (effects/colour.ts), never its own shader. Ids and labels live in the catalogue
 * (effects/presets.ts); ids are stored in projects and never change once released (the first 16
 * shipped in v0.1 and keep their exact numbers).
 */

type Params = Partial<ColourParams>;
type Rgb = readonly [number, number, number];

/**
 * A compact way to write a look. Keys: `t` temperature and `tn` tint (−1…1, like the Warmth and
 * Tint sliders), `e` exposure (+0.1 = 10 % brighter), `gain` explicit multipliers, `c` contrast,
 * `s` saturation, `v` vibrance, `hl`/`sh` highlights/shadows, `lift` (one value or rgb),
 * `b`/`w` output black/white, `st`/`ht` shadow/highlight tint, `mono` [amount, r, g, b],
 * `vg` vignette, `sp` sharpen, `g` grain, `hue` degrees.
 */
interface Look {
  t?: number;
  tn?: number;
  e?: number;
  gain?: Rgb;
  c?: number;
  s?: number;
  v?: number;
  hl?: number;
  sh?: number;
  lift?: number | Rgb;
  b?: number;
  w?: number;
  st?: Rgb;
  ht?: Rgb;
  mono?: readonly [number, number, number, number];
  vg?: number;
  sp?: number;
  g?: number;
  hue?: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function look(l: Look): Params {
  const p: Params = {};
  let gr = l.gain?.[0] ?? 1;
  let gg = l.gain?.[1] ?? 1;
  let gb = l.gain?.[2] ?? 1;
  if (l.t) {
    gr *= 1 + 0.12 * l.t;
    gg *= 1 + 0.02 * l.t;
    gb *= 1 - 0.12 * l.t;
  }
  if (l.tn) {
    gr *= 1 + 0.05 * l.tn;
    gg *= 1 - 0.1 * l.tn;
    gb *= 1 + 0.05 * l.tn;
  }
  if (l.e) {
    gr *= 1 + l.e;
    gg *= 1 + l.e;
    gb *= 1 + l.e;
  }
  if (gr !== 1) p.gainR = r3(gr);
  if (gg !== 1) p.gainG = r3(gg);
  if (gb !== 1) p.gainB = r3(gb);
  if (l.c !== undefined) p.contrast = l.c;
  if (l.s !== undefined) p.saturation = l.s;
  if (l.v !== undefined) p.vibrance = l.v;
  if (l.hl !== undefined) p.highlights = l.hl;
  if (l.sh !== undefined) p.shadows = l.sh;
  if (l.lift !== undefined) {
    const [a, b, c] = typeof l.lift === 'number' ? [l.lift, l.lift, l.lift] : l.lift;
    p.liftR = a;
    p.liftG = b;
    p.liftB = c;
  }
  if (l.b !== undefined) p.black = l.b;
  if (l.w !== undefined) p.white = l.w;
  if (l.st) [p.shadowR, p.shadowG, p.shadowB] = l.st;
  if (l.ht) [p.highR, p.highG, p.highB] = l.ht;
  if (l.mono) [p.mono, p.monoR, p.monoG, p.monoB] = l.mono;
  if (l.vg !== undefined) p.vignette = l.vg;
  if (l.sp !== undefined) p.sharpen = l.sp;
  if (l.g !== undefined) p.grain = l.g;
  if (l.hue !== undefined) p.hue = l.hue;
  return p;
}

/** [id, parameters at intensity 1], in the catalogue's order (effects/presets.ts). */
// prettier-ignore
const FILTERS: readonly (readonly [string, Params])[] = [
  // ── Natural ──
  ['natural', look({ c: 1.04, v: 0.12, s: 1.03 })],
  ['bright', { gainR: 1.12, gainG: 1.12, gainB: 1.12, shadows: 0.3, liftR: 0.02, liftG: 0.02, liftB: 0.02 }],
  ['clear', look({ sp: 0.25, c: 1.06, hl: -0.12, sh: 0.12, v: 0.08 })],
  ['crisp', look({ sp: 0.45, c: 1.1, v: 0.15 })],
  ['soft', look({ c: 0.92, sp: -0.35, lift: 0.015, hl: -0.1 })],
  ['daylight', look({ t: 0.12, e: 0.05, v: 0.12 })],
  ['true', look({ v: 0.22, c: 1.03 })],
  ['fresh', look({ t: -0.06, v: 0.22, e: 0.04, sh: 0.1 })],
  // ── Vivid ──
  ['vivid', { saturation: 1.38, contrast: 1.12, liftR: -0.01, liftG: -0.01, liftB: -0.01 }],
  ['punch', { contrast: 1.3, saturation: 1.28, sharpen: 0.4, vignette: 0.2 }],
  ['pop', look({ s: 1.5, c: 1.1, v: 0.1 })],
  ['electric', look({ s: 1.45, c: 1.15, t: -0.12, hue: -4 })],
  ['juicy', look({ v: 0.5, s: 1.2, t: 0.06, c: 1.05 })],
  ['bold', look({ c: 1.25, s: 1.3, lift: -0.015, sp: 0.2 })],
  ['neon', look({ s: 1.6, c: 1.2, hue: 8, vg: 0.22 })],
  ['rich', look({ s: 1.25, c: 1.12, sh: -0.12, v: 0.15 })],
  // ── Warm ──
  ['warm', { gainR: 1.1, gainG: 1.02, gainB: 0.86, saturation: 1.06, highR: 0.02 }],
  ['golden', { gainR: 1.08, gainG: 1.03, gainB: 0.88, highR: 0.05, highG: 0.03, highB: -0.04, contrast: 1.05, saturation: 1.1 }],
  ['sunset', look({ t: 0.45, tn: 0.1, ht: [0.06, 0.02, -0.04], s: 1.1 })],
  ['honey', look({ t: 0.3, st: [0.03, 0.01, -0.02], c: 0.95, v: 0.1 })],
  ['amber', look({ gain: [1.12, 1.0, 0.8], c: 1.04 })],
  ['cozy', look({ t: 0.25, b: 0.03, c: 0.92, vg: 0.22 })],
  ['peach', look({ t: 0.2, tn: 0.15, lift: [0.03, 0.012, 0], s: 0.95 })],
  ['autumn', look({ t: 0.3, hue: -6, s: 1.15, c: 1.06 })],
  // ── Cool ──
  ['cool', { gainR: 0.9, gainG: 0.99, gainB: 1.12, saturation: 0.98, shadowB: 0.02 }],
  ['arctic', look({ t: -0.45, e: 0.05, s: 0.85 })],
  ['blue-hour', look({ t: -0.35, tn: 0.08, st: [-0.01, 0, 0.05], c: 1.05 })],
  ['mint', look({ t: -0.15, tn: -0.15, lift: [0, 0.02, 0.012], s: 0.95 })],
  ['ice', look({ t: -0.3, b: 0.04, s: 0.7, e: 0.06 })],
  ['ocean', look({ gain: [0.88, 1.0, 1.1], s: 1.1, hue: -4 })],
  ['steel', look({ t: -0.2, s: 0.6, c: 1.1 })],
  ['lagoon', look({ st: [0, 0.03, 0.04], t: -0.2, v: 0.22 })],
  // ── Film ──
  ['film', { contrast: 1.08, saturation: 0.88, black: 0.04, white: 0.97, shadowG: 0.015, shadowB: 0.03, highR: 0.03, highG: 0.015 }],
  ['fade', { contrast: 0.85, black: 0.09, white: 0.95, saturation: 0.78 }],
  ['matte', { black: 0.11, contrast: 0.9, saturation: 0.86, highlights: -0.12 }],
  ['warm-film', look({ t: 0.2, b: 0.05, w: 0.96, c: 1.05, s: 0.9, g: 0.18, ht: [0.03, 0.01, -0.02] })],
  ['cool-film', look({ t: -0.15, b: 0.05, c: 1.05, s: 0.85, g: 0.18, st: [0, 0.02, 0.04] })],
  ['grainy', look({ g: 0.4, c: 1.05, s: 0.92 })],
  ['expired', look({ hue: 6, b: 0.06, t: 0.15, s: 0.8, g: 0.25, tn: -0.1 })],
  ['super8', look({ t: 0.25, b: 0.07, c: 0.9, vg: 0.38, g: 0.45, s: 0.85 })],
  // ── Vintage ──
  ['vintage', { mono: 0.35, monoR: 1.1, monoG: 0.95, monoB: 0.75, black: 0.06, white: 0.93, contrast: 0.9, saturation: 0.75, vignette: 0.3 }],
  ['sepia', { saturation: 0, mono: 1, monoR: 1.12, monoG: 0.94, monoB: 0.72, contrast: 0.95, black: 0.04 }],
  ['antique', look({ mono: [0.6, 1.1, 0.95, 0.75], vg: 0.4, g: 0.3, b: 0.05 })],
  ['instant', look({ t: 0.1, b: 0.05, tn: -0.05, ht: [0.03, 0.03, 0], c: 0.92, s: 0.9 })],
  ['old-photo', look({ mono: [0.85, 1.08, 0.92, 0.7], g: 0.4, vg: 0.45, b: 0.06, w: 0.92 })],
  ['dusty', look({ s: 0.6, t: 0.2, b: 0.06, g: 0.3, c: 0.92 })],
  ['tea', look({ mono: [0.4, 1.15, 1.0, 0.7], c: 0.95, b: 0.03 })],
  // ── Cinematic ──
  ['teal-orange', { shadowR: -0.05, shadowG: 0.03, shadowB: 0.07, highR: 0.08, highG: 0.02, highB: -0.06, saturation: 1.12, contrast: 1.08 }],
  ['blockbuster', look({ st: [-0.04, 0.02, 0.08], ht: [0.08, 0.03, -0.06], c: 1.15, s: 1.05, vg: 0.25 })],
  ['bleach', look({ s: 0.5, c: 1.35, sh: -0.1, sp: 0.15 })],
  ['epic', look({ c: 1.2, t: -0.05, st: [0, 0.02, 0.05], vg: 0.3 })],
  ['dune', look({ t: 0.4, s: 0.8, c: 1.1, hue: -5 })],
  ['cyber', look({ gain: [0.92, 1.06, 0.95], st: [0, 0.04, 0.02], c: 1.15, s: 0.8 })],
  ['western', look({ t: 0.35, s: 0.7, c: 1.15, b: 0.03 })],
  ['thriller', look({ t: -0.2, s: 0.6, c: 1.2, sh: -0.2, vg: 0.35 })],
  // ── Moody ──
  ['moody', { gainR: 0.95, gainG: 0.98, gainB: 1.03, contrast: 1.15, saturation: 0.72, shadows: -0.2, vignette: 0.28 }],
  ['dark', look({ e: -0.15, c: 1.15, sh: -0.25, vg: 0.3 })],
  ['storm', look({ t: -0.25, s: 0.5, c: 1.1, sh: -0.1 })],
  ['dusk', look({ t: 0.1, tn: 0.15, e: -0.1, vg: 0.3, s: 0.85 })],
  ['shadow', look({ sh: -0.35, hl: -0.1, c: 1.2, s: 0.8 })],
  ['melancholy', look({ s: 0.45, t: -0.15, b: 0.05 })],
  ['deep', look({ s: 1.1, c: 1.25, e: -0.1, vg: 0.3 })],
  // ── Pastel ──
  ['dream', { liftR: 0.04, liftG: 0.03, liftB: 0.05, contrast: 0.85, saturation: 1.1, highlights: 0.25, gainR: 1.04, gainB: 1.05, black: 0.05 }],
  ['pastel', look({ b: 0.06, c: 0.85, s: 0.8, lift: [0.03, 0.02, 0.04] })],
  ['cotton', look({ tn: 0.12, b: 0.08, c: 0.85, e: 0.05 })],
  ['lavender', look({ gain: [1.02, 0.96, 1.08], b: 0.05, s: 0.8 })],
  ['blush', look({ tn: 0.2, t: 0.1, b: 0.04, s: 0.9 })],
  ['airy', look({ e: 0.12, c: 0.85, sh: 0.2, s: 0.9 })],
  ['sorbet', look({ hue: 6, s: 1.05, b: 0.06, c: 0.88 })],
  ['milk', look({ b: 0.1, w: 0.97, s: 0.7, e: 0.05 })],
  // ── Black & white ──
  ['mono', { saturation: 0, contrast: 1.1 }],
  ['noir', { saturation: 0, contrast: 1.45, vignette: 0.38, liftR: -0.03, liftG: -0.03, liftB: -0.03 }],
  ['silver', look({ s: 0, c: 1.15, ht: [0.02, 0.02, 0.03] })],
  ['bright-bw', look({ s: 0, e: 0.15, c: 0.95, sh: 0.2 })],
  ['contrast-bw', look({ s: 0, c: 1.5, vg: 0.2 })],
  ['soft-bw', look({ s: 0, c: 0.85, b: 0.04 })],
  ['grain-bw', look({ s: 0, c: 1.2, g: 0.4 })],
  ['blue-tone', look({ mono: [1, 0.85, 0.95, 1.15], c: 1.1 })],
  // ── Retro ──
  ['seventies', look({ t: 0.3, hue: -8, s: 0.85, b: 0.06, c: 0.9 })],
  ['eighties', look({ s: 1.3, tn: 0.15, hue: 10, c: 1.1 })],
  ['nineties', look({ t: 0.1, c: 1.05, s: 0.9, g: 0.2, b: 0.04 })],
  ['tape', look({ s: 1.2, sp: -0.4, b: 0.05, g: 0.3, hue: 4 })],
  ['disco', look({ tn: 0.2, s: 1.35, c: 1.15 })],
  ['arcade', look({ s: 1.5, c: 1.2, hue: -10, vg: 0.3 })],
  ['retro-pop', look({ s: 1.3, b: 0.04, ht: [0.05, 0.02, 0] })],
  ['cross', look({ st: [0, 0.04, 0.08], ht: [0.06, 0.06, -0.08], c: 1.15, s: 1.1 })],
  // ── Food ──
  ['tasty', look({ t: 0.15, v: 0.35, c: 1.08 })],
  ['savory', look({ t: 0.2, s: 1.15, c: 1.1, sh: 0.1 })],
  ['sweet', look({ tn: 0.1, e: 0.06, v: 0.25 })],
  ['bistro', look({ t: 0.25, c: 1.12, vg: 0.25, s: 1.05 })],
  ['brunch', look({ e: 0.1, t: 0.1, v: 0.2, sh: 0.15 })],
  ['crispy', look({ sp: 0.5, c: 1.12, v: 0.2 })],
  ['spice', look({ t: 0.3, s: 1.25, hue: -4, c: 1.1 })],
  // ── Portrait ──
  ['portrait', look({ v: 0.2, sh: 0.15, sp: -0.1, t: 0.05 })],
  ['glow', look({ hl: 0.1, e: 0.06, c: 0.94, sp: -0.2, t: 0.08 })],
  ['skin', look({ v: 0.15, c: 1.02, t: 0.04 })],
  ['rosy', look({ tn: 0.12, t: 0.06, v: 0.1 })],
  ['studio', look({ c: 1.1, sh: 0.1, sp: 0.2 })],
  ['soft-focus', look({ sp: -0.6, c: 0.9, b: 0.03, hl: -0.05 })],
  ['bronze', look({ t: 0.25, ht: [0.04, 0.02, -0.02], c: 1.06 })],
  // ── Landscape ──
  ['landscape', look({ v: 0.35, c: 1.08, sp: 0.25, hl: -0.2 })],
  ['sky', look({ gain: [0.96, 1, 1.08], hl: -0.3, v: 0.25 })],
  ['green', look({ gain: [0.96, 1.06, 0.95], v: 0.3 })],
  ['mountain', look({ c: 1.15, sp: 0.35, t: -0.08, hl: -0.2 })],
  ['desert', look({ t: 0.35, c: 1.1, s: 0.9, hue: -4 })],
  ['tropical', look({ v: 0.5, hue: -6, c: 1.08, e: 0.04 })],
  ['mist', look({ b: 0.08, c: 0.85, s: 0.8, e: 0.05, t: -0.05 })],
  ['harvest', look({ t: 0.3, v: 0.3, hue: -8 })],
  // ── Night ──
  ['night', look({ t: -0.25, e: 0.1, sh: 0.25, c: 1.05 })],
  ['neon-night', look({ s: 1.4, tn: 0.2, c: 1.15, vg: 0.3, t: -0.15 })],
  ['city-lights', look({ t: 0.1, sh: 0.2, c: 1.1, v: 0.3 })],
  ['moonlight', look({ t: -0.4, s: 0.6, e: 0.05, sh: 0.15 })],
  ['midnight', look({ t: -0.3, e: -0.1, c: 1.2, vg: 0.35, s: 0.8 })],
  ['night-vision', look({ mono: [1, 0.6, 1.25, 0.6], c: 1.3, g: 0.3, vg: 0.4 })],
  ['candle', look({ t: 0.45, e: 0.08, sh: 0.2, vg: 0.3 })],
];

/**
 * Each filter as the parameters that differ from identity (at intensity 1). Intensity blends every
 * parameter linearly from identity, so 0 = no change and 0.5 = half the look.
 */
export const FILTER_PARAMS: Readonly<Record<string, Readonly<Params>>> = Object.freeze(
  Object.fromEntries(FILTERS.map(([id, params]) => [id, Object.freeze(params)])),
);
