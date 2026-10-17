import type { Crop, Transform } from '../model/schema';

/**
 * Where a layer's picture goes on the canvas and which part of its texture it shows, as two affine
 * maps from the unit quad q ∈ [−1, 1]² (y down) — the same quad the shaders draw:
 *
 *   clip  = P · q + p      (position on the canvas, clip space, y up)
 *   texUv = K · q + k      (texture coordinate in the decoded frame, 0…1, origin top-left)
 *
 * Packed as 12 floats: [P00, P01, P10, P11, p0, p1, K00, K01, K10, K11, k0, k1].
 * Both backends use the same numbers, so they place pixels identically.
 */

/** The decoded media a layer shows. */
export interface LayerMedia {
  /** Texture size in square pixels, before the file's rotation. */
  width: number;
  height: number;
  /** Clockwise rotation from the file's metadata. */
  rotation: 0 | 90 | 180 | 270;
  /** Horizontal flip from the file's metadata (after rotation). */
  flip: boolean;
}

/** How the item asks to be drawn (from the project). */
export interface LayerLook {
  transform: Transform;
  crop: Crop;
  /** At scale 1: fit inside the canvas, or cover it. */
  fit: 'fit' | 'fill';
}

export const GEOMETRY_FLOATS = 12;

/** Display size of the media: after metadata rotation. */
export function displaySize(media: LayerMedia): { width: number; height: number } {
  const quarter = media.rotation === 90 || media.rotation === 270;
  return quarter
    ? { width: media.height, height: media.width }
    : { width: media.width, height: media.height };
}

/**
 * Computes a layer's geometry for a `canvasW × canvasH` canvas into `out` (12 floats).
 * Crop is in display orientation (what the user sees), as fractions cut from each edge.
 */
export function layerGeometry(
  canvasW: number,
  canvasH: number,
  media: LayerMedia,
  look: LayerLook,
  out: Float32Array = new Float32Array(GEOMETRY_FLOATS),
): Float32Array {
  const { transform: tf, crop } = look;
  const display = displaySize(media);
  const keepW = Math.max(1e-6, 1 - crop.left - crop.right);
  const keepH = Math.max(1e-6, 1 - crop.top - crop.bottom);
  const croppedW = display.width * keepW;
  const croppedH = display.height * keepH;

  // Size on the canvas: scale 1 = fit inside (or cover) the canvas.
  const base =
    look.fit === 'fill'
      ? Math.max(canvasW / croppedW, canvasH / croppedH)
      : Math.min(canvasW / croppedW, canvasH / croppedH);
  const halfW = (croppedW * base * tf.scale) / 2;
  const halfH = (croppedH * base * tf.scale) / 2;
  const fx = tf.flipX ? -1 : 1;
  const fy = tf.flipY ? -1 : 1;

  // Position: clip = S · R · D · q + c, S = screen px → clip, R = clockwise rotation (y down).
  const rad = (tf.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = 2 / canvasW;
  const sy = -2 / canvasH;
  out[0] = sx * cos * halfW * fx;
  out[1] = sx * -sin * halfH * fy;
  out[2] = sy * sin * halfW * fx;
  out[3] = sy * cos * halfH * fy;
  out[4] = sx * tf.x * canvasW - 1;
  out[5] = 1 + sy * tf.y * canvasH;

  // Texture: q → cropped display uv (cu, cv) → (metadata flip) → texture uv (undo rotation).
  // cu = au·qx + bu, cv = av·qy + bv
  let au = keepW / 2;
  let bu = crop.left + keepW / 2;
  const av = keepH / 2;
  const bv = crop.top + keepH / 2;
  if (media.flip) {
    // u → 1 − u
    au = -au;
    bu = 1 - bu;
  }
  // Display uv (u, v) → texture uv for a texture rotated clockwise by `rotation` for display.
  // 0: (u, v)   90: (v, 1 − u)   180: (1 − u, 1 − v)   270: (1 − v, u)
  switch (media.rotation) {
    case 0:
      out.set([au, 0, 0, av, bu, bv], 6);
      break;
    case 90:
      out.set([0, av, -au, 0, bv, 1 - bu], 6);
      break;
    case 180:
      out.set([-au, 0, 0, -av, 1 - bu, 1 - bv], 6);
      break;
    case 270:
      out.set([0, -av, au, 0, 1 - bv, bu], 6);
      break;
  }
  return out;
}

/** Applies the packed maps to a quad corner (for tests and hit-testing). */
export function applyGeometry(
  g: Float32Array,
  qx: number,
  qy: number,
): { clip: [number, number]; uv: [number, number] } {
  return {
    clip: [g[0]! * qx + g[1]! * qy + g[4]!, g[2]! * qx + g[3]! * qy + g[5]!],
    uv: [g[6]! * qx + g[7]! * qy + g[10]!, g[8]! * qx + g[9]! * qy + g[11]!],
  };
}
