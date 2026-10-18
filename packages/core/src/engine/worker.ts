import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { DeviceTier } from '../capabilities';
import { DEFAULT_TRANSFORM, findItem, projectDuration } from '../model/project';
import type { Item, Project } from '../model/schema';
import { FLICKS_PER_SECOND, fps, frameIndex, fromSeconds, type Time } from '../model/time';
import type { LayerMedia } from '../render/layout';
import type { RenderBackend, Renderer } from '../render/types';
import { createWebGL2Renderer } from '../render/webgl2';
import { createWebGPURenderer } from '../render/webgpu';
import { Mixer, type AudioTrackSource } from '../audio/mixer';
import { AudioOutput } from './audio-output';
import { Composer, type MediaLibrary, type VideoMedia } from './compose';
import { cleanStaleExports, ExportCancelled, runExport } from './export-run';
import { DecoderPool } from './frames';
import { QualityGovernor } from './quality';
import type { EngineMessage, EngineRequest, EngineResponseData, EngineStats } from './protocol';
import { upcomingVideo } from './timeline';

/**
 * The engine worker: owns the project, the media, the decoders and the GPU. The main thread only
 * sends commands (play, seek, project changes, export) and receives the playhead time — it never
 * touches frames, so the UI can't stutter because of video work.
 */

declare const self: {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

/** Preview size caps per tier (longest side, pixels). Export always renders full size. */
const PREVIEW_CAP: Record<DeviceTier, number> = { low: 960, mid: 1280, high: 1920 };
const DECODER_BUDGET: Record<DeviceTier, number> = { low: 2, mid: 4, high: 8 };
/** Text / emoji raster budget per tier (bytes). */
const RASTER_BUDGET: Record<DeviceTier, number> = {
  low: 24 * 2 ** 20,
  mid: 48 * 2 ** 20,
  high: 96 * 2 ** 20,
};
/** Warm up the next clip's decoder this long before it appears, so cuts don't stutter. */
const PREFETCH_S = 1;
/** Play: wait at most this long for the first frame before starting the clock. */
const PREROLL_MS = 500;
/** Paused seek: wait this long for exact frames before showing what's ready (then refine). */
const PAUSED_FIRST_DRAW_MS = 60;
/**
 * Export renders with WebGL2: capturing a WebGPU canvas into a VideoFrame was ~2× slower in
 * Phase 0 (BACKLOG). Measured again with the real engine — see the pending PERF notes.
 */
const EXPORT_BACKEND: RenderBackend = 'webgl2';

let renderer: Renderer | null = null;
let composer: Composer | null = null;
let tier: DeviceTier = 'mid';
let pool = new DecoderPool(DECODER_BUDGET.mid);
let project: Project | null = null;
let viewW = 1280;
let viewH = 720;
const media: MediaLibrary = { videos: new Map(), images: new Map() };
/** Audio tracks by asset (videos with sound and audio files), once loaded. */
const audioTracks = new Map<string, AudioTrackSource>();
const audioLoads = new Map<string, Promise<void>>();
let audioOut: AudioOutput | null = null;

let playing = false;
let playheadAt = 0; // flicks, when paused / at clock start
let clockStart = 0; // performance.now() when playback started
let busy = false;
let wantedTime: Time | null = null;
/** Project frame drawn last while playing — the display may tick faster than the project's rate. */
let lastFrameIndex = -1;
const avOffsets: number[] = [];
/** The export running now (one at a time); preview stays paused meanwhile. */
let exportJob: { id: number; cancelled: boolean } | null = null;
let exportFrames = 0;

function summarize(values: number[]): { p50: number; p95: number; max: number } {
  const sorted = values.map(Math.abs).sort((a, b) => a - b);
  const at = (q: number) =>
    Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! * 10) / 10;
  return { p50: at(0.5), p95: at(0.95), max: at(1) };
}

const stats: EngineStats = {
  presented: 0,
  late: 0,
  skipped: 0,
  lateAt: [],
  drawMs: 0,
  gatherMs: 0,
  openFrames: 0,
  decoders: 0,
  decoderBudget: pool.budget,
  previewWidth: 0,
  previewHeight: 0,
  lastRendered: -1,
  lastLayers: 0,
  previewQuality: 1,
  qualityChanges: 0,
  audio: false,
  underruns: 0,
  avOffsetMs: null,
  rasterBytes: 0,
  exporting: false,
};

