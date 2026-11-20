import type { DeviceTier } from '../capabilities';
import { FLICKS_PER_SECOND, type Time } from '../model/time';

/** Output resolutions offered, named by the output's **shorter side** in pixels. */
export type ExportHeight = 480 | 720 | 1080 | 1440 | 2160;

/** All export heights, smallest first. */
export const EXPORT_HEIGHTS: readonly ExportHeight[] = Object.freeze([480, 720, 1080, 1440, 2160]);

/** What to export. */
export interface ExportOptions {
  /** `mp4` = H.264 + AAC (plays everywhere); `webm` = VP9 (or VP8) + Opus. */
  format: 'mp4' | 'webm';
  /**
   * The output's **shorter side** in pixels (720 = 720 × 1280 for a 9:16 project, 1280 × 720 for
   * 16:9). The longer side follows the project's aspect ratio, rounded to even pixels.
   */
  height: ExportHeight;
  fps: 24 | 30 | 60;
  quality: 'low' | 'medium' | 'high';
  /**
   * The video codec (v0.4): `auto` (default — H.264 for MP4, VP9 / VP8 for WebM), or a newer one
   * for a smaller file where this device can encode it ({@link ExportLimits}): `hevc` (H.265,
   * MP4) or `av1` (MP4 or WebM); `h264` / `vp9` ask for the default one by name.
   */
  videoCodec?: ExportVideoCodec;
  /**
   * Export only this part of the timeline (flicks, `start` inclusive, `end` exclusive). Omitted:
   * the whole video. Clamped to the video's length; transitions, animations and sound at the
   * edges are exactly what plays at those times.
   */
  range?: ExportRange;
}

/** Video codecs an export can ask for (see {@link ExportOptions.videoCodec}). */
export type ExportVideoCodec = 'auto' | 'h264' | 'hevc' | 'av1' | 'vp9';

/** A part of the timeline, in flicks: from `start` up to (not including) `end`. */
export interface ExportRange {
  start: Time;
  end: Time;
}

/** Export progress, reported about 4 times a second. */
export interface ExportProgress {
  /** 0…1 */
  fraction: number;
  framesDone: number;
  framesTotal: number;
  /** Estimated seconds left, once a few frames have been measured. */
  etaSeconds: number | null;
}

/** A finished export. */
export interface ExportResult {
  /**
   * The video file. With `storage: 'opfs'` it is backed by a file in the origin-private file
   * system and stays readable until the next export starts (which deletes it).
   */
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  width: number;
  height: number;
  durationSeconds: number;
  /** Where the file was written while exporting: on disk (OPFS) or, as a fallback, in memory. */
  storage: 'opfs' | 'memory';
  /** Frames written. */
  frames: number;
  /** Codecs used, e.g. `avc` + `aac`; audio null when the project has no sound. */
  videoCodec: string;
  audioCodec: string | null;
  /** Wall time of the export, seconds. */
  elapsedSeconds: number;
  /**
   * The file is see-through where the project's background is transparent (WebM with VP9 / VP8
   * alpha). False for every other export, including MP4 of a transparent project (black there).
   */
  transparent: boolean;
  /** Things the user should know (e.g. no Opus encoder → video without sound). */
  warnings: string[];
}

/** Sound-only export formats: AAC in `.m4a`, Opus in `.ogg`, or uncompressed 16-bit `.wav`. */
export type AudioExportFormat = 'm4a' | 'ogg' | 'wav';

/** What to export when exporting only the sound (the same mix as a video export). */
export interface AudioExportOptions {
  format: AudioExportFormat;
  /** Sets the bitrate of AAC / Opus (96 / 128 / 192 kb/s); WAV is always lossless. */
  quality: ExportOptions['quality'];
  /** Export only this part of the timeline; omitted = the whole video. */
  range?: ExportRange;
}

