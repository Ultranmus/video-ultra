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
  /** Things the user should know (e.g. no Opus encoder → video without sound). */
  warnings: string[];
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
/** VP9 needs fewer bits for the same look than H.264; VP8 a few more. */
const CODEC_FACTOR = { avc: 1, vp9: 0.8, vp8: 1.2 } as const;

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
}

function avcCodec(width: number, height: number, fps: number): string {
  const rate = width * height * fps;
  if (rate <= 1280 * 720 * 30) return 'avc1.64001f'; // 3.1
  if (rate <= 1920 * 1088 * 30) return 'avc1.640028'; // 4.0
  if (rate <= 1920 * 1088 * 60) return 'avc1.64002a'; // 4.2
  if (rate <= 4096 * 2304 * 30) return 'avc1.640033'; // 5.1
  return 'avc1.640034'; // 5.2
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
  const limits: ExportLimits = { mp4: [], webm: [], aacFallback: false, opus: false };
  if (typeof VideoEncoder === 'undefined') return limits;
  for (const h of EXPORT_HEIGHTS) {
    if (h > max) break;
    const w = Math.round((h * 16) / 9 / 2) * 2;
    if (await encoderAccepts(avcCodec(w, h, 30), w, h, 30)) limits.mp4.push(h);
    const vp9 = h > 1080 ? 'vp09.00.50.08' : 'vp09.00.40.08';
    if ((await encoderAccepts(vp9, w, h, 30)) || (await encoderAccepts('vp8', w, h, 30)))
      limits.webm.push(h);
  }
  if (typeof AudioEncoder !== 'undefined') {
    limits.aacFallback = !(await audioAccepts('mp4a.40.2'));
    limits.opus = await audioAccepts('opus');
  } else {
    limits.aacFallback = true;
  }
  return limits;
}
