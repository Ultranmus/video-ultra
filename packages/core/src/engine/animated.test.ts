import { describe, expect, it } from 'vitest';
import { frameIndexAt, openAnimatedImage } from './animated';

describe('animated images', () => {
  const starts = new Float64Array([0, 100, 150, 400]); // the last frame lasts 100 ms
  it('finds the frame showing at a time, looping', () => {
    expect(frameIndexAt(starts, 500, 0)).toBe(0);
    expect(frameIndexAt(starts, 500, 99)).toBe(0);
    expect(frameIndexAt(starts, 500, 100)).toBe(1);
    expect(frameIndexAt(starts, 500, 399)).toBe(2);
    expect(frameIndexAt(starts, 500, 450)).toBe(3);
    expect(frameIndexAt(starts, 500, 500)).toBe(0); // loops
    expect(frameIndexAt(starts, 500, 1120)).toBe(1);
    expect(frameIndexAt(starts, 500, -50)).toBe(3);
  });

  it('is a still image where the browser has no ImageDecoder', async () => {
    expect(await openAnimatedImage(new Blob(['GIF89a'], { type: 'image/gif' }))).toBeNull();
    expect(await openAnimatedImage(new Blob([''], { type: 'image/jpeg' }))).toBeNull();
  });
});
