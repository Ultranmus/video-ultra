import {
  TRANSCRIBE_SAMPLE_RATE,
  type TranscribeRequest,
  type TranscribeResult,
  type Transcriber,
  type TranscriptWord,
} from '@video-ultra/core';
import type { FromWorker, ToWorker } from './protocol';
import {
  activeFrames,
  activeShare,
  keepWords,
  windowsOf,
  wordsWithSound,
  WINDOW_SECONDS,
} from './windows';

/**
 * @video-ultra/captions — optional on-device auto-captions (v0.2 A5, DECISIONS #115). Speech is
 * turned into timed words by a small multilingual speech model running in a worker: WebGPU when
 * the device has it, single-threaded WebAssembly otherwise. Nothing is uploaded. The model
 * downloads once, the first time someone asks for captions, and the browser keeps it.
 *
 * ```tsx
 * import { createOnDeviceTranscriber } from '@video-ultra/captions';
 * <VideoEditor transcriber={createOnDeviceTranscriber()} />
 * ```
 */

/** Model sizes: `tiny` (fastest), `base` (more accurate), `small` (needed for some languages). */
export type CaptionModel = 'tiny' | 'base' | 'small';

/** Options of {@link createOnDeviceTranscriber}. */
export interface OnDeviceTranscriberOptions {
  /** Model size; default picks for the device and language (see {@link chooseModel}). */
  model?: CaptionModel | 'auto';
  /** Runtime; default WebGPU when available, else WebAssembly. */
  device?: 'webgpu' | 'wasm' | 'auto';
  /**
   * Where model files come from — self-host them by mirroring the model repos: files are fetched
   * from `<modelHost>/onnx-community/whisper-<size>_timestamped/resolve/main/<file>`.
   * Default `https://huggingface.co`.
   */
  modelHost?: string;
  /** Where the speech runtime's `.wasm` files are served (default: next to its JS module). */
  runtimePath?: string;
  /**
   * Keep the model loaded between jobs (faster next time, holds ~0.3–1 GB). Default false: the
   * worker closes after each job and its memory goes back to the page; the downloaded files stay
   * cached, so the next job only waits a few seconds.
   */
  keepLoaded?: boolean;
  /** @internal Measurements only. */
  debug?: { session?: Record<string, unknown>; files?: { encoder: string; decoder: string } };
}

/** What the device can run, and the setup used for it. */
export interface DeviceSupport {
  /** False on devices too small to caption well on their own (use a host transcriber there). */
  ok: boolean;
  device: 'webgpu' | 'wasm';
  model: CaptionModel;
  /** Approximate one-time download, in MB. */
  downloadMB: number;
  /** Roughly how fast it hears (× real time) on a typical laptop; phones are 2–4× slower. */
  speed: number;
  /** Why not, when `ok` is false. */
  reason?: string;
  /** The model may need more memory than this phone has (measured ~1.2 GB for `small`). */
  memoryRisk: boolean;
}

/** Model files per size and runtime (measured, PERF.md "Captions"). */
const FILES: Record<
  CaptionModel,
  Record<'webgpu' | 'wasm', { encoder: string; decoder: string; mb: number }>
> = {
  tiny: {
    webgpu: { encoder: 'encoder_model.onnx', decoder: 'decoder_model_merged_q4.onnx', mb: 120 },
    wasm: {
      encoder: 'encoder_model_quantized.onnx',
      decoder: 'decoder_model_merged_quantized.onnx',
      mb: 41,
    },
  },
  base: {
    webgpu: { encoder: 'encoder_model.onnx', decoder: 'decoder_model_merged_q4.onnx', mb: 206 },
    wasm: {
      encoder: 'encoder_model_quantized.onnx',
      decoder: 'decoder_model_merged_quantized.onnx',
      mb: 77,
    },
  },
  small: {
    webgpu: { encoder: 'encoder_model_q4.onnx', decoder: 'decoder_model_merged_q4.onnx', mb: 300 },
    wasm: {
      encoder: 'encoder_model_quantized.onnx',
      decoder: 'decoder_model_merged_quantized.onnx',
      mb: 249,
    },
  },
};

