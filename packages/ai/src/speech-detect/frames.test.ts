import { describe, expect, it } from 'vitest';
import { isQuiet, voiceOf, voicedShare } from '../align-words';
import { speechFrames } from './frames';

describe('speech frames', () => {
  it('turns the detector’s chances into 20 ms frames, filling short gaps', () => {
    // 10 windows of 32 ms: speech, a 64 ms dip, speech, then a long silence.
    const chance = Float32Array.from([0.9, 0.9, 0.2, 0.2, 0.9, 0.9, 0.1, 0.1, 0.1, 0.1]);
    const voice = speechFrames(chance, 10 * 512);
    const ms = (f: number) => f * 20;
    const on = [...voice].map((v, f) => (v ? ms(f) : null)).filter((x) => x !== null);
    expect(on[0]).toBe(0);
    // The 64 ms dip is inside the speech; the speech ends with the 6th window (192 ms).
    expect(on).toContain(80);
    expect(Math.max(...(on as number[]))).toBeLessThan(200);
  });
});

describe('quiet pieces', () => {
  const RATE = 16_000;
  const tone = (seconds: number, level: number) =>
    Float32Array.from(
      { length: seconds * RATE },
      (_, i) => level * Math.sin((2 * Math.PI * 220 * i) / RATE),
    );

  it('music throughout isn’t “quiet”, though loudness finds no voice in it', () => {
    const music = tone(5, 0.2);
    expect(voicedShare(voiceOf(music))).toBeLessThan(0.04);
    expect(isQuiet(music)).toBe(false);
  });

  it('a hushed room is quiet', () => {
    expect(isQuiet(tone(5, 0.001))).toBe(true);
    expect(isQuiet(new Float32Array(RATE))).toBe(true);
  });
});