/** A finished sound-only export (48 kHz stereo). */
export interface AudioExportResult {
  /** The sound file (OPFS-backed like video exports, or in memory as a fallback). */
  blob: Blob;
  mimeType: string;
  extension: AudioExportFormat;
  /** `aac`, `opus` or `pcm-s16`. */
  codec: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  storage: 'opfs' | 'memory';
  /** Wall time of the export, seconds. */
  elapsedSeconds: number;
  warnings: string[];
}

/** Still-image formats for saving a frame. */
export type FrameImageFormat = 'png' | 'jpeg';

/** Options for saving one frame of the video as a picture. */
export interface FrameImageOptions {
  format: FrameImageFormat;
  /** JPEG quality 0…1 (default 0.92). Ignored for PNG. */
  quality?: number;
  /**
   * The picture's shorter side in pixels; omitted = the project's own size (its canvas, e.g.
   * 1080 × 1920). The longer side follows the project's aspect ratio.
   */
  height?: number;
}

/** One frame saved as a picture, drawn by the same compositor as the export. */
export interface FrameImage {
  blob: Blob;
  mimeType: string;
  extension: 'png' | 'jpg';
  width: number;
  height: number;
}

/** A ready-made export setting for a common destination. */
export interface ExportPreset {
  /** Stable id: `vertical`, `widescreen` or `square`. */
  id: 'vertical' | 'widescreen' | 'square';
  /** The frame shape it is made for (`9:16`, `16:9`, `1:1`) as a canvas size. */
  aspect: { width: number; height: number };
  /** Shorter side in pixels. */
  height: ExportHeight;
  /** Frame rate; `null` keeps the project's own (24, 30 or 60). */
  fps: ExportOptions['fps'] | null;
  format: ExportOptions['format'];
  quality: ExportOptions['quality'];
}

/**
 * Ready-made export settings: vertical 9:16, widescreen 16:9 and square 1:1, all 1080p MP4. A
 * preset doesn't reshape the picture: when the project's frame shape differs, the editor offers
 * to change the canvas (an undoable edit) and otherwise exports the project's own shape.
 */
export const EXPORT_PRESETS: readonly ExportPreset[] = Object.freeze([
  {
    id: 'vertical',
    aspect: { width: 1080, height: 1920 },
    height: 1080,
    fps: 30,
    format: 'mp4',
    quality: 'medium',
  },
  {
    id: 'widescreen',
    aspect: { width: 1920, height: 1080 },
    height: 1080,
    fps: null,
    format: 'mp4',
    quality: 'medium',
  },
  {
    id: 'square',
    aspect: { width: 1080, height: 1080 },
    height: 1080,
    fps: 30,
    format: 'mp4',
    quality: 'medium',
  },
]);

/** True when a project of `width × height` already has the preset's frame shape (within 1%). */
export function presetFits(preset: ExportPreset, width: number, height: number): boolean {
  return (
    Math.abs(preset.aspect.width / preset.aspect.height - width / height) < 0.01 * (width / height)
  );
}

/**
 * The part of a `duration`-long timeline an export covers: `range` clamped to the timeline, or
 * all of it. Returns `null` when the range is empty after clamping.
 */
export function resolveExportRange(
  range: ExportRange | undefined | null,
  duration: Time,
): ExportRange | null {
  if (duration <= 0) return null;
  if (!range) return { start: 0, end: duration };
  const start = Math.max(0, Math.min(Math.round(range.start), duration));
  const end = Math.max(0, Math.min(Math.round(range.end), duration));
  return end > start ? { start, end } : null;
}

/** Video codecs the export tries, in mediabunny's names. */
export type ExportCodecName = 'avc' | 'hevc' | 'av1' | 'vp9' | 'vp8';

/**
 * Whether an export keeps a transparent background see-through (DECISIONS #196): only WebM can
 * (VP9 / VP8 with alpha); MP4 (H.264 / HEVC / AV1) has no alpha and shows black there.
 */
export function exportKeepsTransparency(
  transparentBackground: boolean,
  format: ExportOptions['format'],
): boolean {
  return transparentBackground && format === 'webm';
}

