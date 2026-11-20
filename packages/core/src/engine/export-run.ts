import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BufferSource,
  BufferTarget,
  Input,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  StreamTarget,
  WavOutputFormat,
  WebMOutputFormat,
  type StreamTargetChunk,
  type VideoCodec,
} from 'mediabunny';
import type { AudioTrackSource } from '../audio/mixer';
import { Mixer } from '../audio/mixer';
import { projectDuration } from '../model/project';
import type { Project } from '../model/schema';
import { FLICKS_PER_SECOND } from '../model/time';
import type { Renderer } from '../render/types';
import { Composer, isTransparentBackground, type MediaLibrary } from './compose';
import {
  audioFramesFor,
  exportAudioBitrate,
  exportBitrate,
  EXPORT_SAMPLE_RATE,
  exportFrameCount,
  exportFrameTime,
  exportKeepsTransparency,
  exportSize,
  exportVideoCodecs,
  resolveExportRange,
  type AudioExportOptions,
  type AudioExportResult,
  type ExportOptions,
  type ExportProgress,
  type ExportRange,
  type ExportResult,
} from './export-plan';
import { DecoderPool } from './frames';
import { upcomingVideo } from './timeline';

/**
 * Offline export in the engine worker: every frame is composed exactly (waiting for each decoded
 * frame — never "late"), encoded with WebCodecs through Mediabunny with encoder backpressure, and
 * streamed to an OPFS file (constant memory) or, where OPFS is missing, to memory. Audio comes
 * from the same mixer as preview, at 48 kHz stereo, interleaved with the video frame by frame and
 * trimmed to the video's exact length.
 */

const OPFS_PREFIX = 'video-ultra-export-';
const AUDIO_BLOCK = 4096;
const PROGRESS_MS = 250;
/** Keep decoders of clips needed within this window (flicks); release the rest. */
const RELEASE_AHEAD = 2 * FLICKS_PER_SECOND;

interface SyncAccessHandle {
  write(data: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

/** Thrown when the export was cancelled. */
export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'AbortError';
  }
}

interface OpfsTarget {
  writable: WritableStream<StreamTargetChunk>;
  file: () => Promise<File>;
  remove: () => Promise<void>;
}

/** Deletes earlier exports (each one is kept only until the next export starts). */
async function removeOldExports(root: FileSystemDirectoryHandle): Promise<void> {
  const names: string[] = [];
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (name.startsWith(OPFS_PREFIX)) names.push(name);
  }
  for (const name of names) await root.removeEntry(name).catch(() => undefined);
}

/**
 * Startup tidy: deletes export files older than `maxAgeMs` (a page that exported and was closed
 * never deletes its file otherwise). Recent ones stay — another open tab may still be offering
 * its file for download; the next export removes those anyway.
 */
export async function cleanStaleExports(maxAgeMs = 60 * 60 * 1000): Promise<number> {
  let removed = 0;
  try {
    const root = await navigator.storage.getDirectory();
    const now = Date.now();
    for await (const [name, handle] of (
      root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
    ).entries()) {
      if (!name.startsWith(OPFS_PREFIX) || handle.kind !== 'file') continue;
      const file = await (handle as FileSystemFileHandle).getFile().catch(() => null);
      if (file && now - file.lastModified > maxAgeMs) {
        await root.removeEntry(name).catch(() => undefined);
        removed++;
      }
    }
  } catch {
    /* no OPFS here: nothing to tidy */
  }
  return removed;
}

async function opfsTarget(name: string): Promise<OpfsTarget | null> {
  try {
    const root = await navigator.storage.getDirectory();
    await removeOldExports(root);
    const handle = await root.getFileHandle(name, { create: true });
    const access = await (
      handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> }
    ).createSyncAccessHandle();
    access.truncate(0);
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      access.flush();
      access.close();
    };
    return {
      writable: new WritableStream<StreamTargetChunk>({
        write(chunk) {
          access.write(chunk.data, { at: chunk.position });
        },
        close,
        abort: close,
      }),
      file: () => handle.getFile(),
      remove: async () => {
        close();
        await root.removeEntry(name).catch(() => undefined);
      },
    };
  } catch {
    return null; // Safari Private Browsing, some webviews, Playwright's WebKit
  }
}