/**
 * Languages the small models hear badly: these use `small` (DECISIONS #128) — on WebGPU when
 * the device has it, else on WebAssembly (slower; the estimate says how long).
 */
const NEEDS_SMALL = new Set([
  'hi',
  'ur',
  'bn',
  'ta',
  'te',
  'mr',
  'gu',
  'kn',
  'ml',
  'pa',
  'ne',
  'si',
]);

/**
 * A model build the page didn't survive (the phone ran out of memory and the browser closed the
 * tab: DECISIONS #132). While a model is being built and heard for the first time, its name is
 * kept in storage; if the page dies then, the next visit finds it and won't load that model on
 * this device again (for a week), so captions never crash the page twice.
 */
const BUILDING_KEY = 'video-ultra-captions-building';
const CRASHED_KEY = 'video-ultra-captions-crashed';
const CRASH_MEMORY_MS = 7 * 24 * 3600 * 1000;

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Setups (`model/device`) that crashed the page here, with when. */
function crashedSetups(): Record<string, number> {
  const store = storage();
  if (!store) return {};
  try {
    const crashed = JSON.parse(store.getItem(CRASHED_KEY) ?? '{}') as Record<string, number>;
    // A build that was still running when the page last closed: it crashed.
    const building = store.getItem(BUILDING_KEY);
    if (building) {
      crashed[building] = Date.now();
      store.removeItem(BUILDING_KEY);
    }
    const recent = Object.fromEntries(
      Object.entries(crashed).filter(([, at]) => Date.now() - at <= CRASH_MEMORY_MS),
    );
    store.setItem(CRASHED_KEY, JSON.stringify(recent));
    return recent;
  } catch {
    return {};
  }
}

function markBuilding(setup: string | null): void {
  try {
    if (setup) storage()?.setItem(BUILDING_KEY, setup);
    else storage()?.removeItem(BUILDING_KEY);
  } catch {
    /* storage off: no crash memory */
  }
}

/**
 * Picks the model and runtime for this device and language (DECISIONS #120): English and other
 * well-heard languages use `base` on WebGPU, `tiny` on WebAssembly; languages that need it (e.g.
 * Hindi) use `small` and only run on WebGPU. Under 4 GB of memory or 4 cores it isn't offered
 * on the device (a host transcriber can still be used). Browser APIs are read here, never at
 * import time (SSR safe).
 */
