import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accumulatePeaks, MAX_PEAKS, peaksPerSecondFor } from './peaks';

/** Brute force: every frame's bucket from its absolute time. */
function reference(
  data: Float32Array,
  channels: number,
  sampleRate: number,
  pps: number,
  length: number,
): Float32Array {
  const out = new Float32Array(length);
  const frames = data.length / channels;
  for (let f = 0; f < frames; f++) {
    const bucket = Math.floor((f / sampleRate) * pps + 1e-9);
    if (bucket >= length) continue;
    for (let c = 0; c < channels; c++)
      out[bucket] = Math.min(1, Math.max(out[bucket]!, Math.abs(data[f * channels + c]!)));
  }
  return out;
}

describe('waveform peaks', () => {
  it('match a brute-force bucketing however the audio is split into blocks', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(8000, 22050, 44100, 48000),
        fc.constantFrom(1, 2),
        fc.array(fc.integer({ min: 1, max: 3000 }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 2 ** 31 }),
        (sampleRate, channels, blockSizes, seed) => {
          const totalFrames = blockSizes.reduce((a, b) => a + b, 0);
          const data = new Float32Array(totalFrames * channels);
          let x = seed || 1;
          for (let i = 0; i < data.length; i++) {
            x = (x * 1103515245 + 12345) & 0x7fffffff;
            data[i] = (x / 0x7fffffff) * 2.2 - 1.1; // includes a little clipping
          }
          const pps = 100;
          const length = Math.ceil((totalFrames / sampleRate) * pps) + 1;
          const peaks = new Float32Array(length);
          let frame = 0;
          for (const size of blockSizes) {
            const block = data.subarray(frame * channels, (frame + size) * channels);
            accumulatePeaks(peaks, pps, block, channels, size, sampleRate, frame / sampleRate);
            frame += size;
          }
          const want = reference(data, channels, sampleRate, pps, length);
          for (let i = 0; i < length; i++) expect(peaks[i]).toBeCloseTo(want[i]!, 5);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('ignores audio before 0 and past the end', () => {
    const peaks = new Float32Array(2);
    const block = new Float32Array(48000).fill(0.5);
    accumulatePeaks(peaks, 1, block, 1, 48000, 48000, -0.5);
    expect([...peaks]).toEqual([0.5, 0]);
    accumulatePeaks(peaks, 1, block, 1, 48000, 48000, 1.5);
    expect([...peaks]).toEqual([0.5, 0.5]);
  });

  it('caps the number of buckets for long files', () => {
    expect(peaksPerSecondFor(180)).toBe(100);
    expect(peaksPerSecondFor(4 * 3600) * 4 * 3600).toBeCloseTo(MAX_PEAKS);
  });
});