/**
 * Append-only fallback (fragmented MP4) into Blob parts: browsers can keep large Blobs on disk, so
 * memory stays bounded better than one growing buffer.
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

/** Where an export's bytes go: an OPFS file (streamed to disk) or, as a fallback, memory. */
interface ExportSink {
  target: StreamTarget | BufferTarget;
  storage: 'opfs' | 'memory';
  /** Memory MP4 is written append-only, so it must be fragmented. */
  fragmented: boolean;
  /** The finished file, typed `mimeType`. */
  blob(mimeType: string): Promise<Blob>;
  /** Deletes a partial file (cancel / failure). */
  remove(): Promise<void>;
}

/**
 * Opens the target for one export file (`extension` names it). MP4 / M4A without OPFS go to Blob
 * parts as fragmented MP4 (bounded memory); WebM / Ogg / WAV without OPFS go to one buffer.
 */
async function exportSink(extension: string): Promise<ExportSink> {
  const opfs = await opfsTarget(`${OPFS_PREFIX}${Date.now().toString(36)}.${extension}`);
  const typed = (blob: Blob, mimeType: string) =>
    blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  if (opfs) {
    return {
      target: new StreamTarget(opfs.writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
      storage: 'opfs',
      fragmented: false,
      blob: async (mimeType) => typed(await opfs.file(), mimeType),
      remove: () => opfs.remove(),
    };
  }
  if (extension === 'mp4' || extension === 'm4a') {
    const memory = blobWritable();
    return {
      target: new StreamTarget(memory.writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
      storage: 'memory',
      fragmented: true,
      blob: async (mimeType) => typed(memory.result(), mimeType),
      remove: async () => undefined,
    };
  }
  const buffer = new BufferTarget();
  return {
    target: buffer,
    storage: 'memory',
    fragmented: false,
    blob: async (mimeType) => new Blob([buffer.buffer!], { type: mimeType }),
    remove: async () => undefined,
  };
}

let aacFallbackRegistered = false;
/** No native AAC encoder (Firefox): load the WASM one, only now (DECISIONS #28). */
async function ensureAacEncoder(): Promise<void> {
  if (aacFallbackRegistered || (await canEncodeAudio('aac'))) return;
  const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
  registerAacEncoder();
  aacFallbackRegistered = true;
}

/** Container the delay is measured in (players treat priming per container). */
type DelayContainer = 'mp4' | 'webm' | 'ogg';
const delays = new Map<string, Promise<number>>();
/** Details of the last delay measurement (for the export check). */
export let lastDelayProbe: { codec: string; found: number; firstTimestamp: number } | null = null;

/**
 * Encoder delay (priming samples) of this browser's `codec` encoder. AAC encoders put 1024–2112
 * samples of priming before the sound and Opus ~312 (pre-skip); the muxer writes no edit list,
 * so players would play the sound that much late. Measured once per session by encoding a tone
 * that starts at a known sample and decoding it back (~50 ms); falls back to typical values.
 */
export function encoderDelay(
  codec: 'aac' | 'opus',
  container: DelayContainer = codec === 'aac' ? 'mp4' : 'webm',
): Promise<number> {
  const key = `${codec}-${container}`;
  let pending = delays.get(key);
  if (!pending) {
    pending = measureDelay(codec, container).catch(() =>
      codec === 'opus' ? 312 : aacFallbackRegistered ? 1024 : 2112,
    );
    delays.set(key, pending);
  }
  return pending;
}

async function measureDelay(codec: 'aac' | 'opus', container: DelayContainer): Promise<number> {
  const rate = EXPORT_SAMPLE_RATE;
  const onset = 4800;
  const frames = 14400;
  const target = new BufferTarget();
  const output = new Output({
    format:
      container === 'mp4'
        ? new Mp4OutputFormat()
        : container === 'ogg'
          ? new OggOutputFormat()
          : new WebMOutputFormat(),
    target,
  });
  const source = new AudioSampleSource({ codec, quality: QUALITY_MEDIUM });
  output.addAudioTrack(source);
  await output.start();
  const data = new Float32Array(frames * 2);
  for (let i = onset; i < frames; i++) {
    const v = 0.8 * Math.sin((2 * Math.PI * 1000 * (i - onset)) / rate);
    data[i] = v;
    data[frames + i] = v;
  }
  const sample = new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: 2,
    sampleRate: rate,
    timestamp: 0,
  });
  await source.add(sample);
  sample.close();
  source.close();
  await output.finalize();
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(target.buffer!) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error('cannot decode');
    let position = -1;
    let found = -1;
    let firstTimestamp = 0;
    for await (const decoded of new AudioSampleSink(track).samples()) {
      try {
        if (found >= 0) continue;
        // Count decoded samples from the file's start, ignoring timestamps: players that don't
        // know the encoder's priming play every decoded sample from 0.
        if (position < 0) {
          firstTimestamp = decoded.timestamp;
          position = 0;
        }
        const plane = new Float32Array(decoded.numberOfFrames);
        decoded.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
        for (let i = 0; i < plane.length; i++) {
          if (Math.abs(plane[i]!) > 0.25) {
            found = position + i;
            break;
          }
        }
        position += decoded.numberOfFrames;
      } finally {
        decoded.close();
      }
    }
    if (found < 0) throw new Error('tone not found');
    lastDelayProbe = { codec, found, firstTimestamp };
    // The tone's first peak above 0.25 comes ~2 samples after its start at 1 kHz.
    return Math.max(0, Math.min(4096, found - onset - 2));
  } finally {
    input.dispose();
  }
}

