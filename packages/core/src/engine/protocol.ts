import type { DeviceTier } from '../capabilities';
import type { Project } from '../model/schema';
import type { BackendChoice } from '../lab/protocol';
import type { RenderBackend } from '../render/types';

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
  /** Preview canvas size in pixels. */
  previewWidth: number;
  previewHeight: number;
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
  | { type: 'stats' };

export type EngineResponseData =
  { type: 'init'; backend: RenderBackend } | { type: 'ok' } | { type: 'stats'; stats: EngineStats };

/** Unsolicited events from the worker. */
export type EngineEvent =
  | { type: 'time'; time: number; playing: boolean }
  | { type: 'ended' }
  | { type: 'error'; message: string };

export type EngineMessage =
  | { id: number; ok: true; data: EngineResponseData }
  | { id: number; ok: false; error: string }
  | { id: -1; event: EngineEvent };
