/**
 * Maths for the blurred background (shared by both renderers so they match): the picture is drawn
 * into a small texture with a footprint-sized blur (cheap anti-aliased downscale), then scaled up
 * over the whole canvas with a second soft blur. Two passes of 13 taps, at a few hundred pixels —
 * affordable on low-tier phones on WebGL2.
 */

/** Size of the small texture for a `canvasW × canvasH` canvas at blur `amount` (0…1). */
export function backdropSize(
  canvasW: number,
  canvasH: number,
  amount: number,
): { width: number; height: number } {
  const a = Math.max(0, Math.min(1, amount));
  // amount 0 → 1/8 of the canvas, 1 → 1/32: stronger blur = smaller texture (also cheaper).
  const factor = 1 / (8 + 24 * a);
  return {
    width: Math.max(4, Math.round(canvasW * factor)),
    height: Math.max(4, Math.round(canvasH * factor)),
  };
}

/**
 * Blur radius (texture uv, x/y) that spans one texel of the small `smallW × smallH` target, for a
 * layer drawn with `geometry` (render/layout.ts): uv per clip unit is K · P⁻¹.
 */
export function footprintRadius(
  geometry: Float32Array,
  smallW: number,
  smallH: number,
  out: [number, number] = [0, 0],
): [number, number] {
  const p00 = geometry[0]!;
  const p01 = geometry[1]!;
  const p10 = geometry[2]!;
  const p11 = geometry[3]!;
  const k00 = geometry[6]!;
  const k01 = geometry[7]!;
  const k10 = geometry[8]!;
  const k11 = geometry[9]!;
  const det = p00 * p11 - p01 * p10 || 1e-9;
  // P⁻¹ = [p11, −p01; −p10, p00] / det
  const m00 = (k00 * p11 - k01 * p10) / det;
  const m01 = (-k00 * p01 + k01 * p00) / det;
  const m10 = (k10 * p11 - k11 * p10) / det;
  const m11 = (-k10 * p01 + k11 * p00) / det;
  const sx = 2 / smallW;
  const sy = 2 / smallH;
  out[0] = Math.abs(m00) * sx + Math.abs(m01) * sy;
  out[1] = Math.abs(m10) * sx + Math.abs(m11) * sy;
  return out;
}

/** Upscale pass blur radius, in small-texture texels. */
export const UPSCALE_BLUR_TEXELS = 1.4;