/** What the export needs from the engine worker. */
export interface ExportDeps {
  project: Project;
  media: MediaLibrary;
  audioOf: (assetId: string) => AudioTrackSource | null;
  /**
   * A renderer drawing into a `width × height` canvas, for the export's length (the engine lends
   * its warm work renderer). `alpha`: a see-through canvas (a transparent background exported as
   * WebM, #196). `release(ok)` gives it back; `ok` false: something failed, drop it.
   */
  renderer: (
    width: number,
    height: number,
    alpha: boolean,
  ) => Promise<{ canvas: OffscreenCanvas; renderer: Renderer; release: (ok: boolean) => void }>;
  decoderBudget: number;
  rasterBudget: number;
  isCancelled: () => boolean;
  onProgress: (progress: ExportProgress) => void;
  /** Counts VideoFrames made for encoding (leak check): +1 / −1. */
  onFrameCount?: (delta: number) => void;
}

/** Export timing details for the bench (beyond the public result). */
export interface ExportRunStats {
  backend: string;
  composeMs: number;
  encodeWaitMs: number;
  audioMs: number;
  missingLayers: number;
  /** Encoder priming compensated (samples at 48 kHz). */
  audioDelaySamples: number;
}

/** The exported span of the timeline, or a plain-language error when it's empty. */
function exportSpan(range: ExportRange | undefined, duration: number): ExportRange {
  const span = resolveExportRange(range, duration);
  if (!span)
    throw new Error('The chosen part of the video is empty — set its start before its end.');
  return span;
}

/** Some clip in `span` (default: anywhere) plays sound the mixer can read. */
function hasSound(project: Project, audioOf: ExportDeps['audioOf'], span?: ExportRange): boolean {
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const item of track.items) {
      if (item.kind !== 'video' && item.kind !== 'audio') continue;
      if (item.muted || item.volume === 0) continue;
      // A second of slack: sound crossfades under transitions run past a clip's edges (#113).
      if (
        span &&
        (item.start >= span.end + FLICKS_PER_SECOND ||
          item.start + item.duration <= span.start - FLICKS_PER_SECOND)
      )
        continue;
      if (audioOf(item.assetId)) return true;
      // A combined clip: some sound inside it the mixer can read (#155).
      const asset = project.assets[item.assetId];
      if (
        asset?.kind === 'compound' &&
        asset.hasAudio &&
        compoundSound(project, asset.id, audioOf, 0)
      )
        return true;
    }
  }
  return false;
}