export async function chooseModel(
  options: Pick<OnDeviceTranscriberOptions, 'model' | 'device'> = {},
  language = 'auto',
): Promise<DeviceSupport> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  let gpu = false;
  if (nav && 'gpu' in nav) {
    try {
      gpu = (await (nav as Navigator & { gpu: GPU }).gpu.requestAdapter()) !== null;
    } catch {
      /* no adapter */
    }
  }
  const needsSmall = NEEDS_SMALL.has(language);
  const memory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  const model: CaptionModel =
    options.model && options.model !== 'auto'
      ? options.model
      : needsSmall
        ? 'small'
        : // `base` hears real recordings clearly better than `tiny` (DECISIONS #130); `tiny` only
          // where the device says it's short of memory (Safari doesn't say: `base`).
          memory !== undefined && memory < 6
          ? 'tiny'
          : 'base';
  // Measured (PERF.md "Captions"): tiny and base are as fast on WebAssembly as on WebGPU and
  // lighter; small is 2.5× faster on WebGPU.
  const device: 'webgpu' | 'wasm' =
    options.device === 'webgpu' || options.device === 'wasm'
      ? options.device
      : model === 'small' && gpu
        ? 'webgpu'
        : 'wasm';
  const cores = nav?.hardwareConcurrency ?? 4;
  const tooSmall = (memory !== undefined && memory < 4) || cores < 4;
  // A setup that crashed the page here before: the other runtime once (WebAssembly holds no
  // second copy on the GPU), then a smaller model if the language allows it, else not offered.
  const crashed = crashedSetups();
  let pickedModel = model;
  let pickedDevice = device;
  const chosen = options.model && options.model !== 'auto';
  if (crashed[`${pickedModel}/${pickedDevice}`] && pickedDevice === 'webgpu') pickedDevice = 'wasm';
  if (crashed[`${pickedModel}/${pickedDevice}`] && !chosen && !needsSmall) {
    pickedModel = pickedModel === 'small' ? 'base' : 'tiny';
    pickedDevice = 'wasm';
  }
  const outOfMemory = !!crashed[`${pickedModel}/${pickedDevice}`];
  const reason = tooSmall
    ? 'This device is too small to make captions on its own.'
    : outOfMemory
      ? "This device ran out of memory with this language's speech model. Try on a computer."
      : undefined;
  // Phones are ~3× slower than the laptop the speeds were measured on (the estimate says so).
  const phone =
    typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && cores <= 8;
  return {
    ok: !reason,
    device: pickedDevice,
    model: pickedModel,
    downloadMB: FILES[pickedModel][pickedDevice].mb,
    speed: SPEED[pickedModel][pickedDevice] / (phone ? 3 : 1),
    // `small` peaks at ~1.2 GB while it hears (PERF.md "Captions"): too close to what a phone's
    // browser gives one tab.
    memoryRisk: phone && pickedModel === 'small',
    ...(reason ? { reason } : {}),
  };
}

/** × real time on a 2023 laptop (captions-bench). */
const SPEED: Record<CaptionModel, Record<'webgpu' | 'wasm', number>> = {
  tiny: { webgpu: 9, wasm: 10 },
  base: { webgpu: 6, wasm: 4.5 },
  small: { webgpu: 0.8, wasm: 0.9 },
};

/**
 * An on-device {@link Transcriber}. The worker and model load on the first `transcribe()` call
 * and stay for later ones (call `dispose()` to free them).
 */