function post(message: EngineMessage, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

/** Reports an engine error to the main thread instead of losing it in a fire-and-forget promise. */
function reportError(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  post({ id: -1, event: { type: 'error', message } });
}

function emitTime(time: Time): void {
  post({ id: -1, event: { type: 'time', time, playing } });
}

// ── media ────────────────────────────────────────────────────────────────

function loadVideo(assetId: string, blob: Blob): void {
  const loading = (async (): Promise<VideoMedia> => {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`Asset ${assetId} has no video`);
    const layerMedia: LayerMedia = {
      width: await track.getSquarePixelWidth(),
      height: await track.getSquarePixelHeight(),
      rotation: await track.getRotation(),
      flip: await track.getFlip(),
    };
    const hdr = ((await track.getColorSpace()).transfer as string | undefined) === 'hlg';
    const audio = loadAudioTrack(assetId, input);
    audioLoads.set(assetId, audio);
    await audio;
    return { input, track, media: layerMedia, hdr };
  })();
  loading.catch(reportError);
  media.videos.set(assetId, loading);
}

/** The asset's chosen audio track (the probe's pick, e.g. AAC rather than iPhone spatial audio). */
async function loadAudioTrack(assetId: string, input: Input): Promise<void> {
  const tracks = await input.getAudioTracks();
  const index = project?.assets[assetId]?.audioTrack ?? 0;
  const track = tracks[index] ?? tracks[0];
  if (track && (await track.canDecode())) {
    audioTracks.set(assetId, { track, sampleRate: await track.getSampleRate() });
  }
}

function loadAudio(assetId: string, blob: Blob): void {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const loading = loadAudioTrack(assetId, input);
  audioLoads.set(assetId, loading.catch(reportError));
}

function loadImage(assetId: string, blob: Blob): void {
  // Straight alpha: the renderer contract (render/types.ts, DECISIONS #39).
  const loading = createImageBitmap(blob, { premultiplyAlpha: 'none' });
  loading.catch(reportError);
  media.images.set(assetId, loading);
}

/** Frees decoders and frames of items that left the project. */
function pruneSources(): void {
  if (!project || !composer) return;
  composer.prune(new Set(project.tracks.flatMap((t) => t.items.map((i) => i.id))));
}

// ── rendering ────────────────────────────────────────────────────────────

const quality = new QualityGovernor();

function noteFrame(late: boolean): void {
  quality.frame(late, performance.now());
  stats.previewQuality = quality.factor;
  stats.qualityChanges = quality.changes;
}

function previewSize(p: Project): { width: number; height: number } {
  const { width, height } = p.settings;
  const cap = PREVIEW_CAP[tier];
  // Fit the project's aspect ratio inside the view, cap the resolution for the tier, then apply
  // the adaptive quality step.
  const scale =
    Math.min(viewW / width, viewH / height, cap / Math.max(width, height), 1) * quality.factor;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width * scale), height: even(height * scale) };
}

/**
 * Draws the frame at timeline time `t`. Waits for exact frames only until `deadlineMs`; late layers
 * reuse their previous picture. Returns the requests still decoding (empty = the frame was exact),
 * so a paused preview can redraw the moment they arrive.
 */
async function renderAt(
  t: Time,
  deadlineMs: number,
  counting = false,
): Promise<Promise<unknown>[]> {
  if (!renderer || !composer || !project) return [];
  const size = previewSize(project);
  if (size.width !== stats.previewWidth || size.height !== stats.previewHeight) {
    renderer.resize(size.width, size.height);
    stats.previewWidth = size.width;
    stats.previewHeight = size.height;
  }
  const result = await composer.render(project, t, size.width, size.height, deadlineMs);
  stats.gatherMs = result.gatherMs;
  stats.drawMs = result.drawMs;
  stats.lastRendered = t;
  stats.lastLayers = result.layers;
  if (counting) noteFrame(result.late);
  if (result.late && counting) {
    stats.late++;
    if (stats.lateAt.length < 10) stats.lateAt.push(`late ${(t / FLICKS_PER_SECOND).toFixed(2)}`);
  }
  stats.openFrames = composer.lastFrames.size;
  stats.decoders = pool.size;
  stats.rasterBytes = composer.rasters.size;
  return result.pending;
}

