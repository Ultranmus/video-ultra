/**
 * Small, allocation-free DSP pieces for the mixer. Pure functions over Float32Arrays — unit-tested
 * and shared by preview playback and export, so both sound the same.
 */

/**
 * Streaming linear resampler for one channel. Feed it source blocks in order; it writes output
 * samples at `ratio` source samples per output sample (source rate × speed / output rate) and
 * keeps the fractional position between calls, so block boundaries are seamless.
 */
export class Resampler {
  /** Position in the current source block, in source samples (fractional). */
  private position = 0;
  /** Last sample of the previous block (for interpolating across the boundary). */
  private previous = 0;
  private primed = false;

  constructor(public ratio: number) {}

  /** Starts over (after a seek): forget the previous block and the fractional position. */
  reset(): void {
    this.position = 0;
    this.previous = 0;
    this.primed = false;
  }

  /**
   * Resamples as much of `input` as fits into `output[outOffset…]`. Returns how many output samples
   * were written and how many input samples were consumed (the rest must be fed again).
   */
  process(
    input: Float32Array,
    output: Float32Array,
    outOffset: number,
    outCount: number,
  ): { written: number; consumed: number } {
    let written = 0;
    if (!this.primed && input.length > 0) {
      this.previous = input[0]!;
      this.primed = true;
    }
    // Sample at fractional source index `position`; index −1 is `previous` (from the last block).
    while (written < outCount) {
      const index = Math.floor(this.position);
      if (index + 1 >= input.length) break;
      const frac = this.position - index;
      const a = index < 0 ? this.previous : input[index]!;
      const b = input[index + 1]!;
      output[outOffset + written] = a + (b - a) * frac;
      written++;
      this.position += this.ratio;
    }
    // Everything before the current position's left neighbour is used up.
    const consumed = Math.max(0, Math.min(input.length, Math.floor(this.position)));
    if (consumed > 0) this.previous = input[consumed - 1]!;
    this.position -= consumed;
    return { written, consumed };
  }
}

/**
 * Gain at `localTime` (seconds into the item) for an item of `duration` seconds: `volume` with
 * linear fade-in / fade-out ramps.
 */
export function gainAt(
  localTime: number,
  duration: number,
  volume: number,
  fadeIn: number,
  fadeOut: number,
): number {
  let gain = volume;
  if (fadeIn > 0 && localTime < fadeIn) gain *= Math.max(0, localTime / fadeIn);
  const remaining = duration - localTime;
  if (fadeOut > 0 && remaining < fadeOut) gain *= Math.max(0, remaining / fadeOut);
  return gain;
}

/**
 * Adds `source` × gain into `target` over `count` samples, ramping the gain linearly from
 * `gainStart` to `gainEnd` (no clicks when volume or fades change between blocks).
 */
export function mixInto(
  target: Float32Array,
  targetOffset: number,
  source: Float32Array,
  sourceOffset: number,
  count: number,
  gainStart: number,
  gainEnd: number,
): void {
  if (gainStart === 0 && gainEnd === 0) return;
  const step = count > 1 ? (gainEnd - gainStart) / count : 0;
  let gain = gainStart;
  for (let i = 0; i < count; i++) {
    target[targetOffset + i]! += source[sourceOffset + i]! * gain;
    gain += step;
  }
}

/** Soft limiter: keeps the mix inside −1…1 without harsh clipping when several sounds add up. */
export function limit(buffer: Float32Array, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = buffer[i]!;
    if (x > 0.9 || x < -0.9) {
      // tanh-like knee above 0.9
      const sign = x < 0 ? -1 : 1;
      const over = Math.abs(x) - 0.9;
      buffer[i] = sign * (0.9 + 0.1 * (over / (over + 0.1)));
    }
  }
}
