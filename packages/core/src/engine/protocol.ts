import type { DeviceTier } from '../capabilities';
import type { ItemAnimation, Project, Transition } from '../model/schema';
import type { BackendChoice } from '../lab/protocol';
import type { RenderBackend } from '../render/types';
import type {
  AudioExportOptions,
  AudioExportResult,
  ExportOptions,
  ExportProgress,
  ExportResult,
  FrameImage,
  FrameImageOptions,
} from './export-plan';

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
  /** Checks only: make the worker throw an uncaught error (the fatal-error path). */
  | { type: 'crash-for-test' }
  | { type: 'export'; jobId: number; options: ExportOptions; backend?: RenderBackend }
  | { type: 'export-cancel'; jobId: number }
  /** Sound only (cancelled with `export-cancel` like a video export). */
  | { type: 'export-audio'; jobId: number; options: AudioExportOptions }
  /** One frame as a PNG / JPEG file, drawn like the export. */
  | { type: 'capture-image'; time: number; options: FrameImageOptions }
  | {
      type: 'capture';
      time: number;
      width?: number;
      height?: number;
      backend?: RenderBackend;
    }
  /** One frame of a visual item with each filter applied (filter strip thumbnails). */
  | {
      type: 'filter-previews';
      itemId: string;
      /** Timeline time inside the item. */
      time: number;
      /** Square tile size in px. */
      size: number;
      filters: (string | null)[];
    }
  | {
      type: 'item-preview';
      /** A lane item (text, sticker, picture-in-picture), drawn alone, centred and large. */
      itemId: string;
      /** Replaces the item's animation (`null` = none, for a still). */
      animation: ItemAnimation | null;
      /** Timeline times to draw. */
      times: number[];
      width: number;
      height: number;
      background: string;
    }
  | {
      type: 'transition-preview';
      /** The main-track clip whose `transitionIn` is previewed (the clip after the cut). */
      itemId: string;
      transition: Transition;
      width: number;
      height: number;
      frames: number;
    }
  /** Audio output: the port to the AudioWorklet, its sample rate and output latency (s). */
  | { type: 'audio'; port: MessagePort; sampleRate: number; latency: number };

export type EngineResponseData =
  | { type: 'init'; backend: RenderBackend }
  | { type: 'ok' }
  | { type: 'stats'; stats: EngineStats }
  | { type: 'export'; result: ExportResult; stats: ExportRunInfo }
  | { type: 'capture'; bitmap: ImageBitmap; backend: RenderBackend }
  | {
      type: 'export-audio';
      result: AudioExportResult;
      stats: { audioMs: number; audioDelaySamples: number };
    }
  | { type: 'capture-image'; image: FrameImage }
  | { type: 'filter-previews'; bitmaps: ImageBitmap[] }
  | { type: 'transition-preview'; bitmaps: ImageBitmap[] }
  | { type: 'item-preview'; bitmaps: ImageBitmap[] };

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
