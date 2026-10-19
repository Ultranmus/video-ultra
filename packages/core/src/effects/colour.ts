import type { Adjust, Filter } from '../model/schema';
import { FILTER_PARAMS } from './filters';

export { FILTER_PARAMS };

/**
 * One colour pipeline for every filter and adjustment: filters are parameter sets of it, not
 * separate shaders. The shader (render/shaders/composite.wgsl, `colour()`) runs, per pixel:
 *
 *   sharpen → HDR correction → × gain → highlights / shadows → contrast (pivot 0.5) → + lift →
 *   saturation → vibrance → hue → split toning → mono tint → output levels (black … white) →
 *   grain → vignette → clamp
 *
 * The parameters travel as {@link EFFECT_FLOATS} floats per layer (19 × vec4, see
 * {@link writeEffects}), next to the layer's geometry in its uniform block, together with the
 * per-layer extras of transitions and animations ({@link LayerFx}).
 */

/**
 * Floats of per-layer effect uniforms (26 × vec4): the colour pipeline and the extras of
 * transitions / animations (19 × vec4), then the picture tools ({@link PictureFx}: green screen,
 * LUT, blurred area, where the renderer's copy of the pixels underneath sits, blend mode, shape
 * mask).
 */
export const EFFECT_FLOATS = 104;

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
  /** Film grain 0…1 (animated per frame). */
  grain: number;
  /** Hue rotation in degrees. */
  hue: number;
  /** −1…1: saturation boost that spares already colourful parts (skin). */
  vibrance: number;
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
    grain: 0,
    hue: 0,
    vibrance: 0,
  };
}

const IDENTITY: Readonly<ColourParams> = Object.freeze(identityColour());
const KEYS = Object.keys(IDENTITY) as (keyof ColourParams)[];

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

/** Blur kinds of {@link LayerFx.blurMode}. */
export const BlurMode = { disc: 0, line: 1, radial: 2, spin: 3 } as const;

/**
 * Mask shapes of {@link LayerFx.mask}. Each reveals the layer as `maskProgress` goes 0 → 1
 * (`maskInvert` hides it instead). Shapes in screen space are aspect-correct; with `maskLocal`
 * they use the layer's own box (animations).
 */
export const MaskShape = {
  none: 0,
  /** Straight edge travelling along (maskDirX, maskDirY). */
  linear: 1,
  /** Clock hand from 12 o'clock; maskDirX < 0 turns anticlockwise. */
  clock: 2,
  /** Circle from (maskCX, maskCY). */
  circle: 3,
  diamond: 4,
  rect: 5,
  /** `maskCount` stripes, each wiping along the direction. */
  blinds: 6,
  /** `maskCount` cells per screen height; alternate cells follow later. */
  checker: 7,
  /** Opens from the centre line outwards along the direction axis. */
  split: 8,
  /** Straight edge with a zigzag (maskPoly 0) or wavy (1) front, `maskCount` teeth. */
  zigzag: 9,
  /** Polar shape: maskPoly 0 star · 1 flower · 2 hexagon · 3 triangle · 4 circle. */
  polar: 10,
  heart: 11,
  /** Random cells (`maskCount` per screen height) appear in random order. */
  noise: 12,
  /** Dark parts of this layer first. */
  luma: 13,
  /** Both clock hands from 12 o'clock. */
  fan: 14,
  /** Text typewriter / word reveal (local; set by the compositor from the text layout). */
  text: 20,
} as const;

/** Warps of {@link LayerFx.warp}: where each screen pixel samples the layer from. */
export const WarpKind = {
  none: 0,
  ripple: 1,
  wave: 2,
  swirl: 3,
  pixelate: 4,
  glitch: 5,
  bulge: 6,
} as const;

/**
 * Per-layer extras of transitions and animations, carried in the same uniform block as the
 * colour (see {@link writeEffects}). Screen units: canvas height = 2, y down, x ∈ ±aspect.
 */
