/**
 * Background removal (v0.3): the editor hands a photo to a {@link BackgroundRemover} and gets the
 * same picture back with its background transparent. The optional `@video-ultra/ai` package has
 * one that runs on the device (nothing uploaded); hosts can plug in their own service.
 */

/** What {@link BackgroundRemover.remove} gets. */
export interface BackgroundRemovalRequest {
  /** The picture (any format the browser decodes). */
  image: Blob;
  signal: AbortSignal;
  onProgress?: (progress: { stage: 'download' | 'work'; fraction: number }) => void;
}

/** Whether and how background removal can run here. */
export interface BackgroundRemoverCheck {
  available: boolean;
  /** True when it runs on the device (nothing is uploaded). */
  onDevice: boolean;
  /** One-time download in MB (first use only), if any. */
  downloadMB?: number;
  reason?: string;
}

/** Makes a picture's background transparent. Implement it to use your own service. */
export interface BackgroundRemover {
  /** The picture with its background removed: a PNG with transparency, the same size. */
  remove(request: BackgroundRemovalRequest): Promise<Blob>;
  check?(): Promise<BackgroundRemoverCheck>;
  /** Frees its model / worker (optional). */
  dispose?(): void;
}
