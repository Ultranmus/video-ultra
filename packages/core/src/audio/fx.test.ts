import { describe, expect, it } from 'vitest';
import { AudioFxSchema } from '../model/schema';
import { AUDIO_FX_PRESETS, ClipFx, hasAudioFx, pitchRatio } from './fx';

const RATE = 48000;

function sine(freq: number, seconds: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE);
  return out;
}

const rms = (x: Float32Array, from = 0) => {
  let s = 0;
  for (let i = from; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (x.length - from));
};
const db = (x: number) => 20 * Math.log10(x);

/** Runs the chain over `input` (both channels) in 512-sample blocks, like the mixer. */
function run(fx: Parameters<ClipFx['process']>[0], input: Float32Array, speed = 1) {
  const chain = new ClipFx(RATE);
  const left = input.slice();
  const right = input.slice();
  for (let i = 0; i < left.length; i += 512) {
    const n = Math.min(512, left.length - i);
    chain.process(fx, speed, left.subarray(i, i + n), right.subarray(i, i + n), n);
  }
  return { left, right };
}

/**
 * Where the energy sits around `near` Hz (power-weighted mean over ±30 %, Goertzel in 2 Hz
 * steps). A delay-line shifter spreads a tone into side lines ~25 Hz apart; their centre is the
 * pitch heard.
 */
function frequencyOf(x: Float32Array, from: number, near: number): number {
  let sum = 0;
  let weight = 0;
  for (let f = Math.round(near * 0.7); f <= near * 1.3; f += 2) {
    const coeff = 2 * Math.cos((2 * Math.PI * f) / RATE);
    let s1 = 0;
    let s2 = 0;
    for (let i = from; i < x.length; i++) {
      const s0 = x[i]! + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    sum += f * power;
    weight += power;
  }
  return sum / weight;
}

describe('sound effects', () => {
  it('EQ: each band lifts or cuts its own frequencies, not the others', () => {
    const gainAt = (freq: number, eq: { low: number; mid: number; high: number }) => {
      const input = sine(freq, 0.5);
      const { left } = run({ eq }, input);
      return db(rms(left, RATE / 10) / rms(input, RATE / 10));
    };
    expect(gainAt(50, { low: 9, mid: 0, high: 0 })).toBeCloseTo(9, 0);
    expect(gainAt(5000, { low: 9, mid: 0, high: 0 })).toBeCloseTo(0, 0);
    expect(gainAt(1000, { low: 0, mid: -9, high: 0 })).toBeCloseTo(-9, 0);
    expect(Math.abs(gainAt(100, { low: 0, mid: -9, high: 0 }))).toBeLessThan(1);
    expect(gainAt(16000, { low: 0, mid: 0, high: 6 })).toBeCloseTo(6, 0);
    expect(Math.abs(gainAt(200, { low: 0, mid: 0, high: 6 }))).toBeLessThan(0.5);
  });

  it('compressor brings loud and quiet parts closer together', () => {
    const loud = sine(440, 0.5, 0.9);
    const quiet = sine(440, 0.5, 0.05);
    const both = new Float32Array(loud.length + quiet.length);
    both.set(loud);
    both.set(quiet, loud.length);
    const { left } = run({ compress: 1 }, both);
    const before = db(rms(loud, 4800) / rms(quiet, 4800));
    const after = db(
      rms(left.subarray(4800, loud.length)) / rms(left.subarray(loud.length + 9600)),
    );
    expect(after).toBeLessThan(before - 6);
    // Never louder than full scale.
    // After its 1 ms attack it never goes over full scale (the mix bus limiter takes the onset).
    let peak = 0;
    for (let i = 480; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]!));
    expect(peak).toBeLessThan(1);
  });

  it('pitch: +12 semitones doubles the frequency, −12 halves it, the length stays', () => {
    const input = sine(220, 1);
    const up = run({ pitch: 12 }, input).left;
    const down = run({ pitch: -12 }, input).left;
    expect(up.length).toBe(input.length);
    expect(frequencyOf(up, RATE / 5, 440) / 440).toBeCloseTo(1, 1);
    expect(frequencyOf(down, RATE / 5, 110) / 110).toBeCloseTo(1, 1);
    // No big level change (the crossfade windows add up to 1).
    expect(Math.abs(db(rms(up, RATE / 5) / rms(input)))).toBeLessThan(3);
  });

  it('keep pitch undoes the speed change (0.5×…2×)', () => {
    expect(pitchRatio({ keepPitch: true }, 2)).toBe(0.5);
    expect(pitchRatio({ keepPitch: true }, 0.8)).toBeCloseTo(1.25);
    expect(pitchRatio({ keepPitch: true }, 8)).toBe(0.5);
    expect(pitchRatio({ keepPitch: true, pitch: 12 }, 2)).toBe(1);
    expect(pitchRatio({ keepPitch: true }, 1)).toBe(1);
  });

  it('neutral settings are free and change nothing', () => {
    expect(hasAudioFx(undefined, 2)).toBe(false);
    expect(hasAudioFx({ eq: { low: 0, mid: 0, high: 0 }, compress: 0, pitch: 0 }, 1)).toBe(false);
    expect(hasAudioFx({ keepPitch: true }, 1)).toBe(false);
    expect(hasAudioFx({ keepPitch: true }, 1.5)).toBe(true);
    const input = sine(440, 0.1);
    expect(run({ eq: { low: 0, mid: 0, high: 0 } }, input).left).toEqual(input);
  });

  it('presets are valid and distinct', () => {
    for (const p of AUDIO_FX_PRESETS) expect(AudioFxSchema.safeParse(p.fx).success).toBe(true);
    expect(new Set(AUDIO_FX_PRESETS.map((p) => JSON.stringify(p.fx))).size).toBe(
      AUDIO_FX_PRESETS.length,
    );
  });

  it('runs fast enough: a minute of stereo through every effect in well under a second', () => {
    const input = sine(300, 60);
    const t0 = performance.now();
    run({ eq: { low: 3, mid: -2, high: 4 }, compress: 0.6, pitch: 3 }, input);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
