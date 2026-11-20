/**
 * A tiny file system the project storage is written against: OPFS in browsers, a Map in memory
 * (Safari Private Browsing, Playwright's WebKit, unit tests). Paths are `/`-separated and relative
 * to the storage namespace, e.g. `projects/abc/log-12.jsonl`.
 */
export interface FileStore {
  readonly kind: 'opfs' | 'memory';
  /** The file (with `size` and `lastModified`), or `null` if it doesn't exist. */
  read(path: string): Promise<File | null>;
  /** Replaces the file's contents (creating it and its folders). */
  write(path: string, data: string | ArrayBuffer): Promise<void>;
  /** Appends text to the file (creating it). */
  append(path: string, text: string): Promise<void>;
  /**
   * Streams `blob` into the file in chunks (constant memory). On failure or abort the partial
   * file is removed and the error is re-thrown (abort → `AbortError`).
   */
  copyIn(path: string, blob: Blob, signal?: AbortSignal): Promise<void>;
  /**
   * Appends `blob` to the end of the file (creating it), streamed in chunks. A failed append
   * leaves the file as it was before it.
   */
  appendBlob(path: string, blob: Blob): Promise<void>;
  /**
   * Downloads `url` into the file and resolves with its size. OPFS streams the response to disk
   * piece by piece in the storage worker (constant memory; the server needn't support range
   * requests); memory keeps the browser's own Blob of the response. A failed or aborted download
   * leaves no file and re-throws (HTTP errors → `NotFoundError`, no room → {@link StorageFullError},
   * abort → `AbortError`).
   */
  download(path: string, url: string, signal?: AbortSignal): Promise<number>;
  /** Removes a file or a whole folder. Missing paths are fine. */
  remove(path: string): Promise<void>;
  /** Names directly inside `dir` (files and folders); `[]` if it doesn't exist. */
  list(dir: string): Promise<string[]>;
}

/** Thrown when the browser's storage quota is used up (writes and media copies). */
export class StorageFullError extends Error {
  constructor(message = 'There is no storage space left on this device for the editor.') {
    super(message);
    this.name = 'StorageFullError';
  }
}

/** True for the DOMException browsers throw when the quota is exceeded. */
export function isQuotaError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'QuotaExceededError' || error.name === 'StorageFullError')
  );
}

/** The error a download rejects with when the server answers with an HTTP error. */
export function httpError(status: number, url: string): Error {
  const error = new Error(`Could not download ${url} (HTTP ${status}).`);
  error.name = 'NotFoundError';
  return error;
}

/** The `AbortError` our cancellable operations reject with. */
export function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

interface MemoryFile {
  parts: BlobPart[];
  lastModified: number;
}

/** In-memory {@link FileStore}. Lost on reload; also the test double for crash tests. */
export class MemoryFileStore implements FileStore {
  readonly kind = 'memory' as const;
  /** Exposed for tests (inspect / tear files). */
  readonly files = new Map<string, MemoryFile>();
  private clock = 0;

  private touch(): number {
    // Strictly increasing even within the same millisecond, so "newest" is well defined.
    this.clock = Math.max(this.clock + 1, Date.now());
    return this.clock;
  }

  async read(path: string): Promise<File | null> {
    const file = this.files.get(normalize(path));
    if (!file) return null;
    return new File(file.parts, path.split('/').pop()!, { lastModified: file.lastModified });
  }

  async write(path: string, data: string | ArrayBuffer): Promise<void> {
    this.files.set(normalize(path), {
      parts: [typeof data === 'string' ? data : data.slice(0)],
      lastModified: this.touch(),
    });
  }

  async append(path: string, text: string): Promise<void> {
    const key = normalize(path);
    const file = this.files.get(key);
    if (file) {
      file.parts.push(text);
      file.lastModified = this.touch();
    } else {
      this.files.set(key, { parts: [text], lastModified: this.touch() });
    }
  }

  async copyIn(path: string, blob: Blob, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();
    // A File from an input is disk-backed already; keeping the reference costs no memory.
    this.files.set(normalize(path), { parts: [blob], lastModified: this.touch() });
  }

  async appendBlob(path: string, blob: Blob): Promise<void> {
    const key = normalize(path);
    const file = this.files.get(key);
    if (file) {
      file.parts.push(blob);
      file.lastModified = this.touch();
    } else {
      this.files.set(key, { parts: [blob], lastModified: this.touch() });
    }
  }

  async download(path: string, url: string, signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) throw abortError();
    // No disk here (Safari Private Browsing, some webviews): the response's Blob is the browser's
    // (large ones are file-backed in Chromium), never copied into the JS heap.
    const response = await fetch(url, signal ? { signal } : undefined);
    if (!response.ok) throw httpError(response.status, url);
    const blob = await response.blob();
    this.files.set(normalize(path), { parts: [blob], lastModified: this.touch() });
    return blob.size;
  }

  async remove(path: string): Promise<void> {
    const key = normalize(path);
    this.files.delete(key);
    for (const name of [...this.files.keys()])
      if (name.startsWith(`${key}/`)) this.files.delete(name);
  }

  async list(dir: string): Promise<string[]> {
    const prefix = normalize(dir) ? `${normalize(dir)}/` : '';
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      names.add(key.slice(prefix.length).split('/')[0]!);
    }
    return [...names];
  }
}

/** `a//b/` → `a/b`. */
export function normalize(path: string): string {
  return path
    .split('/')
    .filter((p) => p !== '' && p !== '.')
    .join('/');
}
