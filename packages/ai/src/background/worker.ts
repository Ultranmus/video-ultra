/// <reference lib="webworker" />
import type * as Ort from 'onnxruntime-web';
import { fetchModel } from '../download';
import { inputSize, matteToRgba, toTensor } from './matte';
import type { FromWorker, ToWorker } from './protocol';

/**
 * Background removal in its own worker (nothing heavy on the main thread): decode the picture,
 * shrink it to the model's input, run the model once, then cut the full-size picture with the
 * matte scaled up by the canvas (no full-size copy of the matte). One job per worker; the
 * worker is closed afterwards so its WebAssembly memory goes back.
 */

const post = (message: FromWorker) => (self as unknown as Worker).postMessage(message);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  void run(e.data).catch((error: unknown) =>
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
};

async function run(job: ToWorker): Promise<void> {
  const ort = (await import('onnxruntime-web/wasm')) as typeof Ort;
  // Never SharedArrayBuffer (host pages can't set cross-origin isolation): one WASM thread.
  ort.env.wasm.numThreads = 1;
  if (job.runtimePath) ort.env.wasm.wasmPaths = job.runtimePath;

  const bytes = await fetchModel(job.model.url, (loaded, total) =>
    post({ type: 'download', loaded, total }),
  );
  post({ type: 'work', fraction: 0.1 });
  const session = await ort.InferenceSession.create(new Uint8Array(bytes), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  const bitmap = await createImageBitmap(job.image, { imageOrientation: 'from-image' });
  try {
    // The model's view: the picture shrunk to its input size.
    const size = inputSize(bitmap.width, bitmap.height, job.model);
    const small = new OffscreenCanvas(size.width, size.height);
    const sg = small.getContext('2d', { willReadFrequently: true })!;
    sg.drawImage(bitmap, 0, 0, size.width, size.height);
    const pixels = sg.getImageData(0, 0, size.width, size.height).data;
    const tensor = new ort.Tensor('float32', toTensor(pixels, size.width, size.height, job.model), [
      1,
      3,
      size.height,
      size.width,
    ]);
    post({ type: 'work', fraction: 0.3 });
    const inputName = session.inputNames[0]!;
    const outputs = await session.run({ [inputName]: tensor });
    tensor.dispose();
    const out = outputs[session.outputNames[0]!]!;
    const [, , mh, mw] = out.dims as number[];
    const matte = out.data as Float32Array;
    post({ type: 'work', fraction: 0.8 });

    // The matte as an alpha image at the model's size…
    const mask = new OffscreenCanvas(mw!, mh!);
    mask.getContext('2d')!.putImageData(new ImageData(matteToRgba(matte), mw!, mh!), 0, 0);
    for (const t of Object.values(outputs)) t.dispose();
    await session.release();

    // …cuts the full-size picture (scaled up by the canvas while it draws).
    const k = Math.min(1, job.maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const result = new OffscreenCanvas(w, h);
    const g = result.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, 0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, 0, 0, w, h);
    const image = await result.convertToBlob({ type: 'image/png' });
    post({ type: 'done', image });
  } finally {
    bitmap.close();
  }
}
