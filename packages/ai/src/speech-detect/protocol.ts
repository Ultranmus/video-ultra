/** Messages between the speech detector and its worker (DECISIONS #167). */

export type ToWorker =
  | {
      type: 'load';
      /** The model file (Silero VAD v5, ONNX). */
      url: string;
      /** Where the runtime's .wasm files are (null = next to the runtime's own module). */
      runtimePath: string | null;
    }
  | {
      type: 'detect';
      id: number;
      /** 16 kHz mono samples (transferred). */
      sound: Float32Array;
    };

export type FromWorker =
  | { type: 'ready' }
  | {
      type: 'voice';
      id: number;
      /** One byte per 20 ms: 1 = speech. */
      voice: Uint8Array;
    }
  | { type: 'error'; id: number | null; message: string };
