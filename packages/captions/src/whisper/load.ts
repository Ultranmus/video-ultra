import type * as Ort from 'onnxruntime-web';
import { WhisperTokenizer } from './tokenizer';
import { WhisperRunner, type WhisperConfig } from './runner';

/**
 * Downloads a Whisper model's files (once — the browser's Cache Storage keeps them), with
 * progress, and builds a {@link WhisperRunner}. Runs in the worker.
 */

export interface ModelFiles {
  /** Base URL of the model repo, ending in `/` (files are fetched relative to it). */
  base: string;
  encoder: string;
  decoder: string;
}

const CACHE = 'video-ultra-captions-v1';

/**
 * Makes sure a file is downloaded. Memory: the download streams straight into the cache
 * (nothing held while it arrives), so a file later costs its size once when read — not three
 * times (chunks + joined copy + cache copy), which ran a phone out of memory on the ~300 MB
 * model (DECISIONS #132). Returns the bytes only when they couldn't be cached (then they're
 * already in memory); `null` means "read it from the cache".
 */
async function download(
  url: string,
  onBytes: (loaded: number, total: number) => void,
): Promise<ArrayBuffer | null> {
  const cache = await openCache();
  if (cache) {
    const size = await cachedSize(cache, url);
    if (size !== null) {
      onBytes(size, size);
      return null;
    }
  }
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Couldn't download ${url.split('/').pop()} (${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  let loaded = 0;
  const counted = response.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.length;
        onBytes(loaded, total || loaded);
        controller.enqueue(chunk);
      },
    }),
  );
  if (!cache) return readAll(counted, total);
  try {
    await cache.put(
      url,
      new Response(counted, {
        headers: { 'content-type': 'application/octet-stream', 'x-vu-size': String(total) },
      }),
    );
    return null;
  } catch {
    // Full disk (or no streaming put): download again, into memory this time.
    const again = await fetch(url);
    if (!again.ok) throw new Error(`Couldn't download ${url.split('/').pop()} (${again.status})`);
    return readAll(again.body!, total);
  }
}

function openCache(): Promise<Cache | null> {
  return typeof caches !== 'undefined'
    ? caches.open(CACHE).catch(() => null)
    : Promise.resolve(null);
}

/**
 * Size of a cached file, or null when it isn't cached. `cache.put` stores a file only once its
 * whole body arrived, so a cached file is always complete.
 */
async function cachedSize(cache: Cache, url: string): Promise<number | null> {
  const file = await cache.match(url).catch(() => undefined);
  if (!file) return null;
  void file.body?.cancel();
  return Number(file.headers.get('x-vu-size') ?? file.headers.get('content-length')) || 1;
}

/** Reads a cached file (one copy in memory). */
async function readCached(url: string): Promise<ArrayBuffer> {
  const hit = await (await openCache())?.match(url).catch(() => undefined);
  if (!hit) throw new Error(`The speech model file ${url.split('/').pop()} went missing`);
  return hit.arrayBuffer();
}

/** Reads a stream into one buffer, sized up front when the length is known (one copy). */
async function readAll(body: ReadableStream<Uint8Array>, total: number): Promise<ArrayBuffer> {
  const reader = body.getReader();
  let bytes = new Uint8Array(total || 1 << 20);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > bytes.length) {
      // Unknown or wrong length: grow by half (rare — the model host sends a length).
      const grown = new Uint8Array(Math.max(at + value.length, Math.ceil(bytes.length * 1.5)));
      grown.set(bytes.subarray(0, at));
      bytes = grown;
    }
    bytes.set(value, at);
    at += value.length;
  }
  return at === bytes.length ? bytes.buffer : bytes.slice(0, at).buffer;
}

export async function loadWhisper(
  ort: typeof Ort,
  files: ModelFiles,
  executionProvider: 'webgpu' | 'wasm',
  onProgress: (loaded: number, total: number) => void,
  onBuilding: () => void,
  sessionOptions: Ort.InferenceSession.SessionOptions = {},
): Promise<WhisperRunner> {
  const names = [
    'config.json',
    'generation_config.json',
    'tokenizer.json',
    `onnx/${files.encoder}`,
    `onnx/${files.decoder}`,
  ];
  const progress = new Map<string, [number, number]>();
  const report = () => {
    let loaded = 0;
    let total = 0;
    for (const [l, t] of progress.values()) {
      loaded += l;
      total += t;
    }
    onProgress(loaded, total);
  };
  /** Downloads a file; its bytes when they're in memory already, else null (in the cache). */
  const fetchFile = (name: string) =>
    download(files.base + name, (l, t) => {
      progress.set(name, [l, t]);
      report();
    });
  const read = async (name: string, held: ArrayBuffer | null) =>
    held ?? readCached(files.base + name);
  const json = async (name: string) =>
    JSON.parse(new TextDecoder().decode(await read(name, await fetchFile(name))));
  const [config, generation, tokenizerJson] = await Promise.all(names.slice(0, 3).map(json));
  const tokenizer = new WhisperTokenizer(tokenizerJson);
  const options: Ort.InferenceSession.SessionOptions = {
    executionProviders: [executionProvider],
    graphOptimizationLevel: 'all',
    ...sessionOptions,
  };
  // Download both first (into the cache, not memory), then build one model at a time: each
  // file's bytes are read back just before its session takes them and dropped right after.
  // Without a cache the bytes come back in memory: then one file at a time, as before.
  const cacheable = (await openCache()) !== null;
  const held: (ArrayBuffer | null)[] = cacheable
    ? await Promise.all([fetchFile(names[3]!), fetchFile(names[4]!)])
    : [await fetchFile(names[3]!), null];
  onBuilding();
  // The bytes are only referenced inside `build`, so each copy can go as soon as its session has it.
  const build = async (name: string, bytes: ArrayBuffer | null) =>
    ort.InferenceSession.create(new Uint8Array(await read(name, bytes)), options);
  const encoder = await build(names[3]!, held[0] ?? null);
  held[0] = null;
  const decoder = await build(
    names[4]!,
    cacheable ? (held[1] ?? null) : await fetchFile(names[4]!),
  );
  held[1] = null;
  const cfg: WhisperConfig = {
    decoderLayers: config.decoder_layers,
    decoderHeads: config.decoder_attention_heads,
    headDim: config.d_model / config.decoder_attention_heads,
    nMels: config.num_mel_bins,
    alignmentHeads: generation.alignment_heads ?? [],
    suppressTokens: generation.suppress_tokens ?? config.suppress_tokens ?? [],
    beginSuppressTokens: generation.begin_suppress_tokens ?? config.begin_suppress_tokens ?? [],
    // The decoder holds 448 positions; 4 go to the prompt. Scripts like Devanagari take several
    // tokens per word, so a 30 s window can need far more than the usual 224.
    maxNewTokens: (config.max_target_positions ?? 448) - 4,
  };
  return new WhisperRunner(ort, encoder, decoder, tokenizer, cfg);
}