/**
 * The video codecs an export tries, best first. WebM is VP9 (VP8 first on Firefox, whose VP9
 * encoder is slower than real time, DECISIONS #111). A see-through export (`alpha`) is always
 * VP9 / VP8 — the codecs whose alpha WebM carries and browsers play — even when AV1 was asked.
 */
export function exportVideoCodecs(
  format: ExportOptions['format'],
  asked: ExportVideoCodec,
  firefox: boolean,
  alpha = false,
): ExportCodecName[] {
  const webm: ExportCodecName[] = firefox ? ['vp8', 'vp9'] : ['vp9', 'vp8'];
  if (alpha && format === 'webm') return webm;
  if (asked === 'hevc' && format === 'mp4') return ['hevc'];
  if (asked === 'av1') return ['av1'];
  return format === 'mp4' ? ['avc'] : webm;
}

/** Export audio is always 48 kHz stereo (DECISIONS #29). */
export const EXPORT_SAMPLE_RATE = 48000;

/** Output size: the shorter side = `shortSide`, the longer one keeps the project's aspect ratio. */
export function exportSize(
  projectW: number,
  projectH: number,
  shortSide: number,
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (projectW >= projectH) {
    return { width: even((shortSide * projectW) / projectH), height: even(shortSide) };
  }
  return { width: even(shortSide), height: even((shortSide * projectH) / projectW) };
}

/** Bits per pixel per frame for each quality (H.264 at typical settings). */
const BITS_PER_PIXEL = { low: 0.05, medium: 0.09, high: 0.16 } as const;
/**
 * Bits for the same look, relative to H.264: VP9 needs fewer, VP8 a few more; HEVC and AV1 about
 * 60 % and 50 % (the point of choosing them: a smaller file).
 */
const CODEC_FACTOR = { avc: 1, vp9: 0.8, vp8: 1.2, hevc: 0.6, av1: 0.5 } as const;

/**
 * The video bitrate (bits/s) an export uses: set from the picture size, frame rate and quality,
 * so the same choice gives about the same file size in every browser (encoders' own "quality"
 * presets differed up to 4×). The export dialog's size estimate uses the same numbers.
 */
export function exportBitrate(
  width: number,
  height: number,
  fps: number,
  quality: ExportOptions['quality'],
  codec: keyof typeof CODEC_FACTOR = 'avc',
): number {
  const bits = width * height * fps * BITS_PER_PIXEL[quality] * CODEC_FACTOR[codec];
  return Math.round(Math.min(60_000_000, Math.max(400_000, bits)));
}

/** The audio bitrate (bits/s) for each quality: AAC / Opus stereo. */
export function exportAudioBitrate(quality: ExportOptions['quality']): number {
  return quality === 'low' ? 96_000 : quality === 'medium' ? 128_000 : 192_000;
}

/** Number of frames for a project of `duration` flicks at `fps` (at least one). */
export function exportFrameCount(duration: Time, fps: number): number {
  return Math.max(1, Math.round((duration / FLICKS_PER_SECOND) * fps));
}

/** Timeline time of output frame `index` (exact integer flicks for 24 / 30 / 60 fps). */
export function exportFrameTime(index: number, fps: number): Time {
  return Math.round((index * FLICKS_PER_SECOND) / fps);
}

/**
 * Audio frames (samples per channel) that must be written once video frame `framesDone` is in:
 * audio is trimmed to exactly the video's length, `framesTotal / fps` seconds.
 */
export function audioFramesFor(framesDone: number, fps: number): number {
  return Math.round((framesDone * EXPORT_SAMPLE_RATE) / fps);
}

/** Highest export resolution (shorter side) for a device tier. */
export function maxExportHeight(tier: DeviceTier): ExportHeight {
  return tier === 'low' ? 1080 : tier === 'mid' ? 1440 : 2160;
}

