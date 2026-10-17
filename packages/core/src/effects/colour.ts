import type { Adjust, Filter } from '../model/schema';

/**
 * One colour pipeline for every filter and adjustment: filters are parameter sets of it, not
 * separate shaders. The shader (render/shaders/composite.wgsl, `colour()`) runs, per pixel:
 *
 *   sharpen → HDR correction → × gain → highlights / shadows → contrast (pivot 0.5) → + lift →
 *   saturation → split toning → mono tint → output levels (black … white) → vignette → clamp
 *
 * The parameters travel as {@link EFFECT_FLOATS} floats per layer (8 × vec4, see
 * {@link writeEffects}), next to the layer's geometry in its uniform block.
 */

/** Floats of per-layer effect uniforms (8 × vec4). */
export const EFFECT_FLOATS = 32;

/** The colour pipeline's parameters. Identity = {@link identityColour}. */
export interface ColourParams {
  /** Per-channel multipliers (white balance, exposure). */
  gainR: number;
  gainG: number;
  gainB: number;
  /** Around mid grey; 1 = unchanged. */
  contrast: number;
  /** Per-channel offsets added after contrast (brightness). */
  liftR: number;
  liftG: number;
  liftB: number;
  /** 0 = grey, 1 = unchanged, > 1 = more colour. */
  saturation: number;
  /** −1…1: darken / brighten the bright and the dark parts. */
  highlights: number;
  shadows: number;
  /** > 0 darkens the edges, < 0 lightens them. */
  vignette: number;
  /** > 0 sharpens (unsharp mask), < 0 softens. */
  sharpen: number;
  /** Colour added to the dark / bright parts (split toning), −1…1 per channel. */
  shadowR: number;
  shadowG: number;
  shadowB: number;
  highR: number;
  highG: number;
  highB: number;
  /** Mix towards a tinted greyscale (sepia, …): amount 0…1 and the tint. */
  mono: number;
  monoR: number;
  monoG: number;
  monoB: number;
  /** Output levels: black maps to `black`, white to `white` (faded / matte looks). */
  black: number;
  white: number;
}

/** A fresh identity parameter set (the picture unchanged). */
export function identityColour(): ColourParams {
  return {
    gainR: 1,
    gainG: 1,
    gainB: 1,
    contrast: 1,
    liftR: 0,
    liftG: 0,
    liftB: 0,
    saturation: 1,
    highlights: 0,
    shadows: 0,
    vignette: 0,
    sharpen: 0,
    shadowR: 0,
    shadowG: 0,
    shadowB: 0,
    highR: 0,
    highG: 0,
    highB: 0,
    mono: 0,
    monoR: 1,
    monoG: 1,
    monoB: 1,
    black: 0,
    white: 1,
  };
}

const IDENTITY: Readonly<ColourParams> = Object.freeze(identityColour());
const KEYS = Object.keys(IDENTITY) as (keyof ColourParams)[];

/**
 * Each filter as the parameters that differ from identity (at intensity 1). Intensity blends every
 * parameter linearly from identity, so 0 = no change and 0.5 = half the look.
 */
export const FILTER_PARAMS: Readonly<Record<string, Readonly<Partial<ColourParams>>>> =
  Object.freeze({
    vivid: { saturation: 1.38, contrast: 1.12, liftR: -0.01, liftG: -0.01, liftB: -0.01 },
    warm: { gainR: 1.1, gainG: 1.02, gainB: 0.86, saturation: 1.06, highR: 0.02 },
    cool: { gainR: 0.9, gainG: 0.99, gainB: 1.12, saturation: 0.98, shadowB: 0.02 },
    golden: {
      gainR: 1.08,
      gainG: 1.03,
      gainB: 0.88,
      highR: 0.05,
      highG: 0.03,
      highB: -0.04,
      contrast: 1.05,
      saturation: 1.1,
    },
    bright: {
      gainR: 1.12,
      gainG: 1.12,
      gainB: 1.12,
      shadows: 0.3,
      liftR: 0.02,
      liftG: 0.02,
      liftB: 0.02,
    },
    punch: { contrast: 1.3, saturation: 1.28, sharpen: 0.4, vignette: 0.2 },
    'teal-orange': {
      shadowR: -0.05,
      shadowG: 0.03,
      shadowB: 0.07,
      highR: 0.08,
      highG: 0.02,
      highB: -0.06,
      saturation: 1.12,
      contrast: 1.08,
    },
    film: {
      contrast: 1.08,
      saturation: 0.88,
      black: 0.04,
      white: 0.97,
      shadowG: 0.015,
      shadowB: 0.03,
      highR: 0.03,
      highG: 0.015,
    },
    dream: {
      liftR: 0.04,
      liftG: 0.03,
      liftB: 0.05,
      contrast: 0.85,
      saturation: 1.1,
      highlights: 0.25,
      gainR: 1.04,
      gainB: 1.05,
      black: 0.05,
    },
    fade: { contrast: 0.85, black: 0.09, white: 0.95, saturation: 0.78 },
    matte: { black: 0.11, contrast: 0.9, saturation: 0.86, highlights: -0.12 },
    vintage: {
      mono: 0.35,
      monoR: 1.1,
      monoG: 0.95,
      monoB: 0.75,
      black: 0.06,
      white: 0.93,
      contrast: 0.9,
      saturation: 0.75,
      vignette: 0.3,
    },
    moody: {
      gainR: 0.95,
      gainG: 0.98,
      gainB: 1.03,
      contrast: 1.15,
      saturation: 0.72,
      shadows: -0.2,
      vignette: 0.28,
    },
    mono: { saturation: 0, contrast: 1.1 },
    noir: {
      saturation: 0,
      contrast: 1.45,
      vignette: 0.38,
      liftR: -0.03,
      liftG: -0.03,
      liftB: -0.03,
    },
    sepia: {
      saturation: 0,
      mono: 1,
      monoR: 1.12,
      monoG: 0.94,
      monoB: 0.72,
      contrast: 0.95,
      black: 0.04,
    },
  });

