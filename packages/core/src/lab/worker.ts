import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  canEncodeAudio,
  VideoSampleSink,
  WebMOutputFormat,
  type InputAudioTrack,
  type InputVideoTrack,
  type StreamTargetChunk,
  type VideoSample,
} from 'mediabunny';
import { DecoderPool, FrameSource } from '../engine/frames';
import { needsHdrCorrection } from '../render/hdr';
import type { FramePlacement, Renderer } from '../render/types';
import { createWebGL2Renderer } from '../render/webgl2';
import { createWebGPURenderer } from '../render/webgpu';
import type {
  BackendChoice,
  Distribution,
  ExportResult,
  LabMessage,
  LabRequest,
  LabResponseData,
  MediaInfo,
  PlayResult,
  ScrubResult,
} from './protocol';

// Only the worker globals we use (the DOM and webworker type libs can't be combined in one build).
declare const self: {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

interface SyncAccessHandle {
  write(data: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

// ── Frame-leak accounting: every VideoFrame we create is counted until closed. ──
let openFrames = 0;
let maxOpenFrames = 0;
function frameOf(sample: VideoSample): VideoFrame {
  const frame = sample.toVideoFrame();
  openFrames++;
  if (openFrames > maxOpenFrames) maxOpenFrames = openFrames;
  return frame;
}
function closeFrame(frame: VideoFrame): void {
  frame.close();
  openFrames--;
}

let renderer: Renderer | null = null;
let input: Input | null = null;
let videoTrack: InputVideoTrack | null = null;
let audioTrack: InputAudioTrack | null = null;
let placement: FramePlacement = { rotation: 0, flip: false, width: 1, height: 1 };
let durationS = 0;
let cancelled = false;

async function createRenderer(
  canvas: OffscreenCanvas,
  choice: BackendChoice,
): Promise<{ renderer: Renderer; fallbackReason: string | null }> {
  if (choice !== 'webgl2') {
    try {
      return { renderer: await createWebGPURenderer(canvas), fallbackReason: null };
    } catch (error) {
      if (choice === 'webgpu') throw error;
      // A canvas can only ever get one context type; WebGPU failed before getContext succeeded
      // in the common cases (no adapter), so WebGL2 on the same canvas is safe here.
      return { renderer: createWebGL2Renderer(canvas), fallbackReason: String(error) };
    }
  }
  return { renderer: createWebGL2Renderer(canvas), fallbackReason: null };
}

function distribution(values: number[]): Distribution {
  if (values.length === 0) return { count: 0, avg: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    count: values.length,
    avg: round(values.reduce((s, v) => s + v, 0) / values.length),
    p50: round(pick(0.5)),
    p95: round(pick(0.95)),
    max: round(sorted[sorted.length - 1]!),
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function requireLoaded(): { renderer: Renderer; video: InputVideoTrack } {
  if (!renderer) throw new Error('Renderer not initialised');
  if (!videoTrack) throw new Error('Load a file with a video track first');
  return { renderer, video: videoTrack };
}

async function load(file: File): Promise<MediaInfo> {
  frames?.destroy();
  frames = null;
  input?.dispose();
  input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const format = await input.getFormat();
  videoTrack = await input.getPrimaryVideoTrack();
  audioTrack = await input.getPrimaryAudioTrack();
  durationS = await input.computeDuration();

  let video: MediaInfo['video'] = null;
  if (videoTrack) {
    const rotation = await videoTrack.getRotation();
    const flip = await videoTrack.getFlip();
    const width = await videoTrack.getSquarePixelWidth();
    const height = await videoTrack.getSquarePixelHeight();
    placement = { rotation, flip, width, height };
    const metrics = await videoTrack.computeFrameRateMetrics().catch(() => null);
    video = {
      codec: await videoTrack.getCodec(),
      codedWidth: await videoTrack.getCodedWidth(),
      codedHeight: await videoTrack.getCodedHeight(),
      displayWidth: await videoTrack.getDisplayWidth(),
      displayHeight: await videoTrack.getDisplayHeight(),
      rotation,
      fps: metrics ? Math.round(metricFps(metrics) * 100) / 100 : null,
      variableFrameRate: metrics ? metricVfr(metrics) : false,
      hdr: await videoTrack.hasHighDynamicRange(),
      colorSpace: await videoTrack.getColorSpace(),
      canDecode: await videoTrack.canDecode(),
    };
  }
  let audio: MediaInfo['audio'] = null;
  if (audioTrack) {
    audio = {
      codec: await audioTrack.getCodec(),
      sampleRate: await audioTrack.getSampleRate(),
      channels: await audioTrack.getNumberOfChannels(),
      canDecode: await audioTrack.canDecode(),
    };
  }
  return {
    name: file.name,
    sizeBytes: file.size,
    container: format.name,
    durationS,
    video,
    audio,
  };
}

// FrameRateMetrics' exact shape varies by version; read it defensively.
function metricFps(metrics: object): number {
  const m = metrics as Record<string, unknown>;
  for (const key of ['averageFrameRate', 'frameRate', 'averageFps', 'fps']) {
    if (typeof m[key] === 'number') return m[key] as number;
  }
  return 0;
}
function metricVfr(metrics: object): boolean {
  const m = metrics as Record<string, unknown>;
  for (const key of ['isVariableFrameRate', 'variableFrameRate', 'isVariable']) {
    if (typeof m[key] === 'boolean') return m[key] as boolean;
  }
  return false;
}

async function play(seconds: number): Promise<PlayResult> {
  const { renderer: r, video } = requireLoaded();
  cancelled = false;
  maxOpenFrames = openFrames;
  const sink = new VideoSampleSink(video);
  const end = Math.min(durationS, seconds);
  const decodeWait: number[] = [];
  const draw: number[] = [];
  const intervals: number[] = [];
  let presented = 0;
  let dropped = 0;
  let firstTimestamp: number | null = null;
  let clockStart = 0;
  let lastPresent = 0;
  let requested = performance.now();

  for await (const sample of sink.samples(0, end)) {
    decodeWait.push(performance.now() - requested);
    if (cancelled) {
      sample.close();
      break;
    }
    if (firstTimestamp === null) {
      firstTimestamp = sample.timestamp;
      clockStart = performance.now();
    }
    const due = clockStart + (sample.timestamp - firstTimestamp) * 1000;
    const frameMs = Math.max(sample.duration * 1000, 1);
    const now = performance.now();
    if (now > due + frameMs) {
      // Late by more than a frame: drop it to catch up.
      dropped++;
      sample.close();
      requested = performance.now();
      continue;
    }
    if (due > now) await sleep(due - now);
    const frame = frameOf(sample);
    const t0 = performance.now();
    r.draw(frame, placement);
    draw.push(performance.now() - t0);
    closeFrame(frame);
    sample.close();
    if (lastPresent) intervals.push(t0 - lastPresent);
    lastPresent = t0;
    presented++;
    requested = performance.now();
  }
  const wallS = (performance.now() - clockStart) / 1000;
  return {
    backend: r.backend,
    seconds: Math.round(wallS * 100) / 100,
    presented,
    dropped,
    effectiveFps: Math.round((presented / Math.max(wallS, 0.001)) * 10) / 10,
    decodeWaitMs: distribution(decodeWait),
    drawMs: distribution(draw),
    intervalMs: distribution(intervals),
    maxOpenFrames,
    openFramesAfter: openFrames,
  };
}

const pool = new DecoderPool(4);
let frames: FrameSource | null = null;

function frameSource(video: InputVideoTrack): FrameSource {
  frames ??= new FrameSource(video, pool);
  return frames;
}

function draw(r: Renderer, sample: VideoSample): void {
  const frame = frameOf(sample);
  r.draw(frame, placement);
  closeFrame(frame);
  sample.close();
}

/** Random seeks, one after another (each waits for its frame). */
async function scrub(count: number): Promise<ScrubResult> {
  const { renderer: r, video } = requireLoaded();
  cancelled = false;
  const source = frameSource(video);
  const latencies: number[] = [];
  // Deterministic pseudo-random seek points so runs are comparable across devices.
  let seed = 42;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < count && !cancelled; i++) {
    const t = random() * durationS * 0.98;
    const t0 = performance.now();
    const sample = await source.frameAt(t, { onPreview: (preview) => draw(r, preview) });
    if (sample) draw(r, sample);
    latencies.push(performance.now() - t0);
  }
  return {
    backend: r.backend,
    latencyMs: distribution(latencies),
    openFramesAfter: openFrames,
    drag: await drag(r, source),
    sessions: source.stats.restarts,
    previews: source.stats.previews,
    continued: source.stats.continued,
    restarts: source.stats.restarts,
  };
}

/**
 * A finger dragging the playhead: a seek every 16 ms across the clip, never waiting. Measures how
 * many frames reach the screen during the drag and how long the final frame takes after the
 * finger stops — the number users feel.
 */
async function drag(r: Renderer, source: FrameSource): Promise<NonNullable<ScrubResult['drag']>> {
  const steps = 45;
  const span = Math.min(durationS * 0.9, 9);
  const startAt = durationS * 0.05;
  let shown = 0;
  let last: Promise<VideoSample | null> = Promise.resolve(null);
  const show = (sample: VideoSample | null) => {
    if (sample) {
      draw(r, sample);
      shown++;
    }
  };
  for (let i = 0; i < steps; i++) {
    last = source.frameAt(startAt + (span * i) / (steps - 1), { onPreview: show });
    void last.then(show);
    await sleep(16);
  }
  const stopped = performance.now();
  await last;
  return {
    framesShown: shown,
    settleMs: Math.round(performance.now() - stopped),
    skipped: source.stats.skipped,
  };
}

/** WritableStream that writes Mediabunny's positioned chunks into an OPFS file (constant memory). */
async function opfsWritable(name: string): Promise<{
  writable: WritableStream<StreamTargetChunk>;
  size: () => number;
}> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(name, { create: true });
  const access = await (
    handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> }
  ).createSyncAccessHandle();
  access.truncate(0);
  let finalSize = 0;
  return {
    writable: new WritableStream<StreamTargetChunk>({
      write(chunk) {
        access.write(chunk.data, { at: chunk.position });
      },
      close() {
        access.flush();
        finalSize = access.getSize();
        access.close();
      },
      abort() {
        access.close();
      },
    }),
    size: () => finalSize,
  };
}

/**
 * Fallback when OPFS is missing (Safari Private Browsing, some embedded webviews): the output is
 * written append-only (fragmented MP4) into Blob parts. Browsers can keep large Blobs on disk, so
 * memory stays bounded better than one growing ArrayBuffer.
 */
function blobWritable(): { writable: WritableStream<StreamTargetChunk>; result: () => Blob } {
  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let expected = 0;
  const flush = () => {
    if (pendingBytes === 0) return;
    parts.push(new Blob(pending as BlobPart[]));
    pending = [];
    pendingBytes = 0;
  };
  return {
    writable: new WritableStream<StreamTargetChunk>({
      write(chunk) {
        if (chunk.position !== expected) {
          throw new Error(
            `Append-only target got a write at ${chunk.position}, expected ${expected}`,
          );
        }
        pending.push(chunk.data);
        pendingBytes += chunk.data.byteLength;
        expected += chunk.data.byteLength;
        if (pendingBytes >= 8 * 1024 * 1024) flush();
      },
      close: flush,
    }),
    result: () => new Blob(parts),
  };
}

let aacFallbackRegistered = false;
/** Firefox (and some others) have no native AAC encoder: load the WASM one only when needed. */
async function ensureAacEncoder(): Promise<void> {
  if (aacFallbackRegistered || (await canEncodeAudio('aac'))) return;
  const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
  registerAacEncoder();
  aacFallbackRegistered = true;
}

async function exportVideo(
  options: Extract<LabRequest, { type: 'export' }>,
): Promise<ExportResult> {
  const { renderer: preview, video } = requireLoaded();
  cancelled = false;
  const { width, height, fps, container } = options;
  const mediaSeconds = Math.min(options.seconds, durationS);
  const canvas = new OffscreenCanvas(width, height);
  const exportRenderer =
    preview.backend === 'webgpu'
      ? await createWebGPURenderer(canvas)
      : createWebGL2Renderer(canvas);

  const fileName = `lab-export.${container}`;
  // OPFS is missing in Safari Private Browsing (and Playwright's WebKit): fall back to memory.
  const opfs = await opfsWritable(fileName).catch(() => null);
  const memory = opfs ? null : blobWritable();
  const output = new Output({
    format:
      container === 'mp4'
        ? new Mp4OutputFormat(opfs ? {} : { fastStart: 'fragmented' })
        : new WebMOutputFormat(),
    target: new StreamTarget((opfs ?? memory)!.writable, {
      chunked: true,
      chunkSize: 4 * 1024 * 1024,
    }),
  });
  const videoCodec = container === 'mp4' ? 'avc' : 'vp9';
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, quality: QUALITY_HIGH });
  output.addVideoTrack(videoSource, { frameRate: fps });

  const audioCodec = container === 'mp4' ? 'aac' : 'opus';
  let audioSource: AudioSampleSource | null = null;
  if (audioTrack && (await audioTrack.canDecode())) {
    if (audioCodec === 'aac') await ensureAacEncoder();
    // Encoders only accept standard layouts, so the export always gets 48 kHz stereo (the real
    // engine's mixer outputs exactly this; here Mediabunny resamples/upmixes).
    audioSource = new AudioSampleSource({
      codec: audioCodec,
      quality: QUALITY_HIGH,
      transform: { sampleRate: 48000, numberOfChannels: 2 },
    });
    output.addAudioTrack(audioSource);
  }
  await output.start();
  const t0 = performance.now();
  const frameCount = Math.floor(mediaSeconds * fps);
  let hdrFrames = 0;
  const transfers = new Set<string>();

  const videoJob = (async () => {
    const sink = new VideoSampleSink(video);
    const timestamps = (function* () {
      for (let i = 0; i < frameCount; i++) yield i / fps;
    })();
    let i = 0;
    for await (const sample of sink.samplesAtTimestamps(timestamps)) {
      if (cancelled) {
        sample?.close();
        break;
      }
      if (sample) {
        const frame = frameOf(sample);
        if (needsHdrCorrection(frame.colorSpace)) hdrFrames++;
        else transfers.add(String(frame.colorSpace.transfer));
        exportRenderer.draw(frame, placement);
        closeFrame(frame);
        sample.close();
      }
      await videoSource.add(i / fps, 1 / fps);
      i++;
      if (i % 15 === 0) post({ id: -1, progress: i / frameCount });
    }
    videoSource.close();
  })();

  const audioJob = (async () => {
    if (!audioSource || !audioTrack) return;
    const sink = new AudioSampleSink(audioTrack);
    for await (const sample of sink.samples(0, mediaSeconds)) {
      if (cancelled) {
        sample.close();
        break;
      }
      await audioSource.add(sample);
      sample.close();
    }
    audioSource.close();
  })();

  try {
    await Promise.all([videoJob, audioJob]);
    if (cancelled) {
      await output.cancel();
      throw new Error('Export cancelled');
    }
    await output.finalize();
  } finally {
    exportRenderer.destroy();
  }
  const wallMs = performance.now() - t0;
  const blob = memory ? memory.result() : null;
  const sizeBytes = blob ? blob.size : opfs!.size();
  return {
    backend: exportRenderer.backend,
    fileName,
    blob,
    storage: opfs ? 'opfs' : 'memory',
    aacFallback: aacFallbackRegistered,
    hdrFrames,
    otherTransfers: [...transfers],
    sizeBytes,
    width,
    height,
    fps,
    mediaSeconds,
    wallMs: Math.round(wallMs),
    realtimeFactor: Math.round((mediaSeconds / (wallMs / 1000)) * 100) / 100,
    videoCodec,
    audioCodec: audioSource ? audioCodec : null,
    openFramesAfter: openFrames,
  };
}

function post(message: LabMessage): void {
  self.postMessage(message);
}

async function handle(request: LabRequest): Promise<LabResponseData> {
  switch (request.type) {
    case 'init': {
      renderer?.destroy();
      const created = await createRenderer(request.canvas, request.backend);
      renderer = created.renderer;
      renderer.resize(request.width, request.height);
      return { type: 'init', backend: renderer.backend, fallbackReason: created.fallbackReason };
    }
    case 'resize':
      renderer?.resize(request.width, request.height);
      return { type: 'resize' };
    case 'load':
      return { type: 'load', info: await load(request.file) };
    case 'play':
      return { type: 'play', result: await play(request.seconds) };
    case 'scrub':
      return { type: 'scrub', result: await scrub(request.count) };
    case 'export':
      return { type: 'export', result: await exportVideo(request) };
    case 'cancel':
      cancelled = true;
      return { type: 'cancel' };
  }
}

self.onmessage = (event: MessageEvent<{ id: number; request: LabRequest }>) => {
  const { id, request } = event.data;
  handle(request).then(
    (data) => post({ id, ok: true, data }),
    (error: unknown) =>
      post({
        id,
        ok: false,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      }),
  );
};