/** What this device can export. From {@link exportLimits}. */
export interface ExportLimits {
  /** Heights (shorter side) both allowed for the tier and accepted by an encoder, per format. */
  mp4: ExportHeight[];
  webm: ExportHeight[];
  /** AAC (MP4 sound) needs a downloaded encoder here (about 280 KB, loaded only when exporting). */
  aacFallback: boolean;
  /** Opus (WebM sound) can be encoded. Without it a WebM export has no sound. */
  opus: boolean;
  /** Heights HEVC (H.265, in MP4) and AV1 (MP4 / WebM) can be encoded at, if any (v0.4). */
  hevc: ExportHeight[];
  av1: ExportHeight[];
}

function avcCodec(width: number, height: number, fps: number): string {
  const rate = width * height * fps;
  if (rate <= 1280 * 720 * 30) return 'avc1.64001f'; // 3.1
  if (rate <= 1920 * 1088 * 30) return 'avc1.640028'; // 4.0
  if (rate <= 1920 * 1088 * 60) return 'avc1.64002a'; // 4.2
  if (rate <= 4096 * 2304 * 30) return 'avc1.640033'; // 5.1
  return 'avc1.640034'; // 5.2
}

/** HEVC Main profile, level by size (3.1 · 4.1 · 5.1). */
function hevcCodec(shortSide: number): string {
  return shortSide <= 720
    ? 'hvc1.1.6.L93.B0'
    : shortSide <= 1080
      ? 'hvc1.1.6.L123.B0'
      : 'hvc1.1.6.L153.B0';
}

/** AV1 Main profile, 8-bit, level by size (3.1 · 4.0 · 5.1). */
function av1Codec(shortSide: number): string {
  return shortSide <= 720 ? 'av01.0.05M.08' : shortSide <= 1080 ? 'av01.0.08M.08' : 'av01.0.13M.08';
}

async function encoderAccepts(codec: string, width: number, height: number, fps: number) {
  try {
    const result = await VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      framerate: fps,
      bitrate: Math.round(width * height * fps * 0.1),
    });
    return result.supported === true;
  } catch {
    return false;
  }
}

async function audioAccepts(codec: string): Promise<boolean> {
  try {
    const result = await AudioEncoder.isConfigSupported({
      codec,
      sampleRate: EXPORT_SAMPLE_RATE,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
    return result.supported === true;
  } catch {
    return false;
  }
}

/**
 * Asks the browser's encoders which export resolutions work here (capped by
 * {@link maxExportHeight} for the tier; checked as 16:9 at 30 fps). Plain WebCodecs checks, safe
 * on the main thread; takes a few milliseconds.
 */
export async function exportLimits(tier: DeviceTier): Promise<ExportLimits> {
  const max = maxExportHeight(tier);
  const limits: ExportLimits = {
    mp4: [],
    webm: [],
    aacFallback: false,
    opus: false,
    hevc: [],
    av1: [],
  };
  if (typeof VideoEncoder === 'undefined') return limits;
  for (const h of EXPORT_HEIGHTS) {
    if (h > max) break;
    const w = Math.round((h * 16) / 9 / 2) * 2;
    if (await encoderAccepts(avcCodec(w, h, 30), w, h, 30)) limits.mp4.push(h);
    const vp9 = h > 1080 ? 'vp09.00.50.08' : 'vp09.00.40.08';
    if ((await encoderAccepts(vp9, w, h, 30)) || (await encoderAccepts('vp8', w, h, 30)))
      limits.webm.push(h);
    if (await encoderAccepts(hevcCodec(h), w, h, 30)) limits.hevc.push(h);
    if (await encoderAccepts(av1Codec(h), w, h, 30)) limits.av1.push(h);
  }
  if (typeof AudioEncoder !== 'undefined') {
    limits.aacFallback = !(await audioAccepts('mp4a.40.2'));
    limits.opus = await audioAccepts('opus');
  } else {
    limits.aacFallback = true;
  }
  return limits;
}