function clampUnit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

/**
 * The colour parameters for a clip's filter + adjustments, written into `out` (reused — no
 * allocation). Unknown filter ids are treated as no filter.
 */
export function colourParams(
  filter: Filter | null,
  adjust: Adjust,
  out: ColourParams = identityColour(),
): ColourParams {
  const preset = filter ? FILTER_PARAMS[filter.id] : undefined;
  const k = filter ? Math.max(0, Math.min(1, filter.intensity)) : 0;
  for (const key of KEYS) {
    const base = IDENTITY[key];
    const target = preset?.[key];
    out[key] = target === undefined ? base : base + (target - base) * k;
  }
  // Adjustments stack on top of the filter.
  const brightness = clampUnit(adjust.brightness);
  if (brightness) {
    const g = 1 + 0.3 * brightness;
    out.gainR *= g;
    out.gainG *= g;
    out.gainB *= g;
    out.liftR += 0.05 * brightness;
    out.liftG += 0.05 * brightness;
    out.liftB += 0.05 * brightness;
  }
  out.contrast *= 1 + 0.5 * clampUnit(adjust.contrast);
  out.saturation *= 1 + clampUnit(adjust.saturation);
  const warmth = clampUnit(adjust.warmth);
  out.gainR *= 1 + 0.12 * warmth;
  out.gainG *= 1 + 0.02 * warmth;
  out.gainB *= 1 - 0.12 * warmth;
  const tint = clampUnit(adjust.tint); // + = magenta, − = green
  out.gainR *= 1 + 0.05 * tint;
  out.gainG *= 1 - 0.1 * tint;
  out.gainB *= 1 + 0.05 * tint;
  out.highlights += clampUnit(adjust.highlights);
  out.shadows += clampUnit(adjust.shadows);
  out.sharpen += clampUnit(adjust.sharpen);
  out.vignette += 0.8 * clampUnit(adjust.vignette);
  return out;
}

/** True when the parameters leave the picture unchanged (lets the caller skip work). */
export function isIdentityColour(params: ColourParams): boolean {
  for (const key of KEYS) if (Math.abs(params[key] - IDENTITY[key]) > 1e-6) return false;
  return true;
}

/** Transition / compositing extras carried in the same uniform block as the colour. */
export interface LayerFx {
  /** Blur radius in texture uv units (x, y); 0 = sharp. */
  blurX: number;
  blurY: number;
  /** Wipe mask: draw only where clip-space x < `wipeEdge` (soft edge `wipeSoft`). */
  wipe: boolean;
  wipeEdge: number;
  wipeSoft: number;
}

/** A fresh "no extras" {@link LayerFx}. */
export function noFx(): LayerFx {
  return { blurX: 0, blurY: 0, wipe: false, wipeEdge: 0, wipeSoft: 0 };
}

/**
 * Packs colour + extras into `out` at `offset` (floats), in the shader's order (8 × vec4):
 * gain+contrast, lift+saturation, highlights/shadows/vignette/sharpen, shadow tint+mono,
 * highlight tint+black, mono tint+white, blur xy + texel size (filled by the renderer), wipe.
 */
export function writeEffects(
  out: Float32Array,
  offset: number,
  c: Readonly<ColourParams>,
  fx: Readonly<LayerFx>,
): void {
  out[offset] = c.gainR;
  out[offset + 1] = c.gainG;
  out[offset + 2] = c.gainB;
  out[offset + 3] = c.contrast;
  out[offset + 4] = c.liftR;
  out[offset + 5] = c.liftG;
  out[offset + 6] = c.liftB;
  out[offset + 7] = c.saturation;
  out[offset + 8] = c.highlights;
  out[offset + 9] = c.shadows;
  out[offset + 10] = c.vignette;
  out[offset + 11] = c.sharpen;
  out[offset + 12] = c.shadowR;
  out[offset + 13] = c.shadowG;
  out[offset + 14] = c.shadowB;
  out[offset + 15] = c.mono;
  out[offset + 16] = c.highR;
  out[offset + 17] = c.highG;
  out[offset + 18] = c.highB;
  out[offset + 19] = c.black;
  out[offset + 20] = c.monoR;
  out[offset + 21] = c.monoG;
  out[offset + 22] = c.monoB;
  out[offset + 23] = c.white;
  out[offset + 24] = fx.blurX;
  out[offset + 25] = fx.blurY;
  out[offset + 26] = 0; // texel size: written by the renderer, which knows the source size
  out[offset + 27] = 0;
  out[offset + 28] = fx.wipe ? 1 : 0;
  out[offset + 29] = fx.wipeEdge;
  out[offset + 30] = fx.wipeSoft;
  out[offset + 31] = 0;
}

/** The identity effect block (no filter, no extras) — shared, never modified. */
export const IDENTITY_EFFECTS: Readonly<Float32Array> = (() => {
  const block = new Float32Array(EFFECT_FLOATS);
  writeEffects(block, 0, IDENTITY, noFx());
  return block;
})();
