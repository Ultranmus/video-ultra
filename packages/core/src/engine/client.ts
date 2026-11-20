import type { ScopeData } from '../effects/scopes';
import type { DeviceTier } from '../capabilities';
import type { BackendChoice } from '../lab/protocol';
import type { ItemAnimation, Project, Transition } from '../model/schema';
import { FLICKS_PER_SECOND, type Time } from '../model/time';
import type { RenderBackend } from '../render/types';
import type {
  AudioExportOptions,
  AudioExportResult,
  ExportOptions,
  ExportProgress,
  ExportResult,
  FrameImage,
  FrameImageOptions,
} from './export-plan';
import type {
  EngineEvent,
  ExportRunInfo,
  EngineMessage,
  EngineRequest,
  EngineResponseData,
  EngineStats,
} from './protocol';

/** Listening sessions (captions), numbered per page. */
let listenSessions = 0;

/** Drives the engine worker from the main thread. The UI never touches video frames. */
export interface Engine {
  readonly backend: RenderBackend;
  /**
   * Replaces the project (cheap: it's JSON). Call after every edit. While paused it resolves once
   * a frame drawn with it is on screen (or after ~150 ms at most).
   */
  setProject(project: Project): Promise<void>;
  /** Gives the engine the bytes of an asset (a `File` from an input, or a Blob). */
  addMedia(assetId: string, blob: Blob): Promise<void>;
  /**
   * Previews `assetId` from `proxy` (a lighter copy, same timing); exports and saved frames keep
   * reading the original. `null` goes back to the original.
   */
  setProxy(assetId: string, proxy: Blob | null): Promise<void>;
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
   * Exports only the sound — the same mix as a video export — as M4A (AAC), Ogg (Opus) or WAV.
   * Same rules as {@link Engine.export}: preview pauses, one export at a time, `signal` cancels
   * (`AbortError`, partial file deleted), progress ~4 times a second.
   */
  exportAudio(
    options: AudioExportOptions,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<AudioExportResult>;
  /**
   * A project's sound (`from`…`to`) as mono PCM at `sampleRate`, in pieces of `pieceSeconds`,
   * mixed by the same mixer as export. Pulled one piece at a time, so memory stays flat. Used to
   * hand speech to a transcriber (pass a project without the music to help it). Fails with an
   * error named `SoundUnreadable` when the project has sound but none of it can be decoded here
   * (an http page has no audio decoder), rather than handing over silence.
   */
  listen(
    project: Project,
    from: Time,
    to: Time,
    sampleRate: number,
    signal: AbortSignal,
    pieceSeconds?: number,
  ): AsyncIterable<Float32Array>;
  /**
   * One frame at `time` saved as a PNG or JPEG file, at the project's own size by default, drawn
   * by the same compositor path as the export (so it matches the exported video).
   */
  captureImage(time: Time, options: FrameImageOptions): Promise<FrameImage>;
  /**
   * One exact frame of the project at `time` as an ImageBitmap (caller closes it): preview size by
   * default, or `width × height`; `backend` picks the GPU path (golden-image checks). `alpha`:
   * a transparent background stays see-through (the PNG / WebM export path) instead of black.
   */
  capture(
    time: Time,
    options?: { width?: number; height?: number; backend?: RenderBackend; alpha?: boolean },
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
  /**
   * Square thumbnails of one picture's frame at timeline `time`, one per LUT look (`lutIds`:
   * `lut` asset ids, `null` = no LUT) at full strength, with the item's own filter and
   * adjustments — for the LUT tiles. The caller closes the bitmaps.
   */
  lutPreviews(
    itemId: string,
    time: Time,
    size: number,
    lutIds: readonly (string | null)[],
  ): Promise<ImageBitmap[]>;
  /**
   * A short flip-book of one transition played on the real cut before `itemId` (its previous
   * clip into it): `frames` bitmaps across the transition window, `width × height` — for the
   * transition picker's hover preview. The caller closes the bitmaps.
   */
  transitionPreview(
    itemId: string,
    transition: Transition,
    width: number,
    height: number,
    frames: number,
  ): Promise<ImageBitmap[]>;
  /**
   * One lane item drawn alone (centred, filling most of a `width × height` tile, on `background`)
   * at each timeline time in `times`, with `animation` in place of its own — the animation
   * picker's tiles and hover flip-books. The caller closes the bitmaps.
   */
  itemPreview(
    itemId: string,
    animation: ItemAnimation | null,
    times: readonly Time[],
    width: number,
    height: number,
    background: string,
  ): Promise<ImageBitmap[]>;
  /**
   * Reads a `.cube` LUT file in the worker: its grid size and title. Rejects with a plain message
   * (error name `LutError`) when the file isn't a usable 3D LUT.
   */
  checkLut(blob: Blob): Promise<{ size: number; title: string | null }>;
  /**
   * The colour (`#rrggbb`) of a picture item — alone, without its green screen — at canvas point
   * `x, y` (fractions) at timeline `time`; null outside the picture. For "pick from video".
   * `covers`: the share (0…1) of the picture a green screen of that colour would remove at the
   * item's own range — near 1 means the whole picture would vanish. `fitTolerance`: the largest
   * range (0…1) that removes at most half the picture.
   */
  pickColour(
    itemId: string,
    time: Time,
    x: number,
    y: number,
  ): Promise<{ color: string; covers: number; fitTolerance: number | null } | null>;
  /**
   * Video scopes (histogram, waveform, parade, vectorscope) of the whole picture at `time`,
   * measured on a small render in the worker. For the Scopes view; ask at most a few per second.
   */
  scopes(time: Time): Promise<ScopeData>;
  /**
   * Silences (or restores) the engine's sound output without touching playback timing — e.g.
   * while recording a voiceover without headphones.
   */
  setOutputMuted(muted: boolean): void;
  /**
   * Playhead updates (every frame while playing). `levels`: while sound plays, the loudest
   * sample per side just heard (0…1; level meters).
   */
  onTime: ((time: Time, playing: boolean, levels?: [number, number]) => void) | null;
  onEnded: (() => void) | null;
  onError: ((message: string) => void) | null;
  /**
   * Sound can't play: `insecure` — the page isn't a secure context (http on a LAN address), so the
   * browser offers no AudioWorklet; `failed` — anything else (`detail` says what). Playback goes on
   * silently on the wall clock. Reported once.
   */
  onAudioUnavailable: ((reason: 'insecure' | 'failed', detail: string) => void) | null;
  /**
   * The engine stopped for good: its worker threw an uncaught error, ran out of memory or sent
   * unreadable data. Nothing more will play or export; the host should offer a reload (the
   * project itself is untouched — autosave runs on the main thread).
   */
  onFatal: ((message: string) => void) | null;
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
  /** Checks only: crash the worker (tests the fatal-error path). */
  crashForTest(): void;
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
    onAudioUnavailable: null as Engine['onAudioUnavailable'],
    onFatal: null as Engine['onFatal'],
  };

  worker.onmessage = (event: MessageEvent<EngineMessage>) => {
    const message = event.data;
    if ('event' in message) {
      const e: EngineEvent = message.event;
      if (e.type === 'time') handlers.onTime?.(e.time, e.playing, e.levels);
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
    else {
      // Keep the worker's error name (e.g. `SoundUnreadable` from listen) for callers to tell apart.
      const error = new Error(message.error);
      if (message.name && message.name !== 'Error') error.name = message.name;
      entry.reject(error);
    }
  };
  let fatal = false;
  const die = (message: string) => {
    if (fatal) return;
    fatal = true;
    const error = new Error(message);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    if (handlers.onFatal) handlers.onFatal(message);
    else handlers.onError?.(message);
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    die(`Engine worker failed: ${event.message || 'could not load the worker script'}`);
  };
  worker.onmessageerror = () => die('Engine worker sent data that could not be read');

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
  // `context` is null when this browser can't play sound here (see onAudioUnavailable).
  let audio: { context: AudioContext | null; ready: Promise<void> } | null = null;
  /** Between the worklet and the speakers: 0 mutes the output (the clock keeps running). */
  let outputGain: GainNode | null = null;
  let player: AudioWorkletNode | null = null;
  /** Silences the player now, from this thread (the worker's own stop can wait behind a decode). */
  const hush = () => player?.port.postMessage({ type: 'flush' });
  let outputMuted = false;
  // Set by destroy(): late idle callbacks then do nothing (no context created after the end).
  let destroyed = false;
  // Building the AudioContext and loading the worklet costs ~100 ms of main-thread time in Chrome, so
  // it happens now (while loading, in idle time) instead of inside the user's Play tap. A context
  // created without a gesture starts suspended; play() resumes it inside the tap (cheap), which is
  // what iOS Safari requires.
  const prepareAudio = () => {
    if (destroyed || audio || options.audio === false || typeof AudioContext === 'undefined')
      return;
    // Browsers only offer AudioWorklet on secure pages (https, localhost). On http over a LAN
    // address (a phone testing a dev server) there is no sound — say so plainly, once. Safari
    // keeps the property there but leaves it undefined, so check the page itself first.
    if (globalThis.isSecureContext === false || !('audioWorklet' in AudioContext.prototype)) {
      audio = { context: null, ready: Promise.resolve() };
      handlers.onAudioUnavailable?.(
        globalThis.isSecureContext === false ? 'insecure' : 'failed',
        'AudioWorklet is not available',
      );
      return;
    }
    // iPhone: web audio is "ambient" by default, so the silent switch mutes it. A video's sound
    // is playback, like a video app's (owner, 2026-11-21). Safari 16.4+; elsewhere a no-op.
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    const context = new AudioContext({ latencyHint: 'interactive' });
    const ready = (async () => {
      await context.audioWorklet.addModule(new URL('./audio.worklet.js', import.meta.url));
      const node = new AudioWorkletNode(context, 'video-ultra-player', {
        numberOfInputs: 0,
        outputChannelCount: [2],
      });
      player = node;
      outputGain = context.createGain();
      outputGain.gain.value = outputMuted ? 0 : 1;
      node.connect(outputGain).connect(context.destination);
      const channel = new MessageChannel();
      node.port.postMessage({ type: 'port', port: channel.port1 }, [channel.port1]);
      const latency = (context.outputLatency || 0) + (context.baseLatency || 0);
      await send({ type: 'audio', port: channel.port2, sampleRate: context.sampleRate, latency }, [
        channel.port2,
      ]);
    })().catch((error: unknown) => {
      if (destroyed) return; // torn down while loading: not a problem worth reporting
      // No sound is better than no playback: keep going on the wall clock.
      const detail = error instanceof Error ? error.message : String(error);
      if (handlers.onAudioUnavailable) return handlers.onAudioUnavailable('failed', detail);
      handlers.onError?.(
        `Audio unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    audio = { context, ready };
  };
  const idle = (
    globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  ).requestIdleCallback;
  // Chrome spends ~125 ms of main-thread time starting its audio service on a page's first
  // AudioContext — unavoidable, and worse inside the user's first Play tap. Do it once startup has
  // settled, in a quiet moment (PERF.md: the one accepted long task). An early Play still works:
  // startAudio() prepares it on the spot.
  setTimeout(() => {
    if (idle) idle(prepareAudio, { timeout: 10_000 });
    else prepareAudio();
  }, 3000);

  const startAudio = (): Promise<void> => {
    prepareAudio(); // in case play() comes before idle time
    if (!audio) return Promise.resolve();
    void audio.context?.resume(); // synchronously inside the user's gesture
    return audio.ready;
  };

  /** Runs one export job (video or sound): progress routing and cancel through `signal`. */
  async function runJob<T>(
    request: (jobId: number) => EngineRequest,
    onProgress: ((progress: ExportProgress) => void) | undefined,
    signal: AbortSignal | undefined,
    pick: (data: EngineResponseData) => T,
  ): Promise<T> {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const jobId = nextJob++;
    if (onProgress) progressHandlers.set(jobId, onProgress);
    const abort = () => void send({ type: 'export-cancel', jobId });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return pick(await send(request(jobId)));
    } finally {
      signal?.removeEventListener('abort', abort);
      progressHandlers.delete(jobId);
    }
  }

  async function exportWithInfo(
    options: ExportOptions,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
    backend?: RenderBackend,
  ): Promise<{ result: ExportResult; info: ExportRunInfo }> {
    return runJob(
      (jobId) => ({ type: 'export', jobId, options, ...(backend ? { backend } : {}) }),
      onProgress,
      signal,
      (data) => {
        if (data.type !== 'export') throw new Error('Unexpected engine response');
        return { result: data.result, info: data.stats };
      },
    );
  }

  return Object.assign(handlers, {
    setOutputMuted(muted: boolean) {
      outputMuted = muted;
      if (outputGain && audio?.context)
        outputGain.gain.setTargetAtTime(muted ? 0 : 1, audio.context.currentTime, 0.02);
    },
    crashForTest() {
      void send({ type: 'crash-for-test' }).catch(() => {});
    },
    backend: init.backend,
    async setProject(project: Project) {
      await send({ type: 'project', project });
    },
    async setProxy(assetId: string, proxy: Blob | null) {
      await send({ type: 'proxy', assetId, blob: proxy });
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
      hush();
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
    exportAudio(
      options: AudioExportOptions,
      onProgress?: (progress: ExportProgress) => void,
      signal?: AbortSignal,
    ) {
      return runJob(
        (jobId) => ({ type: 'export-audio', jobId, options }),
        onProgress,
        signal,
        (data) => {
          if (data.type !== 'export-audio') throw new Error('Unexpected engine response');
          return data.result;
        },
      );
    },
    async *listen(
      listenProject: Project,
      from: Time,
      to: Time,
      sampleRate: number,
      signal: AbortSignal,
      pieceSeconds = 10,
    ) {
      const session = ++listenSessions;
      const step = Math.max(1, Math.round(pieceSeconds * sampleRate));
      const total = Math.max(0, Math.round(((to - from) / FLICKS_PER_SECOND) * sampleRate));
      try {
        for (let done = 0; done < total; done += step) {
          if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          const data = await send({
            type: 'listen',
            session,
            ...(done === 0 ? { project: listenProject } : {}),
            sampleRate,
            start: from + Math.round((done / sampleRate) * FLICKS_PER_SECOND),
            frames: Math.min(step, total - done),
          });
          if (data.type !== 'listen') throw new Error('Unexpected engine response');
          yield data.pcm;
        }
      } finally {
        void send({ type: 'listen-end', session }).catch(() => {});
      }
    },
    async captureImage(time: Time, options: FrameImageOptions) {
      const data = await send({ type: 'capture-image', time, options: { ...options } });
      if (data.type !== 'capture-image') throw new Error('Unexpected engine response');
      return data.image;
    },
    async capture(
      time: Time,
      captureOptions: {
        width?: number;
        height?: number;
        backend?: RenderBackend;
        alpha?: boolean;
      } = {},
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
    async lutPreviews(
      itemId: string,
      time: Time,
      size: number,
      lutIds: readonly (string | null)[],
    ) {
      const data = await send({
        type: 'filter-previews',
        itemId,
        time,
        size,
        filters: [],
        luts: [...lutIds],
      });
      if (data.type !== 'filter-previews') throw new Error('Unexpected engine response');
      return data.bitmaps;
    },
    async itemPreview(
      itemId: string,
      animation: ItemAnimation | null,
      times: readonly Time[],
      width: number,
      height: number,
      background: string,
    ) {
      const data = await send({
        type: 'item-preview',
        itemId,
        animation,
        times: [...times],
        width,
        height,
        background,
      });
      if (data.type !== 'item-preview') throw new Error('Unexpected engine response');
      return data.bitmaps;
    },
    async checkLut(blob: Blob) {
      const data = await send({ type: 'lut-check', blob });
      if (data.type !== 'lut-check') throw new Error('Unexpected engine response');
      return { size: data.size, title: data.title };
    },
    async scopes(time: Time) {
      const data = await send({ type: 'scopes', time });
      if (data.type !== 'scopes') throw new Error('Unexpected engine response');
      return data.scopes;
    },
    async pickColour(itemId: string, time: Time, x: number, y: number) {
      const data = await send({ type: 'pick-colour', itemId, time, x, y });
      if (data.type !== 'pick-colour') throw new Error('Unexpected engine response');
      return data.color
        ? { color: data.color, covers: data.covers, fitTolerance: data.fitTolerance }
        : null;
    },
    async transitionPreview(
      itemId: string,
      transition: Transition,
      width: number,
      height: number,
      frames: number,
    ) {
      const data = await send({
        type: 'transition-preview',
        itemId,
        transition: { ...transition },
        width,
        height,
        frames,
      });
      if (data.type !== 'transition-preview') throw new Error('Unexpected engine response');
      return data.bitmaps;
    },
    destroy() {
      // Safe to call twice (React strict mode, a host re-mounting the editor).
      if (destroyed) return;
      destroyed = true;
      if (audio?.context && audio.context.state !== 'closed') audio.context.close().catch(() => {});
      worker.terminate();
      for (const entry of pending.values()) entry.reject(new Error('Engine destroyed'));
      pending.clear();
    },
  });
}
