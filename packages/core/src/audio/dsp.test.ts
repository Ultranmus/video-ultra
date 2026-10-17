import { describe, expect, it } from 'vitest';
import { gainAt, limit, mixInto, Resampler } from './dsp';

/** Feeds `input` to a resampler in blocks of `block` samples and collects all output. */
function run(ratio: number, input: Float32Array, block: number, outLength: number): Float32Array {
  const r = new Resampler(ratio);
  const out = new Float32Array(outLength);
  let written = 0;
  let pending = new Float32Array(0);
  let fed = 0;
  while (written < outLength && (fed < input.length || pending.length > 1)) {
    if (fed < input.length) {
      const next = input.subarray(fed, Math.min(input.length, fed + block));
      fed += next.length;
      const merged = new Float32Array(pending.length + next.length);
      merged.set(pending);
      merged.set(next, pending.length);
      pending = merged;
    }
    const { written: w, consumed } = r.process(pending, out, written, outLength - written);
    written += w;
    pending = pending.slice(consumed);
    if (w === 0 && fed >= input.length) break;
  }
  return out.subarray(0, written);
}

describe('Resampler', () => {
  it('passes samples through at ratio 1', () => {
    const input = Float32Array.from({ length: 100 }, (_, i) => i);
    const out = run(1, input, 17, 90);
    expect(Array.from(out.subarray(0, 5))).toEqual([0, 1, 2, 3, 4]);
    expect(out[89]).toBe(89);
  });

  it('downsamples 2:1 and upsamples 1:2 with linear interpolation', () => {
    const ramp = Float32Array.from({ length: 200 }, (_, i) => i);
    expect(Array.from(run(2, ramp, 33, 50).subarray(0, 4))).toEqual([0, 2, 4, 6]);
    expect(Array.from(run(0.5, ramp, 33, 50).subarray(0, 5))).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('is seamless across block boundaries (44.1 kHz → 48 kHz sine)', () => {
    const rate = 44100 / 48000;
    const sine = Float32Array.from({ length: 44100 }, (_, i) =>
      Math.sin((2 * Math.PI * 440 * i) / 44100),
    );
    const small = run(rate, sine, 128, 47000);
    const big = run(rate, sine, 44100, 47000);
    let maxDiff = 0;
    for (let i = 0; i < Math.min(small.length, big.length); i++)
      maxDiff = Math.max(maxDiff, Math.abs(small[i]! - big[i]!));
    expect(maxDiff).toBeLessThan(1e-6);
    // And it is still a 440 Hz sine at 48 kHz.
    const expected = Math.sin((2 * Math.PI * 440 * 1000) / 48000);
    expect(small[1000]).toBeCloseTo(expected, 2);
  });
});

describe('gain and mixing', () => {
  it('ramps fades in and out', () => {
    expect(gainAt(0, 10, 1, 1, 1)).toBe(0);
    expect(gainAt(0.5, 10, 1, 1, 1)).toBe(0.5);
    expect(gainAt(5, 10, 0.8, 1, 1)).toBe(0.8);
    expect(gainAt(9.5, 10, 1, 1, 1)).toBeCloseTo(0.5);
    expect(gainAt(5, 10, 1, 0, 0)).toBe(1);
  });

  it('mixes with a click-free gain ramp', () => {
    const target = new Float32Array(4).fill(0.1);
    mixInto(target, 0, new Float32Array([1, 1, 1, 1]), 0, 4, 0, 1);
    expect(Array.from(target).map((v) => Math.round(v * 100) / 100)).toEqual([
      0.1, 0.35, 0.6, 0.85,
    ]);
  });

  it('limits loud mixes softly into −1…1', () => {
    const loud = new Float32Array([0.5, 1.5, -3, 0.95]);
    limit(loud, loud.length);
    expect(loud[0]).toBe(0.5);
    for (const v of loud) expect(Math.abs(v)).toBeLessThan(1);
    expect(loud[1]).toBeGreaterThan(0.9);
  });
});
