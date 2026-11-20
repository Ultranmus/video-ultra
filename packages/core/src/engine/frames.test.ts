import { describe, expect, it } from 'vitest';
import { DecoderPool, type DecoderOwner } from './frames';

function owner(): DecoderOwner & { released: number } {
  return {
    released: 0,
    releaseDecoder() {
      this.released++;
    },
  };
}

describe('DecoderPool', () => {
  it('evicts the least recently used decoder over budget', () => {
    const pool = new DecoderPool(2);
    const [a, b, c] = [owner(), owner(), owner()];
    pool.acquire(a);
    pool.acquire(b);
    pool.acquire(a); // a is newer now
    pool.acquire(c);
    expect(b.released).toBe(1);
    expect(a.released).toBe(0);
    expect(pool.size).toBe(2);
    expect(pool.peak).toBe(2);
  });

  it('counts an optional decoder (keyframe preview) only when a slot is free', () => {
    const pool = new DecoderPool(2);
    const [clip, preview, other] = [owner(), owner(), owner()];
    pool.acquire(clip);
    // Low tier, one clip scrubbed: the preview gets the second slot.
    expect(pool.tryAcquire(preview)).toBe(true);
    expect(pool.size).toBe(2);
    // Full: a second preview is refused and nobody is evicted.
    expect(pool.tryAcquire(other)).toBe(false);
    expect(clip.released + preview.released).toBe(0);
    // A playing clip's decoder wins: the preview is evicted (its picture is dropped).
    pool.acquire(other);
    expect(preview.released).toBe(1);
    expect(clip.released).toBe(0);
    expect(pool.size).toBe(2);
    expect(pool.peak).toBe(2);
    pool.release(preview);
    expect(pool.size).toBe(2);
  });
});
