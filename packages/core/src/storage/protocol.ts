/** Messages between the OPFS file store (main thread) and the storage worker. Not public API. */

/** Main thread → storage worker. */
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
  /** Streams `blob` into the file; `append` adds it at the end instead of replacing the file. */
  | { id: number; op: 'copy'; root: string; path: string; blob: Blob; append?: boolean }
  /** Downloads `url` (absolute) into the file, streamed; a failed download leaves no file. */
  | { id: number; op: 'download'; root: string; path: string; url: string }
  | { id: number; op: 'cancel'; target: number };

/** Storage worker → main thread (`id` matches the request). */
export type StorageResponse =
  { id: number; ok: true; size: number } | { id: number; ok: false; name: string; message: string };
