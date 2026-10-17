import { EFFECT_FLOATS, IDENTITY_EFFECTS } from '../effects/colour';
import { HDR_CALIBRATIONS, type HdrCalibration, type HdrCalibrationKey } from './hdr-calibration';
import type { RenderBackend } from './types';

/** Browser engine, as far as colour conversion goes. */
export type BrowserEngine = 'chromium' | 'webkit' | 'gecko';

/** Detects the engine from the user agent (works in workers). */
export function browserEngine(userAgent = navigator.userAgent): BrowserEngine {
  // Every iOS / iPadOS browser (Chrome "CriOS", Firefox "FxiOS", Edge "EdgiOS") is WebKit inside.
  if (/iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS/.test(userAgent)) return 'webkit';
  if (/Firefox\//.test(userAgent)) return 'gecko';
  if (
    /Chrome\/|Chromium\/|Edg\/|CriOS\//.test(userAgent) &&
    !/Version\/[\d.]+ (Mobile\/\w+ )?Safari/.test(userAgent)
  ) {
    return 'chromium';
  }
  if (/AppleWebKit\//.test(userAgent)) return 'webkit';
  return 'chromium';
}

/**
 * The HDR correction for this engine + GPU path. `verified` is false when it was measured on a
 * different path and is the closest guess (e.g. Safari's WebGPU path before it's been measured).
 */
export function hdrCalibrationFor(
  engine: BrowserEngine,
  backend: RenderBackend,
): { key: HdrCalibrationKey; calibration: HdrCalibration; verified: boolean } {
  let key: HdrCalibrationKey;
  let verified = true;
  if (engine === 'chromium') key = backend === 'webgpu' ? 'chromium-webgpu' : 'chromium-webgl2';
  else if (engine === 'webkit') {
    // Measured on an iPhone (Safari 26, 2026-10-17): its WebGPU and WebGL2 imports both match
    // the WebKit WebGL2 calibration (error 29 → 6.2 / 27.6 → 6.8).
    key = 'webkit-webgl2';
  } else {
    // Firefox can't decode HEVC (iPhone) at all; HLG in VP9/AV1 is rare. Closest guess.
    key = 'chromium-webgl2';
    verified = false;
  }
  return { key, calibration: HDR_CALIBRATIONS[key], verified };
}

/**
 * True when a frame needs the HDR correction: the track is HLG (`trackHdr`, from the file's
 * metadata), or the frame itself says HLG. Safari on iOS labels decoded HDR frames as sRGB, so the
 * track flag is the reliable one. PQ isn't calibrated yet.
 */
export function frameIsHdr(colorSpace: VideoColorSpace, trackHdr = false): boolean {
  return trackHdr || needsHdrCorrection(colorSpace);
}

/** True for frames whose own colour space says HLG. Prefer {@link frameIsHdr}. */
export function needsHdrCorrection(colorSpace: VideoColorSpace): boolean {
  // The DOM typings don't list 'hlg' yet, but browsers report it for HLG video.
  return (colorSpace.transfer as string | null) === 'hlg';
}

/** The tone curve as 256×1 RGBA8 pixels (R, G, B curves; A = 255). */
export function curvePixels(calibration: HdrCalibration): Uint8Array<ArrayBuffer> {
  const pixels = new Uint8Array(256 * 4);
  const { r, g, b } = calibration.curve;
  for (let i = 0; i < 256; i++) {
    pixels[i * 4] = parseInt(r.slice(i * 2, i * 2 + 2), 16);
    pixels[i * 4 + 1] = parseInt(g.slice(i * 2, i * 2 + 2), 16);
    pixels[i * 4 + 2] = parseInt(b.slice(i * 2, i * 2 + 2), 16);
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

/**
 * Floats per layer in the uniform block: 7 × vec4 (pos, posT, uv, uvT, c0, c1, c2) + the effect
 * block (8 × vec4, effects/colour.ts).
 */
export const LAYER_FLOATS = 28 + EFFECT_FLOATS;

/**
 * Writes one layer's uniforms at `offset` (floats) — same layout as `Uniforms` in composite.wgsl
 * (std140 / WGSL, vec4-aligned): geometry from render/layout.ts, opacity, HDR flag + matrix, then
 * the effect block (identity when `effects` is null) with the source's texel size.
 */
export function writeLayerUniforms(
  out: Float32Array,
  offset: number,
  geometry: Float32Array,
  opacity: number,
  hdr: boolean,
  calibration: HdrCalibration,
  effects: Readonly<Float32Array> | null = null,
  texelW = 0,
  texelH = 0,
): void {
  out[offset] = geometry[0]!;
  out[offset + 1] = geometry[1]!;
  out[offset + 2] = geometry[2]!;
  out[offset + 3] = geometry[3]!;
  out[offset + 4] = geometry[4]!;
  out[offset + 5] = geometry[5]!;
  out[offset + 6] = opacity;
  out[offset + 7] = hdr ? 1 : 0;
  out[offset + 8] = geometry[6]!;
  out[offset + 9] = geometry[7]!;
  out[offset + 10] = geometry[8]!;
  out[offset + 11] = geometry[9]!;
  out[offset + 12] = geometry[10]!;
  out[offset + 13] = geometry[11]!;
  out[offset + 14] = 0;
  out[offset + 15] = 0;
  const [r0, r1, r2] = calibration.matrix;
  out[offset + 16] = r0[0]!;
  out[offset + 17] = r0[1]!;
  out[offset + 18] = r0[2]!;
  out[offset + 19] = 0;
  out[offset + 20] = r1[0]!;
  out[offset + 21] = r1[1]!;
  out[offset + 22] = r1[2]!;
  out[offset + 23] = 0;
  out[offset + 24] = r2[0]!;
  out[offset + 25] = r2[1]!;
  out[offset + 26] = r2[2]!;
  out[offset + 27] = 0;
  out.set(effects ?? IDENTITY_EFFECTS, offset + 28);
  // Texel size of the source (sharpen taps) — only the renderer knows it.
  out[offset + 28 + 26] = texelW;
  out[offset + 28 + 27] = texelH;
}
