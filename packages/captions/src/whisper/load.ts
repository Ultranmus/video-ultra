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

/** Fetches a file, from the cache when it's there; reports bytes as they arrive. */
async function fetchCached(
  url: string,
  onBytes: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  const hit = await cache?.match(url);
  if (hit) {
    const buffer = await hit.arrayBuffer();
    onBytes(buffer.byteLength, buffer.byteLength);
    return buffer;
  }
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Couldn't download ${url.split('/').pop()} (${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body!.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onBytes(loaded, total || loaded);
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  parts.length = 0;
  // Keep it for next time (best effort: a full disk just means downloading again).
  await cache
    ?.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }))
    .catch(() => {});
  return bytes.buffer;
}

export async function loadWhisper(
  ort: typeof Ort,
  files: ModelFiles,
  executionProvider: 'webgpu' | 'wasm',
  onProgress: (loaded: number, total: number) => void,
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
  const get = (name: string) =>
    fetchCached(files.base + name, (l, t) => {
      progress.set(name, [l, t]);
      report();
    });
  const json = async (name: string) => JSON.parse(new TextDecoder().decode(await get(name)));
  const [config, generation, tokenizerJson] = await Promise.all(names.slice(0, 3).map(json));
  const tokenizer = new WhisperTokenizer(tokenizerJson);
  const options: Ort.InferenceSession.SessionOptions = {
    executionProviders: [executionProvider],
    graphOptimizationLevel: 'all',
    ...sessionOptions,
  };
  // One model at a time: each file's bytes are dropped as soon as its session holds them.
  const encoder = await ort.InferenceSession.create(new Uint8Array(await get(names[3]!)), options);
  const decoder = await ort.InferenceSession.create(new Uint8Array(await get(names[4]!)), options);
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
