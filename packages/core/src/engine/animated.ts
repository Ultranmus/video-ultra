/**
 * Animated images (GIF, animated WebP / PNG) for stickers and photos: frames decoded one at a
 * time with the browser's `ImageDecoder` (WebCodecs), in the engine worker. Only the frame on
 * screen is held — memory stays flat however long the animation is. Where `ImageDecoder` isn't
 * available the image stays still (its first frame), as before.
 */

/** Longest animation we time (frames past it are ignored; a GIF that long is unusual). */
const MAX_FRAMES = 1000;
/** GIFs that say "0 ms" per frame play at 10 fps, as browsers do. */
const DEFAULT_FRAME_MS = 100;

/** A decodable animation and its timing. */
export interface AnimatedImage {
  width: number;
  height: number;
  /** Start of each frame (ms), and the loop length. */
  starts: Float64Array;
  total: number;
  /** Decodes frame `index` as a straight-alpha bitmap (the caller closes it). */
  frame(index: number): Promise<ImageBitmap>;
  close(): void;
}

interface ImageDecoderLike {
  tracks: {
    ready: Promise<void>;
    selectedTrack: { animated: boolean; frameCount: number } | null;
  };
  completed: Promise<void>;
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}

type ImageDecoderCtor = new (init: {
  data: ReadableStream<Uint8Array>;
  type: string;
}) => ImageDecoderLike;

/**
 * Opens `blob` as an animation, or returns null when it's a still image, the type can't animate
 * or the browser has no `ImageDecoder`.
 */
export async function openAnimatedImage(
  blob: Blob,
  type = blob.type,
): Promise<AnimatedImage | null> {
  const Decoder = (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  if (!Decoder || !/^image\/(gif|webp|png|apng)$/.test(type)) return null;
  let decoder: ImageDecoderLike;
  try {
    decoder = new Decoder({ data: blob.stream(), type });
    await decoder.tracks.ready;
  } catch {
    return null;
  }
  const track = decoder.tracks.selectedTrack;
  if (!track?.animated) {
    decoder.close();
    return null;
  }
  // The frame count is final once the whole file is read.
  await decoder.completed.catch(() => undefined);
  const count = Math.min(MAX_FRAMES, decoder.tracks.selectedTrack?.frameCount ?? 0);
  if (count < 2) {
    decoder.close();
    return null;
  }
  // Timing: each frame's duration (decoded once here, each frame closed at once).
  const starts = new Float64Array(count);
  let at = 0;
  let width = 0;
  let height = 0;
  for (let i = 0; i < count; i++) {
    starts[i] = at;
    const { image } = await decoder.decode({ frameIndex: i });
    if (i === 0) {
      width = image.displayWidth;
      height = image.displayHeight;
    }
    const ms = (image.duration ?? 0) / 1000;
    image.close();
    at += ms > 1 ? ms : DEFAULT_FRAME_MS;
  }
  return {
    width,
    height,
    starts,
    total: at,
    async frame(index) {
      const { image } = await decoder.decode({ frameIndex: index });
      try {
        return await createImageBitmap(image, { premultiplyAlpha: 'none' });
      } finally {
        image.close();
      }
    },
    close: () => decoder.close(),
  };
}

/** Which frame shows `ms` into the animation (it loops). */
export function frameIndexAt(starts: Float64Array, total: number, ms: number): number {
  if (starts.length === 0 || total <= 0) return 0;
  const t = ((ms % total) + total) % total;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
