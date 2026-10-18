import type { StorageRequest, StorageResponse } from './protocol';

/**
 * The storage worker: every OPFS write goes through here, using `createSyncAccessHandle` — the one
 * OPFS write API every supported browser has (iOS 17/18 Safari has no `createWritable`), and it
 * keeps big media copies off the main thread. Writes to the same file run one after another;
 * different files run side by side (a 1 GB import doesn't hold up autosave).
 */

declare const self: {
  postMessage(message: StorageResponse): void;
  onmessage: ((event: MessageEvent<StorageRequest>) => void) | null;
};

interface SyncAccessHandle {
  write(buffer: ArrayBufferView | ArrayBuffer, options?: { at?: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}
type SyncFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
};

const encoder = new TextEncoder();
const chains = new Map<string, Promise<unknown>>();
const cancelled = new Set<number>();
/** Flush a long copy every this many bytes (bounds what a crash can lose; keeps memory flat). */
const FLUSH_EVERY = 16 * 2 ** 20;

async function directory(root: string, parts: string[]): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const part of [root, ...parts]) {
    if (part) dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

async function fileHandle(root: string, path: string): Promise<SyncFileHandle> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop()!;
  const dir = await directory(root, parts);
  return (await dir.getFileHandle(name, { create: true })) as SyncFileHandle;
}

/** Opens a sync handle; another tab holding the file gets a few short retries. */
async function open(handle: SyncFileHandle): Promise<SyncAccessHandle> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await handle.createSyncAccessHandle();
    } catch (error) {
      const name = (error as { name?: string }).name;
      // Chrome/Safari say NoModificationAllowedError for a file another handle holds; Firefox
      // may say InvalidStateError.
      const locked = name === 'NoModificationAllowedError' || name === 'InvalidStateError';
      if (attempt >= 4 || !locked) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}

async function write(
  root: string,
  path: string,
  data: string | ArrayBuffer,
  append: boolean,
): Promise<number> {
  const sync = await open(await fileHandle(root, path));
  try {
    const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
    const at = append ? sync.getSize() : 0;
    if (!append) sync.truncate(0);
    sync.write(bytes, { at });
    sync.flush();
    return at + bytes.byteLength;
  } finally {
    sync.close();
  }
}

async function copy(
  id: number,
  root: string,
  path: string,
  blob: Blob,
  append = false,
): Promise<number> {
  const handle = await fileHandle(root, path);
  const sync = await open(handle);
  // Appending (a recording arriving in pieces): a failed piece is cut off again, the rest stays.
  const startSize = append ? sync.getSize() : 0;
  let at = startSize;
  let failed = true;
  const reader = blob.stream().getReader();
  try {
    sync.truncate(startSize);
    let sinceFlush = 0;
    for (;;) {
      if (cancelled.has(id)) {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        throw error;
      }
      const { done, value } = await reader.read();
      if (done) break;
      sync.write(value, { at });
      at += value.byteLength;
      sinceFlush += value.byteLength;
      if (sinceFlush >= FLUSH_EVERY) {
        sync.flush();
        sinceFlush = 0;
      }
    }
    sync.flush();
    failed = false;
    return at;
  } finally {
    cancelled.delete(id);
    void reader.cancel().catch(() => undefined);
    if (failed && append) {
      try {
        sync.truncate(startSize);
        sync.flush();
      } catch {
        /* the file stays as it was written so far */
      }
    }
    sync.close();
    if (failed && !append) {
      // Leave no partial media behind.
      const parts = path.split('/').filter(Boolean);
      const name = parts.pop()!;
      await (await directory(root, parts)).removeEntry(name).catch(() => undefined);
    }
  }
}

/** A name per probe: two storages starting at once (another tab, strict mode) mustn't collide. */
async function probe(root: string, id: number): Promise<number> {
  const name = `.probe-${id}-${Math.random().toString(36).slice(2)}`;
  const size = await write(root, name, 'ok', false);
  await (await directory(root, [])).removeEntry(name).catch(() => undefined);
  return size;
}

/** Runs `task` after the previous task on the same file. */
function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  chains.set(key, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  return next;
}

self.onmessage = (event: MessageEvent<StorageRequest>) => {
  const request = event.data;
  if (request.op === 'cancel') {
    cancelled.add(request.target);
    return;
  }
  const task =
    request.op === 'probe'
      ? () => probe(request.root, request.id)
      : request.op === 'write'
        ? () => write(request.root, request.path, request.data, request.append)
        : () => copy(request.id, request.root, request.path, request.blob, request.append);
  const key = request.op === 'probe' ? `probe-${request.id}` : `${request.root}/${request.path}`;
  serial(key, task).then(
    (size) => self.postMessage({ id: request.id, ok: true, size }),
    (error: unknown) =>
      self.postMessage({
        id: request.id,
        ok: false,
        name: (error as { name?: string }).name ?? 'Error',
        message: (error as { message?: string }).message ?? String(error),
      }),
  );
};