/**
 * Gives back the decoder and held frame of clips that are neither on screen nor about to be (more
 * than 2 s away from the playhead): on a phone, idle decoders and 4K frames are wasted GPU memory.
 */
function releaseIdle(t: Time): void {
  if (!project || !composer) return;
  const keep = new Set(
    upcomingVideo(project, Math.max(0, t - fromSeconds(2)), fromSeconds(2 + PREFETCH_S + 2)).map(
      (u) => u.item.id,
    ),
  );
  composer.releaseExcept(keep);
}

/** Warm up decoders for clips that appear soon — transitions included (first frame at the cut). */
function prefetch(t: Time): void {
  if (!project || !composer) return;
  const c = composer;
  for (const upcoming of upcomingVideo(project, t, fromSeconds(PREFETCH_S))) {
    const item = upcoming.item;
    if (upcoming.visibleFrom <= t || c.sources.has(item.id)) continue;
    void c.sourceFor(item.id, item.assetId).then(async (found) => {
      const sample = await found?.source.frameAt(upcoming.firstSourceTime / FLICKS_PER_SECOND);
      if (sample) c.keep(item.id, sample);
    });
  }
}

// ── clock & loop ─────────────────────────────────────────────────────────

function currentTime(): Time {
  if (!playing || clockStart === 0) return playheadAt;
  // Sound leads: video shows what is audible now. Without audio, the wall clock.
  const audible = audioOut?.clock();
  if (audible != null) return audible;
  if (audioOut) return playheadAt; // audio is starting: hold the first frame until it plays
  return playheadAt + fromSeconds((performance.now() - clockStart) / 1000);
}

/** Wakes a paused preview that is waiting to refine an older frame (a newer seek arrived). */
let wakeRefine: (() => void) | null = null;

/** The paused-preview loop while it runs — play() waits for it so two renders never overlap. */
let pausedLoop: Promise<void> | null = null;

/** Seek while paused: latest request wins; draws as soon as frames are ready. */
function showAt(t: Time): Promise<void> {
  wantedTime = t;
  wakeRefine?.();
  if (exportJob) return Promise.resolve(); // drawn when the export ends
  if (busy) return pausedLoop ?? Promise.resolve();
  busy = true;
  pausedLoop = pausedPreview().finally(() => {
    pausedLoop = null;
  });
  return pausedLoop;
}

async function pausedPreview(): Promise<void> {
  try {
    while (wantedTime !== null && !playing && !exportJob) {
      const next = wantedTime;
      wantedTime = null;
      // Progressive: show what's ready almost at once, then redraw when the exact frames arrive —
      // unless the user has moved on (a newer seek is waiting).
      releaseIdle(next);
      let pendingRequests = await renderAt(next, performance.now() + PAUSED_FIRST_DRAW_MS).catch(
        (error: unknown) => {
          reportError(error);
          return [];
        },
      );
      for (
        let attempt = 0;
        pendingRequests.length > 0 && wantedTime === null && attempt < 3;
        attempt++
      ) {
        await Promise.race([
          Promise.all(pendingRequests),
          new Promise((r) => setTimeout(r, 2000)),
          new Promise<void>((r) => (wakeRefine = r)),
        ]);
        wakeRefine = null;
        if (wantedTime !== null || playing || exportJob) break;
        pendingRequests = await renderAt(next, performance.now() + PAUSED_FIRST_DRAW_MS).catch(
          (error: unknown) => {
            reportError(error);
            return [];
          },
        );
      }
    }
  } finally {
    busy = false;
  }
}

