import type { DeviceTier } from '../capabilities';
import type {
  AnalyzerRequest,
  AnalyzerResponse,
  AnalyzerStats,
  ThumbnailMode,
} from './analyzer-protocol';
import type { Waveform } from './peaks';
import type { ProbeResult } from './probe';
import type { SceneSensitivity } from './scenes';

export type { AnalyzerStats, ThumbnailMode } from './analyzer-protocol';
export type { Waveform } from './peaks';

/**
 * Media analysis for the editor UI: import probing, timeline thumbnails and waveforms. All decoding
 * happens in a worker (`analyzer.worker.js`, shipped next to this module); the main thread only
 * sends requests and receives small bitmaps and peak arrays.
 */
export interface MediaAnalyzer {
  /** Probes a file in the worker (keeps Mediabunny off the main thread). */
  probe(file: Blob, name: string): Promise<ProbeResult>;
  /**
   * Registers bytes for an asset so thumbnails/waveforms can read it. Cheap (the Blob is shared,
   * not copied). `options.audioTrack` = the asset's chosen audio track (`asset.audioTrack`); without
   * it the analyzer picks the same track probing would.
   */
  addMedia(
    assetId: string,
    blob: Blob,
    kind: 'video' | 'audio' | 'image',
    options?: { audioTrack?: number },
  ): void;
  /** Forgets an asset: pending requests for it resolve `null`, its cache entries are freed. */
  removeMedia(assetId: string): void;
  /**
   * A small frame of the video near `seconds` (nearest keyframe or the decoded frame — fast over
   * exact), `height` CSS px × devicePixelRatio decided by the caller. The caller OWNS the returned
   * bitmap (closes it). Requests are prioritised newest-first and deduplicated; aborted ones are
   * skipped and resolve `null`. Images return a scaled bitmap of the image; audio returns `null`.
   */
  thumbnail(
    assetId: string,
    seconds: number,
    height: number,
    signal?: AbortSignal,
  ): Promise<ImageBitmap | null>;
  /**
   * Audio peaks for the asset's chosen audio track (asset.audioTrack). `peaks[i]` = max |sample| in
   * bucket i, 0…1. Cached per asset (in memory, and in `options.waveformCache` when given): the
   * same object is returned to every caller — treat it as read-only. `null` when the asset has no
   * decodable sound, or when aborted.
   */
  waveform(assetId: string, signal?: AbortSignal): Promise<Waveform | null>;
  /**
   * Where new scenes start in a video (seconds of its media, in order; v0.4). Decodes the range
   * `from`…`to` in the worker at low priority (thumbnails go first). `null` when the asset isn't a
   * decodable video, or when aborted. `onProgress` gets 0…1.
   */
  scenes(
    assetId: string,
    options: {
      from?: number;
      to?: number;
      sensitivity?: SceneSensitivity;
      signal?: AbortSignal;
      onProgress?: (done: number) => void;
    },
  ): Promise<number[] | null>;
  /** Worker counters (tests, bench). */
  stats(): Promise<AnalyzerStats>;
  /** Stops the worker. Pending requests resolve `null` (probes reject). */
  destroy(): void;
}

/** A persistent waveform cache (e.g. {@link ProjectStorage} implements it on OPFS). */
export interface WaveformCache {
  /** The stored waveform of an asset, or `null`. */
  getWaveform(assetId: string): Promise<Waveform | null>;
  /** Stores an asset's waveform (replacing any older one). */
  putWaveform(assetId: string, waveform: Waveform): Promise<void>;
}

/** Options for {@link createMediaAnalyzer}. */
export interface MediaAnalyzerOptions {
  /** Device tier: sets the decode budget (low 1 decoder, else 2) and cache sizes. Default `mid`. */
  tier?: DeviceTier;
  /** `keyframe` (default, fast) or `exact` frames for thumbnails. */
  thumbnails?: ThumbnailMode;
  /** Where computed waveforms are kept across sessions. */
  waveformCache?: WaveformCache;
}

interface SharedWaveform {
  promise: Promise<Waveform | null>;
  users: number;
  id: number;
  done: boolean;
}

type Pending =
  | { kind: 'probe'; resolve: (r: ProbeResult) => void; reject: (e: Error) => void }
  | { kind: 'thumb'; resolve: (b: ImageBitmap | null) => void }
  | { kind: 'wave'; resolve: (w: Waveform | null) => void }
  | {
      kind: 'scenes';
      resolve: (cuts: number[] | null) => void;
      progress: ((done: number) => void) | undefined;
    }
  | { kind: 'stats'; resolve: (s: AnalyzerStats) => void; reject: (e: Error) => void };

/**
 * Starts the media-analysis worker. Browser only (call it from an effect, not at module load).
 */
