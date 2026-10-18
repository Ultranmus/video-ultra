/**
 * Maths shared by both renderers for layers that read the pixels under them (blend modes,
 * blurred / pixelated areas), so the backends match: which canvas rectangle is copied, and how
 * small the blurred area's copy is drawn.
 */

/**
 * The canvas pixels a layer with `geometry` (render/layout.ts) covers, grown by `pad` px and
 * clipped to the `canvasW × canvasH` canvas, as integers `[x0, y0, x1, y1)` (y down) in `out`.
 * Returns false when nothing of it is on the canvas.
 */
export function layerBounds(
  geometry: Float32Array,
  canvasW: number,
  canvasH: number,
  pad: number,
  out: Int32Array,
): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 4; i++) {
    const qx = i & 1 ? 1 : -1;
    const qy = i & 2 ? 1 : -1;
    const cx = geometry[0]! * qx + geometry[1]! * qy + geometry[4]!;
    const cy = geometry[2]! * qx + geometry[3]! * qy + geometry[5]!;
    const x = ((cx + 1) / 2) * canvasW;
    const y = ((1 - cy) / 2) * canvasH;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // Float32 geometry: a hair of tolerance so exact edges stay exact.
  out[0] = Math.max(0, Math.floor(minX - pad + 1e-3));
  out[1] = Math.max(0, Math.floor(minY - pad + 1e-3));
  out[2] = Math.min(canvasW, Math.ceil(maxX + pad - 1e-3));
  out[3] = Math.min(canvasH, Math.ceil(maxY + pad - 1e-3));
  return out[2]! > out[0]! && out[3]! > out[1]!;
}

/**
 * Canvas pixels per texel of a blurred area's small copy, for strength `amount` (0…1) on a canvas
 * `canvasH` px tall. Blur: 0.4 %–2.6 % of the height (a soft blur of about two texels); pixelate:
 * the mosaic's cell, 1.2 %–6.2 % of the height. Scales with the canvas, so the preview and the
 * export look the same.
 */
export function regionTexel(amount: number, pixelate: boolean, canvasH: number): number {
  const a = Math.max(0, Math.min(1, amount));
  const k = pixelate ? 0.012 + 0.05 * a : 0.004 + 0.022 * a;
  return Math.max(2, canvasH * k);
}

/** Padding around a blurred area's copy, so its edge is blurred from what's around it too. */
export function regionPad(texel: number, pixelate: boolean): number {
  return Math.ceil(texel * (pixelate ? 1 : 2));
}

/** Size of a blurred area's small copy for a `w × h` px rectangle. */
export function regionSmallSize(w: number, h: number, texel: number, out: Int32Array): Int32Array {
  out[0] = Math.max(1, Math.round(w / texel));
  out[1] = Math.max(1, Math.round(h / texel));
  return out;
}

/** Downscale blur radius (in texels of the small copy): blur 0.75, mosaic averages its cell. */
export function regionDownRadius(pixelate: boolean): number {
  return pixelate ? 0.5 : 0.75;
}
