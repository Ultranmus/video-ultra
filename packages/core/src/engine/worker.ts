import { ALL_FORMATS, BlobSource, Input, type InputVideoTrack, type VideoSample } from 'mediabunny';
import type { DeviceTier } from '../capabilities';
import { projectDuration } from '../model/project';
import type { Project } from '../model/schema';
import { FLICKS_PER_SECOND, fps, frameIndex, fromSeconds, type Time } from '../model/time';
import { layerGeometry, type LayerMedia } from '../render/layout';
import type { LayerDraw, Renderer } from '../render/types';
import { createWebGL2Renderer } from '../render/webgl2';
import { createWebGPURenderer } from '../render/webgpu';
import { Mixer, type AudioTrackSource } from '../audio/mixer';
import { AudioOutput } from './audio-output';
import { DecoderPool, FrameSource } from './frames';
import type { EngineMessage, EngineRequest, EngineResponseData, EngineStats } from './protocol';
import { activeLayers, upcomingVideoItems, type ActiveLayer } from './timeline';

/**
 * The engine worker: owns the project, the media, the decoders and the GPU. The main thread only
 * sends commands (play, seek, project changes) and receives the playhead time — it never touches
 * frames, so the UI can't stutter because of video work.
 */

declare const self: {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

/** Preview size caps per tier (longest side, pixels). Export always renders full size. */
const PREVIEW_CAP: Record<DeviceTier, number> = { low: 960, mid: 1280, high: 1920 };
const DECODER_BUDGET: Record<DeviceTier, number> = { low: 2, mid: 4, high: 8 };
/** Warm up the next clip's decoder this long before it appears, so cuts don't stutter. */
const PREFETCH_S = 1;
/** Play: wait at most this long for the first frame before starting the clock. */
const PREROLL_MS = 500;
/** Paused seek: wait this long for exact frames before showing what's ready (then refine). */
const PAUSED_FIRST_DRAW_MS = 60;

interface VideoMedia {
  input: Input;
  track: InputVideoTrack;
  media: LayerMedia;
  hdr: boolean;
}

let renderer: Renderer | null = null;
let tier: DeviceTier = 'mid';
let pool = new DecoderPool(DECODER_BUDGET.mid);
let project: Project | null = null;
let viewW = 1280;
let viewH = 720;
const videos = new Map<string, Promise<VideoMedia>>();
/** Audio tracks by asset (videos with sound and audio files), once loaded. */
const audioTracks = new Map<string, AudioTrackSource>();
let audioOut: AudioOutput | null = null;
const images = new Map<string, Promise<ImageBitmap>>();
/** One frame source per timeline item (each needs its own decode position). */
const sources = new Map<string, FrameSource>();
/** Last frame drawn per item, reused when the next one isn't decoded in time. */
const lastFrames = new Map<string, VideoSample>();

let playing = false;
let playheadAt = 0; // flicks, when paused / at clock start
let clockStart = 0; // performance.now() when playback started
let busy = false;
let wantedTime: Time | null = null;
/** Project frame drawn last while playing — the display may tick faster than the project's rate. */
let lastFrameIndex = -1;
const avOffsets: number[] = [];

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
  audio: false,
  underruns: 0,
  avOffsetMs: null,
};

function post(message: EngineMessage): void {
  self.postMessage(message);
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
  videos.set(
    assetId,
    (async () => {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error(`Asset ${assetId} has no video`);
      const media: LayerMedia = {
        width: await track.getSquarePixelWidth(),
        height: await track.getSquarePixelHeight(),
        rotation: await track.getRotation(),
        flip: await track.getFlip(),
      };
      const hdr = ((await track.getColorSpace()).transfer as string | undefined) === 'hlg';
      await loadAudioTrack(assetId, input);
      return { input, track, media, hdr };
    })(),
  );
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
  void loadAudioTrack(assetId, input).catch(reportError);
}

