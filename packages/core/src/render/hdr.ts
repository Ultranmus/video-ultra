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
    key = 'webkit-webgl2';
    // WebKit's WebGPU import should use the same colour pipeline as its WebGL2 one — measure it.
    verified = backend === 'webgl2';
  } else {
    // Firefox can't decode HEVC (iPhone) at all; HLG in VP9/AV1 is rare. Closest guess.
    key = 'chromium-webgl2';
    verified = false;
  }
  return { key, calibration: HDR_CALIBRATIONS[key], verified };
}

/** True for frames whose transfer function is HDR (HLG). PQ isn't calibrated yet. */
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
 * Fills the uniform block: m (placement) is written by the caller into [0..3];
 * this writes hdr flag [4] and matrix rows [8..19] (vec4-aligned, std140 / WGSL layout).
 */
export function writeHdrUniforms(
  out: Float32Array,
  calibration: HdrCalibration,
  enabled: boolean,
): void {
  out[4] = enabled ? 1 : 0;
  const [r0, r1, r2] = calibration.matrix;
  out.set([r0[0]!, r0[1]!, r0[2]!, 0], 8);
  out.set([r1[0]!, r1[1]!, r1[2]!, 0], 12);
  out.set([r2[0]!, r2[1]!, r2[2]!, 0], 16);
}

/** Floats in the uniform block (m, hdr, c0, c1, c2 = 5 × vec4). */
export const UNIFORM_FLOATS = 20;