function tick(): void {
  if (!playing || !project) return;
  const frameMs = 1000 / fps(project.settings.frameRate);
  const t = currentTime();
  const end = projectDuration(project);
  if (t >= end) {
    playing = false;
    audioOut?.stop();
    playheadAt = end;
    emitTime(end);
    post({ id: -1, event: { type: 'ended' } });
    return;
  }
  emitTime(t);
  prefetch(t);
  const index = frameIndex(t, project.settings.frameRate);
  if (index % 15 === 0 && index !== lastFrameIndex) releaseIdle(t);
  if (index === lastFrameIndex) {
    // Same project frame as last tick (60 Hz display, 30 fps project): nothing new to draw.
    scheduleTick(frameMs);
    return;
  }
  if (busy) {
    stats.skipped++;
    if (stats.lateAt.length < 10) stats.lateAt.push(`skip ${(t / FLICKS_PER_SECOND).toFixed(2)}`);
  } else {
    busy = true;
    // Give decoders most of a frame; a late layer reuses its previous picture instead of stalling.
    lastFrameIndex = index;
    void renderAt(t, performance.now() + frameMs * 0.8, true)
      .then(() => {
        stats.presented++;
        // How far the picture now on screen is from the sound now audible (ms).
        const audible = audioOut?.clock();
        if (audible != null) {
          if (avOffsets.length < 2000) avOffsets.push(((audible - t) / FLICKS_PER_SECOND) * 1000);
          stats.avOffsetMs = summarize(avOffsets);
        }
      })
      .catch(reportError)
      .finally(() => {
        busy = false;
      });
  }
  scheduleTick(frameMs);
}

const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number })
  .requestAnimationFrame;
function scheduleTick(frameMs: number): void {
  if (raf) raf(tick);
  else setTimeout(tick, frameMs);
}

function pausePlayback(): void {
  if (!playing) return;
  playheadAt = currentTime();
  playing = false;
  audioOut?.stop();
  emitTime(playheadAt);
}

// ── export & capture ─────────────────────────────────────────────────────

async function makeRenderer(canvas: OffscreenCanvas, backend: RenderBackend): Promise<Renderer> {
  if (backend === 'webgpu') {
    try {
      return await createWebGPURenderer(canvas);
    } catch {
      // A canvas gets one context type; WebGPU fails before getContext in the common cases.
    }
  }
  return createWebGL2Renderer(canvas);
}

/** Everything the project uses is loaded (decoders and audio readers can start). */
async function mediaReady(p: Project): Promise<void> {
  const waits: Promise<unknown>[] = [];
  for (const id of Object.keys(p.assets)) {
    const v = media.videos.get(id);
    if (v) waits.push(v.catch(() => undefined));
    const i = media.images.get(id);
    if (i) waits.push(i.catch(() => undefined));
    const a = audioLoads.get(id);
    if (a) waits.push(a.catch(() => undefined));
  }
  await Promise.all(waits);
}

async function startExport(
  request: Extract<EngineRequest, { type: 'export' }>,
): Promise<EngineResponseData> {
  if (!project) throw new Error('No project to export');
  if (exportJob) throw new Error('An export is already running');
  const job = { id: request.jobId, cancelled: false };
  exportJob = job;
  stats.exporting = true;
  try {
    // Preview pauses: playback stops and the paused preview finishes its render; preview decoders
    // and held frames are given back so the export has the device's decoders and memory.
    pausePlayback();
    wakeRefine?.();
    if (pausedLoop) await pausedLoop;
    composer?.releaseExcept(new Set());
    const p = project;
    await mediaReady(p);
    const { result, stats: run } = await runExport(
      {
        project: p,
        media,
        audioOf: (assetId) => audioTracks.get(assetId) ?? null,
        makeRenderer: (canvas) => makeRenderer(canvas, request.backend ?? EXPORT_BACKEND),
        decoderBudget: DECODER_BUDGET[tier],
        rasterBudget: RASTER_BUDGET[tier],
        isCancelled: () => job.cancelled,
        onProgress: (progress) =>
          post({ id: -1, event: { type: 'export-progress', jobId: job.id, progress } }),
        onFrameCount: (delta) => (exportFrames += delta),
      },
      request.options,
    );
    return { type: 'export', result, stats: { ...run, openFramesAfter: exportFrames } };
  } catch (error) {
    if (error instanceof ExportCancelled) throw error;
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    exportJob = null;
    stats.exporting = false;
    void showAt(playheadAt);
  }
}

