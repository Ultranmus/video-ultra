import type { DeviceTier } from '../capabilities';

/**
 * Proxies (v0.4): lighter copies of heavy videos (4K, or 1080p on budget phones) for smooth
 * editing. The editor previews from the copy; exports always read the original. Copies are made
 * in their own worker (WebCodecs, keyframe every second for quick seeking, no sound — sound
 * comes from the original) and kept on this device in OPFS (`video-ultra-proxies/`), so a
 * project opened again finds them. Device-local: never part of the project file.
 */

/** Main thread ↔ proxy worker. Not public API. */
export type ProxyRequest =
  | { type: 'find'; id: number; key: string }
  | { type: 'make'; id: number; key: string; blob: Blob; height: number; budget: number }
  | { type: 'cancel'; id: number }
  | { type: 'remove'; id: number; prefix: string };

export type ProxyResponse =
  | { id: number; type: 'progress'; done: number }
  | { id: number; type: 'file'; file: File | null; reason?: string };

/** Total bytes of proxies kept per device tier (oldest go first beyond it). */
export const PROXY_BUDGET: Record<DeviceTier, number> = {
  low: 1 * 2 ** 30,
  mid: 2 * 2 ** 30,
  high: 4 * 2 ** 30,
};

/**
 * The proxy height for a video of `width × height` (as shown, after rotation) on a device of
 * `tier`, or null when it plays fine as it is: low tier proxies anything over 720p (to 540p),
 * mid anything over 1080p (to 720p), high anything over 4K (to 1080p).
 */
export function proxyHeightFor(width: number, height: number, tier: DeviceTier): number | null {
  const pixels = width * height;
  const short = Math.min(width, height);
  const over = { low: 1280 * 720, mid: 1920 * 1080, high: 3840 * 2160 }[tier];
  const target = { low: 540, mid: 720, high: 1080 }[tier];
  if (pixels <= over * 1.05 || short <= target) return null;
  return target;
}

/** The file name of an asset's proxy at `height` (one per asset and size). */
export function proxyKey(assetId: string, height: number): string {
  return `${assetId.replace(/[^\w-]/g, '_')}-${height}p.mp4`;
}

/** Makes and finds proxies in a worker. Browser only. */
export interface ProxyMaker {
  /** The finished proxy of `assetId` at `height` kept from before, or null. */
  find(assetId: string, height: number): Promise<File | null>;
  /**
   * Makes the proxy (or returns the one kept). Null when it can't be made here (no OPFS, not
   * enough space, the encoder refused) — the original is used then. Cancel with `signal`.
   */
  make(
    assetId: string,
    blob: Blob,
    height: number,
    options?: { signal?: AbortSignal; onProgress?: (done: number) => void },
  ): Promise<File | null>;
  /** Deletes every proxy of `assetId`. */
  remove(assetId: string): Promise<void>;
  destroy(): void;
}

/** Starts the proxy worker (`proxy.worker.js`, shipped next to this module). */
export function createProxyMaker(tier: DeviceTier): ProxyMaker {
  const worker = new Worker(new URL('./proxy.worker.js', import.meta.url), { type: 'module' });
  const pending = new Map<
    number,
    { resolve: (file: File | null) => void; progress: ((done: number) => void) | undefined }
  >();
  let nextId = 1;
  let destroyed = false;
  worker.onmessage = (event: MessageEvent<ProxyResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.type === 'progress') {
      entry.progress?.(message.done);
      return;
    }
    pending.delete(message.id);
    entry.resolve(message.file);
  };
  worker.onerror = () => {
    for (const entry of pending.values()) entry.resolve(null);
    pending.clear();
  };
  const ask = (
    request: ProxyRequest,
    progress?: (done: number) => void,
    signal?: AbortSignal,
  ): Promise<File | null> => {
    if (destroyed || signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const onAbort = () => {
        if (!pending.delete(request.id)) return;
        worker.postMessage({ type: 'cancel', id: request.id } satisfies ProxyRequest);
        resolve(null);
      };
      pending.set(request.id, {
        resolve: (file) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(file);
        },
        progress,
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.postMessage(request);
    });
  };
  return {
    find(assetId, height) {
      return ask({ type: 'find', id: nextId++, key: proxyKey(assetId, height) });
    },
    make(assetId, blob, height, options = {}) {
      return ask(
        {
          type: 'make',
          id: nextId++,
          key: proxyKey(assetId, height),
          blob,
          height,
          budget: PROXY_BUDGET[tier],
        },
        options.onProgress,
        options.signal,
      );
    },
    async remove(assetId) {
      await ask({
        type: 'remove',
        id: nextId++,
        prefix: proxyKey(assetId, 0).replace(/0p\.mp4$/, ''),
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      worker.terminate();
      for (const entry of pending.values()) entry.resolve(null);
      pending.clear();
    },
  };
}
