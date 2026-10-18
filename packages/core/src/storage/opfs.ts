import { abortError, normalize, StorageFullError, isQuotaError, type FileStore } from './files';
import type { StorageRequest, StorageResponse } from './protocol';

/**
 * OPFS {@link FileStore}. Reads, listings and removals use the async OPFS API on the main thread
 * (cheap: they return disk-backed `File`s / names). Every write goes to the storage worker
 * (`storage.worker.js`, sync access handles) so nothing big is written on the main thread.
 */
export class OpfsFileStore implements FileStore {
  readonly kind = 'opfs' as const;
  private readonly pending = new Map<
    number,
    { resolve: (size: number) => void; reject: (error: Error) => void }
  >();
  private nextId = 1;

  private constructor(
    private readonly root: FileSystemDirectoryHandle,
    private readonly rootName: string,
    private readonly worker: Worker,
  ) {
    worker.onmessage = (event: MessageEvent<StorageResponse>) => {
      const message = event.data;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.ok) entry.resolve(message.size);
      else entry.reject(toError(message.name, message.message));
    };
    worker.onerror = (event) => {
      const error = new Error(`Storage worker failed: ${event.message || 'could not load it'}`);
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
  }

  /**
   * Opens OPFS under `namespace` and checks the worker can write there. Resolves `null` where OPFS
   * or sync access handles are missing (Safari Private Browsing, Playwright's WebKit).
   */
  static async open(namespace: string): Promise<OpfsFileStore | null> {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function')
      return null;
    if (typeof Worker === 'undefined') return null;
    let root: FileSystemDirectoryHandle;
    try {
      root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(namespace, { create: true });
    } catch {
      return null;
    }
    const worker = new Worker(new URL('./storage.worker.js', import.meta.url), { type: 'module' });
    const store = new OpfsFileStore(root, namespace, worker);
    try {
      // A worker that fails to load or to write reports it (onerror / ok:false); the timeout is only
      // a safety net — a slow phone on a slow network can take seconds to fetch the worker script.
      await withTimeout(store.send({ id: 0, op: 'probe', root: namespace }), 30_000);
      return store;
    } catch {
      // One more try: falling back to memory loses work on reload, so be sure first.
      try {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await withTimeout(store.send({ id: 0, op: 'probe', root: namespace }), 30_000);
        return store;
      } catch {
        worker.terminate();
        return null;
      }
    }
  }

  private send(request: StorageRequest): Promise<number> {
    const id = this.nextId++;
    return new Promise<number>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id });
    });
  }

  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let dir = this.root;
    try {
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
      return dir;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async read(path: string): Promise<File | null> {
    const parts = normalize(path).split('/');
    const name = parts.pop()!;
    const dir = await this.dir(parts, false);
    if (!dir) return null;
    try {
      return await (await dir.getFileHandle(name)).getFile();
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async write(path: string, data: string | ArrayBuffer): Promise<void> {
    await this.send({
      id: 0,
      op: 'write',
      root: this.rootName,
      path: normalize(path),
      data,
      append: false,
    });
  }

  async append(path: string, text: string): Promise<void> {
    await this.send({
      id: 0,
      op: 'write',
      root: this.rootName,
      path: normalize(path),
      data: text,
      append: true,
    });
  }

  async copyIn(path: string, blob: Blob, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();
    const id = this.nextId; // the id send() will use
    const onAbort = () => this.worker.postMessage({ id: -1, op: 'cancel', target: id });
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await this.send({ id: 0, op: 'copy', root: this.rootName, path: normalize(path), blob });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async appendBlob(path: string, blob: Blob): Promise<void> {
    await this.send({
      id: 0,
      op: 'copy',
      root: this.rootName,
      path: normalize(path),
      blob,
      append: true,
    });
  }

  async remove(path: string): Promise<void> {
    const parts = normalize(path).split('/');
    const name = parts.pop()!;
    const dir = await this.dir(parts, false);
    if (!dir) return;
    try {
      await dir.removeEntry(name, { recursive: true });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async list(path: string): Promise<string[]> {
    const parts = normalize(path) ? normalize(path).split('/') : [];
    const dir = await this.dir(parts, false);
    if (!dir) return [];
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys())
      names.push(name);
    return names;
  }

  /** Stops the worker. */
  close(): void {
    this.worker.terminate();
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NotFoundError' || name === 'TypeMismatchError';
}

function toError(name: string, message: string): Error {
  if (isQuotaError({ name })) return new StorageFullError();
  const error = new Error(message);
  error.name = name;
  return error;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
