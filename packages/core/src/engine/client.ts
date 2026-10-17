import type { DeviceTier } from '../capabilities';
import type { BackendChoice } from '../lab/protocol';
import type { Project } from '../model/schema';
import type { Time } from '../model/time';
import type { RenderBackend } from '../render/types';
import type { ExportOptions, ExportProgress, ExportResult } from './export-plan';
import type {
  EngineEvent,
  ExportRunInfo,
  EngineMessage,
  EngineRequest,
  EngineResponseData,
  EngineStats,
} from './protocol';

/** Drives the engine worker from the main thread. The UI never touches video frames. */
export interface Engine {
  readonly backend: RenderBackend;
  /** Replaces the project (cheap: it's JSON). Call after every edit. */
  setProject(project: Project): Promise<void>;
  /** Gives the engine the bytes of an asset (a `File` from an input, or a Blob). */
  addMedia(assetId: string, blob: Blob): Promise<void>;
  /** The size of the element showing the preview changed (device pixels). */
  setViewSize(width: number, height: number): Promise<void>;
  seek(time: Time): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stats(): Promise<EngineStats>;
  /**
   * Renders the whole project to a video file, offline (every frame exact; not real time). Preview
   * playback pauses while it runs and `play()` is refused. Rejects with an `AbortError` when
   * `signal` aborts (the partial file is deleted), or with a plain-language error (e.g. the browser
   * can't encode that format / size). Progress arrives ~4 times a second.
   */
  export(
    options: ExportOptions,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<ExportResult>;
  /**
   * One exact frame of the project at `time` as an ImageBitmap (caller closes it): preview size by
   * default, or `width × height`; `backend` picks the GPU path (golden-image checks).
   */
  capture(
    time: Time,
    options?: { width?: number; height?: number; backend?: RenderBackend },
  ): Promise<ImageBitmap>;
  /**
   * Square thumbnails of one visual item's frame at timeline `time` (inside the item), one per
   * filter id (`null` = no filter), with the item's own adjustments — for the filter strip. The
   * frame is decoded once; the caller closes the bitmaps.
   */
  filterPreviews(
    itemId: string,
    time: Time,
    size: number,
    filters: readonly (string | null)[],
  ): Promise<ImageBitmap[]>;
  /** Playhead updates (every frame while playing). */
  onTime: ((time: Time, playing: boolean) => void) | null;
  onEnded: (() => void) | null;
  onError: ((message: string) => void) | null;
  destroy(): void;
}

/** Engine plus internal extras for checks and the bench (not part of the UI contract). */
export interface EngineInternal extends Engine {
  /** Like `export`, plus timing details; `backend` forces the export's GPU path. */
  exportWithInfo(
    options: ExportOptions,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
    backend?: RenderBackend,
  ): Promise<{ result: ExportResult; info: ExportRunInfo }>;
}

export interface EngineOptions {
  backend?: BackendChoice;
  tier: DeviceTier;
  /** Play sound (default true). Without it the clock is the wall clock. */
  audio?: boolean;
}

/**
 * Starts the engine worker and hands it `canvas` (transferred — the main thread can't draw on it
 * afterwards). The worker file ships next to this module; bundlers pick it up from the
 * `new URL(..., import.meta.url)` pattern.
 */
export async function createEngine(
  canvas: HTMLCanvasElement,
  options: EngineOptions,
): Promise<EngineInternal> {
  const worker = new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' });
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (d: EngineResponseData) => void; reject: (e: Error) => void }
  >();
  const progressHandlers = new Map<number, (p: ExportProgress) => void>();
  let nextJob = 1;
  const handlers = {
    onTime: null as Engine['onTime'],
    onEnded: null as Engine['onEnded'],
    onError: null as Engine['onError'],
  };

  worker.onmessage = (event: MessageEvent<EngineMessage>) => {
    const message = event.data;
    if ('event' in message) {
      const e: EngineEvent = message.event;
      if (e.type === 'time') handlers.onTime?.(e.time, e.playing);
      else if (e.type === 'ended') handlers.onEnded?.();
      else if (e.type === 'export-progress') progressHandlers.get(e.jobId)?.(e.progress);
      else handlers.onError?.(e.message);
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.data);
    else if (message.name === 'AbortError')
      entry.reject(new DOMException(message.error, 'AbortError'));
    else entry.reject(new Error(message.error));
  };
  worker.onerror = (event) => {
    const error = new Error(
      `Engine worker failed: ${event.message || 'could not load the worker script'}`,
    );
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    handlers.onError?.(error.message);
  };