function loadImage(assetId: string, blob: Blob): void {
  // Straight alpha: the renderer contract (render/types.ts, DECISIONS #39).
  images.set(assetId, createImageBitmap(blob, { premultiplyAlpha: 'none' }));
}

async function sourceFor(
  itemId: string,
  assetId: string,
): Promise<{ source: FrameSource; video: VideoMedia } | null> {
  const pending = videos.get(assetId);
  if (!pending) return null;
  const video = await pending;
  let source = sources.get(itemId);
  if (!source) {
    source = new FrameSource(video.track, pool);
    sources.set(itemId, source);
  }
  return { source, video };
}

/** Frees decoders and frames of items that left the project. */
function pruneSources(): void {
  if (!project) return;
  const alive = new Set(project.tracks.flatMap((t) => t.items.map((i) => i.id)));
  for (const [id, source] of sources) {
    if (alive.has(id)) continue;
    source.destroy();
    sources.delete(id);
    lastFrames.get(id)?.close();
    lastFrames.delete(id);
  }
}

// ── rendering ────────────────────────────────────────────────────────────

const layerDraws: LayerDraw[] = [];
const active: ActiveLayer[] = [];
const geometries: Float32Array[] = [];

function previewSize(p: Project): { width: number; height: number } {
  const { width, height } = p.settings;
  const cap = PREVIEW_CAP[tier];
  // Fit the project's aspect ratio inside the view, then cap the resolution for the tier.
  const scale = Math.min(viewW / width, viewH / height, cap / Math.max(width, height), 1);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width * scale), height: even(height * scale) };
}

function backgroundColor(p: Project): [number, number, number] {
  const bg = p.settings.background;
  if (bg.type !== 'color') return [0, 0, 0]; // blur background: Day 5
  const hex = bg.color.replace('#', '');
  const value = parseInt(
    hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6),
    16,
  );
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
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
  const pendingRequests: Promise<unknown>[] = [];
  if (!renderer || !project) return pendingRequests;
  const p = project;
  const size = previewSize(p);
  if (size.width !== stats.previewWidth || size.height !== stats.previewHeight) {
    renderer.resize(size.width, size.height);
    stats.previewWidth = size.width;
    stats.previewHeight = size.height;
  }
  const t0 = performance.now();
  activeLayers(p, t, active);
  layerDraws.length = 0;
  let late = false;

  const jobs = active.map(async (layer, index) => {
    const item = layer.item;
    if (item.kind === 'image') {
      const bitmap = await images.get(item.assetId);
      if (!bitmap) return null;
      const geometry = (geometries[index] ??= new Float32Array(12));
      layerGeometry(
        size.width,
        size.height,
        { width: bitmap.width, height: bitmap.height, rotation: 0, flip: false },
        item,
        geometry,
      );
      return {
        source: bitmap,
        geometry,
        opacity: item.transform.opacity,
        hdr: false,
      } satisfies LayerDraw;
    }
    if (item.kind !== 'video' && item.kind !== 'freeze') return null; // text & stickers: Day 5
    const found = await sourceFor(item.id, item.assetId);
    if (!found) return null;
    const seconds = layer.sourceTime / FLICKS_PER_SECOND;
    const request = found.source.frameAt(seconds);
    // Wait for the exact frame until the deadline; otherwise show the previous one.
    const remaining = Math.max(0, deadlineMs - performance.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sample = await Promise.race([
      request,
      new Promise<'late'>((resolve) => (timer = setTimeout(() => resolve('late'), remaining))),
    ]).finally(() => clearTimeout(timer));
    if (sample === 'late') {
      late = true;
      pendingRequests.push(request);
      // When it does arrive, keep it as the newest picture for this item.
      void request.then((s) => {
        if (!s) return;
        lastFrames.get(item.id)?.close();
        lastFrames.set(item.id, s);
      });
    } else if (sample) {
      lastFrames.get(item.id)?.close();
      lastFrames.set(item.id, sample);
    }
    const geometry = (geometries[index] ??= new Float32Array(12));
    layerGeometry(size.width, size.height, found.video.media, item, geometry);
    // The picture itself is looked up after all layers are gathered (below), not here: a late
    // frame arriving while other layers are still decoding may replace and close it.
    return { itemId: item.id, geometry, opacity: item.transform.opacity, hdr: found.video.hdr };
  });

  const results = await Promise.all(jobs);
  stats.gatherMs = performance.now() - t0;
  // From here to render() nothing awaits, so no held picture can be closed under our feet.
  const temporary: VideoFrame[] = [];
  for (const result of results) {
    if (!result) continue;
    if ('itemId' in result) {
      const picture = lastFrames.get(result.itemId);
      if (!picture) continue;
      const frame = picture.toVideoFrame();
      temporary.push(frame);
      layerDraws.push({
        source: frame,
        geometry: result.geometry,
        opacity: result.opacity,
        hdr: result.hdr,
      });
    } else {
      layerDraws.push(result);
    }
  }
  const t1 = performance.now();
  renderer.render(layerDraws, backgroundColor(p));
  stats.drawMs = performance.now() - t1;
  stats.lastRendered = t;
  stats.lastLayers = layerDraws.length;
  for (const frame of temporary) frame.close();
  if (late && counting) {
    stats.late++;
    if (stats.lateAt.length < 10) stats.lateAt.push(`late ${(t / FLICKS_PER_SECOND).toFixed(2)}`);
  }
  stats.openFrames = lastFrames.size;
  stats.decoders = pool.size;
  return pendingRequests;
}

