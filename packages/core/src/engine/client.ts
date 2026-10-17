import type { DeviceTier } from '../capabilities';
import type { BackendChoice } from '../lab/protocol';
import type { Project } from '../model/schema';
import type { Time } from '../model/time';
import type { RenderBackend } from '../render/types';
import type {
  EngineEvent,
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
  /** Playhead updates (every frame while playing). */
  onTime: ((time: Time, playing: boolean) => void) | null;
  onEnded: (() => void) | null;
  onError: ((message: string) => void) | null;
  destroy(): void;
}

export interface EngineOptions {
  backend?: BackendChoice;
  tier: DeviceTier;
}

/**
 * Starts the engine worker and hands it `canvas` (transferred — the main thread can't draw on it
 * afterwards). The worker file ships next to this module; bundlers pick it up from the
 * `new URL(..., import.meta.url)` pattern.
 */
export async function createEngine(
  canvas: HTMLCanvasElement,
  options: EngineOptions,
): Promise<Engine> {
  const worker = new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' });
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (d: EngineResponseData) => void; reject: (e: Error) => void }
  >();
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
      else handlers.onError?.(e.message);
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.data);
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
    destroy() {
      worker.terminate();
      for (const entry of pending.values()) entry.reject(new Error('Engine destroyed'));
      pending.clear();
    },
  });
}
