import type { FromWorker, ToWorker } from './protocol';

/** Options of {@link createSpeechDetector}. */
export interface SpeechDetectorOptions {
  /**
   * Where the model comes from — self-host it by mirroring the repo: the file is fetched from
   * `<modelHost>/onnx-community/silero-vad/resolve/main/onnx/model_quantized.onnx`.
   * Default `https://huggingface.co`.
   */
  modelHost?: string;
  /** Where the runtime's `.wasm` files are served (default: next to its JS module). */
  runtimePath?: string;
}

/** Finds where people speak (as opposed to music or noise), on the device. */
export interface SpeechDetector {
  /** One byte per 20 ms of 16 kHz mono `sound`: 1 = speech. */
  detect(sound: Float32Array): Promise<Uint8Array>;
  /** Closes its worker (its memory goes back); the next `detect` starts a new one. */
  close(): void;
}

/**
 * A speech detector running in a worker: Silero VAD (MIT, 0.64 MB, downloaded
 * once and cached). Measured: speech found 98–100 % with music or fan noise as loud as the voice
 * (judging by loudness found 0–14 %), music or noise alone never taken for speech; ~0.1 s per
 * 22 s of sound. `createCaptionsEndpoint` uses one by default.
 */
export function createSpeechDetector(options: SpeechDetectorOptions = {}): SpeechDetector {
  const host = (options.modelHost ?? 'https://huggingface.co').replace(/\/$/, '');
  let worker: Worker | null = null;
  let ready: Promise<void> | null = null;
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: Uint8Array) => void; reject: (e: Error) => void }
  >();
  const fail = (message: string) => {
    for (const p of pending.values()) p.reject(new Error(message));
    pending.clear();
  };
  const start = () => {
    if (ready) return ready;
    const w = new Worker(new URL('./speech.worker.js', import.meta.url), { type: 'module' });
    worker = w;
    ready = new Promise<void>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const msg = e.data;
        if (msg.type === 'ready') resolve();
        else if (msg.type === 'voice') {
          pending.get(msg.id)?.resolve(msg.voice);
          pending.delete(msg.id);
        } else if (msg.id === null) reject(new Error(msg.message));
        else {
          pending.get(msg.id)?.reject(new Error(msg.message));
          pending.delete(msg.id);
        }
      };
      w.onerror = (e) => {
        const message = e.message || 'The speech detector failed to start';
        reject(new Error(message));
        fail(message);
      };
    });
    const load: ToWorker = {
      type: 'load',
      url: `${host}/onnx-community/silero-vad/resolve/main/onnx/model_quantized.onnx`,
      runtimePath: options.runtimePath ?? null,
    };
    w.postMessage(load);
    return ready;
  };
  const close = () => {
    worker?.terminate();
    worker = null;
    ready = null;
    fail('The speech detector was closed');
  };
  return {
    async detect(sound) {
      await start();
      const id = nextId++;
      const copy = sound.slice();
      return new Promise<Uint8Array>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const msg: ToWorker = { type: 'detect', id, sound: copy };
        worker!.postMessage(msg, [copy.buffer]);
      });
    },
    close,
  };
}