/** Renders one exact frame at any size and backend into an ImageBitmap (tests, cover images). */
async function capture(
  request: Extract<EngineRequest, { type: 'capture' }>,
): Promise<{ data: EngineResponseData; transfer: Transferable[] }> {
  if (!project) throw new Error('No project');
  const p = project;
  await mediaReady(p);
  const size =
    request.width && request.height
      ? { width: request.width, height: request.height }
      : previewSize(p);
  const canvas = new OffscreenCanvas(size.width, size.height);
  // An explicit backend is strict (golden checks must know which path drew the picture).
  const r =
    request.backend === 'webgpu'
      ? await createWebGPURenderer(canvas)
      : await makeRenderer(canvas, request.backend ?? renderer?.backend ?? 'webgl2');
  const c = new Composer(r, new DecoderPool(2), media, true, RASTER_BUDGET[tier], false);
  try {
    await c.render(p, Math.max(0, Math.round(request.time)), size.width, size.height, null);
    const bitmap = canvas.transferToImageBitmap();
    return { data: { type: 'capture', bitmap, backend: r.backend }, transfer: [bitmap] };
  } finally {
    c.destroy();
    r.destroy();
  }
}

/**
 * Filter strip thumbnails: one small renderer + composer kept warm between calls (the strip asks
 * again when the clip or playhead changes) and freed after a few idle seconds.
 */
let looks: {
  canvas: OffscreenCanvas;
  renderer: Renderer;
  composer: Composer;
  size: number;
} | null = null;
let looksIdle: ReturnType<typeof setTimeout> | undefined;

async function filterPreviews(
  request: Extract<EngineRequest, { type: 'filter-previews' }>,
): Promise<{ data: EngineResponseData; transfer: Transferable[] }> {
  if (!project) throw new Error('No project');
  const found = findItem(project, request.itemId);
  const item = found?.item;
  if (!found || !item || !('filter' in item))
    return { data: { type: 'filter-previews', bitmaps: [] }, transfer: [] };
  // Text and stickers are shown alone, centred on a neutral grey, with each look.
  const element = item.kind === 'text' || item.kind === 'sticker';
  clearTimeout(looksIdle);
  const size = Math.max(16, Math.min(256, Math.round(request.size)));
  if (!looks || looks.size !== size) {
    looks?.composer.destroy();
    looks?.renderer.destroy();
    const canvas = new OffscreenCanvas(size, size);
    const r = await makeRenderer(canvas, renderer?.backend ?? 'webgl2');
    looks = {
      canvas,
      renderer: r,
      composer: new Composer(r, new DecoderPool(1), media, true, 4 << 20, false),
      size,
    };
  }
  const local = Math.max(0, Math.min(item.duration - 1, Math.round(request.time) - item.start));
  // Pictures: the clip's own frame, filling the square, with its own adjustments.
  const base = (
    element
      ? { ...centredForTile(item, size, size, undefined), start: 0 }
      : {
          ...item,
          start: 0,
          transitionIn: null,
          transform: { ...DEFAULT_TRANSFORM },
          fit: 'fill',
        }
  ) as Extract<Item, { filter: unknown }>;
  const mini: Project = {
    ...project,
    settings: {
      ...project.settings,
      width: size,
      height: size,
      background: { type: 'color', color: element ? '#3c3c44' : '#000000' },
    },
    tracks: element
      ? [
          { id: 'looks-main', kind: 'main', muted: true, hidden: false, locked: false, items: [] },
          { ...found.track, muted: true, hidden: false, items: [base] },
        ]
      : [{ id: 'looks', kind: 'main', muted: true, hidden: false, locked: false, items: [base] }],
  };
  await mediaReady(mini);
  // A fresh renderer's first draw can land before the frame is decoded: warm it up once.
  base.filter = null;
  await looks.composer.render(mini, local, size, size, null);
  looks.canvas.transferToImageBitmap().close();
  const bitmaps: ImageBitmap[] = [];
  for (const id of request.filters) {
    base.filter = id ? { id, intensity: 1 } : null;
    await looks.composer.render(mini, local, size, size, null);
    bitmaps.push(looks.canvas.transferToImageBitmap());
  }
  looksIdle = setTimeout(() => {
    looks?.composer.destroy();
    looks?.renderer.destroy();
    looks = null;
  }, 5000);
  return { data: { type: 'filter-previews', bitmaps }, transfer: bitmaps };
}

/**
 * Picker previews share one small renderer and canvas, so they run one at a time: two at once
 * would draw over each other's frames (or one would resize the renderer under the other).
 */