  const send = (request: EngineRequest, transfer: Transferable[] = []) =>
    new Promise<EngineResponseData>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, request }, transfer);
    });

  const offscreen = canvas.transferControlToOffscreen();
  const init = await send(
    {
      type: 'init',
      canvas: offscreen,
      backend: options.backend ?? 'auto',
      tier: options.tier,
      viewWidth: canvas.width,
      viewHeight: canvas.height,
    },
    [offscreen],
  );
  if (init.type !== 'init') throw new Error('Unexpected engine response');

  // Sound: an AudioWorklet on the main thread's AudioContext, fed directly by the worker over a
  // MessagePort. Created on the first play() — browsers (iOS Safari especially) only allow audio to
  // start inside a user gesture, so the context is created and resumed synchronously there.
  let audio: { context: AudioContext; ready: Promise<void> } | null = null;
  // Building the AudioContext and loading the worklet costs ~100 ms of main-thread time in Chrome, so
  // it happens now (while loading, in idle time) instead of inside the user's Play tap. A context
  // created without a gesture starts suspended; play() resumes it inside the tap (cheap), which is
  // what iOS Safari requires.
  const prepareAudio = () => {
    if (audio || options.audio === false || typeof AudioContext === 'undefined') return;
    const context = new AudioContext({ latencyHint: 'interactive' });
    const ready = (async () => {
      await context.audioWorklet.addModule(new URL('./audio.worklet.js', import.meta.url));
      const node = new AudioWorkletNode(context, 'video-ultra-player', {
        numberOfInputs: 0,
        outputChannelCount: [2],
      });
      node.connect(context.destination);
      const channel = new MessageChannel();
      node.port.postMessage({ type: 'port', port: channel.port1 }, [channel.port1]);
      const latency = (context.outputLatency || 0) + (context.baseLatency || 0);
      await send({ type: 'audio', port: channel.port2, sampleRate: context.sampleRate, latency }, [
        channel.port2,
      ]);
    })().catch((error: unknown) => {
      // No sound is better than no playback: keep going on the wall clock.
      handlers.onError?.(
        `Audio unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    audio = { context, ready };
  };
  const idle = (
    globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  ).requestIdleCallback;
  if (idle) idle(prepareAudio, { timeout: 2000 });
  else setTimeout(prepareAudio, 0);

  const startAudio = (): Promise<void> => {
    prepareAudio(); // in case play() comes before idle time
    if (!audio) return Promise.resolve();
    void audio.context.resume(); // synchronously inside the user's gesture
    return audio.ready;
  };

  async function exportWithInfo(
    options: ExportOptions,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
    backend?: RenderBackend,
  ): Promise<{ result: ExportResult; info: ExportRunInfo }> {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const jobId = nextJob++;
    if (onProgress) progressHandlers.set(jobId, onProgress);
    const abort = () => void send({ type: 'export-cancel', jobId });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const data = await send({ type: 'export', jobId, options, ...(backend ? { backend } : {}) });
      if (data.type !== 'export') throw new Error('Unexpected engine response');
      return { result: data.result, info: data.stats };
    } finally {
      signal?.removeEventListener('abort', abort);
      progressHandlers.delete(jobId);
    }
  }

  return Object.assign(handlers, {
    backend: init.backend,
    async setProject(project: Project) {
      await send({ type: 'project', project });
    },
    async addMedia(assetId: string, blob: Blob) {
      await send({ type: 'media', assetId, blob });
    },
    async setViewSize(width: number, height: number) {
      await send({ type: 'view', viewWidth: width, viewHeight: height });
    },
    async seek(time: Time) {
      await send({ type: 'seek', time });
    },
    async play() {
      await startAudio();
      await send({ type: 'play' });
    },
    async pause() {
      await send({ type: 'pause' });
    },
    async stats() {
      const data = await send({ type: 'stats' });
      if (data.type !== 'stats') throw new Error('Unexpected engine response');
      return data.stats;
    },
    async export(
      options: ExportOptions,
      onProgress?: (progress: ExportProgress) => void,
      signal?: AbortSignal,
    ) {
      return (await exportWithInfo(options, onProgress, signal)).result;
    },
    exportWithInfo,
    async capture(
      time: Time,
      captureOptions: { width?: number; height?: number; backend?: RenderBackend } = {},
    ) {
      const data = await send({ type: 'capture', time, ...captureOptions });
      if (data.type !== 'capture') throw new Error('Unexpected engine response');
      return data.bitmap;
    },
    async filterPreviews(
      itemId: string,
      time: Time,
      size: number,
      filters: readonly (string | null)[],
    ) {
      const data = await send({
        type: 'filter-previews',
        itemId,
        time,
        size,
        filters: [...filters],
      });
      if (data.type !== 'filter-previews') throw new Error('Unexpected engine response');
      return data.bitmaps;
    },
    destroy() {
      void audio?.context.close();
      worker.terminate();
      for (const entry of pending.values()) entry.reject(new Error('Engine destroyed'));
      pending.clear();
    },
  });
}
