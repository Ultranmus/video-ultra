import type {
  BackendChoice,
  ExportResult,
  HdrCheckResult,
  LabMessage,
  LabRequest,
  LabResponseData,
  MediaInfo,
  PlayResult,
  ScrubResult,
} from './protocol';
import type { RenderBackend } from '../render/types';

/** Phase 0 lab: drives the lab worker from the main thread. Not public API. */
export interface LabSession {
  readonly backend: RenderBackend;
  /** Why WebGPU wasn't used when `auto` fell back to WebGL2. */
  readonly fallbackReason: string | null;
  resize(width: number, height: number): Promise<void>;
  load(file: File): Promise<MediaInfo>;
  play(seconds: number): Promise<PlayResult>;
  scrub(count: number): Promise<ScrubResult>;
  exportVideo(
    options: Omit<Extract<LabRequest, { type: 'export' }>, 'type'>,
  ): Promise<ExportResult>;
  cancel(): Promise<void>;
  hdrCheck(times: number[], width: number): Promise<HdrCheckResult>;
  /** Called with 0…1 during export. */
  onProgress: ((progress: number) => void) | null;
  destroy(): void;
}

/**
 * Starts the lab worker and gives it `canvas` (transferred — the main thread can't draw on it
 * afterwards). The worker file ships next to this module in `dist/`; bundlers pick it up from the
 * `new URL(..., import.meta.url)` pattern.
 */
export async function createLabSession(
  canvas: HTMLCanvasElement,
  backend: BackendChoice,
): Promise<LabSession> {
  const worker = new Worker(new URL('./lab.worker.js', import.meta.url), { type: 'module' });
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (d: LabResponseData) => void; reject: (e: Error) => void }
  >();

  const session = {
    onProgress: null as ((progress: number) => void) | null,
  };
  worker.onmessage = (event: MessageEvent<LabMessage>) => {
    const message = event.data;
    if ('progress' in message) {
      session.onProgress?.(message.progress);
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
      `Lab worker failed: ${event.message || 'could not load the worker script'}`,
    );
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  function send(request: LabRequest, transfer: Transferable[] = []): Promise<LabResponseData> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, request }, transfer);
    });
  }

  const offscreen = canvas.transferControlToOffscreen();
  const init = await send(
    { type: 'init', canvas: offscreen, backend, width: canvas.width, height: canvas.height },
    [offscreen],
  );
  if (init.type !== 'init') throw new Error('Unexpected lab response');

  const expect = async <T extends LabResponseData['type']>(
    request: LabRequest,
    type: T,
  ): Promise<Extract<LabResponseData, { type: T }>> => {
    const data = await send(request);
    if (data.type !== type) throw new Error(`Unexpected lab response: ${data.type}`);
    return data as Extract<LabResponseData, { type: T }>;
  };

  return Object.assign(session, {
    backend: init.backend,
    fallbackReason: init.fallbackReason,
    async resize(width: number, height: number) {
      await expect({ type: 'resize', width, height }, 'resize');
    },
    async load(file: File) {
      return (await expect({ type: 'load', file }, 'load')).info;
    },
    async play(seconds: number) {
      return (await expect({ type: 'play', seconds }, 'play')).result;
    },
    async scrub(count: number) {
      return (await expect({ type: 'scrub', count }, 'scrub')).result;
    },
    async exportVideo(options: Omit<Extract<LabRequest, { type: 'export' }>, 'type'>) {
      return (await expect({ type: 'export', ...options }, 'export')).result;
    },
    async cancel() {
      await expect({ type: 'cancel' }, 'cancel');
    },
    async hdrCheck(times: number[], width: number) {
      return (await expect({ type: 'hdrCheck', times, width }, 'hdrCheck')).result;
    },
    destroy() {
      worker.terminate();
      for (const entry of pending.values()) entry.reject(new Error('Lab session destroyed'));
      pending.clear();
    },
  });
}