/**
 * Gives back the decoder and held frame of clips that are neither on screen nor about to be (more
 * than 2 s away from the playhead): on a phone, idle decoders and 4K frames are wasted GPU memory.
 */
function releaseIdle(t: Time): void {
  if (!project) return;
  const keep = new Set(
    upcomingVideoItems(
      project,
      Math.max(0, t - fromSeconds(2)),
      fromSeconds(2 + PREFETCH_S + 2),
    ).map((i) => i.id),
  );
  for (const [id, source] of sources) {
    if (keep.has(id)) continue;
    source.releaseDecoder();
    lastFrames.get(id)?.close();
    lastFrames.delete(id);
  }
}

/** Warm up decoders for clips that start soon (so the first frame is ready at the cut). */
function prefetch(t: Time): void {
  if (!project) return;
  for (const item of upcomingVideoItems(project, t, fromSeconds(PREFETCH_S))) {
    if (item.start <= t || sources.has(item.id)) continue;
    if (item.kind !== 'video' && item.kind !== 'freeze') continue;
    const first = item.kind === 'video' ? item.sourceIn : item.sourceTime;
    void sourceFor(item.id, item.assetId).then(async (found) => {
      const sample = await found?.source.frameAt(first / FLICKS_PER_SECOND);
      if (sample) {
        lastFrames.get(item.id)?.close();
        lastFrames.set(item.id, sample);
      }
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
  if (busy) return pausedLoop ?? Promise.resolve();
  busy = true;
  pausedLoop = pausedPreview().finally(() => {
    pausedLoop = null;
  });
  return pausedLoop;
}

async function pausedPreview(): Promise<void> {
  try {
    while (wantedTime !== null && !playing) {
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
        if (wantedTime !== null || playing) break;
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

// ── messages ─────────────────────────────────────────────────────────────

async function handle(request: EngineRequest): Promise<EngineResponseData> {
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
        playheadAt = currentTime();
        playing = false;
        audioOut?.stop();
        void showAt(playheadAt);
        emitTime(playheadAt);
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
    case 'stats':
      return {
        type: 'stats',
        stats: { ...stats, underruns: audioOut?.underruns ?? 0, audio: audioOut !== null },
      };
  }
}

self.onmessage = (event: MessageEvent<{ id: number; request: EngineRequest }>) => {
  const { id, request } = event.data;
  handle(request).then(
    (data) => post({ id, ok: true, data }),
    (error: unknown) =>
      post({ id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
};
