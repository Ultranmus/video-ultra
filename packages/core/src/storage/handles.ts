/**
 * Stored `FileSystemFileHandle`s (Chromium desktop, File System Access API): the editor keeps a
 * handle to the user's original file instead of copying it (DECISIONS #19). Handles can only be
 * persisted in IndexedDB; where IndexedDB is missing they live in memory for the session.
 */
export interface HandleStore {
  get(key: string): Promise<FileSystemFileHandle | null>;
  put(key: string, handle: FileSystemFileHandle): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Handles kept in a Map (lost on reload). */
export function memoryHandleStore(): HandleStore {
  const map = new Map<string, FileSystemFileHandle>();
  return {
    get: async (key) => map.get(key) ?? null,
    put: async (key, handle) => void map.set(key, handle),
    delete: async (key) => void map.delete(key),
  };
}

/** Handles in IndexedDB database `<namespace>-handles`. Falls back to memory if it can't open. */
export function indexedDbHandleStore(namespace: string): HandleStore {
  const fallback = memoryHandleStore();
  let db: Promise<IDBDatabase | null> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      try {
        const request = indexedDB.open(`${namespace}-handles`, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('handles');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  const run = <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>) =>
    open().then(
      (database) =>
        database &&
        new Promise<T>((resolve, reject) => {
          const request = op(database.transaction('handles', mode).objectStore('handles'));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
        }),
    );
  return {
    async get(key) {
      const database = await open();
      if (!database) return fallback.get(key);
      const value = await run<unknown>('readonly', (s) => s.get(key));
      return (value as FileSystemFileHandle | undefined) ?? null;
    },
    async put(key, handle) {
      if (!(await open())) return fallback.put(key, handle);
      await run('readwrite', (s) => s.put(handle, key));
    },
    async delete(key) {
      if (!(await open())) return fallback.delete(key);
      await run('readwrite', (s) => s.delete(key));
    },
  };
}
