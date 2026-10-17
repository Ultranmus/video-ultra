import type { Renderer } from '../render/types';

/**
 * Text and emoji rasters per item, for one renderer. An item is re-rasterised only when its key
 * (text, style, raster size) changes; the old canvas's GPU copy is released at once. Entries not
 * drawn for a while, or over the byte budget (least recently used first), are released too.
 */
export class RasterCache {
  private readonly entries = new Map<
    string,
    { key: string; canvas: OffscreenCanvas; used: number; bytes: number }
  >();
  private frame = 0;
  private bytes = 0;

  constructor(
    private readonly renderer: Renderer,
    /** Byte budget (RGBA, 4 bytes per pixel). */
    private readonly budget: number,
  ) {}

  /** Bytes held now. */
  get size(): number {
    return this.bytes;
  }

  /** The raster for item `id` with `key`, made by `make` when missing or stale. */
  get(id: string, key: string, make: () => OffscreenCanvas): OffscreenCanvas {
    const entry = this.entries.get(id);
    if (entry && entry.key === key) {
      entry.used = this.frame;
      return entry.canvas;
    }
    if (entry) this.drop(id);
    const canvas = make();
    const bytes = canvas.width * canvas.height * 4;
    this.entries.set(id, { key, canvas, used: this.frame, bytes });
    this.bytes += bytes;
    return canvas;
  }

  /** Call once per rendered frame: ages entries and enforces the budget. */
  endFrame(): void {
    this.frame++;
    if (this.frame % 30 === 0) {
      for (const [id, entry] of this.entries) if (this.frame - entry.used > 90) this.drop(id);
    }
    while (this.bytes > this.budget && this.entries.size > 1) {
      let oldest: string | null = null;
      let oldestUsed = Infinity;
      for (const [id, entry] of this.entries) {
        if (entry.used < oldestUsed && entry.used !== this.frame) {
          oldest = id;
          oldestUsed = entry.used;
        }
      }
      if (oldest === null) break;
      this.drop(oldest);
    }
  }

  /** Releases every raster. */
  clear(): void {
    for (const id of [...this.entries.keys()]) this.drop(id);
  }

  private drop(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.renderer.release(entry.canvas);
    this.bytes -= entry.bytes;
    this.entries.delete(id);
  }
}
