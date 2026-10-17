/**
 * Waveform peaks: max |sample| per fixed time bucket, built incrementally from decoded audio so the
 * whole PCM is never held in memory. Pure maths, no browser APIs (unit-tested in Node).
 */

/** Audio peaks of one asset, for drawing a waveform on the timeline. */
export interface Waveform {
  /** Buckets per second of media. */
  peaksPerSecond: number;
  /** `peaks[i]` = max |sample| over all channels in bucket i (`i / peaksPerSecond` s), 0…1. */
  peaks: Float32Array;
  /** Media duration, seconds. */
  duration: number;
}

/** Default resolution: 100 buckets per second (10 ms — enough for any timeline zoom we offer). */
export const DEFAULT_PEAKS_PER_SECOND = 100;
/** Cap on buckets per asset (1 MB of Float32): long files get coarser buckets instead of more memory. */
export const MAX_PEAKS = 262_144;

/** Buckets per second for a file of `duration` seconds (100, or fewer for very long files). */
export function peaksPerSecondFor(duration: number): number {
  if (!(duration > 0)) return DEFAULT_PEAKS_PER_SECOND;
  return Math.min(DEFAULT_PEAKS_PER_SECOND, MAX_PEAKS / duration);
}

/**
 * Folds one block of interleaved samples into `peaks`. `timestamp` is the block's start (s).
 * Frames before 0 or past the end of `peaks` are ignored. No allocation — safe in a decode loop.
 */
export function accumulatePeaks(
  peaks: Float32Array,
  peaksPerSecond: number,
  data: Float32Array,
  channels: number,
  frames: number,
  sampleRate: number,
  timestamp: number,
): void {
  const framesPerBucket = sampleRate / peaksPerSecond;
  // Fractional frame position of the block start in "bucket units".
  const startPos = timestamp * peaksPerSecond;
  let bucket = Math.floor(startPos + 1e-9);
  // Frame index (within this block) where the next bucket starts.
  let nextBoundary = Math.ceil((bucket + 1 - startPos) * framesPerBucket - 1e-6);
  let max = bucket >= 0 && bucket < peaks.length ? peaks[bucket]! : 0;
  const total = frames * channels;
  for (let frame = 0, i = 0; i < total; frame++) {
    if (frame >= nextBoundary) {
      if (bucket >= 0 && bucket < peaks.length) peaks[bucket] = max > 1 ? 1 : max;
      bucket++;
      nextBoundary = Math.ceil((bucket + 1 - startPos) * framesPerBucket - 1e-6);
      max = bucket >= 0 && bucket < peaks.length ? peaks[bucket]! : 0;
    }
    for (let c = 0; c < channels; c++, i++) {
      const v = data[i]!;
      const a = v < 0 ? -v : v;
      if (a > max) max = a;
    }
  }
  if (bucket >= 0 && bucket < peaks.length) peaks[bucket] = max > 1 ? 1 : max;
}
