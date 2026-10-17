import type { DeviceTier } from '../capabilities';
import type { Project } from '../model/schema';
import type { BackendChoice } from '../lab/protocol';
import type { RenderBackend } from '../render/types';
import type { ExportOptions, ExportProgress, ExportResult } from './export-plan';

/** Messages between the main thread (engine client) and the engine worker. Not public API. */

export interface EngineStats {
  /** Frames drawn while playing. */
  presented: number;
  /** Frames where at least one layer reused its previous picture (decode wasn't ready in time). */
  late: number;
  /** Ticks skipped because the previous frame was still being prepared. */
  skipped: number;
  /** The first late / skipped frames, e.g. "late 3.40" / "skip 0.02" (seconds) — to find causes. */
  lateAt: string[];
  /** Draw (composite) CPU time of the last frame, ms. */
  drawMs: number;
  /** Time to gather the layers' frames for the last frame, ms. */
  gatherMs: number;
  /** VideoFrames currently held by the engine. */
  openFrames: number;
  /** Decoders open right now / budget. */
  decoders: number;
  decoderBudget: number;
  /** Timeline time (flicks) of the last frame drawn, and how many layers it had. */
  lastRendered: number;
  lastLayers: number;
  /** Adaptive preview resolution factor (1, 0.75, 0.5) and how often it changed. */
  previewQuality: number;
  qualityChanges: number;
  /** Preview canvas size in pixels. */
  previewWidth: number;
  previewHeight: number;
  /** Audio is connected; times the worklet ran out of sound since play started. */
  audio: boolean;
  underruns: number;
  /** |picture time − audible time| at each drawn frame while playing (ms). */
  avOffsetMs: { p50: number; p95: number; max: number } | null;
  /** Bytes of text / emoji rasters held by the preview. */
  rasterBytes: number;
  /** An export is running (preview paused). */
  exporting: boolean;
}

/** Export timing details for checks and the bench (not public API). */
export interface ExportRunInfo {
  backend: string;
  /** Total ms spent composing frames, waiting on the encoder, mixing audio. */
  composeMs: number;
  encodeWaitMs: number;
  audioMs: number;
  /** Exact frames that couldn't be decoded (should be 0). */
  missingLayers: number;
  /** Audio encoder priming compensated (samples at 48 kHz). */
  audioDelaySamples: number;
  /** VideoFrames still open after the export (must be 0). */
  openFramesAfter: number;
}

export type EngineRequest =
  | {
      type: 'init';
      canvas: OffscreenCanvas;
      backend: BackendChoice;
      tier: DeviceTier;
      /** Size of the element showing the preview, in device pixels. */
      viewWidth: number;
      viewHeight: number;
    }
  | { type: 'project'; project: Project }
  | { type: 'media'; assetId: string; blob: Blob }
  | { type: 'view'; viewWidth: number; viewHeight: number }
  | { type: 'seek'; time: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stats' }
  | { type: 'export'; jobId: number; options: ExportOptions; backend?: RenderBackend }
  | { type: 'export-cancel'; jobId: number }
  | {
      type: 'capture';
      time: number;
      width?: number;
      height?: number;
      backend?: RenderBackend;
    }
  /** Audio output: the port to the AudioWorklet, its sample rate and output latency (s). */
  | { type: 'audio'; port: MessagePort; sampleRate: number; latency: number };

export type EngineResponseData =
  | { type: 'init'; backend: RenderBackend }
  | { type: 'ok' }
  | { type: 'stats'; stats: EngineStats }
  | { type: 'export'; result: ExportResult; stats: ExportRunInfo }
  | { type: 'capture'; bitmap: ImageBitmap; backend: RenderBackend };

/** Unsolicited events from the worker. */
export type EngineEvent =
  | { type: 'time'; time: number; playing: boolean }
  | { type: 'ended' }
  | { type: 'error'; message: string }
  | { type: 'export-progress'; jobId: number; progress: ExportProgress };

export type EngineMessage =
  | { id: number; ok: true; data: EngineResponseData }
  | { id: number; ok: false; error: string; name?: string }
  | { id: -1; event: EngineEvent };
