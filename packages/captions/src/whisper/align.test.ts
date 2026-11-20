import { describe, expect, it } from 'vitest';
import { firstFrames, heardUntil, tokenStartTimes } from './align';

/** One head, `rows` tokens over `frames` frames; token r attends to frames [r*w, (r+1)*w). */
function diagonal(rows: number, frames: number, width: number): Float32Array {
  const m = new Float32Array(rows * frames);
  for (let r = 0; r < rows; r++)
    for (let f = r * width; f < Math.min(frames, (r + 1) * width); f++) m[r * frames + f] = 1;
  return m;
}

describe('early end (DECISIONS #208)', () => {
  it('finds where the heard text ends, not where the warping stretches it', () => {
    // 5 tokens said in the first 1 s (50 frames each 10), then 29 s with no token.
    const frames = 1500;
    const head = diagonal(5, frames, 10);
    expect(heardUntil([head], frames, 0, 4)).toBeCloseTo(0.6, 1);
    // The warping alone runs the last token to the window's end.
    const jumps = tokenStartTimes([head], 5, frames);
    expect(jumps[5]).toBeCloseTo(30);
    // Timed within what was heard, each token starts where it is said.
    const keep = 60;
    const near = tokenStartTimes(firstFrames([head], 5, frames, keep), 5, keep);
    expect(near[4]).toBeCloseTo(0.8, 1);
  });

  it('keeps the first frames of every row', () => {
    const head = Float32Array.from([1, 2, 3, 4, 5, 6]); // 2 rows × 3 frames
    expect(Array.from(firstFrames([head], 2, 3, 2)[0]!)).toEqual([1, 2, 4, 5]);
  });
});