export interface LayerFx {
  /**
   * Disc blur radius in texture uv (x, y). Other modes use x only: line = length in screen units,
   * radial = fraction of the distance to the centre, spin = radians. 0 = sharp.
   */
  blurX: number;
  blurY: number;
  /** {@link BlurMode}. `line` blurs along the unit vector (blurDirX, blurDirY) on screen. */
  blurMode: number;
  blurDirX: number;
  blurDirY: number;
  /** RGB split: red and blue sampled this far apart (screen units, horizontal). */
  split: number;
  /** Blurs take half the taps (low-tier preview; export never sets it). */
  cheapBlur: boolean;
  /** Grain seed (changes per frame; set by the compositor). */
  grainSeed: number;
  /** {@link MaskShape} (0 = none). */
  mask: number;
  maskProgress: number;
  maskSoft: number;
  maskInvert: boolean;
  /** Use the layer's own box (−1…1, aspect-correct) instead of the screen. */
  maskLocal: boolean;
  maskDirX: number;
  maskDirY: number;
  maskCount: number;
  maskCX: number;
  maskCY: number;
  /** Polar shape id / zigzag front style. */
  maskPoly: number;
  /** Darkens (> 0) or lights (< 0) the visible side next to the edge, over `maskShadeWidth`. */
  maskShade: number;
  maskShadeWidth: number;
  /** Text reveal (MaskShape.text), raster fractions: first line's top, line height, … */
  textTop: number;
  textLineH: number;
  /** Line being revealed (earlier lines show, later ones don't). */
  textLine: number;
  textLines: number;
  /** On that line: shown left of cut A, `textFadeB` opacity between A and B. */
  textCutA: number;
  textCutB: number;
  textFadeB: number;
  textRtl: boolean;
  /** {@link WarpKind}. */
  warp: number;
  warpAmount: number;
  warpFreq: number;
  warpPhase: number;
  warpDirX: number;
  warpDirY: number;
  warpCX: number;
  warpCY: number;
  /** Mix the result towards this colour (dips, flashes, 3D shading). */
  flashR: number;
  flashG: number;
  flashB: number;
  flash: number;
  /** 3D turn: 0 none · 1 around the vertical axis · 2 around the horizontal axis. */
  rotAxis: number;
  /** Degrees. */
  rotAngle: number;
  /** Camera distance (screen units); smaller = stronger perspective. */
  rotDistance: number;
  /** Turn pivot in screen units (z: depth, + = away from the viewer). */
  pivotX: number;
  pivotY: number;
  pivotZ: number;
}

/** A fresh "no extras" {@link LayerFx}. */
export function noFx(): LayerFx {
  return resetFx({} as LayerFx);
}

/** Resets `fx` to "no extras" in place (reused objects, no allocation). */
export function resetFx(fx: LayerFx): LayerFx {
  fx.blurX = 0;
  fx.blurY = 0;
  fx.blurMode = 0;
  fx.blurDirX = 0;
  fx.blurDirY = 0;
  fx.split = 0;
  fx.cheapBlur = false;
  fx.grainSeed = 0;
  fx.mask = 0;
  fx.maskProgress = 0;
  fx.maskSoft = 0;
  fx.maskInvert = false;
  fx.maskLocal = false;
  fx.maskDirX = 1;
  fx.maskDirY = 0;
  fx.maskCount = 1;
  fx.maskCX = 0;
  fx.maskCY = 0;
  fx.maskPoly = 0;
  fx.maskShade = 0;
  fx.maskShadeWidth = 0;
  fx.textTop = 0;
  fx.textLineH = 1;
  fx.textLine = 0;
  fx.textLines = 1;
  fx.textCutA = 1;
  fx.textCutB = 1;
  fx.textFadeB = 0;
  fx.textRtl = false;
  fx.warp = 0;
  fx.warpAmount = 0;
  fx.warpFreq = 0;
  fx.warpPhase = 0;
  fx.warpDirX = 1;
  fx.warpDirY = 0;
  fx.warpCX = 0;
  fx.warpCY = 0;
  fx.flashR = 0;
  fx.flashG = 0;
  fx.flashB = 0;
  fx.flash = 0;
  fx.rotAxis = 0;
  fx.rotAngle = 0;
  fx.rotDistance = 3;
  fx.pivotX = 0;
  fx.pivotY = 0;
  fx.pivotZ = 0;
  return fx;
}

/** True when `fx` changes nothing (the compositor can then skip the effect block). */
export function isNoFx(fx: Readonly<LayerFx>): boolean {
  return (
    fx.blurX === 0 &&
    fx.split === 0 &&
    fx.mask === 0 &&
    fx.warp === 0 &&
    fx.flash === 0 &&
    fx.rotAxis === 0
  );
}

/** Blend modes as the shader numbers them (`BlendMode` in the project schema). */
export const BLEND_IDS = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  'soft-light': 4,
  add: 5,
  lighten: 6,
  darken: 7,
  difference: 8,
} as const;

/**
 * Per-layer picture tools (v0.2 C1–C4), packed after {@link LayerFx}: green screen, LUT look,
 * blurred / pixelated area and blend mode. Identity = {@link noPictureFx}.
 */
