import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny';
import type { ProxyRequest, ProxyResponse } from './proxy';

/**
 * The proxy worker: one conversion at a time (proxies are background work; a second decoder +
 * encoder pair would slow the editor on phones). Each proxy is written straight to OPFS through
 * a sync access handle (never held in memory) and marked finished with a small `.ok` file, so a
 * half-written copy is never used. Beyond the byte budget the oldest proxies are deleted.
 */

declare const self: {
  postMessage(message: ProxyResponse): void;
  onmessage: ((event: MessageEvent<ProxyRequest>) => void) | null;
};

interface SyncAccessHandle {
  write(data: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

const DIR = 'video-ultra-proxies';
/** Proxy bitrate per pixel per frame (H.264, plenty for editing). */
const BITS_PER_PIXEL = 0.08;

let queue: Promise<void> = Promise.resolve();
const cancelled = new Set<number>();
const running = new Map<number, Conversion>();

async function dir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR, { create: true });
  } catch {
    return null;
  }
}

async function finished(d: FileSystemDirectoryHandle, key: string): Promise<File | null> {
  try {
    await d.getFileHandle(`${key}.ok`);
    return await (await d.getFileHandle(key)).getFile();
  } catch {
    return null;
  }
}

async function entries(d: FileSystemDirectoryHandle): Promise<[string, FileSystemHandle][]> {
  const out: [string, FileSystemHandle][] = [];
  for await (const entry of (
    d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
  ).entries())
    out.push(entry);
  return out;
}

/** Deletes the oldest finished proxies until the rest fit `budget` (keeps `keep`). */
async function trim(d: FileSystemDirectoryHandle, budget: number, keep: string): Promise<void> {
  const files: { name: string; size: number; at: number }[] = [];
  for (const [name, handle] of await entries(d)) {
    if (handle.kind !== 'file' || name.endsWith('.ok')) continue;
    const file = await (handle as FileSystemFileHandle).getFile().catch(() => null);
    if (file) files.push({ name, size: file.size, at: file.lastModified });
  }
  let total = files.reduce((n, f) => n + f.size, 0);
  for (const f of files.sort((a, b) => a.at - b.at)) {
    if (total <= budget) break;
    if (f.name === keep) continue;
    await d.removeEntry(`${f.name}.ok`).catch(() => undefined);
    await d.removeEntry(f.name).catch(() => undefined);
    total -= f.size;
  }
}

async function make(request: Extract<ProxyRequest, { type: 'make' }>): Promise<ProxyResponse> {
  const none = (reason: string): ProxyResponse => ({
    id: request.id,
    type: 'file',
    file: null,
    reason,
  });
  const d = await dir();
  if (!d) return none('no storage');
  const kept = await finished(d, request.key);
  if (kept) return { id: request.id, type: 'file', file: kept };
  if (cancelled.has(request.id)) return none('cancelled');

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(request.blob) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return none('no video');
  const duration = await input.computeDuration();
  const w = await track.getDisplayWidth();
  const h = await track.getDisplayHeight();
  const scale = request.height / Math.min(w, h);
  const outW = Math.round((w * scale) / 2) * 2;
  const outH = Math.round((h * scale) / 2) * 2;
  const fps = Math.min(60, (await track.computePacketStats(120)).averagePacketRate || 30);
  const bitrate = Math.round(outW * outH * fps * BITS_PER_PIXEL);
  // Room for it (and some to spare): never fill the device.
  const estimate = (bitrate / 8) * duration;
  const space: StorageEstimate = await navigator.storage.estimate().catch(() => ({}));
  const quota = space.quota ?? Infinity;
  const usage = space.usage ?? 0;
  if (quota - usage < estimate * 2 + 200 * 2 ** 20) return none('not enough space');

  const handle = await d.getFileHandle(request.key, { create: true });
  let access: SyncAccessHandle;
  try {
    access = await (
      handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> }
    ).createSyncAccessHandle();
  } catch {
    return none('no storage');
  }
  access.truncate(0);
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    access.flush();
    access.close();
  };
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      access.write(chunk.data, { at: chunk.position });
    },
    close,
    abort: close,
  });
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 2 ** 20 }),
  });
  let ok = false;
  try {
    // Landscape or portrait: the short side becomes `height`; rotation metadata is kept, so the
    // copy shows exactly like the original.
    const portrait = h > w;
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        ...(portrait ? { width: request.height } : { height: request.height }),
        codec: 'avc',
        bitrate,
        keyFrameInterval: 1,
        forceTranscode: true,
      },
      audio: { discard: true },
    });
    if (!conversion.isValid) return none('this device can’t encode the copy');
    running.set(request.id, conversion);
    let last = 0;
    conversion.onProgress = (done) => {
      if (done - last < 0.02 && done < 1) return;
      last = done;
      self.postMessage({ id: request.id, type: 'progress', done });
    };
    if (cancelled.has(request.id)) return none('cancelled');
    await conversion.execute();
    ok = true;
  } catch (error) {
    return none(cancelled.has(request.id) ? 'cancelled' : String(error));
  } finally {
    running.delete(request.id);
    close();
    if (!ok) await d.removeEntry(request.key).catch(() => undefined);
  }
  await d.getFileHandle(`${request.key}.ok`, { create: true });
  await trim(d, request.budget, request.key).catch(() => undefined);
  return { id: request.id, type: 'file', file: await handle.getFile() };
}

self.onmessage = (event: MessageEvent<ProxyRequest>) => {
  const request = event.data;
  switch (request.type) {
    case 'cancel':
      cancelled.add(request.id);
      void running.get(request.id)?.cancel();
      return;
    case 'find':
      void (async () => {
        const d = await dir();
        self.postMessage({
          id: request.id,
          type: 'file',
          file: d ? await finished(d, request.key) : null,
        });
      })();
      return;
    case 'remove':
      queue = queue.then(async () => {
        const d = await dir();
        if (d)
          for (const [name] of await entries(d))
            if (name.startsWith(request.prefix)) await d.removeEntry(name).catch(() => undefined);
        self.postMessage({ id: request.id, type: 'file', file: null });
      });
      return;
    case 'make':
      queue = queue.then(async () => {
        const response = await make(request).catch((error: unknown): ProxyResponse => ({
          id: request.id,
          type: 'file',
          file: null,
          reason: String(error),
        }));
        cancelled.delete(request.id);
        self.postMessage(response);
      });
      return;
  }
};
