import type { ModelInput } from './matte';

/** Messages between the background remover and its worker. */

export interface ModelSpec extends ModelInput {
  url: string;
}

export type ToWorker = {
  type: 'remove';
  image: Blob;
  model: ModelSpec;
  /** Where the runtime's .wasm files are (null = next to the runtime's own module). */
  runtimePath: string | null;
  /** Longest side of the result (bigger pictures are scaled down to it). */
  maxSide: number;
};

export type FromWorker =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'work'; fraction: number }
  | { type: 'done'; image: Blob }
  | { type: 'error'; message: string };