export interface PictureFx {
  /** Green screen on. */
  key: boolean;
  /** Key colour's chroma (BT.709 Cb, Cr). */
  keyCb: number;
  keyCr: number;
  /** Chroma distance fully removed, and the feather beyond it. */
  keyTolerance: number;
  keySoftness: number;
  /** 0…1: how much of the key's tint is taken off what remains. */
  keySpill: number;
  /** 0 = no LUT; else how much of it is mixed in. `lutSize` = grid points per side. */
  lutAmount: number;
  lutSize: number;
  /** Blurred area: 0 none · 1 blur · 2 pixelate. */
  region: number;
  /** 0 rectangle · 1 ellipse. */
  regionShape: number;
  /** Anti-aliased edge width in box units (−1…1), per axis. */
  regionEdgeX: number;
  regionEdgeY: number;
  /** {@link BLEND_IDS}. */
  blend: number;
  /** Shape mask (`ShapeFamily`, effects/shapes.ts; 0 = none) and its parameters. */
  shape: number;
  shapeA: number;
  shapeB: number;
  shapeC: number;
  /** Turn of the shape, degrees clockwise. */
  shapeRotation: number;
  shapeStretch: boolean;
  shapeInvert: boolean;
  /** Soft edge, in shape units (0 = sharp). */
  shapeFeather: number;
}

/** "No picture tools". */
export function noPictureFx(): PictureFx {
  return resetPictureFx({} as PictureFx);
}

/** Resets `p` in place (reused objects, no allocation). */
export function resetPictureFx(p: PictureFx): PictureFx {
  p.key = false;
  p.keyCb = 0;
  p.keyCr = 0;
  p.keyTolerance = 0;
  p.keySoftness = 0;
  p.keySpill = 0;
  p.lutAmount = 0;
  p.lutSize = 0;
  p.region = 0;
  p.regionShape = 0;
  p.regionEdgeX = 0;
  p.regionEdgeY = 0;
  p.blend = 0;
  p.shape = 0;
  p.shapeA = 0;
  p.shapeB = 0;
  p.shapeC = 0;
  p.shapeRotation = 0;
  p.shapeStretch = false;
  p.shapeInvert = false;
  p.shapeFeather = 0;
  return p;
}

/** True when `p` changes nothing. */
export function isNoPictureFx(p: Readonly<PictureFx>): boolean {
  return !p.key && p.lutAmount === 0 && p.region === 0 && p.blend === 0 && p.shape === 0;
}

/** BT.709 chroma (Cb, Cr) of an RGB colour (0…1) — the same maths as the shader's key. */
export function chromaOf(r: number, g: number, b: number): [number, number] {
  return [-0.1146 * r - 0.3854 * g + 0.5 * b, 0.5 * r - 0.4542 * g - 0.0458 * b];
}

/**
 * Green-screen settings (0…1 sliders) → shader values: tolerance 0…1 removes colours up to a
 * chroma distance of 0.02…0.42 from the key; softness feathers over 0.005…0.205 more.
 */
