import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  EncodedPacketSink,
  Input,
  VideoSampleSink,
  type AudioSample,
  type InputAudioTrack,
  type InputVideoTrack,
  type VideoSample,
} from 'mediabunny';
import type { DeviceTier } from '../capabilities';
import type {
  AnalyzerRequest,
  AnalyzerResponse,
  AnalyzerStats,
  ThumbnailMode,
} from './analyzer-protocol';
import { accumulatePeaks, peaksPerSecondFor } from './peaks';
import { probeMedia } from './probe';
import { SCENE_FRAME_HEIGHT, SCENE_FRAME_WIDTH, SceneDetector } from './scenes';

/**
 * The media-analysis worker: probing at import, timeline thumbnails and waveforms. Everything that
 * decodes runs here, so the editor's main thread never touches a frame or a sample.
 *
 * - **Decode budget:** at most `JOB_BUDGET[tier]` decode jobs at once (low 1, else 2); each job owns
 *   one decoder for its lifetime.
 * - **Thumbnails** are batched per asset, newest request first; a batch is decoded in time order
 *   through one `samplesAtTimestamps` pass (one decoder). In `keyframe` mode every target snaps to
 *   its keyframe, so each thumbnail costs one packet decode. Same keyframe + height = one decode.
 *   Results go through a small byte-budgeted cache (zooming the timeline asks for the same
 *   keyframes again).
 * - **Waveforms** stream-decode audio into fixed buckets (never the whole PCM). On a full decode
 *   budget they pause every few seconds of audio to let waiting thumbnails through.
 * - **Scene detection** decodes the asked range frame by frame and reads each frame at 64×36
 *   ({@link SceneDetector}). Like waveforms, it steps aside for waiting thumbnails and resumes.
 * - **Every VideoSample is closed** right after it's drawn (`openFrames` counts them).
 * - **Watchdog:** a decode step that doesn't answer in time ends its job; its requests get `null`.
 */

declare const self: {
  postMessage(message: AnalyzerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<AnalyzerRequest>) => void) | null;
};

const JOB_BUDGET: Record<DeviceTier, number> = { low: 1, mid: 2, high: 2 };
const CACHE_BUDGET: Record<DeviceTier, number> = {
  low: 8 * 2 ** 20,
  mid: 24 * 2 ** 20,
  high: 48 * 2 ** 20,
};
/** Open Mediabunny inputs kept (each holds a read cache). */
const MAX_INPUTS: Record<DeviceTier, number> = { low: 3, mid: 6, high: 10 };
/** Per-input read cache (Mediabunny's default is 8 MiB — too much for many open files). */
const INPUT_CACHE_BYTES = 2 * 2 ** 20;
/** Most thumbnails per decode job. */
const MAX_BATCH = 16;
/** Queue cap: beyond it the oldest waiting requests are dropped (answered `null`). */
const MAX_QUEUE = 512;
const WATCHDOG_MS = 4000;
/** A waveform job checks for waiting thumbnails after every this many seconds of audio. */
const WAVE_SLICE_S = 8;
/** A scene job checks for waiting thumbnails after every this many seconds of video. */
const SCENE_SLICE_S = 2;

let tier: DeviceTier = 'mid';
let mode: ThumbnailMode = 'keyframe';
let budget = JOB_BUDGET.mid;

interface VideoInfo {
  track: InputVideoTrack;
  sink: VideoSampleSink;
  packets: EncodedPacketSink;
  duration: number;
}

interface AudioInfo {
  track: InputAudioTrack;
  sink: AudioSampleSink;
  duration: number;
}

interface MediaEntry {
  assetId: string;
  blob: Blob;
  kind: 'video' | 'audio' | 'image';
  audioTrack: number | undefined;
  input: Input | null;
  video: Promise<VideoInfo | null> | null;
  audio: Promise<AudioInfo | null> | null;
  /** Jobs using the input right now (it isn't disposed while > 0). */
  users: number;
  lastUsed: number;
  removed: boolean;
}

interface ThumbRequest {
  id: number;
  assetId: string;
  seconds: number;
  height: number;
  order: number;
}

interface WaveJob {
  id: number;
  assetId: string;
  resumeAt: number;
  state: { peaks: Float32Array; peaksPerSecond: number; duration: number } | null;
}

interface SceneJob {
  id: number;
  assetId: string;
  from: number;
  to: number;
  /** Frames before this media time were read already (resume point). */
  resumeAt: number;
  detector: SceneDetector;
}