/** Whether combined clip `assetId` holds sound the mixer can read (through ones inside it). */
function compoundSound(
  project: Project,
  assetId: string,
  audioOf: ExportDeps['audioOf'],
  depth: number,
): boolean {
  const asset = project.assets[assetId];
  if (!asset?.tracks || depth > 4) return false;
  return asset.tracks.some(
    (t) =>
      !t.muted &&
      t.items.some((i) => {
        if (i.kind !== 'video' && i.kind !== 'audio') return false;
        if (i.muted || i.volume === 0) return false;
        if (audioOf(i.assetId)) return true;
        return project.assets[i.assetId]?.kind === 'compound'
          ? compoundSound(project, i.assetId, audioOf, depth + 1)
          : false;
      }),
  );
}

/**
 * Stops an output that won't be finished (cancel or failure) without an encoder error: each
 * source is closed gently first — the encoder finishes the samples it already has, then closes —
 * and only then is the output cancelled. Cancelling straight away force-closes encoders with
 * encodes in flight, which WebKit reports as "AudioEncoder encode failed" (BACKLOG). A source
 * whose encoder already failed still closes (the close always releases it); errors are ignored,
 * the export is being thrown away.
 */
async function abandon(
  output: Output,
  sources: readonly (CanvasSource | AudioSampleSource | null)[],
): Promise<void> {
  if (output.state === 'finalized' || output.state === 'canceled') return;
  if (output.state === 'started') {
    for (const source of sources) {
      try {
        source?.close();
      } catch {
        /* not connected / already closing */
      }
    }
  }
  // cancel() waits for the gentle closes above (it reuses an ongoing close) before releasing
  // the target.
  await output.cancel().catch(() => undefined);
}

