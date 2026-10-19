import type { CubeLut } from '../effects/lut';

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
export type LayerSource = VideoFrame | ImageBitmap | OffscreenCanvas | RenderTarget;

/**
 * An off-screen picture the renderer draws into (a combined clip's frame, DECISIONS #155) and can
 * then show as a layer like any picture. Made and freed by the renderer that owns it.
 */
export interface RenderTarget {
  readonly width: number;
  readonly height: number;
}

/** One layer of a frame, bottom to top. */
export interface LayerDraw {
  source: LayerSource;
  /** 12 floats from `layerGeometry` (render/layout.ts). */
  geometry: Float32Array;
  /** 0…1 */
  opacity: number;
  /** Apply the HDR correction (track is HLG). */
  hdr: boolean;
  /**
   * Colour pipeline + extras, `EFFECT_FLOATS` floats from `writeEffects`
   * (effects/colour.ts). Omitted / null = unchanged picture.
   */
  effects?: Float32Array | null;
  /**
   * Blend mode (`BLEND_IDS`, effects/colour.ts; also in `effects`). Not normal: the renderer
   * copies the pixels under the layer first and the shader mixes with them.
   */
  blend?: number;
  /** A 3D LUT look (its amount and size travel in `effects`). */
  lut?: CubeLut | null;
  /**
   * A blurred / pixelated area: `source` is ignored; the renderer copies what's under the layer's
   * box, shrinks it (blur strength / cell size from `amount` 0…1) and draws it back inside the
   * box (shape and edge in `effects`).
   */
  region?: RegionDraw | null;
}

/** What a blurred area does (see {@link LayerDraw.region}). */
export interface RegionDraw {
  pixelate: boolean;
  amount: number;
}

/**
 * A blurred, enlarged copy of a picture behind every layer (the "blur" background). The renderer
 * draws `source` small (cheap: a few hundred pixels wide), then scales it up with a soft blur.
 */
export interface Backdrop {
  source: LayerSource;
  /** Geometry that covers the canvas (from `layerGeometry` with fit 'fill'). */
  geometry: Float32Array;
  hdr: boolean;
  /** Blur strength 0…1. */
  amount: number;
  /** The clip's own colour (filter / adjustments), applied before the blur. */
  effects?: Float32Array | null;
}

/** Composites layers onto an `OffscreenCanvas` (WebGPU or WebGL2; same output). */
export interface Renderer {
  readonly backend: RenderBackend;
  /** Changes the drawing-buffer size in device pixels. */
  resize(width: number, height: number): void;
  /**
   * Draws one frame: clears to `background` (RGB 0…1; `null` = transparent), draws the blurred
   * `backdrop` if given, then `layers` in order — on the canvas, or into `target`.
   */
  render(
    layers: readonly LayerDraw[],
    background?: readonly [number, number, number] | null,
    backdrop?: Backdrop | null,
    target?: RenderTarget | null,
  ): void;
  /** A `width × height` render target (RGBA). Free it with {@link Renderer.destroyTarget}. */
  createTarget(width: number, height: number): RenderTarget;
  /** Frees a render target made by this renderer. */
  destroyTarget(target: RenderTarget): void;
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
