/** Which GPU API a renderer uses. */
export type RenderBackend = 'webgpu' | 'webgl2';

/** How a source frame is placed on the output canvas. */
export interface FramePlacement {
  /** Clockwise rotation from the file's metadata, in degrees. */
  rotation: 0 | 90 | 180 | 270;
  /** Horizontal flip from the file's metadata (applied after rotation). */
  flip: boolean;
  /** Width × height of the frame in square pixels, before rotation. */
  width: number;
  height: number;
}

/**
 * Draws decoded frames onto an `OffscreenCanvas`. Phase 0 version: one layer, contain-fit.
 * Phase 2 grows this into the compositor (layers, transforms, effects).
 */
export interface Renderer {
  readonly backend: RenderBackend;
  /** Changes the drawing-buffer size in device pixels. */
  resize(width: number, height: number): void;
  /** Clears the canvas and draws `frame` fitted inside it. Does not close `frame`. */
  draw(frame: VideoFrame, placement: FramePlacement): void;
  /** Frees every GPU resource. The renderer can't be used afterwards. */
  destroy(): void;
}

/**
 * Builds the 2×2 matrix (a, b, c, d) that maps the unit quad (−1…1, y down) to clip space so the
 * frame is rotated, flipped and contain-fitted in a `canvasW × canvasH` canvas:
 * `ndc.x = a·q.x + b·q.y`, `ndc.y = c·q.x + d·q.y`. Shared by both backends so they match exactly.
 */
export function placementMatrix(
  placement: FramePlacement,
  canvasW: number,
  canvasH: number,
  out: Float32Array,
): Float32Array {
  const { rotation, flip, width, height } = placement;
  const quarter = rotation === 90 || rotation === 270;
  const boxW = quarter ? height : width;
  const boxH = quarter ? width : height;
  const scale = Math.min(canvasW / boxW, canvasH / boxH);
  // Half extents of the (unrotated) frame on screen, in pixels.
  const hx = ((width * scale) / 2) * (flip ? -1 : 1);
  const hy = (height * scale) / 2;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  // Screen pixels (y down) → clip space (y up).
  const sx = 2 / canvasW;
  const sy = -2 / canvasH;
  out[0] = sx * cos * hx;
  out[1] = sx * -sin * hy;
  out[2] = sy * sin * hx;
  out[3] = sy * cos * hy;
  return out;
}
