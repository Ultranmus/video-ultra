import type { RenderBackend } from '../render/types';

/** Phase 0 lab: messages between the main thread and the lab worker. Not public API. */

export type BackendChoice = RenderBackend | 'auto';

export interface MediaInfo {
  name: string;
  sizeBytes: number;
  container: string;
  durationS: number;
  video: null | {
    codec: string | null;
    codedWidth: number;
    codedHeight: number;
    displayWidth: number;
    displayHeight: number;
    rotation: number;
    fps: number | null;
    variableFrameRate: boolean;
    hdr: boolean;
    colorSpace: VideoColorSpaceInit;
    canDecode: boolean;
  };
  audio: null | {
    codec: string | null;
    sampleRate: number;
    channels: number;
    canDecode: boolean;
  };
}

export interface Distribution {
  count: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
}

export interface PlayResult {
  backend: RenderBackend;
  seconds: number;
  presented: number;
  dropped: number;
  effectiveFps: number;
  /** Time spent waiting for the next decoded frame (ms). */
  decodeWaitMs: Distribution;
  /** CPU time of one draw call (ms). */
  drawMs: Distribution;
  /** Time between presented frames (ms). */
  intervalMs: Distribution;
  maxOpenFrames: number;
  openFramesAfter: number;
}

export interface ScrubResult {
  backend: RenderBackend;
  /** Seek → frame drawn (ms). */
  latencyMs: Distribution;
  openFramesAfter: number;
  /** Decode sessions created (1 = one decoder reused for every seek). */
  sessions: number;
  /** Keyframe previews shown before exact frames. */
  previews: number;
  /** Previews left out because every decoder slot was taken. */
  previewsSkipped: number;
  /** Most decoders open at once (previews included) / the pool's budget. */
  peakDecoders: number;
  decoderBudget: number;
  /** Seeks that continued decoding forward vs restarted from a keyframe. */
  continued: number;
  restarts: number;
  /** Simulated finger drag of the playhead. */
  drag: { framesShown: number; settleMs: number; skipped: number } | null;
}

export interface LabExportResult {
  backend: RenderBackend;
  fileName: string;
  /** The file itself when OPFS wasn't available; otherwise read `fileName` from OPFS. */
  blob: Blob | null;
  storage: 'opfs' | 'memory';
  /** The WASM AAC encoder was used (no native AAC encoder in this browser). */
  aacFallback: boolean;
  /** Frames that got the HDR correction, and the transfer functions of the others. */
  hdrFrames: number;
  otherTransfers: string[];
  sizeBytes: number;
  width: number;
  height: number;
  fps: number;
  mediaSeconds: number;
  wallMs: number;
  /** Media seconds produced per wall-clock second (> 1 = faster than real time). */
  realtimeFactor: number;
  videoCodec: string;
  audioCodec: string | null;
  openFramesAfter: number;
}

/** HDR check: the browser's own HDR conversion of a few frames, per GPU path (no correction). */
export interface HdrCheckResult {
  engine: string;
  userAgent: string;
  paths: Record<
    string,
    { error: string } | { width: number; height: number; frames: { t: number; rgb: string }[] }
  >;
  /** Per path: the very first draw after creating the renderer came back blank. */
  firstDrawBlank: Record<string, boolean>;
}

export type LabRequest =
  | { type: 'init'; canvas: OffscreenCanvas; backend: BackendChoice; width: number; height: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'load'; file: File }
  | { type: 'play'; seconds: number }
  | { type: 'scrub'; count: number; decoders?: number }
  | {
      type: 'export';
      width: number;
      height: number;
      fps: number;
      seconds: number;
      container: 'mp4' | 'webm';
    }
  | { type: 'hdrCheck'; times: number[]; width: number }
  | { type: 'cancel' };

export type LabResponseData =
  | { type: 'init'; backend: RenderBackend; fallbackReason: string | null }
  | { type: 'load'; info: MediaInfo }
  | { type: 'play'; result: PlayResult }
  | { type: 'scrub'; result: ScrubResult }
  | { type: 'export'; result: LabExportResult }
  | { type: 'hdrCheck'; result: HdrCheckResult }
  | { type: 'resize' }
  | { type: 'cancel' };

export type LabMessage =
  | { id: number; ok: true; data: LabResponseData }
  | { id: number; ok: false; error: string }
  | { id: -1; progress: number };
