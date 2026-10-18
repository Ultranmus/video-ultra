/**
 * Model files: downloaded once into Cache Storage, streamed straight there (nothing held while
 * they arrive), then read back once — a file costs its size once in memory (as the captions
 * package does, DECISIONS #132). Without Cache Storage, one buffer sized from Content-Length.
 */

const CACHE = 'video-ultra-ai-v1';

function openCache(): Promise<Cache | null> {
  return typeof caches !== 'undefined'
    ? caches.open(CACHE).catch(() => null)
    : Promise.resolve(null);
}

/** Reads a stream into one buffer, sized up front when the length is known. */
async function readAll(body: ReadableStream<Uint8Array>, total: number): Promise<ArrayBuffer> {
  const reader = body.getReader();
  let bytes = new Uint8Array(total || 1 << 20);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > bytes.length) {
      const grown = new Uint8Array(Math.max(at + value.length, Math.ceil(bytes.length * 1.5)));
      grown.set(bytes.subarray(0, at));
      bytes = grown;
    }
    bytes.set(value, at);
    at += value.length;
  }
  return at === bytes.length ? bytes.buffer : bytes.slice(0, at).buffer;
}

/** The file's bytes: from the cache, or downloaded (into the cache first when there is one). */
export async function fetchModel(
  url: string,
  onBytes: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const cache = await openCache();
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) {
    const buffer = await hit.arrayBuffer();
    onBytes(buffer.byteLength, buffer.byteLength);
    return buffer;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't download the model (${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  let loaded = 0;
  const counted = response.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.length;
        onBytes(loaded, total || loaded);
        controller.enqueue(chunk);
      },
    }),
  );
  if (!cache) return readAll(counted, total);
  try {
    await cache.put(
      url,
      new Response(counted, { headers: { 'content-type': 'application/octet-stream' } }),
    );
    const back = await cache.match(url);
    if (back) return back.arrayBuffer();
  } catch {
    /* full disk: download again into memory */
  }
  const again = await fetch(url);
  if (!again.ok) throw new Error(`Couldn't download the model (${again.status})`);
  return readAll(again.body!, total);
}
