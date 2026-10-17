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

/**
 * Geometry for a picture shown at a fixed size — `widthPx × heightPx` canvas pixels at scale 1
 * (text blocks) — placed by `transform`'s position, rotation, flips and scale. The whole texture
 * is shown.
 */
export function placedGeometry(
  canvasW: number,
  canvasH: number,
  widthPx: number,
  heightPx: number,
  tf: Transform,
  out: Float32Array = new Float32Array(GEOMETRY_FLOATS),
): Float32Array {
  const halfW = (widthPx * tf.scale) / 2;
  const halfH = (heightPx * tf.scale) / 2;
  const fx = tf.flipX ? -1 : 1;
  const fy = tf.flipY ? -1 : 1;
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
  out[6] = 0.5;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0.5;
  out[10] = 0.5;
  out[11] = 0.5;
  return out;
}

/**
 * Moves a computed geometry on the canvas (transitions): scales it by `scale` around the canvas
 * centre, then shifts it by `dx` / `dy` canvas widths / heights (y down). In place.
 */
export function shiftGeometry(g: Float32Array, scale: number, dx: number, dy: number): void {
  g[0] = g[0]! * scale;
  g[1] = g[1]! * scale;
  g[2] = g[2]! * scale;
  g[3] = g[3]! * scale;
  g[4] = g[4]! * scale + 2 * dx;
  g[5] = g[5]! * scale - 2 * dy;
}

/** A 2D move of a layer: scale, per-axis scale, clockwise rotation and shift. */
export interface GeometryMove {
  scale: number;
  scaleX: number;
  scaleY: number;
  /** Clockwise degrees. */
  rotate: number;
  /** Canvas widths / heights (y down). */
  dx: number;
  dy: number;
  /** Pivot: canvas fractions for {@link moveOnCanvas}, the layer's box (−1…1) for {@link moveInBox}. */
  pivotX: number;
  pivotY: number;
}

/**
 * Rotation + scale in screen pixels, as a matrix on clip coordinates: S⁻¹ · R · Σ · S with
 * S = diag(W/2, −H/2). Writes [m00, m01, m10, m11] into `m`.
 */
function screenMatrix(
  canvasW: number,
  canvasH: number,
  rotate: number,
  sx: number,
  sy: number,
  m: Float64Array,
): void {
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const kx = canvasW / 2;
  const ky = -canvasH / 2;
  // R·Σ = [cos·sx, −sin·sy; sin·sx, cos·sy]; conjugated by S.
  m[0] = cos * sx;
  m[1] = (-sin * sy * ky) / kx;
  m[2] = (sin * sx * kx) / ky;
  m[3] = cos * sy;
}

const scratch = new Float64Array(4);

/**
 * Moves a computed geometry on the canvas (transitions): scales it along the screen axes and
 * rotates it around a canvas pivot, then shifts it. In place.
 */
export function moveOnCanvas(
  g: Float32Array,
  canvasW: number,
  canvasH: number,
  move: Readonly<GeometryMove>,
): void {
  const m = scratch;
  screenMatrix(
    canvasW,
    canvasH,
    move.rotate,
    move.scale * move.scaleX,
    move.scale * move.scaleY,
    m,
  );
  const cx = 2 * move.pivotX - 1;
  const cy = 1 - 2 * move.pivotY;
  const [a, b, c, d] = [g[0]!, g[1]!, g[2]!, g[3]!];
  g[0] = m[0]! * a + m[1]! * c;
  g[1] = m[0]! * b + m[1]! * d;
  g[2] = m[2]! * a + m[3]! * c;
  g[3] = m[2]! * b + m[3]! * d;
  const px = g[4]! - cx;
  const py = g[5]! - cy;
  g[4] = m[0]! * px + m[1]! * py + cx + 2 * move.dx;
  g[5] = m[2]! * px + m[3]! * py + cy - 2 * move.dy;
}

/**
 * Moves a computed geometry within its own box (animations): scales along the layer's own axes
 * and rotates on screen around a pivot in the box (−1…1), then shifts it. In place.
 */
export function moveInBox(
  g: Float32Array,
  canvasW: number,
  canvasH: number,
  move: Readonly<GeometryMove>,
): void {
  const m = scratch;
  screenMatrix(canvasW, canvasH, move.rotate, 1, 1, m);
  const sx = move.scale * move.scaleX;
  const sy = move.scale * move.scaleY;
  const [a, b, c, d] = [g[0]!, g[1]!, g[2]!, g[3]!];
  // Pivot point on the canvas (stays put).
  const qx = move.pivotX;
  const qy = move.pivotY;
  const px = a * qx + b * qy + g[4]!;
  const py = c * qx + d * qy + g[5]!;
  // P' = R · P · diag(sx, sy)
  const n0 = (m[0]! * a + m[1]! * c) * sx;
  const n1 = (m[0]! * b + m[1]! * d) * sy;
  const n2 = (m[2]! * a + m[3]! * c) * sx;
  const n3 = (m[2]! * b + m[3]! * d) * sy;
  g[0] = n0;
  g[1] = n1;
  g[2] = n2;
  g[3] = n3;
  g[4] = px - (n0 * qx + n1 * qy) + 2 * move.dx;
  g[5] = py - (n2 * qx + n3 * qy) - 2 * move.dy;
}

/** Geometry covering the whole canvas with the whole texture (solid overlays). */
export function fullCanvasGeometry(
  out: Float32Array = new Float32Array(GEOMETRY_FLOATS),
): Float32Array {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = -1;
  out[4] = 0;
  out[5] = 0;
  out[6] = 0.5;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0.5;
  out[10] = 0.5;
  out[11] = 0.5;
  return out;
}