let looksQueue: Promise<unknown> = Promise.resolve();
function inLooksQueue<T>(job: () => Promise<T>): Promise<T> {
  const run = looksQueue.then(job, job);
  looksQueue = run.catch(() => undefined);
  return run;
}

/** The warm looks renderer at `width × height` (shared by the picker previews). */
async function looksRenderer(width: number, height: number) {
  clearTimeout(looksIdle);
  const key = width * 1000 + height;
  if (!looks || looks.size !== key) {
    looks?.composer.destroy();
    looks?.renderer.destroy();
    const canvas = new OffscreenCanvas(width, height);
    const r = await makeRenderer(canvas, renderer?.backend ?? 'webgl2');
    looks = {
      canvas,
      renderer: r,
      composer: new Composer(r, new DecoderPool(2), media, true, 4 << 20, false),
      size: key,
    };
  }
  return looks;
}

function looksDone(): void {
  looksIdle = setTimeout(() => {
    looks?.composer.destroy();
    looks?.renderer.destroy();
    looks = null;
  }, 5000);
}

/**
 * A lane item placed for a picker tile: centred, upright, opaque, and sized to the tile —
 * pictures fill most of it, stickers about 70%, and text so its longest line fills most of the
 * width (never more than ~45% of the height), so even a small caption reads in its preview.
 */
function centredForTile(
  item: Item,
  width: number,
  height: number,
  animation: Extract<Item, { kind: 'text' }>['animation'],
): Item {
  if (!('transform' in item)) return item;
  let scale = item.transform.scale;
  if (item.kind === 'video' || item.kind === 'image' || item.kind === 'freeze') scale = 0.72;
  else if (item.kind === 'sticker') scale = 0.7;
  else if (item.kind === 'text') {
    const lines = item.text.split('\n');
    const longest = Math.max(1, ...lines.map((line) => line.length));
    const spacing = 0.56 + Math.max(0, item.style.letterSpacing);
    const fontPx = Math.min(
      (height * 0.45) / Math.max(1, lines.length),
      (width * 0.85) / (longest * spacing),
    );
    scale = fontPx / (item.style.size * height);
  }
  return {
    ...item,
    transform: { ...item.transform, x: 0.5, y: 0.5, rotation: 0, opacity: 1, scale },
    animation,
  } as Item;
}

/**
 * Animation picker: one lane item alone, centred and large in the tile, at the requested times
 * with the requested animation (a still when `animation` is null).
 */
async function itemPreview(
  request: Extract<EngineRequest, { type: 'item-preview' }>,
): Promise<{ data: EngineResponseData; transfer: Transferable[] }> {
  const empty = { data: { type: 'item-preview' as const, bitmaps: [] }, transfer: [] };
  if (!project) throw new Error('No project');
  const found = findItem(project, request.itemId);
  if (!found || found.track.kind === 'main' || !('transform' in found.item)) return empty;
  const width = Math.max(16, Math.min(320, Math.round(request.width)));
  const height = Math.max(16, Math.min(320, Math.round(request.height)));
  const l = await looksRenderer(width, height);
  const item = found.item;
  const shown = centredForTile(item, width, height, request.animation ?? undefined);
  const mini: Project = {
    ...project,
    settings: {
      ...project.settings,
      width,
      height,
      background: { type: 'color', color: request.background },
    },
    tracks: [
      { id: 'looks-main', kind: 'main', muted: true, hidden: false, locked: false, items: [] },
      { ...found.track, muted: true, hidden: false, items: [shown] },
    ],
  };
  await mediaReady(mini);
  const times = request.times.slice(0, 24);
  const clampT = (t: number) =>
    Math.max(item.start, Math.min(item.start + item.duration - 1, Math.round(t)));
  await l.composer.render(mini, clampT(times[0] ?? item.start), width, height, null);
  l.canvas.transferToImageBitmap().close();
  const bitmaps: ImageBitmap[] = [];
  for (const t of times) {
    const at = Math.max(item.start, Math.min(item.start + item.duration - 1, Math.round(t)));
    await l.composer.render(mini, at, width, height, null);
    bitmaps.push(l.canvas.transferToImageBitmap());
  }
  looksDone();
  return { data: { type: 'item-preview', bitmaps }, transfer: bitmaps };
}

