import type { DeviceTier } from '@video-ultra/core';
import type { MediaAnalyzer, Waveform } from '@video-ultra/core/internal';

/** Byte budget for timeline thumbnails per device tier. */
// Small on purpose: the analyzer worker keeps its own byte-budgeted cache and re-serves a cached
// strip in 1–7 ms, so this only needs what's on screen plus a little scroll room.
const THUMB_BUDGET: Record<DeviceTier, number> = {
  low: 6 * 1024 * 1024,
  mid: 16 * 1024 * 1024,
  high: 32 * 1024 * 1024,
};
const MAX_IN_FLIGHT = 3;

interface Entry {
  bitmap: ImageBitmap;
  bytes: number;
}

/**
 * Timeline thumbnails and waveforms. Thumbnails are cached by (asset, quantised time, height) in
 * an LRU with a byte budget; evicted bitmaps are closed. Requests come from the draw loop: each
 * draw lists what it wants, older wants that are no longer visible are aborted, and at most a few
 * are in flight. The timeline never waits — it draws what's there and redraws on arrival.
 */
export class TimelineMediaCache {
  readonly #analyzer: () => MediaAnalyzer | null;
  readonly #budget: number;
  readonly #onChange: () => void;
  #bytes = 0;
  /** Map order = LRU order (oldest first). */
  readonly #thumbs = new Map<string, Entry>();
  /** Latest loaded thumbnail per asset: shown while the exact one loads. */
  readonly #fallback = new Map<string, string>();
  readonly #inFlight = new Map<string, AbortController>();
  #wanted: { key: string; assetId: string; seconds: number; height: number }[] = [];
  readonly #waveforms = new Map<string, Waveform | null | 'pending'>();
  #destroyed = false;

  constructor(analyzer: () => MediaAnalyzer | null, tier: DeviceTier, onChange: () => void) {
    this.#analyzer = analyzer;
    this.#budget = THUMB_BUDGET[tier];
    this.#onChange = onChange;
  }

  static key(assetId: string, seconds: number, height: number): string {
    return `${assetId}|${seconds.toFixed(3)}|${height}`;
  }

  /** The thumbnail for the key, or the asset's latest one as a stand-in, or null. Marks wanted. */
  thumbnail(assetId: string, seconds: number, height: number): ImageBitmap | null {
    const key = TimelineMediaCache.key(assetId, seconds, height);
    const hit = this.#thumbs.get(key);
    if (hit) {
      // Refresh LRU position.
      this.#thumbs.delete(key);
      this.#thumbs.set(key, hit);
      return hit.bitmap;
    }
    this.#wanted.push({ key, assetId, seconds, height });
    const fallback = this.#fallback.get(assetId);
    return (fallback && this.#thumbs.get(fallback)?.bitmap) || null;
  }

  /** Called once per draw after all `thumbnail()` calls: starts/aborts requests. */
  flush(): void {
    const wanted = this.#wanted;
    this.#wanted = [];
    const keys = new Set(wanted.map((w) => w.key));
    for (const [key, controller] of this.#inFlight) {
      if (!keys.has(key)) {
        controller.abort();
        this.#inFlight.delete(key);
      }
    }
    const analyzer = this.#analyzer();
    if (!analyzer) return;
    for (const want of wanted) {
      if (this.#inFlight.size >= MAX_IN_FLIGHT) break;
      if (this.#inFlight.has(want.key)) continue;
      const controller = new AbortController();
      this.#inFlight.set(want.key, controller);
      analyzer
        .thumbnail(want.assetId, want.seconds, want.height, controller.signal)
        .then((bitmap) => {
          if (this.#inFlight.get(want.key) === controller) this.#inFlight.delete(want.key);
          if (!bitmap) return;
          if (this.#destroyed || controller.signal.aborted) {
            bitmap.close();
            return;
          }
          this.#store(want.key, want.assetId, bitmap);
          this.#onChange();
        })
        .catch(() => {
          if (this.#inFlight.get(want.key) === controller) this.#inFlight.delete(want.key);
        });
    }
  }

  #store(key: string, assetId: string, bitmap: ImageBitmap): void {
    const old = this.#thumbs.get(key);
    if (old) {
      old.bitmap.close();
      this.#bytes -= old.bytes;
      this.#thumbs.delete(key);
    }
    const bytes = bitmap.width * bitmap.height * 4;
    this.#thumbs.set(key, { bitmap, bytes });
    this.#fallback.set(assetId, key);
    this.#bytes += bytes;
    for (const [k, entry] of this.#thumbs) {
      if (this.#bytes <= this.#budget) break;
      if (k === key) continue;
      entry.bitmap.close();
      this.#bytes -= entry.bytes;
      this.#thumbs.delete(k);
    }
  }

  /** The asset's waveform, starting a request the first time. */
  waveform(assetId: string): Waveform | null {
    const known = this.#waveforms.get(assetId);
    if (known === 'pending') return null;
    if (known !== undefined) return known;
    const analyzer = this.#analyzer();
    if (!analyzer) return null;
    this.#waveforms.set(assetId, 'pending');
    analyzer
      .waveform(assetId)
      .then((w) => {
        if (this.#destroyed) return;
        this.#waveforms.set(assetId, w);
        if (w) this.#onChange();
      })
      .catch(() => this.#waveforms.set(assetId, null));
    return null;
  }

  /** Bytes held by thumbnails (for tests and the stats overlay). */
  get bytes(): number {
    return this.#bytes;
  }

  destroy(): void {
    this.#destroyed = true;
    for (const controller of this.#inFlight.values()) controller.abort();
    this.#inFlight.clear();
    for (const entry of this.#thumbs.values()) entry.bitmap.close();
    this.#thumbs.clear();
    this.#bytes = 0;
  }
}
