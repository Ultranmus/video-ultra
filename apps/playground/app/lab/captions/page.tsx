'use client';

/**
 * Captions lab (v0.2 A0): runs speech clips through the on-device transcriber and reports speed,
 * accuracy against the clips' known text, and timings. scripts/captions-bench.ts drives it
 * (`window.runCaptions(config)`); open it by hand to watch one run.
 */
import { createOnDeviceTranscriber, type CaptionModel } from '@video-ultra/captions';
import { TRANSCRIBE_SAMPLE_RATE } from '@video-ultra/core';
import { useEffect, useState } from 'react';

interface RunConfig {
  file: string;
  model: CaptionModel;
  device: 'webgpu' | 'wasm';
  language: string;
  /** Reference text (word error rate). */
  reference: string;
  debug?: { session?: Record<string, unknown>; files?: { encoder: string; decoder: string } };
}

interface RunResult {
  file: string;
  model: string;
  device: string;
  loadMs: number;
  transcribeMs: number;
  seconds: number;
  realtime: number;
  wer: number;
  words: number;
  firstWords: string;
  allText: string;
  timings: string;
  firstWordStart: number | null;
  lastWordEnd: number | null;
  error?: string;
}

const tokens = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.,!?;:"'“”‘’()\-—।]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Word error rate: edit distance between word lists / reference length. */
function wer(reference: string, heard: string): number {
  const r = tokens(reference);
  const h = tokens(heard);
  const d = Array.from({ length: h.length + 1 }, (_, i) => i);
  for (let i = 1; i <= r.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= h.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (r[i - 1] === h[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return r.length ? d[h.length]! / r.length : 0;
}

async function decode16k(url: string): Promise<Float32Array> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, TRANSCRIBE_SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(bytes);
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / buffer.numberOfChannels;
  }
  return out;
}

const transcribers = new Map<string, ReturnType<typeof createOnDeviceTranscriber>>();

async function runCaptions(config: RunConfig): Promise<RunResult> {
  const key = `${config.model}/${config.device}/${JSON.stringify(config.debug ?? {})}`;
  let transcriber = transcribers.get(key);
  const fresh = !transcriber;
  transcriber ??= createOnDeviceTranscriber({
    model: config.model,
    device: config.device,
    ...(config.debug ? { debug: config.debug as never } : {}),
  });
  transcribers.set(key, transcriber);
  const pcm = await decode16k(`/media/${config.file}`);
  const seconds = pcm.length / TRANSCRIBE_SAMPLE_RATE;
  async function* pieces() {
    const size = 10 * TRANSCRIBE_SAMPLE_RATE;
    for (let i = 0; i < pcm.length; i += size) yield pcm.slice(i, i + size);
  }
  const t0 = performance.now();
  let tReady = t0;
  try {
    const result = await transcriber.transcribe({
      audio: pieces(),
      duration: seconds,
      language: config.language,
      signal: new AbortController().signal,
      onProgress: (p) => {
        if (p.stage === 'transcribe' && p.fraction === 0) tReady = performance.now();
      },
    });
    const t1 = performance.now();
    const text = result.words.map((w) => w.text).join(' ');
    return {
      file: config.file,
      model: config.model,
      device: config.device,
      loadMs: fresh ? Math.round(tReady - t0) : 0,
      transcribeMs: Math.round(t1 - tReady),
      seconds: Math.round(seconds * 10) / 10,
      realtime: Math.round((seconds / ((t1 - tReady) / 1000)) * 10) / 10,
      wer: Math.round(wer(config.reference, text) * 1000) / 1000,
      words: result.words.length,
      firstWords: text.slice(0, 80),
      allText: text,
      timings: result.words.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(' '),
      firstWordStart: result.words[0]?.start ?? null,
      lastWordEnd: result.words.at(-1)?.end ?? null,
    };
  } catch (error) {
    return {
      file: config.file,
      model: config.model,
      device: config.device,
      loadMs: 0,
      transcribeMs: 0,
      seconds,
      realtime: 0,
      wer: 1,
      words: 0,
      firstWords: '',
      allText: '',
      timings: '',
      firstWordStart: null,
      lastWordEnd: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default function CaptionsLab() {
  const [log, setLog] = useState<RunResult[]>([]);
  useEffect(() => {
    (window as unknown as { runCaptions: typeof runCaptions }).runCaptions = async (c) => {
      const r = await runCaptions(c);
      setLog((l) => [...l, r]);
      return r;
    };
    (window as unknown as { captionsReady: boolean }).captionsReady = true;
  }, []);
  return (
    <main
      style={{
        padding: 24,
        fontFamily: 'system-ui',
        color: '#eee',
        background: '#111',
        minHeight: '100vh',
      }}
    >
      <h1>Captions lab</h1>
      <p>Driven by scripts/captions-bench.ts. Results:</p>
      <pre>{JSON.stringify(log, null, 2)}</pre>
    </main>
  );
}