/**
 * Transition picker flip-book: the real cut (previous clip → this clip) with one transition,
 * rendered at a few points across its window on the warm looks renderer.
 */
async function transitionPreview(
  request: Extract<EngineRequest, { type: 'transition-preview' }>,
): Promise<{ data: EngineResponseData; transfer: Transferable[] }> {
  const empty = { data: { type: 'transition-preview' as const, bitmaps: [] }, transfer: [] };
  if (!project) throw new Error('No project');
  // The cut's own track: the main track, or a picture layer where two clips touch.
  const track = findItem(project, request.itemId)?.track;
  const index = track ? track.items.findIndex((i) => i.id === request.itemId) : -1;
  if (!track || index < 1) return empty;
  const prev = track.items[index - 1]!;
  const item = track.items[index]!;
  if (!('transitionIn' in item)) return empty;
  clearTimeout(looksIdle);
  const width = Math.max(16, Math.min(320, Math.round(request.width)));
  const height = Math.max(16, Math.min(320, Math.round(request.height)));
  const key = width * 1000 + height;
  if (!looks || looks.size !== key) {
    looks?.composer.destroy();
    looks?.renderer.destroy();
    const canvas = new OffscreenCanvas(width, height);
    const r = await makeRenderer(canvas, renderer?.backend ?? 'webgl2');
    looks = {
      canvas,
      renderer: r,
      composer: new Composer(r, new DecoderPool(2), media, true, 4 << 20, false),
      size: key,
    };
  }
  const transition = request.transition;
  const next = { ...item, transitionIn: transition } as Item;
  const mini: Project = {
    ...project,
    settings: { ...project.settings, width, height },
    tracks:
      track.kind === 'main'
        ? [{ ...track, muted: true, hidden: false, items: [prev, next] }]
        : [
            // A layer cut is shown on its own, centred and large, like the main track's.
            {
              id: 'looks-main',
              kind: 'main',
              muted: true,
              hidden: false,
              locked: false,
              items: [],
            },
            {
              ...track,
              muted: true,
              hidden: false,
              items: [prev, next].map((i) =>
                'transform' in i
                  ? ({
                      ...i,
                      transform: { ...i.transform, x: 0.5, y: 0.5, scale: 1, rotation: 0 },
                    } as Item)
                  : i,
              ),
            },
          ],
  };
  await mediaReady(mini);
  const half = Math.min(transition.duration, prev.duration, item.duration) / 2;
  const from = item.start - half;
  const frames = Math.max(2, Math.min(24, Math.round(request.frames)));
  await looks.composer.render(mini, Math.max(0, Math.round(from)), width, height, null);
  looks.canvas.transferToImageBitmap().close();
  const bitmaps: ImageBitmap[] = [];
  for (let i = 0; i < frames; i++) {
    const t = Math.round(from + (2 * half * i) / (frames - 1));
    await looks.composer.render(
      mini,
      Math.min(t, item.start + item.duration - 1),
      width,
      height,
      null,
    );
    bitmaps.push(looks.canvas.transferToImageBitmap());
  }
  looksIdle = setTimeout(() => {
    looks?.composer.destroy();
    looks?.renderer.destroy();
    looks = null;
  }, 5000);
  return { data: { type: 'transition-preview', bitmaps }, transfer: bitmaps };
}

// ── messages ─────────────────────────────────────────────────────────────

