/** Which GPU API a renderer uses. */
export type RenderBackend = 'webgpu' | 'webgl2';

/** Options shared by both renderers. */
export interface RendererOptions {
  /**
   * Apply the HDR correction to HLG frames (default true). `false` shows the browser's own
   * conversion — used by the bench's HDR check to measure a device.
   */
  hdrCorrection?: boolean;
}

/** How a source frame is placed on the output canvas. */
export interface FramePlacement {
  /** Clockwise rotation from the file's metadata, in degrees. */
  rotation: 0 | 90 | 180 | 270;
  /** Horizontal flip from the file's metadata (applied after rotation). */
  flip: boolean;
  /** Width × height of the frame in square pixels, before rotation. */
  width: number;
  height: number;
  /**
   * The track is HLG HDR (from the file's metadata). Needed because Safari on iOS labels decoded
   * HDR frames as sRGB, so the frame's own colour space can't be trusted for this.
   */
  hdr?: boolean;
}

/**
 * Something a layer can show: a decoded video frame, or an image/canvas (photos, stickers, text).
 * ImageBitmaps must have **straight (non-premultiplied) alpha** —
 * `createImageBitmap(blob, { premultiplyAlpha: 'none' })`. WebGL uploads ImageBitmaps as they are
 * (its unpack flags don't apply to them), so a premultiplied bitmap would get its transparency
 * applied twice and look too dark on the WebGL2 backend.
 */
export type LayerSource = VideoFrame | ImageBitmap | OffscreenCanvas;

/** One layer of a frame, bottom to top. */
export interface LayerDraw {
  source: LayerSource;
  /** 12 floats from `layerGeometry` (render/layout.ts). */
  geometry: Float32Array;
  /** 0…1 */
  opacity: number;
  /** Apply the HDR correction (track is HLG). */
  hdr: boolean;
}

/** Composites layers onto an `OffscreenCanvas` (WebGPU or WebGL2; same output). */
export interface Renderer {
  readonly backend: RenderBackend;
  /** Changes the drawing-buffer size in device pixels. */
  resize(width: number, height: number): void;
  /** Draws one frame: clears to `background` (RGB 0…1) and draws `layers` in order. */
  render(layers: readonly LayerDraw[], background?: readonly [number, number, number]): void;
  /**
   * Convenience for a single video frame, contain-fitted (the lab and bench). Does not close
   * `frame`.
   */
  draw(frame: VideoFrame, placement: FramePlacement): void;
  /** Frees the GPU copy of an image source (call when an image is no longer used). */
  release(source: ImageBitmap | OffscreenCanvas): void;
  /** Frees every GPU resource. The renderer can't be used afterwards. */
  destroy(): void;
}
