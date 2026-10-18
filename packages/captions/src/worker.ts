/// <reference lib="webworker" />
import type * as Ort from 'onnxruntime-web';
import type { FromWorker, ToWorker } from './protocol';
import { loadWhisper } from './whisper/load';
import type { WhisperRunner } from './whisper/runner';

/**
 * The speech model, in its own worker (nothing heavy on the main thread). One model per worker;
 * windows are heard one at a time, in order. The WebGPU build of the runtime is only loaded when
 * the model runs on WebGPU.
 */

const post = (message: FromWorker) => (self as unknown as Worker).postMessage(message);

let runner: WhisperRunner | null = null;
let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  queue = queue.then(() => handle(msg)).catch(() => {});
};

async function runtime(device: 'webgpu' | 'wasm', wasmPaths: string | null): Promise<typeof Ort> {
  const ort = (
    device === 'webgpu'
      ? await import('onnxruntime-web/webgpu')
      : await import('onnxruntime-web/wasm')
  ) as typeof Ort;
  // Never SharedArrayBuffer (host pages can't set cross-origin isolation): one WASM thread.
  ort.env.wasm.numThreads = 1;
  if (wasmPaths) ort.env.wasm.wasmPaths = wasmPaths;
  return ort;
}

async function handle(msg: ToWorker): Promise<void> {
  if (msg.type === 'load') {
    try {
      const ort = await runtime(msg.model.device, msg.runtimePath);
      runner = await loadWhisper(
        ort,
        msg.model.files,
        msg.model.device,
        (loaded, total) => post({ type: 'download', loaded, total }),
        msg.session ?? {},
      );
      post({ type: 'ready', device: msg.model.device });
    } catch (error) {
      post({
        type: 'error',
        id: null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (!runner) {
    post({ type: 'error', id: msg.id, message: 'The speech model is not loaded' });
    return;
  }
  try {
    const out = await runner.transcribe(msg.audio, msg.language);
    post({ type: 'words', id: msg.id, words: out.words, language: out.language });
  } catch (error) {
    post({
      type: 'error',
      id: msg.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