async function handle(
  request: EngineRequest,
): Promise<EngineResponseData | { data: EngineResponseData; transfer: Transferable[] }> {
  switch (request.type) {
    case 'init': {
      tier = request.tier;
      pool = new DecoderPool(DECODER_BUDGET[tier]);
      stats.decoderBudget = pool.budget;
      viewW = request.viewWidth;
      viewH = request.viewHeight;
      const canvas = request.canvas;
      if (request.backend !== 'webgl2') {
        try {
          renderer = await createWebGPURenderer(canvas);
        } catch (error) {
          if (request.backend === 'webgpu') throw error;
        }
      }
      renderer ??= createWebGL2Renderer(canvas);
      composer = new Composer(renderer, pool, media, false, RASTER_BUDGET[tier]);
      // Old export files left by closed pages: tidy once, after startup work is done.
      setTimeout(() => void cleanStaleExports(), 5000);
      composer.cheapEffects = tier === 'low';
      return { type: 'init', backend: renderer.backend };
    }
    case 'project':
      project = request.project;
      pruneSources();
      if (!playing) void showAt(playheadAt);
      return { type: 'ok' };
    case 'media': {
      const asset = project?.assets[request.assetId];
      if (asset?.kind === 'image') loadImage(request.assetId, request.blob);
      else if (asset?.kind === 'audio') loadAudio(request.assetId, request.blob);
      else loadVideo(request.assetId, request.blob);
      if (!playing) void showAt(playheadAt);
      return { type: 'ok' };
    }
    case 'view':
      viewW = request.viewWidth;
      viewH = request.viewHeight;
      if (!playing) void showAt(playheadAt);
      return { type: 'ok' };
    case 'seek': {
      const t = Math.max(0, Math.round(request.time));
      playheadAt = t;
      clockStart = performance.now();
      if (playing && audioOut) void audioOut.start(t).catch(reportError);
      if (!playing) void showAt(t);
      emitTime(t);
      return { type: 'ok' };
    }
    case 'play':
      if (exportJob) throw new Error('Playback is paused while exporting');
      if (!playing && project) {
        if (playheadAt >= projectDuration(project)) playheadAt = 0;
        // Stop the paused preview first (it checks `playing`) and wait for its last render, so only
        // one render is ever in flight. The clock doesn't run until scheduleTick below.
        playing = true;
        wantedTime = null;
        wakeRefine?.();
        if (pausedLoop) await pausedLoop;
        // Pre-roll: get the first frame decoded before the clock starts (up to 500 ms), so
        // playback never begins with late or skipped frames.
        busy = true;
        try {
          const pending = await renderAt(playheadAt, performance.now() + PREROLL_MS).catch(
            (e: unknown) => {
              reportError(e);
              return [];
            },
          );
          if (pending.length)
            await Promise.race([
              Promise.all(pending),
              new Promise((r) => setTimeout(r, PREROLL_MS)),
            ]);
        } finally {
          busy = false;
        }
        if (!playing) return { type: 'ok' }; // paused during pre-roll
        if (audioOut) await audioOut.start(playheadAt);
        if (!playing) return { type: 'ok' };
        clockStart = performance.now();
        Object.assign(stats, { presented: 0, late: 0, skipped: 0, lateAt: [], avOffsetMs: null });
        avOffsets.length = 0;
        lastFrameIndex = frameIndex(playheadAt, project.settings.frameRate); // drawn by the pre-roll
        scheduleTick(0);
      }
      return { type: 'ok' };
    case 'pause':
      if (playing) {
        pausePlayback();
        void showAt(playheadAt);
      }
      return { type: 'ok' };
    case 'audio': {
      const mixer = new Mixer(request.sampleRate, (assetId) => audioTracks.get(assetId) ?? null);
      audioOut = new AudioOutput(
        request.port,
        request.sampleRate,
        request.latency,
        mixer,
        () => project,
        reportError,
      );
      return { type: 'ok' };
    }
    case 'crash-for-test':
      setTimeout(() => {
        throw new Error('Test crash');
      });
      return { type: 'ok' };
    case 'stats':
      return {
        type: 'stats',
        stats: { ...stats, underruns: audioOut?.underruns ?? 0, audio: audioOut !== null },
      };
    case 'export':
      return startExport(request);
    case 'export-cancel':
      if (exportJob && exportJob.id === request.jobId) exportJob.cancelled = true;
      return { type: 'ok' };
    case 'capture':
      return capture(request);
    case 'filter-previews':
      return inLooksQueue(() => filterPreviews(request));
    case 'transition-preview':
      return inLooksQueue(() => transitionPreview(request));
    case 'item-preview':
      return inLooksQueue(() => itemPreview(request));
  }
}

self.onmessage = (event: MessageEvent<{ id: number; request: EngineRequest }>) => {
  const { id, request } = event.data;
  handle(request).then(
    (response) => {
      if ('transfer' in response) post({ id, ok: true, data: response.data }, response.transfer);
      else post({ id, ok: true, data: response });
    },
    (error: unknown) =>
      post({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Error',
      }),
  );
};