export function createOnDeviceTranscriber(options: OnDeviceTranscriberOptions = {}): Transcriber {
  let worker: Worker | null = null;
  let loading: Promise<'webgpu' | 'wasm'> | null = null;
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (w: { words: TranscriptWord[]; language: string }) => void;
      reject: (e: Error) => void;
    }
  >();
  let onDownload: ((loaded: number, total: number) => void) | null = null;

  /** The model the worker has loaded (for switching after detecting the language). */
  let loadedModel: CaptionModel | null = null;
  const start = (language: string): Promise<'webgpu' | 'wasm'> => {
    if (loading) return loading;
    loading = (async () => {
      const support = await chooseModel(options, language);
      loadedModel = support.model;
      worker = new Worker(new URL('./transcribe.worker.js', import.meta.url), { type: 'module' });
      return new Promise<'webgpu' | 'wasm'>((resolve, reject) => {
        worker!.onmessage = (e: MessageEvent<FromWorker>) => {
          const msg = e.data;
          if (msg.type === 'download') onDownload?.(msg.loaded, msg.total);
          else if (msg.type === 'building') markBuilding(`${support.model}/${support.device}`);
          else if (msg.type === 'ready') resolve(msg.device);
          else if (msg.type === 'words') {
            pending.get(msg.id)?.resolve({ words: msg.words, language: msg.language });
            pending.delete(msg.id);
          } else if (msg.type === 'error') {
            if (msg.id === null) reject(new Error(msg.message));
            else {
              pending.get(msg.id)?.reject(new Error(msg.message));
              pending.delete(msg.id);
            }
          }
        };
        worker!.onerror = (e) =>
          reject(new Error(e.message || 'The speech worker failed to start'));
        const files = options.debug?.files ?? FILES[support.model][support.device];
        const host = (options.modelHost ?? 'https://huggingface.co').replace(/\/$/, '');
        const load: ToWorker = {
          type: 'load',
          model: {
            files: {
              base: `${host}/onnx-community/whisper-${support.model}_timestamped/resolve/main/`,
              encoder: files.encoder,
              decoder: files.decoder,
            },
            device: support.device,
          },
          runtimePath: options.runtimePath ?? null,
          session: options.debug?.session ?? null,
        };
        worker!.postMessage(load);
      });
    })();
    loading.catch(() => {
      loading = null;
      worker?.terminate();
      worker = null;
    });
    return loading;
  };

  const hear = (
    audio: Float32Array,
    language: string,
  ): Promise<{ words: TranscriptWord[]; language: string }> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const msg: ToWorker = { type: 'window', id, audio, language };
      worker!.postMessage(msg, [audio.buffer]);
    });

  const close = () => {
    worker?.terminate();
    worker = null;
    loading = null;
  };

  return {
    async check(language: string) {
      const support = await chooseModel(options, language);
      return {
        available: support.ok,
        onDevice: true,
        downloadMB: support.downloadMB,
        speed: support.speed,
        memoryRisk: support.memoryRisk,
        ...(support.reason ? { reason: support.reason } : {}),
      };
    },
    async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
      const { signal } = request;
      const abort = () => {
        // A window can't be interrupted inside the model: drop the worker, start fresh next time.
        worker?.terminate();
        worker = null;
        loading = null;
        for (const p of pending.values()) p.reject(new DOMException('Cancelled', 'AbortError'));
        pending.clear();
      };
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      signal.addEventListener('abort', abort, { once: true });
      try {
        onDownload = (loaded, total) =>
          request.onProgress?.({
            stage: 'download',
            fraction: total ? loaded / total : 0,
            loaded,
            total,
          });
        await start(request.language);
        onDownload = null;
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const words: TranscriptWord[] = [];
        const windows = Math.max(1, Math.ceil(request.duration / (WINDOW_SECONDS - 2)));
        request.onProgress?.({ stage: 'transcribe', fraction: 0 });
        let language = request.language;
        for await (const w of windowsOf(request.audio, TRANSCRIBE_SAMPLE_RATE)) {
          if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          const length = w.audio.length / TRANSCRIBE_SAMPLE_RATE;
          // Nearly silent (a quiet room, wind, hum): nothing to hear — the model would only make
          // words up. Skip it (DECISIONS #130).
          const active = activeFrames(w.audio);
          if (activeShare(active) < 0.04) {
            request.onProgress?.({
              stage: 'transcribe',
              fraction: Math.min(1, (w.index + 1) / windows),
            });
            continue;
          }
          // Detecting: keep this window, in case the language heard needs another model.
          const again = language === 'auto' ? w.audio.slice() : null;
          let heard = await hear(w.audio, language);
          markBuilding(null); // built and heard once: it fits in memory here
          if (language === 'auto') {
            language = heard.language;
            const need = await chooseModel(options, language);
            if (again && need.ok && need.model !== loadedModel) {
              // e.g. Hindi heard with the fast model: load the one that writes it, hear again.
              close();
              onDownload = (loaded, total) =>
                request.onProgress?.({
                  stage: 'download',
                  fraction: total ? loaded / total : 0,
                  loaded,
                  total,
                });
              await start(language);
              onDownload = null;
              heard = await hear(again, language);
              markBuilding(null);
            }
          }
          const spoken = wordsWithSound(heard.words, active);
          for (const word of keepWords(spoken, w.index, w.isLast, length)) words.push(word);
          request.onProgress?.({
            stage: 'transcribe',
            fraction: Math.min(1, (w.index + 1) / windows),
          });
        }
        return { words, language };
      } finally {
        markBuilding(null);
        signal.removeEventListener('abort', abort);
        onDownload = null;
        // WebAssembly memory never shrinks: close the worker so the page gets it back.
        if (!options.keepLoaded) close();
      }
    },
    dispose: close,
  };
}