const media = new Map<string, MediaEntry>();
let thumbQueue: ThumbRequest[] = [];
const waveQueue: WaveJob[] = [];
const sceneQueue: SceneJob[] = [];
/** Ids of requests inside a running job that were cancelled. */
const cancelled = new Set<number>();
/** Ids of requests inside a running job (so a cancel knows to mark them). */
const running = new Set<number>();
let order = 0;
let clock = 0;
let active = 0;

const stats: AnalyzerStats = {
  thumbRequests: 0,
  thumbDelivered: 0,
  cacheHits: 0,
  skipped: 0,
  framesDecoded: 0,
  openFrames: 0,
  activeJobs: 0,
  peakJobs: 0,
  jobBudget: budget,
  cacheBytes: 0,
  cacheBudget: CACHE_BUDGET.mid,
  waveforms: 0,
  sceneRuns: 0,
  watchdogResets: 0,
  openInputs: 0,
};

// ---------------------------------------------------------------------------------------------
// Thumbnail cache (LRU by insertion order of a Map; byte budget per tier)

const cache = new Map<string, { bitmap: ImageBitmap; bytes: number }>();
const cacheKey = (assetId: string, ts: number, height: number) => `${assetId}|${ts}|${height}`;

function cacheGet(key: string): ImageBitmap | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit.bitmap;
}

function cachePut(key: string, bitmap: ImageBitmap): void {
  const bytes = bitmap.width * bitmap.height * 4;
  const old = cache.get(key);
  if (old) {
    cache.delete(key);
    stats.cacheBytes -= old.bytes;
    old.bitmap.close();
  }
  cache.set(key, { bitmap, bytes });
  stats.cacheBytes += bytes;
  for (const [k, v] of cache) {
    if (stats.cacheBytes <= stats.cacheBudget) break;
    cache.delete(k);
    stats.cacheBytes -= v.bytes;
    v.bitmap.close();
  }
}

function cachePurge(assetId: string): void {
  for (const [k, v] of cache) {
    if (!k.startsWith(`${assetId}|`)) continue;
    cache.delete(k);
    stats.cacheBytes -= v.bytes;
    v.bitmap.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Inputs

function openInput(entry: MediaEntry): Input {
  entry.lastUsed = ++clock;
  if (entry.input) return entry.input;
  // Close the least recently used idle inputs first.
  const idle = [...media.values()]
    .filter((m) => m.input && m.users === 0)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  for (const m of idle) {
    if (stats.openInputs < MAX_INPUTS[tier]) break;
    closeInput(m);
  }
  entry.input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(entry.blob, { maxCacheSize: INPUT_CACHE_BYTES }),
  });
  stats.openInputs++;
  return entry.input;
}

function closeInput(entry: MediaEntry): void {
  if (!entry.input) return;
  entry.input.dispose();
  entry.input = null;
  entry.video = null;
  entry.audio = null;
  stats.openInputs--;
}

function videoInfo(entry: MediaEntry): Promise<VideoInfo | null> {
  const input = openInput(entry);
  entry.video ??= (async () => {
    for (const track of await input.getVideoTracks()) {
      if (!(await track.canDecode())) continue;
      return {
        track,
        sink: new VideoSampleSink(track),
        packets: new EncodedPacketSink(track),
        duration: await track.computeDuration(),
      };
    }
    return null;
  })().catch(() => null);
  return entry.video;
}

function audioInfo(entry: MediaEntry): Promise<AudioInfo | null> {
  const input = openInput(entry);
  entry.audio ??= (async () => {
    const tracks = await input.getAudioTracks();
    const chosen =
      entry.audioTrack !== undefined ? tracks[entry.audioTrack] : await pickAudioTrack(tracks);
    if (!chosen || !(await chosen.canDecode())) return null;
    return {
      track: chosen,
      sink: new AudioSampleSink(chosen),
      duration: await chosen.computeDuration(),
    };
  })().catch(() => null);
  return entry.audio;
}

/** Same choice as probing: the first decodable stereo/mono track, else any decodable one. */
async function pickAudioTrack(tracks: InputAudioTrack[]): Promise<InputAudioTrack | undefined> {
  let fallback: InputAudioTrack | undefined;
  for (const track of tracks) {
    if (!(await track.canDecode())) continue;
    if ((await track.getNumberOfChannels()) <= 2) return track;
    fallback ??= track;
  }
  return fallback;
}

// ---------------------------------------------------------------------------------------------
// Scheduling