export function createMediaAnalyzer(options: MediaAnalyzerOptions = {}): MediaAnalyzer {
  const worker = new Worker(new URL('./analyzer.worker.js', import.meta.url), { type: 'module' });
  const pending = new Map<number, Pending>();
  const waveforms = new Map<string, SharedWaveform>();
  const cache = options.waveformCache;
  let nextId = 1;
  let destroyed = false;

  const send = (request: AnalyzerRequest) => {
    if (!destroyed) worker.postMessage(request);
  };
  send({ type: 'init', tier: options.tier ?? 'mid', mode: options.thumbnails ?? 'keyframe' });

  worker.onmessage = (event: MessageEvent<AnalyzerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (message.type === 'scenes-progress') {
      if (entry?.kind === 'scenes') entry.progress?.(message.done);
      return;
    }
    if (!entry) {
      // Answer to a request that was aborted meanwhile.
      if (message.type === 'thumb') message.bitmap?.close();
      return;
    }
    pending.delete(message.id);
    if (message.type === 'error') {
      if (entry.kind === 'probe' || entry.kind === 'stats')
        entry.reject(new Error(message.message));
      else entry.resolve(null);
      return;
    }
    if (entry.kind === 'probe' && message.type === 'probe') entry.resolve(message.result);
    else if (entry.kind === 'thumb' && message.type === 'thumb') entry.resolve(message.bitmap);
    else if (entry.kind === 'wave' && message.type === 'wave') entry.resolve(message.waveform);
    else if (entry.kind === 'scenes' && message.type === 'scenes') entry.resolve(message.cuts);
    else if (entry.kind === 'stats' && message.type === 'stats') entry.resolve(message.stats);
  };
  worker.onerror = (event) => {
    const error = new Error(
      `Media analyzer worker failed: ${event.message || 'could not load the worker script'}`,
    );
    failAll(error);
  };

  function failAll(error: Error): void {
    for (const entry of pending.values()) {
      if (entry.kind === 'probe' || entry.kind === 'stats') entry.reject(error);
      else entry.resolve(null);
    }
    pending.clear();
  }

  function waveformFromWorker(assetId: string, id: number): Promise<Waveform | null> {
    return new Promise<Waveform | null>((resolve) => {
      pending.set(id, { kind: 'wave', resolve });
      send({ type: 'wave', id, assetId });
    });
  }

  return {
    probe(file, name) {
      if (destroyed) return Promise.reject(new Error('Media analyzer destroyed'));
      const id = nextId++;
      return new Promise<ProbeResult>((resolve, reject) => {
        pending.set(id, { kind: 'probe', resolve, reject });
        send({ type: 'probe', id, file, name });
      });
    },

    addMedia(assetId, blob, kind, addOptions = {}) {
      send({
        type: 'add',
        assetId,
        blob,
        kind,
        ...(addOptions.audioTrack !== undefined ? { audioTrack: addOptions.audioTrack } : {}),
      });
    },

    removeMedia(assetId) {
      send({ type: 'remove', assetId });
      const wave = waveforms.get(assetId);
      waveforms.delete(assetId);
      if (wave && !wave.done) {
        const entry = pending.get(wave.id);
        if (pending.delete(wave.id)) send({ type: 'cancel', id: wave.id });
        if (entry?.kind === 'wave') entry.resolve(null);
      }
    },

    thumbnail(assetId, seconds, height, signal) {
      if (destroyed || signal?.aborted) return Promise.resolve(null);
      const id = nextId++;
      return new Promise<ImageBitmap | null>((resolve) => {
        const onAbort = () => {
          if (!pending.delete(id)) return;
          send({ type: 'cancel', id });
          resolve(null);
        };
        pending.set(id, {
          kind: 'thumb',
          resolve: (bitmap) => {
            signal?.removeEventListener('abort', onAbort);
            resolve(bitmap);
          },
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        send({ type: 'thumb', id, assetId, seconds, height });
      });
    },

    waveform(assetId, signal) {
      if (destroyed || signal?.aborted) return Promise.resolve(null);
      let shared = waveforms.get(assetId);
      if (!shared) {
        const id = nextId++;
        const entry: SharedWaveform = { id, users: 0, done: false, promise: Promise.resolve(null) };
        entry.promise = (async () => {
          const stored = await cache?.getWaveform(assetId).catch(() => null);
          if (stored) return stored;
          if (waveforms.get(assetId) !== entry) return null; // cancelled while reading the cache
          const computed = await waveformFromWorker(assetId, id);
          if (computed) void cache?.putWaveform(assetId, computed).catch(() => undefined);
          return computed;
        })();
        entry.promise
          .then((w) => {
            entry.done = true;
            // Don't keep failures: a later call may succeed (e.g. media added again).
            if (!w && waveforms.get(assetId) === entry) waveforms.delete(assetId);
          })
          .catch(() => undefined);
        waveforms.set(assetId, entry);
        shared = entry;
      }
      const entry = shared;
      entry.users++;
      if (!signal) return entry.promise;
      return new Promise<Waveform | null>((resolve) => {
        const onAbort = () => {
          entry.users--;
          resolve(null);
          // Nobody wants it any more: stop the decode.
          if (entry.users === 0 && !entry.done && waveforms.get(assetId) === entry) {
            waveforms.delete(assetId);
            if (pending.delete(entry.id)) send({ type: 'cancel', id: entry.id });
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
        entry.promise.then(
          (w) => {
            signal.removeEventListener('abort', onAbort);
            resolve(w);
          },
          () => resolve(null),
        );
      });
    },

    scenes(assetId, { from = 0, to = Infinity, sensitivity = 'normal', signal, onProgress }) {
      if (destroyed || signal?.aborted) return Promise.resolve(null);
      const id = nextId++;
      return new Promise<number[] | null>((resolve) => {
        const onAbort = () => {
          if (!pending.delete(id)) return;
          send({ type: 'cancel', id });
          resolve(null);
        };
        pending.set(id, {
          kind: 'scenes',
          progress: onProgress,
          resolve: (cuts) => {
            signal?.removeEventListener('abort', onAbort);
            resolve(cuts);
          },
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        send({ type: 'scenes', id, assetId, from, to, sensitivity });
      });
    },

    stats() {
      const id = nextId++;
      return new Promise<AnalyzerStats>((resolve, reject) => {
        pending.set(id, { kind: 'stats', resolve, reject });
        send({ type: 'stats', id });
      });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      worker.terminate();
      failAll(new Error('Media analyzer destroyed'));
      waveforms.clear();
    },
  };
}