/** Runs one export. Throws {@link ExportCancelled} when cancelled (the partial file is deleted). */
export async function runExport(
  deps: ExportDeps,
  options: ExportOptions,
): Promise<{ result: ExportResult; stats: ExportRunStats }> {
  const { project } = deps;
  const started = performance.now();
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('The project is empty — add a clip before exporting.');
  const span = exportSpan(options.range, duration);
  const { fps, format } = options;
  const { width, height } = exportSize(
    project.settings.width,
    project.settings.height,
    options.height,
  );
  const framesTotal = exportFrameCount(span.end - span.start, fps);
  const warnings: string[] = [];
  // The encoder's own presets differ a lot between browsers; probing with them is fine, the
  // real encode uses an explicit bitrate (exportBitrate).
  const quality =
    options.quality === 'low'
      ? QUALITY_LOW
      : options.quality === 'medium'
        ? QUALITY_MEDIUM
        : QUALITY_HIGH;

  // Codecs.
  // WebM: VP9 everywhere except Firefox, whose VP9 encoder is software-only and slower than real
  // time (0.70× at 720p) — VP8 there is 3.7× faster (2.6×) for a somewhat larger file
  // (DECISIONS #111). Measured with scripts/export-check.ts.
  const firefox = /firefox/i.test(globalThis.navigator?.userAgent ?? '');
  const asked = options.videoCodec ?? 'auto';
  // A transparent background stays see-through in WebM (VP9 / VP8 alpha, DECISIONS #196); the
  // colour / alpha split runs in mediabunny's own small worker, so it needs nested workers.
  let alpha = exportKeepsTransparency(isTransparentBackground(project), format);
  if (alpha && typeof Worker === 'undefined') {
    alpha = false;
    warnings.push(
      "This browser can't make see-through video here, so the transparent background is black.",
    );
  }
  if (alpha && asked === 'av1') {
    warnings.push(
      'AV1 can’t keep the background see-through, so this WebM file uses VP9 / VP8 instead.',
    );
  }
  const candidates: VideoCodec[] = exportVideoCodecs(format, asked, firefox, alpha);
  let videoCodec: VideoCodec | null = null;
  for (const codec of candidates) {
    if (await canEncodeVideo(codec, { width, height, frameRate: fps, quality })) {
      videoCodec = codec;
      break;
    }
  }
  if (!videoCodec) {
    const name =
      asked === 'hevc'
        ? 'HEVC'
        : asked === 'av1'
          ? 'AV1'
          : format === 'mp4'
            ? 'MP4 (H.264)'
            : 'WebM';
    throw new Error(
      `This browser can't encode ${name} video at ${width}×${height}. Try a lower resolution${asked === 'hevc' || asked === 'av1' ? ' or H.264' : format === 'mp4' ? ' or WebM' : ' or MP4'}.`,
    );
  }
  let audioCodec: 'aac' | 'opus' | null = null;
  if (hasSound(project, deps.audioOf, span)) {
    if (format === 'mp4') {
      await ensureAacEncoder();
      audioCodec = 'aac';
    } else if (await canEncodeAudio('opus')) {
      audioCodec = 'opus';
    } else {
      warnings.push(
        'This browser has no Opus encoder, so the WebM file has no sound. Export MP4 to keep the sound.',
      );
    }
  }

  // Target: OPFS (streamed to disk) or memory.
  const sink = await exportSink(format);
  const output = new Output({
    format:
      format === 'mp4'
        ? new Mp4OutputFormat(sink.fragmented ? { fastStart: 'fragmented' } : {})
        : new WebMOutputFormat(),
    target: sink.target,
  });

  const lease = await deps.renderer(width, height, alpha);
  const { canvas, renderer } = lease;
  let leaseOk = false;
  const pool = new DecoderPool(deps.decoderBudget);
  const composer = new Composer(renderer, pool, deps.media, true, deps.rasterBudget, false);
  composer.keepTransparency = alpha;
  const stats: ExportRunStats = {
    backend: renderer.backend,
    composeMs: 0,
    encodeWaitMs: 0,
    audioMs: 0,
    missingLayers: 0,
    audioDelaySamples: 0,
  };
  const videoSource = new CanvasSource(canvas, {
    codec: videoCodec,
    bitrate: exportBitrate(
      width,
      height,
      fps,
      options.quality,
      videoCodec === 'vp9' || videoCodec === 'vp8' || videoCodec === 'hevc' || videoCodec === 'av1'
        ? videoCodec
        : 'avc',
    ),
    keyFrameInterval: 2,
    latencyMode: 'quality',
    // See-through: mediabunny splits each frame into colour + alpha (its worker, on the CPU) and
    // encodes the alpha as a second VP9 / VP8 stream, written as WebM alpha side data.
    alpha: alpha ? 'keep' : 'discard',
  });
  output.addVideoTrack(videoSource, { frameRate: fps, canBeTransparent: alpha });
  let audioSource: AudioSampleSource | null = null;
  if (audioCodec) {
    audioSource = new AudioSampleSource({
      codec: audioCodec,
      bitrate: exportAudioBitrate(options.quality),
    });
    output.addAudioTrack(audioSource);
  }
  const mixer = audioSource ? new Mixer(EXPORT_SAMPLE_RATE, deps.audioOf) : null;
  // Compensate the encoder's priming: feed the timeline from sample `delay`, so decoded sample k
  // is timeline sample k (lip sync) and the decoded length matches the video.
  const delay = audioCodec ? await encoderDelay(audioCodec) : 0;
  stats.audioDelaySamples = delay;
  let audioWritten = 0;
  const flicksPerSample = FLICKS_PER_SECOND / EXPORT_SAMPLE_RATE; // 14 700, exact

  const writeAudio = async (until: number) => {
    if (!audioSource || !mixer) return;
    const a0 = performance.now();
    while (audioWritten < until) {
      const frames = Math.min(AUDIO_BLOCK, until - audioWritten);
      const data = new Float32Array(frames * 2);
      const left = data.subarray(0, frames);
      const right = data.subarray(frames);
      await mixer.render(
        project,
        span.start + (audioWritten + delay) * flicksPerSample,
        frames,
        left,
        right,
      );
      const sample = new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: 2,
        sampleRate: EXPORT_SAMPLE_RATE,
        timestamp: audioWritten / EXPORT_SAMPLE_RATE,
      });
      try {
        await audioSource.add(sample);
      } finally {
        sample.close();
      }
      audioWritten += frames;
    }
    stats.audioMs += performance.now() - a0;
  };

  const keep = new Set<string>();
  let lastProgress = 0;
  const report = (framesDone: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastProgress < PROGRESS_MS) return;
    lastProgress = now;
    const elapsed = (now - started) / 1000;
    const fraction = framesDone / framesTotal;
    deps.onProgress({
      fraction,
      framesDone,
      framesTotal,
      etaSeconds:
        framesDone >= 10 && fraction > 0
          ? Math.max(0, (elapsed / fraction) * (1 - fraction))
          : null,
    });
  };

  try {
    await output.start();
    report(0, true);
    for (let i = 0; i < framesTotal; i++) {
      if (deps.isCancelled()) throw new ExportCancelled();
      const t = span.start + exportFrameTime(i, fps);
      // Clips that are done give back their decoder and last frame (memory stays flat).
      if (i % 15 === 0) {
        keep.clear();
        for (const u of upcomingVideo(project, t, RELEASE_AHEAD)) keep.add(u.item.id);
        composer.releaseExcept(keep);
      }
      const c0 = performance.now();
      const composed = await composer.render(project, t, width, height, null);
      stats.composeMs += performance.now() - c0;
      stats.missingLayers += composed.missing;
      const e0 = performance.now();
      // Captures the canvas as a frame, encodes it; resolves when the encoder has room again.
      deps.onFrameCount?.(1);
      try {
        await videoSource.add(i / fps, 1 / fps);
      } finally {
        deps.onFrameCount?.(-1);
      }
      stats.encodeWaitMs += performance.now() - e0;
      // Interleave: the sound up to the end of this frame (trimmed to the video's length).
      await writeAudio(Math.max(0, audioFramesFor(i + 1, fps) - delay));
      report(i + 1);
    }
    videoSource.close();
    audioSource?.close();
    if (deps.isCancelled()) throw new ExportCancelled();
    await output.finalize();
    leaseOk = true;
  } catch (error) {
    // A cancel leaves the renderer healthy.
    leaseOk = error instanceof ExportCancelled;
    await abandon(output, [videoSource, audioSource]);
    await sink.remove();
    throw error;
  } finally {
    composer.destroy();
    mixer?.dispose();
    lease.release(leaseOk);
  }
  report(framesTotal, true);

  const mimeType = format === 'mp4' ? 'video/mp4' : 'video/webm';
  const blob = await sink.blob(mimeType);
  return {
    result: {
      blob,
      mimeType,
      extension: format,
      width,
      height,
      durationSeconds: framesTotal / fps,
      storage: sink.storage,
      frames: framesTotal,
      videoCodec,
      audioCodec,
      elapsedSeconds: (performance.now() - started) / 1000,
      transparent: alpha,
      warnings,
    },
    stats,
  };
}

