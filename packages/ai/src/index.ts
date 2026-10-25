import type {
  BackgroundRemovalRequest,
  BackgroundRemover,
  BackgroundRemoverCheck,
} from '@video-ultra/core';
import type { FromWorker, ModelSpec, ToWorker } from './background/protocol';

/**
 * @video-ultra/ai — optional AI for video-ultra. AI editing (v0.4): `createChatAssistant` connects
 * the editor to your own model endpoint; text to speech: `createSpeechEndpoint`; captions in any
 * language from your own speech service: `createCaptionsEndpoint`. Background removal (v0.3): a
 * segmentation model runs in a worker on the device (single-threaded WebAssembly, no
 * cross-origin isolation needed); nothing is uploaded. The model downloads once, the first time
 * someone removes a background, and the browser keeps it.
 *
 * ```tsx
 * import { createBackgroundRemover } from '@video-ultra/ai';
 * <VideoEditor backgroundRemover={createBackgroundRemover()} />
 * ```
 */

export { createChatAssistant, parseAnswer, type ChatAssistantOptions } from './assistant';
export { createSpeechEndpoint, type SpeechEndpointOptions } from './speech';
export {
  createCaptionsEndpoint,
  type CaptionsEndpointOptions,
  type CaptionsEndpointReply,
} from './captions';
export { alignWords } from './align-words';

/** Which model: `people` (small, fast, best on people) or `objects` (anything; bigger). */
export type BackgroundModel = 'people' | 'objects';

/** Options of {@link createBackgroundRemover}. */
export interface BackgroundRemoverOptions {
  /** Default `auto`: see {@link chooseBackgroundModel}. */
  model?: BackgroundModel | 'auto';
  /**
   * Where model files come from — self-host them by mirroring the model repos (files are
   * fetched from `<modelHost>/<repo>/resolve/main/onnx/<file>`). Default `https://huggingface.co`.
   */
  modelHost?: string;
  /** Where the runtime's `.wasm` files are served (default: next to its JS module). */
  runtimePath?: string;
  /** Longest side of the result in pixels (default 4096; bigger photos are scaled down). */
  maxSide?: number;
}

/** The models (Apache-2.0), measured in PERF.md "Background removal". */
const MODELS: Record<
  BackgroundModel,
  Omit<ModelSpec, 'url'> & { repo: string; file: string; mb: number }
> = {
  people: {
    repo: 'Xenova/modnet',
    file: 'model_quantized.onnx',
    mb: 6.6,
    resize: 'short',
    size: 512,
    mean: 0.5,
    std: 0.5,
  },
  objects: {
    repo: 'onnx-community/ormbg-ONNX',
    file: 'model_quantized.onnx',
    mb: 44.3,
    resize: 'square',
    size: 1024,
    mean: 0,
    std: 1,
  },
};

/**
 * The model for this device: `objects` (any subject, cleaner edges; +0.7 GB while it works) on
 * computers, `people` (+0.26 GB) on phones and tablets (a touch screen as the main pointer) and
 * wherever the device says it has under 4 GB (PERF.md "Background removal"). Browser APIs are
 * read here, never at import time (SSR safe).
 */
export function chooseBackgroundModel(model: BackgroundModel | 'auto' = 'auto'): BackgroundModel {
  if (model !== 'auto') return model;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const memory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return touch || (memory !== undefined && memory < 4) ? 'people' : 'objects';
}

/** An on-device {@link BackgroundRemover}: one worker per picture, closed when it's done. */
export function createBackgroundRemover(options: BackgroundRemoverOptions = {}): BackgroundRemover {
  const host = (options.modelHost ?? 'https://huggingface.co').replace(/\/$/, '');
  let active: Worker | null = null;
  return {
    async check(): Promise<BackgroundRemoverCheck> {
      const ok = typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined';
      const model = MODELS[chooseBackgroundModel(options.model)];
      return ok
        ? { available: true, onDevice: true, downloadMB: model.mb }
        : { available: false, onDevice: true, reason: "This browser can't remove backgrounds." };
    },
    remove({ image, signal, onProgress }: BackgroundRemovalRequest): Promise<Blob> {
      if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
      const choice = MODELS[chooseBackgroundModel(options.model)];
      const worker = new Worker(new URL('./background.worker.js', import.meta.url), {
        type: 'module',
      });
      active = worker;
      return new Promise<Blob>((resolve, reject) => {
        const finish = () => {
          signal.removeEventListener('abort', abort);
          worker.terminate();
          if (active === worker) active = null;
        };
        const abort = () => {
          finish();
          reject(new DOMException('Cancelled', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
        worker.onmessage = (e: MessageEvent<FromWorker>) => {
          const msg = e.data;
          if (msg.type === 'download')
            onProgress?.({ stage: 'download', fraction: msg.total ? msg.loaded / msg.total : 0 });
          else if (msg.type === 'work') onProgress?.({ stage: 'work', fraction: msg.fraction });
          else if (msg.type === 'done') {
            finish();
            resolve(msg.image);
          } else {
            finish();
            reject(new Error(msg.message));
          }
        };
        worker.onerror = (e) => {
          finish();
          reject(new Error(e.message || 'The background remover failed to start'));
        };
        const job: ToWorker = {
          type: 'remove',
          image,
          model: {
            url: `${host}/${choice.repo}/resolve/main/onnx/${choice.file}`,
            resize: choice.resize,
            size: choice.size,
            mean: choice.mean,
            std: choice.std,
          },
          runtimePath: options.runtimePath ?? null,
          maxSide: options.maxSide ?? 4096,
        };
        worker.postMessage(job);
      });
    },
    dispose() {
      active?.terminate();
      active = null;
    },
  };
}
