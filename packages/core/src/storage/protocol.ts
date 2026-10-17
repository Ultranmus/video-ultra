/** Messages between the OPFS file store (main thread) and the storage worker. Not public API. */

export type StorageRequest =
  /** Can this worker write OPFS with sync access handles? Writes + removes a probe file. */
  | { id: number; op: 'probe'; root: string }
  | {
      id: number;
      op: 'write';
      root: string;
      path: string;
      data: string | ArrayBuffer;
      append: boolean;
    }
  | { id: number; op: 'copy'; root: string; path: string; blob: Blob }
  | { id: number; op: 'cancel'; target: number };

export type StorageResponse =
  { id: number; ok: true; size: number } | { id: number; ok: false; name: string; message: string };