function reply(message: AnalyzerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function answerThumb(id: number, bitmap: ImageBitmap | null): void {
  running.delete(id);
  if (cancelled.delete(id)) {
    bitmap?.close();
    stats.skipped++;
    return;
  }
  if (bitmap) stats.thumbDelivered++;
  reply({ id, type: 'thumb', bitmap }, bitmap ? [bitmap] : []);
}

const live = (id: number) => !cancelled.has(id);

function pump(): void {
  while (active < budget) {
    const job = nextThumbJob() ?? nextWaveJob() ?? nextSceneJob();
    if (!job) return;
    active++;
    stats.activeJobs = active;
    stats.peakJobs = Math.max(stats.peakJobs, active);
    void job()
      .catch(() => undefined)
      .finally(() => {
        active--;
        stats.activeJobs = active;
        pump();
      });
  }
}

function nextThumbJob(): (() => Promise<void>) | null {
  if (thumbQueue.length === 0) return null;
  let newest = thumbQueue[0]!;
  for (const r of thumbQueue) if (r.order > newest.order) newest = r;
  const entry = media.get(newest.assetId);
  const sameAsset = thumbQueue.filter((r) => r.assetId === newest.assetId);
  // Split one asset's requests over the free decode slots (a whole strip asked at once).
  const free = Math.max(1, budget - active);
  const size = Math.min(MAX_BATCH, Math.ceil(sameAsset.length / free));
  const batch = sameAsset.sort((a, b) => b.order - a.order).slice(0, size);
  const taken = new Set(batch);
  thumbQueue = thumbQueue.filter((r) => !taken.has(r));
  for (const r of batch) running.add(r.id);
  if (!entry) {
    for (const r of batch) answerThumb(r.id, null);
    return () => Promise.resolve();
  }
  return () => runThumbJob(entry, batch);
}

function nextWaveJob(): (() => Promise<void>) | null {
  const job = waveQueue.shift();
  if (!job) return null;
  const entry = media.get(job.assetId);
  if (!entry) {
    answerWave(job.id, null);
    return () => Promise.resolve();
  }
  return () => runWaveJob(entry, job);
}

function nextSceneJob(): (() => Promise<void>) | null {
  const job = sceneQueue.shift();
  if (!job) return null;
  const entry = media.get(job.assetId);
  if (!entry || entry.kind !== 'video') {
    answerScenes(job.id, null);
    return () => Promise.resolve();
  }
  return () => runSceneJob(entry, job);
}

class WatchdogError extends Error {}

/** `iterator.next()` with a time limit. A result that arrives after the limit is closed. */
async function nextWithWatchdog<T extends { close(): void } | null>(
  iterator: AsyncIterator<T>,
): Promise<IteratorResult<T>> {
  const step = iterator.next();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new WatchdogError('Decoder stopped answering'));
    }, WATCHDOG_MS);
  });
  step
    .then((r) => {
      if (timedOut && !r.done) r.value?.close();
    })
    .catch(() => undefined);
  try {
    return await Promise.race([step, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// Thumbnails

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

function drawThumb(sample: VideoSample, height: number): ImageBitmap {
  const width = Math.max(1, Math.round((height * sample.displayWidth) / sample.displayHeight));
  if (!canvas || !context) {
    canvas = new OffscreenCanvas(width, height);
    context = canvas.getContext('2d', { alpha: false })!;
  } else if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.imageSmoothingQuality = 'medium';
  sample.drawWithFit(context, { fit: 'fill' });
  return canvas.transferToImageBitmap();
}

async function runThumbJob(entry: MediaEntry, batch: ThumbRequest[]): Promise<void> {
  entry.users++;
  try {
    if (entry.kind === 'audio') {
      for (const r of batch) answerThumb(r.id, null);
      return;
    }
    if (entry.kind === 'image') {
      await imageThumbs(entry, batch);
      return;
    }
    await videoThumbs(entry, batch);
  } finally {
    entry.users--;
    // Anything still unanswered (errors, watchdog) gets null.
    for (const r of batch) if (running.has(r.id)) answerThumb(r.id, null);
    if (entry.removed && entry.users === 0) closeInput(entry);
  }
}

/** Hands `bitmap` to every request in `group` (copies for all but the cache's own). */
async function deliver(key: string, bitmap: ImageBitmap, group: ThumbRequest[]): Promise<void> {
  cachePut(key, bitmap);
  for (const r of group) {
    if (!live(r.id)) {
      answerThumb(r.id, null);
      continue;
    }
    answerThumb(r.id, await createImageBitmap(bitmap));
  }
}

async function fromCache(key: string, group: ThumbRequest[]): Promise<boolean> {
  const hit = cacheGet(key);
  if (!hit) return false;
  for (const r of group) {
    if (!live(r.id)) {
      answerThumb(r.id, null);
      continue;
    }
    stats.cacheHits++;
    answerThumb(r.id, await createImageBitmap(hit));
  }
  return true;
}

async function imageThumbs(entry: MediaEntry, batch: ThumbRequest[]): Promise<void> {
  const byHeight = groupBy(batch, (r) => r.height);
  for (const [height, group] of byHeight) {
    const key = cacheKey(entry.assetId, 0, height);
    if (await fromCache(key, group)) continue;
    if (!group.some((r) => live(r.id))) continue;
    try {
      const bitmap = await createImageBitmap(entry.blob, {
        resizeHeight: height,
        resizeQuality: 'medium',
      });
      await deliver(key, bitmap, group);
    } catch {
      for (const r of group) answerThumb(r.id, null);
    }
  }
}

async function videoThumbs(entry: MediaEntry, batch: ThumbRequest[]): Promise<void> {
  const info = await videoInfo(entry);
  if (!info) return;
  // Target timestamp per request: its keyframe (fast) or the exact time.
  const targets = new Map<ThumbRequest, number>();
  for (const r of batch) {
    if (!live(r.id)) continue;
    const t = Math.min(Math.max(0, r.seconds), Math.max(0, info.duration - 0.001));
    if (mode === 'keyframe') {
      const key = await info.packets.getKeyPacket(t, { metadataOnly: true }).catch(() => null);
      targets.set(r, key ? key.timestamp : t);
    } else {
      targets.set(r, t);
    }
  }
  // Group by timestamp, then height; answer cache hits right away.
  const byTime = new Map<number, Map<number, ThumbRequest[]>>();
  for (const [r, ts] of targets) {
    let heights = byTime.get(ts);
    if (!heights) byTime.set(ts, (heights = new Map()));
    const group = heights.get(r.height);
    if (group) group.push(r);
    else heights.set(r.height, [r]);
  }
  for (const [ts, heights] of byTime) {
    for (const [height, group] of heights) {
      if (await fromCache(cacheKey(entry.assetId, ts, height), group)) heights.delete(height);
    }
    if (heights.size === 0) byTime.delete(ts);
  }
  if (byTime.size === 0) return;

  const wanted = (ts: number) =>
    [...(byTime.get(ts)?.values() ?? [])].some((g) => g.some((r) => live(r.id)));
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const fifo: number[] = [];
  // Lazy: Mediabunny pulls the next time after decoding the previous one, so cancelled requests
  // are skipped before they cost a decode.
  function* stamps(): Generator<number> {
    for (const ts of times) {
      if (!wanted(ts)) continue;
      fifo.push(ts);
      yield ts;
    }
  }
  const iterator = info.sink.samplesAtTimestamps(stamps())[Symbol.asyncIterator]();
  try {
    for (;;) {
      const result = await nextWithWatchdog(iterator);
      if (result.done) break;
      const sample = result.value;
      const ts = fifo.shift();
      if (!sample) continue;
      stats.framesDecoded++;
      stats.openFrames++;
      try {
        for (const [height, group] of byTime.get(ts!) ?? []) {
          if (!group.some((r) => live(r.id))) continue;
          const bitmap = drawThumb(sample, height);
          await deliver(cacheKey(entry.assetId, ts!, height), bitmap, group);
        }
      } finally {
        sample.close();
        stats.openFrames--;
      }
    }
  } catch (error) {
    if (error instanceof WatchdogError) stats.watchdogResets++;
  } finally {
    void iterator.return?.(undefined).catch(() => undefined);
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = out.get(k);
    if (group) group.push(item);
    else out.set(k, [item]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Waveforms

let scratch = new Float32Array(0);

function answerWave(id: number, state: WaveJob['state']): void {
  running.delete(id);
  if (cancelled.delete(id)) return;
  if (state) stats.waveforms++;
  reply(
    {
      id,
      type: 'wave',
      waveform: state && {
        peaksPerSecond: state.peaksPerSecond,
        peaks: state.peaks,
        duration: state.duration,
      },
    },
    state ? [state.peaks.buffer] : [],
  );
}

async function runWaveJob(entry: MediaEntry, job: WaveJob): Promise<void> {
  entry.users++;
  let iterator: AsyncIterator<AudioSample> | null = null;
  try {
    const info = entry.kind === 'image' ? null : await audioInfo(entry);
    if (!info) {
      answerWave(job.id, null);
      return;
    }
    if (!job.state) {
      const peaksPerSecond = peaksPerSecondFor(info.duration);
      job.state = {
        peaksPerSecond,
        duration: info.duration,
        peaks: new Float32Array(Math.ceil(info.duration * peaksPerSecond) + 1),
      };
    }
    const state = job.state;
    iterator = info.sink.samples(job.resumeAt)[Symbol.asyncIterator]();
    let sliceEnd = job.resumeAt + WAVE_SLICE_S;
    for (;;) {
      if (!live(job.id)) {
        answerWave(job.id, null);
        return;
      }
      const result = await nextWithWatchdog(iterator);
      if (result.done) break;
      const sample = result.value;
      const end = sample.timestamp + sample.duration;
      try {
        const frames = sample.numberOfFrames;
        const channels = sample.numberOfChannels;
        const needed = frames * channels;
        if (scratch.length < needed) scratch = new Float32Array(needed);
        sample.copyTo(scratch, { planeIndex: 0, format: 'f32', frameCount: frames });
        accumulatePeaks(
          state.peaks,
          state.peaksPerSecond,
          scratch,
          channels,
          frames,
          sample.sampleRate,
          sample.timestamp,
        );
      } finally {
        sample.close();
      }
      if (end >= sliceEnd) {
        sliceEnd = end + WAVE_SLICE_S;
        // Thumbnails are waiting and no slot is free: step aside, continue later from here.
        if (thumbQueue.length > 0 && active >= budget) {
          job.resumeAt = end;
          waveQueue.unshift(job);
          return;
        }
      }
    }
    answerWave(job.id, state);
  } catch (error) {
    if (error instanceof WatchdogError) stats.watchdogResets++;
    answerWave(job.id, null);
  } finally {
    void iterator?.return?.(undefined).catch(() => undefined);
    entry.users--;
    if (entry.removed && entry.users === 0) closeInput(entry);
  }
}

// ---------------------------------------------------------------------------------------------
// Scene detection

let sceneCanvas: OffscreenCanvas | null = null;
let sceneContext: OffscreenCanvasRenderingContext2D | null = null;

function answerScenes(id: number, cuts: number[] | null): void {
  running.delete(id);
  if (cancelled.delete(id)) return;
  if (cuts) stats.sceneRuns++;
  reply({ id, type: 'scenes', cuts });
}

async function runSceneJob(entry: MediaEntry, job: SceneJob): Promise<void> {
  entry.users++;
  let iterator: AsyncIterator<VideoSample> | null = null;
  try {
    const info = await videoInfo(entry);
    if (!info) {
      answerScenes(job.id, null);
      return;
    }
    if (!sceneCanvas || !sceneContext) {
      sceneCanvas = new OffscreenCanvas(SCENE_FRAME_WIDTH, SCENE_FRAME_HEIGHT);
      sceneContext = sceneCanvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
    }
    const ctx = sceneContext;
    const to = Math.min(job.to, info.duration);
    iterator = info.sink.samples(job.resumeAt, to)[Symbol.asyncIterator]();
    let sliceEnd = job.resumeAt + SCENE_SLICE_S;
    let reported = job.resumeAt;
    for (;;) {
      if (!live(job.id)) {
        answerScenes(job.id, null);
        return;
      }
      const result = await nextWithWatchdog(iterator);
      if (result.done) break;
      const sample = result.value;
      const time = sample.timestamp;
      stats.framesDecoded++;
      stats.openFrames++;
      try {
        // A resumed decode starts at the frame showing at resumeAt: read already.
        if (time < job.resumeAt - 1e-4 && job.resumeAt > job.from) continue;
        sample.drawWithFit(ctx, { fit: 'fill' });
      } finally {
        sample.close();
        stats.openFrames--;
      }
      job.detector.push(ctx.getImageData(0, 0, SCENE_FRAME_WIDTH, SCENE_FRAME_HEIGHT).data, time);
      job.resumeAt = time + 1e-3;
      if (time - reported >= 0.5) {
        reported = time;
        reply({
          id: job.id,
          type: 'scenes-progress',
          done: Math.min(1, (time - job.from) / Math.max(1e-3, to - job.from)),
        });
      }
      if (time >= sliceEnd) {
        sliceEnd = time + SCENE_SLICE_S;
        if (thumbQueue.length > 0 && active >= budget) {
          sceneQueue.unshift(job);
          return;
        }
      }
    }
    answerScenes(job.id, job.detector.cuts);
  } catch (error) {
    if (error instanceof WatchdogError) stats.watchdogResets++;
    answerScenes(job.id, null);
  } finally {
    void iterator?.return?.(undefined).catch(() => undefined);
    entry.users--;
    if (entry.removed && entry.users === 0) closeInput(entry);
  }
}

// ---------------------------------------------------------------------------------------------
// Messages

self.onmessage = (event: MessageEvent<AnalyzerRequest>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      tier = message.tier;
      mode = message.mode;
      budget = JOB_BUDGET[tier];
      stats.jobBudget = budget;
      stats.cacheBudget = CACHE_BUDGET[tier];
      return;
    case 'probe':
      void probeMedia(message.file, message.name).then(
        (result) => reply({ id: message.id, type: 'probe', result }),
        (error: unknown) => reply({ id: message.id, type: 'error', message: String(error) }),
      );
      return;
    case 'add': {
      const old = media.get(message.assetId);
      if (old) removeMedia(old);
      media.set(message.assetId, {
        assetId: message.assetId,
        blob: message.blob,
        kind: message.kind,
        audioTrack: message.audioTrack,
        input: null,
        video: null,
        audio: null,
        users: 0,
        lastUsed: ++clock,
        removed: false,
      });
      return;
    }
    case 'remove': {
      const entry = media.get(message.assetId);
      if (entry) removeMedia(entry);
      return;
    }
    case 'thumb': {
      stats.thumbRequests++;
      thumbQueue.push({
        id: message.id,
        assetId: message.assetId,
        seconds: message.seconds,
        height: Math.max(1, Math.min(2048, Math.round(message.height))),
        order: ++order,
      });
      if (thumbQueue.length > MAX_QUEUE) {
        thumbQueue.sort((a, b) => a.order - b.order);
        for (const r of thumbQueue.splice(0, thumbQueue.length - MAX_QUEUE)) {
          stats.skipped++;
          reply({ id: r.id, type: 'thumb', bitmap: null });
        }
      }
      pump();
      return;
    }
    case 'wave':
      waveQueue.push({ id: message.id, assetId: message.assetId, resumeAt: 0, state: null });
      running.add(message.id);
      pump();
      return;
    case 'scenes':
      sceneQueue.push({
        id: message.id,
        assetId: message.assetId,
        from: Math.max(0, message.from),
        to: message.to,
        resumeAt: Math.max(0, message.from),
        detector: new SceneDetector({ sensitivity: message.sensitivity }),
      });
      running.add(message.id);
      pump();
      return;
    case 'cancel': {
      const queued = thumbQueue.findIndex((r) => r.id === message.id);
      if (queued >= 0) {
        thumbQueue.splice(queued, 1);
        stats.skipped++;
        return;
      }
      const wave = waveQueue.findIndex((j) => j.id === message.id);
      if (wave >= 0) {
        waveQueue.splice(wave, 1);
        running.delete(message.id);
        return;
      }
      const scene = sceneQueue.findIndex((j) => j.id === message.id);
      if (scene >= 0) {
        sceneQueue.splice(scene, 1);
        running.delete(message.id);
        return;
      }
      if (running.has(message.id)) cancelled.add(message.id);
      return;
    }
    case 'stats':
      reply({ id: message.id, type: 'stats', stats: { ...stats } });
      return;
  }
};

function removeMedia(entry: MediaEntry): void {
  media.delete(entry.assetId);
  entry.removed = true;
  cachePurge(entry.assetId);
  thumbQueue = thumbQueue.filter((r) => {
    if (r.assetId !== entry.assetId) return true;
    stats.skipped++;
    reply({ id: r.id, type: 'thumb', bitmap: null });
    return false;
  });
  for (let i = waveQueue.length - 1; i >= 0; i--) {
    const job = waveQueue[i]!;
    if (job.assetId !== entry.assetId) continue;
    waveQueue.splice(i, 1);
    answerWave(job.id, null);
  }
  for (let i = sceneQueue.length - 1; i >= 0; i--) {
    const job = sceneQueue[i]!;
    if (job.assetId !== entry.assetId) continue;
    sceneQueue.splice(i, 1);
    answerScenes(job.id, null);
  }
  // Jobs in flight finish and answer on their own; the input closes after the last one.
  if (entry.users === 0) closeInput(entry);
}
