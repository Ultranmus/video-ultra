import { describe, expect, it } from 'vitest';
import { keepWords, ownedSpan, spreadCollapsed, windowsOf } from './windows';

async function* pieces(total: number, size: number, rate: number) {
  let left = total;
  let t = 0;
  while (left > 0) {
    const n = Math.min(size, left);
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = (t + i) / rate; // value = time in s
    t += n;
    left -= n;
    yield p;
  }
}

describe('windows', () => {
  it('cuts long sound into 30 s windows overlapping by 2 s, any piece size', async () => {
    const rate = 100;
    const out = [];
    for await (const w of windowsOf(pieces(65 * rate, 7 * rate, rate), rate)) out.push(w);
    expect(out.map((w) => [w.index, w.audio.length, w.isLast])).toEqual([
      [0, 3000, false],
      [1, 3000, false],
      [2, 900, true],
    ]);
    // Window 1 starts at 28 s, window 2 at 56 s.
    expect(out[1]!.audio[0]).toBeCloseTo(28);
    expect(out[2]!.audio[0]).toBeCloseTo(56);
    expect(out[2]!.audio.at(-1)).toBeCloseTo(64.99);
  });

  it('short sound is one window; an exact 30 s too', async () => {
    const rate = 100;
    const one = [];
    for await (const w of windowsOf(pieces(12 * rate, 30 * rate, rate), rate)) one.push(w);
    expect(one.map((w) => [w.index, w.audio.length, w.isLast])).toEqual([[0, 1200, true]]);
    const exact = [];
    for await (const w of windowsOf(pieces(30 * rate, 30 * rate, rate), rate)) exact.push(w);
    expect(exact.map((w) => [w.index, w.audio.length, w.isLast])).toEqual([[0, 3000, true]]);
  });

  it('keeps each word once, from the window that owns it', () => {
    expect(ownedSpan(0, false)).toEqual({ from: 0, to: 29 });
    expect(ownedSpan(1, true)).toEqual({ from: 29, to: Infinity });
    // A word at 28.5 s (both windows hear it): window 0 keeps it, window 1 drops it.
    const w0 = keepWords([{ text: ' cup', start: 28.4, end: 28.7 }], 0, false);
    const w1 = keepWords([{ text: 'cup', start: 0.4, end: 0.7 }], 1, true);
    expect(w0).toEqual([{ text: 'cup', start: 28.4, end: 28.7 }]);
    expect(w1).toEqual([]);
    // Words "heard" past a short window's real sound are dropped; ends are clamped to it.
    expect(keepWords([{ text: 'ghost', start: 5, end: 6 }], 2, true, 2.4)).toEqual([]);
    expect(keepWords([{ text: 'end', start: 2, end: 9 }], 2, true, 2.4)[0]!.end).toBeCloseTo(58.4);
    // Empty and broken entries are tidied.
    expect(keepWords([{ text: '  ', start: 1, end: 2 }], 0, true)).toEqual([]);
    expect(keepWords([{ text: 'x', start: 3, end: 2 }], 0, true)[0]!.end).toBeCloseTo(3.01);
  });
});

describe('sound check', () => {
  it('finds speech-loud frames and drops words said in silence', async () => {
    const { activeFrames, activeShare, wordsWithSound } = await import('./windows');
    const a = new Float32Array(16_000 * 2);
    // 0.5–1.0 s: a loud tone; the rest a faint hiss.
    for (let i = 0; i < a.length; i++)
      a[i] = i >= 8000 && i < 16000 ? 0.2 * Math.sin(i / 5) : 0.001 * Math.sin(i * 1.7);
    const active = activeFrames(a);
    expect(activeShare(active)).toBeCloseTo(0.25, 1);
    expect(
      wordsWithSound(
        [
          { text: 'real', start: 0.6, end: 0.8 },
          { text: 'ghost', start: 1.5, end: 1.8 },
        ],
        active,
      ).map((w) => (w as { text: string }).text),
    ).toEqual(['real']);
    expect(activeShare(activeFrames(new Float32Array(32_000)))).toBe(0);
  });

  it('spreads words whose timing collapsed over the sound, in order', () => {
    // 30 s window: sound from 2 s to 20 s (20 ms frames).
    const active = new Uint8Array(1500);
    active.fill(1, 100, 1000);
    const collapsed = ['one', 'two', 'three', 'four'].map((text) => ({
      text,
      start: 29.9,
      end: 30,
    }));
    const out = spreadCollapsed(collapsed, active);
    expect(out[0]!.start).toBeCloseTo(2, 1);
    expect(out.at(-1)!.end).toBeLessThanOrEqual(20.1);
    for (let i = 1; i < out.length; i++) expect(out[i]!.start).toBeGreaterThan(out[i - 1]!.start);
    // Believable timing is left alone.
    const fine = [
      { text: 'a', start: 1, end: 1.2 },
      { text: 'b', start: 3, end: 3.2 },
      { text: 'c', start: 6, end: 6.4 },
    ];
    expect(spreadCollapsed(fine, active)).toEqual(fine);
  });
});