/** What a sound-only export needs from the engine worker. */
export type AudioExportDeps = Pick<
  ExportDeps,
  'project' | 'audioOf' | 'isCancelled' | 'onProgress'
>;

/** Container codec and file type of each sound-only format. */
const AUDIO_FORMATS = {
  m4a: { codec: 'aac', mimeType: 'audio/mp4' },
  ogg: { codec: 'opus', mimeType: 'audio/ogg' },
  wav: { codec: 'pcm-s16', mimeType: 'audio/wav' },
} as const;

/**
 * Exports only the sound: the same mixer at 48 kHz stereo, with the encoder's priming compensated
 * exactly as in a video export, so the file lines up with (and sounds like) the video export's
 * track. AAC in M4A, Opus in Ogg, or 16-bit PCM WAV (lossless, no encoder needed). Streamed to
 * OPFS like video. Throws {@link ExportCancelled} when cancelled (the partial file is deleted).
 */
export async function runAudioExport(
  deps: AudioExportDeps,
  options: AudioExportOptions,
): Promise<{ result: AudioExportResult; stats: { audioMs: number; audioDelaySamples: number } }> {
  const { project } = deps;
  const started = performance.now();
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('The project is empty — add a clip before exporting.');
  const span = exportSpan(options.range, duration);
  if (!hasSound(project, deps.audioOf, span))
    throw new Error('There is no sound in this part of the video to export.');
  const { codec, mimeType } = AUDIO_FORMATS[options.format];
  if (codec === 'aac') await ensureAacEncoder();
  else if (codec === 'opus' && !(await canEncodeAudio('opus')))
    throw new Error("This browser can't encode Opus sound. Choose M4A or WAV instead.");

  const sink = await exportSink(options.format);
  const output = new Output({
    format:
      options.format === 'm4a'
        ? new Mp4OutputFormat(sink.fragmented ? { fastStart: 'fragmented' } : {})
        : options.format === 'ogg'
          ? new OggOutputFormat()
          : new WavOutputFormat(),
    target: sink.target,
  });
  const source = new AudioSampleSource(
    codec === 'pcm-s16' ? { codec } : { codec, bitrate: exportAudioBitrate(options.quality) },
  );
  output.addAudioTrack(source);
  const mixer = new Mixer(EXPORT_SAMPLE_RATE, deps.audioOf);
  const delay =
    codec === 'aac'
      ? await encoderDelay('aac', 'mp4')
      : codec === 'opus'
        ? await encoderDelay('opus', 'ogg')
        : 0;
  const flicksPerSample = FLICKS_PER_SECOND / EXPORT_SAMPLE_RATE; // 14 700, exact
  const total = Math.max(1, Math.round((span.end - span.start) / flicksPerSample));
  // Decoded = priming + what is written, so writing `total − delay` decodes to exactly `total`.
  const toWrite = Math.max(0, total - delay);
  const blocks = Math.max(1, Math.ceil(toWrite / AUDIO_BLOCK));
  let written = 0;
  let lastProgress = 0;
  let audioMs = 0;
  try {
    await output.start();
    while (written < toWrite) {
      if (deps.isCancelled()) throw new ExportCancelled();
      const frames = Math.min(AUDIO_BLOCK, toWrite - written);
      // A fresh block each time: the encoder may still read the previous one (32 KB, not per frame).
      const data = new Float32Array(frames * 2);
      const a0 = performance.now();
      await mixer.render(
        project,
        span.start + (written + delay) * flicksPerSample,
        frames,
        data.subarray(0, frames),
        data.subarray(frames),
      );
      const sample = new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: 2,
        sampleRate: EXPORT_SAMPLE_RATE,
        timestamp: written / EXPORT_SAMPLE_RATE,
      });
      try {
        await source.add(sample);
      } finally {
        sample.close();
      }
      audioMs += performance.now() - a0;
      written += frames;
      const now = performance.now();
      if (now - lastProgress >= PROGRESS_MS) {
        lastProgress = now;
        const fraction = written / Math.max(1, toWrite);
        const elapsed = (now - started) / 1000;
        deps.onProgress({
          fraction,
          framesDone: Math.ceil(written / AUDIO_BLOCK),
          framesTotal: blocks,
          etaSeconds: fraction > 0.02 ? Math.max(0, (elapsed / fraction) * (1 - fraction)) : null,
        });
      }
    }
    source.close();
    if (deps.isCancelled()) throw new ExportCancelled();
    await output.finalize();
  } catch (error) {
    await abandon(output, [source]);
    await sink.remove();
    throw error;
  } finally {
    mixer.dispose();
  }
  deps.onProgress({ fraction: 1, framesDone: blocks, framesTotal: blocks, etaSeconds: 0 });
  return {
    result: {
      blob: await sink.blob(mimeType),
      mimeType,
      extension: options.format,
      codec,
      sampleRate: EXPORT_SAMPLE_RATE,
      channels: 2,
      durationSeconds: total / EXPORT_SAMPLE_RATE,
      storage: sink.storage,
      elapsedSeconds: (performance.now() - started) / 1000,
      warnings: [],
    },
    stats: { audioMs, audioDelaySamples: delay },
  };
}

/**
 * Encodes a rendered frame as a PNG or JPEG file (in the worker: OffscreenCanvas 2D +
 * `convertToBlob`). Closes `bitmap`.
 */
export async function encodeFrameImage(
  bitmap: ImageBitmap,
  format: 'png' | 'jpeg',
  quality = 0.92,
): Promise<Blob> {
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("This browser can't make pictures in the background.");
    ctx.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob(
      format === 'png'
        ? { type: 'image/png' }
        : { type: 'image/jpeg', quality: Math.max(0, Math.min(1, quality)) },
    );
  } finally {
    bitmap.close();
  }
}
