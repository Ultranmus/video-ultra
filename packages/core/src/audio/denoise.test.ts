import { describe, expect, it } from 'vitest';
import { Denoiser } from './denoise';

const RATE = 48_000;

/** Deterministic white noise (−1…1 scaled). */
function noise(n: number, amp: number, seed = 1): Float32Array {
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    out[i] = amp * (s / 2 ** 32 - 0.5) * 2;
  }
  return out;
}

const tone = (n: number, hz: number, amp: number) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));

/** Runs both channels (same signal) through in 480-sample blocks, like the mixer. */
function run(input: Float32Array, amount: number): Float32Array {
  const d = new Denoiser();
  const l = Float32Array.from(input);
  const r = Float32Array.from(input);
  for (let i = 0; i < l.length; i += 480) {
    const n = Math.min(480, l.length - i);
    d.process(l.subarray(i, i + n), r.subarray(i, i + n), n, amount);
  }
  return l;
}

const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (to - from));
};
const db = (a: number, b: number) => 20 * Math.log10(a / b);

describe('Clean up noise', () => {
  it('turns steady noise well down', () => {
    const n = RATE * 4;
    const out = run(noise(n, 0.05), 1);
    // After it has learnt the noise (the last 2 s).
    expect(db(rms(out, RATE * 2, n), 0.05 / Math.sqrt(3))).toBeLessThan(-12);
  });

  it('keeps a voice-like tone that stands above the noise', () => {
    const n = RATE * 4;
    const noisy = noise(n, 0.02);
    const voice = tone(n, 440, 0.3);
    // The tone comes and goes (like speech with pauses) so the floor can be learnt.
    for (let i = 0; i < n; i++) if (Math.floor(i / (RATE * 0.5)) % 2 === 1) voice[i] = 0;
    const mixed = Float32Array.from(noisy, (v, i) => v + voice[i]!);
    const out = run(mixed, 0.7);
    const lag = Denoiser.latency;
    // A tone stretch late in the clip: 3.0–3.5 s (shifted by the latency).
    const a = RATE * 3 + 2000;
    const b = RATE * 3.5 - 2000;
    const kept = rms(out, a + lag, b + lag) / rms(voice, a, b);
    expect(Math.abs(20 * Math.log10(kept))).toBeLessThan(1.5);
    // A pause after it: what's left of the noise is much lower than before.
    const c = RATE * 3.5 + 4000;
    const e = RATE * 4 - 4000;
    expect(db(rms(out, c + lag, Math.min(n, e + lag)), rms(noisy, c, e))).toBeLessThan(-8);
  });

  it('passes the sound through untouched at amount 0 (only delayed)', () => {
    const n = RATE;
    const input = tone(n, 1000, 0.5);
    const out = run(input, 0);
    const lag = Denoiser.latency;
    let worst = 0;
    for (let i = lag + 2048; i < n; i++)
      worst = Math.max(worst, Math.abs(out[i]! - input[i - lag]!));
    expect(worst).toBeLessThan(1e-3);
  });

  it('silence stays silence', () => {
    const out = run(new Float32Array(RATE), 1);
    expect(rms(out, 0, RATE)).toBe(0);
  });
});
