import type { DeviceTier } from '../capabilities';
import type { ProbeResult } from './probe';

/** Messages between the main thread (media analyzer client) and the analyzer worker. Not public API. */

/** How thumbnails pick their frame. */
export type ThumbnailMode =
  /** The keyframe at or before the time: one packet decoded per thumbnail (fast, default). */
  | 'keyframe'
  /** The exact frame at the time: decodes from the keyframe up to it (slower on long GOPs). */
  | 'exact';

/** Counters for tests and the bench. */
export interface AnalyzerStats {
  /** Thumbnails asked for / delivered / answered from the cache / skipped (aborted or superseded). */
  thumbRequests: number;
  thumbDelivered: number;
  cacheHits: number;
  skipped: number;
  /** Frames decoded for thumbnails. */
  framesDecoded: number;
  /** Decoded frames not yet closed (must be 0 when idle). */
  openFrames: number;
  /** Decode jobs running now, the most at once, and the budget. */
  activeJobs: number;
  peakJobs: number;
  jobBudget: number;
  /** Thumbnail cache use (bytes) and budget. */
  cacheBytes: number;
  cacheBudget: number;
  /** Waveforms computed. */
  waveforms: number;
  /** Stalled decodes the watchdog gave up on. */
  watchdogResets: number;
  /** Media files currently open (Mediabunny inputs). */
  openInputs: number;
}

export type AnalyzerRequest =
  | { type: 'init'; tier: DeviceTier; mode: ThumbnailMode }
  | { type: 'probe'; id: number; file: Blob; name: string }
  | {
      type: 'add';
      assetId: string;
      blob: Blob;
      kind: 'video' | 'audio' | 'image';
      audioTrack?: number;
    }
  | { type: 'remove'; assetId: string }
  | { type: 'thumb'; id: number; assetId: string; seconds: number; height: number }
  | { type: 'wave'; id: number; assetId: string }
  | { type: 'cancel'; id: number }
  | { type: 'stats'; id: number };

export type AnalyzerResponse =
  | { id: number; type: 'probe'; result: ProbeResult }
  | { id: number; type: 'thumb'; bitmap: ImageBitmap | null }
  | {
      id: number;
      type: 'wave';
      waveform: { peaksPerSecond: number; peaks: Float32Array; duration: number } | null;
    }
  | { id: number; type: 'stats'; stats: AnalyzerStats }
  | { id: number; type: 'error'; message: string };
