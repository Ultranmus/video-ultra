/// <reference lib="webworker" />
import type * as Ort from 'onnxruntime-web';
import { fetchModel } from '../download';
import { speechFrames } from './frames';
import type { FromWorker, ToWorker } from './protocol';

/**
 * Speech detection in its own worker: Silero VAD, 32 ms windows of 16 kHz
 * sound (with the 64 samples before each as context) → the chance someone speaks → 20 ms frames
 * of speech. Measured ~0.1 s per 22 s of sound on one core. One worker per captions job.
 */

const post = (message: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

let ort: typeof Ort | null = null;
let session: Ort.InferenceSession | null = null;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const job = e.data;
  const run = job.type === 'load' ? load(job) : detect(job);
  void run.catch((error: unknown) =>
    post({
      type: 'error',
      id: job.type === 'detect' ? job.id : null,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
};

async function load(job: Extract<ToWorker, { type: 'load' }>): Promise<void> {
  ort = (await import('onnxruntime-web/wasm')) as typeof Ort;
  // Never SharedArrayBuffer (host pages can't set cross-origin isolation): one WASM thread.
  ort.env.wasm.numThreads = 1;
  if (job.runtimePath) ort.env.wasm.wasmPaths = job.runtimePath;
  const bytes = await fetchModel(job.url, () => undefined);
  session = await ort.InferenceSession.create(new Uint8Array(bytes), {
    executionProviders: ['wasm'],
  });
  post({ type: 'ready' });
}

const WINDOW = 512;
const CONTEXT = 64;

async function detect(job: Extract<ToWorker, { type: 'detect' }>): Promise<void> {
  if (!ort || !session) throw new Error('The speech detector is not loaded');
  const sound = job.sound;
  // Fresh state per piece; buffers reused across windows (no allocation per window).
  let state: Ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  const input = new Float32Array(CONTEXT + WINDOW);
  const tensor = new ort.Tensor('float32', input, [1, CONTEXT + WINDOW]);
  const chance = new Float32Array(Math.ceil(sound.length / WINDOW));
  for (let w = 0, i = 0; i < sound.length; w++, i += WINDOW) {
    input.copyWithin(0, WINDOW, WINDOW + CONTEXT);
    input.fill(0, CONTEXT);
    input.set(sound.subarray(i, i + WINDOW), CONTEXT);
    const out = await session.run({ input: tensor, state, sr });
    chance[w] = (out.output!.data as Float32Array)[0]!;
    if (state !== out.stateN) state.dispose();
    state = out.stateN as Ort.Tensor;
    out.output!.dispose();
  }
  state.dispose();
  const voice = speechFrames(chance, sound.length);
  post({ type: 'voice', id: job.id, voice }, [voice.buffer]);
}
