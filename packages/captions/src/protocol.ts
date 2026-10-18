import type { ModelFiles } from './whisper/load';

/** Messages between the transcriber and its worker. */

/** Which model files and runtime the worker loads. */
export interface ModelChoice {
  files: ModelFiles;
  device: 'webgpu' | 'wasm';
}

export type ToWorker =
  | {
      type: 'load';
      model: ModelChoice;
      /** Where the runtime's .wasm files are (null = next to the runtime's own module). */
      runtimePath: string | null;
      /** Measurements only: runtime session options. */
      session: Record<string, unknown> | null;
    }
  | { type: 'window'; id: number; audio: Float32Array; language: string };

export type FromWorker =
  | { type: 'download'; loaded: number; total: number }
  /** Downloaded; the model is being built in memory (the step most likely to run out of it). */
  | { type: 'building' }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | {
      type: 'words';
      id: number;
      words: { text: string; start: number; end: number }[];
      language: string;
    }
  | { type: 'error'; id: number | null; message: string };
