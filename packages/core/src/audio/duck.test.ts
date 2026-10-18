import { describe, expect, it } from 'vitest';
import { applyDuck, DUCK_TUNING, DuckFollower, hasDucking, presenceFor } from './duck';
import { fixtureProject, audioItem } from '../test/fixtures';
import { addToLane } from '../edit/ops';

const RATE = 48000;

/** A 300 Hz "voice" at `amplitude` between `from` and `to` seconds, silence elsewhere. */
function voice(seconds: number, parts: [from: number, to: number][], amplitude = 0.3) {
  const x = new Float32Array(Math.round(seconds * RATE));
  for (const [from, to] of parts)
    for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++)
      x[i] = amplitude * Math.sin((2 * Math.PI * 300 * i) / RATE);
  return x;
}

/** Runs the follower over `key` in blocks (sizes cycle through `blocks`), from sample `start`. */
function follow(key: Float32Array, blocks: number[], start = 0): Float32Array {
  const follower = new DuckFollower(RATE);
  const out = new Float32Array(key.length);
  const scratch = new Float32Array(Math.max(...blocks));
  const presence = new Float32Array(Math.max(...blocks));
  let b = 0;
  for (let at = start; at < key.length;) {
    const n = Math.min(blocks[b++ % blocks.length]!, key.length - at);
    scratch.set(key.subarray(at, at + n));
    follower.process(scratch, n, at, presence);
    out.set(presence.subarray(0, n), at);
    at += n;
  }
  return out;
}

const at = (curve: Float32Array, s: number) => curve[Math.round(s * RATE)]!;

describe('presenceFor', () => {
  it('is 0 below the floor, 1 above full, smooth and rising in between', () => {
    const rms = (db: number) => 10 ** (db / 20);
    expect(presenceFor(0, -40, -30)).toBe(0);
    expect(presenceFor(rms(-50), -40, -30)).toBe(0);
    expect(presenceFor(rms(-20), -40, -30)).toBe(1);
    expect(presenceFor(rms(-35), -40, -30)).toBeCloseTo(0.5, 5);
    let last = 0;
    for (let db = -40; db <= -30; db += 0.5) {
      const p = presenceFor(rms(db), -40, -30);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });
});

describe('DuckFollower', () => {
  it('ducks while the voice speaks and comes back after hold + release', () => {
    const curve = follow(voice(6, [[1, 3]]), [2048]);
    expect(at(curve, 0.5)).toBe(0); // silence: no duck
    // Attack (40 ms time constant): most of the way down within 0.15 s.
    expect(at(curve, 1.15)).toBeGreaterThan(0.9);
    expect(at(curve, 2)).toBeGreaterThan(0.999);
    // Hold: still fully down 0.25 s after the voice stopped.
    expect(at(curve, 3.25)).toBeGreaterThan(0.99);
    // Release (450 ms): partly back at 3.6 s, gone by 5.5 s.
    const mid = at(curve, 3.6);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.95);
    expect(at(curve, 5.5)).toBeLessThan(0.02);
  });

  it('gives the same curve for any block size (preview 2048 vs export ~1600, odd sizes)', () => {
    const key = voice(4, [
      [0.5, 1.7],
      [2.1, 3.0],
    ]);
    const a = follow(key, [2048]);
    for (const blocks of [[1600], [128], [1000, 37, 4096, 513]]) {
      const b = follow(key, blocks);
      let max = 0;
      for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
      expect(max).toBeLessThan(1e-6);
    }
  });

  it('never steps: the gain changes by a tiny amount per sample (no clicks)', () => {
    const curve = follow(voice(4, [[1, 2]], 1), [2048]);
    let max = 0;
    for (let i = 1; i < curve.length; i++) max = Math.max(max, Math.abs(curve[i]! - curve[i - 1]!));
    // Fastest change: the attack's first window, ≤ (1 − e^(−5 ms / 40 ms)) / 240 samples.
    const bound = (1 - Math.exp(-DUCK_TUNING.window / DUCK_TUNING.attack)) / 240;
    expect(max).toBeLessThanOrEqual(bound + 1e-7);
  });

  it("doesn't pump in the short gaps between words", () => {
    // Words of 0.4 s with 0.2 s pauses.
    const parts: [number, number][] = [];
    for (let t = 1; t < 4; t += 0.6) parts.push([t, t + 0.4]);
    const curve = follow(voice(5, parts), [2048]);
    let min = 1;
    for (let s = 1.3; s < 3.9; s += 0.001) min = Math.min(min, at(curve, s));
    expect(min).toBeGreaterThan(0.99);
  });

  it('ignores quiet room noise and low rumble', () => {
    const n = 3 * RATE;
    const noise = new Float32Array(n);
    let seed = 1;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      // −50 dBFS hiss + a loud 40 Hz hum (filtered out by the speech band).
      noise[i] = 0.003 * (seed / 2 ** 32 - 0.5) * 3.46 + 0.3 * Math.sin((2 * Math.PI * 40 * i) / n);
    }
    const curve = follow(noise, [2048]);
    let max = 0;
    for (const v of curve) max = Math.max(max, v);
    expect(max).toBeLessThan(0.05);
  });

  it('primes after a seek: starting mid-sentence is already ducked, like the continuous run', () => {
    const key = voice(4, [[0.5, 3.5]]);
    const continuous = follow(key, [2048]);
    const seeked = follow(key, [2048], Math.round(2 * RATE));
    expect(at(seeked, 2)).toBeGreaterThan(0.99);
    let max = 0;
    for (let i = 2 * RATE; i < key.length; i++)
      max = Math.max(max, Math.abs(continuous[i]! - seeked[i]!));
    expect(max).toBeLessThan(0.01);
  });

  it('works at 44.1 kHz with the same timing', () => {
    const follower = new DuckFollower(44100);
    const x = new Float32Array(44100 * 2);
    for (let i = 22050; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 300 * i) / 44100);
    const out = new Float32Array(x.length);
    follower.process(x, x.length, 0, out);
    expect(out[22050 - 1]).toBe(0);
    expect(out[Math.round(44100 * 0.65)]!).toBeGreaterThan(0.9);
  });
});

describe('applyDuck', () => {
  it('scales by 1 − amount × presence', () => {
    const buffer = Float32Array.from([1, 1, 1, 1]);
    applyDuck(buffer, 4, Float32Array.from([0, 0, 0.5, 1, 1]), 1, 0.75);
    expect([...buffer]).toEqual([1, 1 - 0.375, 0.25, 0.25]);
    const untouched = Float32Array.from([1, 1]);
    applyDuck(untouched, 2, Float32Array.from([1, 1]), 0, 0);
    expect([...untouched]).toEqual([1, 1]);
  });
});

describe('hasDucking', () => {
  it('is true only when an unmuted sounding item on an unmuted track is set to duck', () => {
    const project = fixtureProject();
    const music = audioItem('m', 0, 5);
    addToLane(project, music, () => 'lane');
    expect(hasDucking(project)).toBe(false);
    const placed = project.tracks[1]!.items[0]!;
    if (placed.kind !== 'audio') throw new Error('expected audio');
    placed.duck = 0.75;
    expect(hasDucking(project)).toBe(true);
    placed.muted = true;
    expect(hasDucking(project)).toBe(false);
    placed.muted = false;
    project.tracks[1]!.muted = true;
    expect(hasDucking(project)).toBe(false);
  });
});