export function keyParams(
  color: readonly [number, number, number],
  tolerance: number,
  softness: number,
  spill: number,
  out: PictureFx,
): PictureFx {
  const [cb, cr] = chromaOf(color[0], color[1], color[2]);
  out.key = true;
  out.keyCb = cb;
  out.keyCr = cr;
  out.keyTolerance = 0.02 + 0.4 * clamp01(tolerance);
  out.keySoftness = 0.005 + 0.2 * clamp01(softness);
  out.keySpill = clamp01(spill);
  return out;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/**
 * Packs colour + extras into `out` at `offset` (floats), in the shader's order (19 × vec4):
 * gain+contrast, lift+saturation, highlights/shadows/vignette/sharpen, shadow tint+mono,
 * highlight tint+black, mono tint+white, blur xy + texel size (renderer), grain/seed/hue/vibrance,
 * blur mode, mask ×3, warp ×2, flash, 3D turn, pivot, inverse geometry (renderer), canvas
 * (renderer).
 */
export function writeEffects(
  out: Float32Array,
  offset: number,
  c: Readonly<ColourParams>,
  fx: Readonly<LayerFx>,
  pic: Readonly<PictureFx> = NO_PICTURE,
): void {
  const o = offset;
  out[o] = c.gainR;
  out[o + 1] = c.gainG;
  out[o + 2] = c.gainB;
  out[o + 3] = c.contrast;
  out[o + 4] = c.liftR;
  out[o + 5] = c.liftG;
  out[o + 6] = c.liftB;
  out[o + 7] = c.saturation;
  out[o + 8] = c.highlights;
  out[o + 9] = c.shadows;
  out[o + 10] = c.vignette;
  out[o + 11] = c.sharpen;
  out[o + 12] = c.shadowR;
  out[o + 13] = c.shadowG;
  out[o + 14] = c.shadowB;
  out[o + 15] = c.mono;
  out[o + 16] = c.highR;
  out[o + 17] = c.highG;
  out[o + 18] = c.highB;
  out[o + 19] = c.black;
  out[o + 20] = c.monoR;
  out[o + 21] = c.monoG;
  out[o + 22] = c.monoB;
  out[o + 23] = c.white;
  out[o + 24] = fx.blurX;
  out[o + 25] = fx.blurY;
  out[o + 26] = 0; // texel size: written by the renderer, which knows the source size
  out[o + 27] = 0;
  out[o + 28] = c.grain;
  out[o + 29] = fx.grainSeed;
  out[o + 30] = (c.hue * Math.PI) / 180;
  out[o + 31] = c.vibrance;
  out[o + 32] = fx.blurMode;
  out[o + 33] = fx.blurDirX;
  out[o + 34] = fx.blurDirY;
  out[o + 35] = fx.split;
  out[o + 36] = fx.mask;
  out[o + 37] = fx.maskProgress;
  out[o + 38] = fx.maskSoft;
  out[o + 39] = (fx.maskInvert ? 1 : 0) + (fx.maskLocal ? 2 : 0);
  if (fx.mask === MaskShape.text) {
    out[o + 40] = fx.textTop;
    out[o + 41] = fx.textLineH;
    out[o + 42] = fx.textLine;
    out[o + 43] = fx.textRtl ? 1 : 0;
    out[o + 44] = fx.textCutA;
    out[o + 45] = fx.textCutB;
    out[o + 46] = fx.textFadeB;
    out[o + 47] = fx.textLines;
  } else {
    out[o + 40] = fx.maskDirX;
    out[o + 41] = fx.maskDirY;
    out[o + 42] = fx.maskCount;
    out[o + 43] = fx.maskPoly;
    out[o + 44] = fx.maskCX;
    out[o + 45] = fx.maskCY;
    out[o + 46] = fx.maskShade;
    out[o + 47] = fx.maskShadeWidth;
  }
  out[o + 48] = fx.warp;
  out[o + 49] = fx.warpAmount;
  out[o + 50] = fx.warpFreq;
  out[o + 51] = fx.warpPhase;
  out[o + 52] = fx.warpDirX;
  out[o + 53] = fx.warpDirY;
  out[o + 54] = fx.warpCX;
  out[o + 55] = fx.warpCY;
  out[o + 56] = fx.flashR;
  out[o + 57] = fx.flashG;
  out[o + 58] = fx.flashB;
  out[o + 59] = fx.flash;
  const rad = (fx.rotAngle * Math.PI) / 180;
  out[o + 60] = fx.rotAxis;
  out[o + 61] = Math.cos(rad);
  out[o + 62] = Math.sin(rad);
  out[o + 63] = fx.rotDistance;
  out[o + 64] = fx.pivotX;
  out[o + 65] = fx.pivotY;
  out[o + 66] = fx.pivotZ;
  out[o + 67] = fx.cheapBlur ? 1 : 0;
  // 68–75: inverse geometry and canvas size, written by the renderer.
  for (let i = 68; i < 76; i++) out[o + i] = 0;
  out[o + 76] = pic.keyCb;
  out[o + 77] = pic.keyCr;
  out[o + 78] = pic.keyTolerance;
  out[o + 79] = pic.keySoftness;
  out[o + 80] = pic.keySpill;
  out[o + 81] = pic.key ? 1 : 0;
  out[o + 82] = pic.lutAmount;
  out[o + 83] = pic.lutSize;
  out[o + 84] = pic.region;
  out[o + 85] = pic.regionShape;
  out[o + 86] = pic.regionEdgeX;
  out[o + 87] = pic.regionEdgeY;
  // 88–91: where the copy of the pixels underneath sits (renderer).
  for (let i = 88; i < 92; i++) out[o + i] = 0;
  out[o + 92] = pic.blend;
  out[o + 93] = 0;
  out[o + 94] = 0;
  out[o + 95] = 0;
  out[o + 96] = pic.shape;
  out[o + 97] = pic.shapeA;
  out[o + 98] = pic.shapeB;
  out[o + 99] = pic.shapeC;
  out[o + 100] = (pic.shapeRotation * Math.PI) / 180;
  out[o + 101] = (pic.shapeStretch ? 1 : 0) + (pic.shapeInvert ? 2 : 0);
  out[o + 102] = pic.shapeFeather;
  out[o + 103] = 0;
}

const NO_PICTURE: Readonly<PictureFx> = Object.freeze(noPictureFx());

/** The identity effect block (no filter, no extras) — shared, never modified. */
export const IDENTITY_EFFECTS: Readonly<Float32Array> = (() => {
  const block = new Float32Array(EFFECT_FLOATS);
  writeEffects(block, 0, IDENTITY, noFx());
  return block;
})();
