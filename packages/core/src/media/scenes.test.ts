import { describe, expect, it } from 'vitest';
import { SCENE_FRAME_HEIGHT, SCENE_FRAME_WIDTH, SceneDetector, sceneCutTimes } from './scenes';

const W = SCENE_FRAME_WIDTH;
const H = SCENE_FRAME_HEIGHT;

/** A shot: a gradient in `colour` with a bright square moving across it by `t`. */
function frame(colour: [number, number, number], t: number, noise = 0, seed = 1): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  let s = seed;
  const square = Math.floor(t * 20) % (W - 8);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const n = noise ? ((s >> 16) % (2 * noise)) - noise : 0;
      const shade = 0.6 + (0.4 * x) / W;
      const inSquare = x >= square && x < square + 8 && y >= 10 && y < 18;
      for (let c = 0; c < 3; c++)
        out[i + c] = Math.max(0, Math.min(255, inSquare ? 250 : colour[c]! * shade + n));
      out[i + 3] = 255;
    }
  return out;
}

const run = (shots: { colour: [number, number, number]; seconds: number }[], fps = 30) => {
  const d = new SceneDetector();
  let t = 0;
  let seed = 1;
  for (const shot of shots) {
    const frames = Math.round(shot.seconds * fps);
    for (let f = 0; f < frames; f++) {
      d.push(frame(shot.colour, t, 6, seed++), t);
      t += 1 / fps;
    }
  }
  return d.cuts;
};

describe('scene detection', () => {
  it('finds hard cuts on the exact frame', () => {
    const cuts = run([
      { colour: [200, 40, 40], seconds: 2 },
      { colour: [40, 180, 60], seconds: 1.5 },
      { colour: [30, 50, 200], seconds: 2 },
      { colour: [120, 120, 120], seconds: 1 },
    ]);
    expect(cuts.map((c) => Math.round(c * 30))).toEqual([60, 105, 165]);
  });

  it('finds cuts between shots of similar colour but different pictures', () => {
    const d = new SceneDetector();
    for (let f = 0; f < 60; f++) d.push(frame([100, 100, 100], f / 30, 4, f), f / 30);
    // Same colours, flipped picture (dark left ↔ right) and square elsewhere.
    for (let f = 60; f < 120; f++) {
      const a = frame([100, 100, 100], 3 + f / 30, 4, f);
      const flipped = new Uint8Array(a.length);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          for (let c = 0; c < 4; c++)
            flipped[(y * W + x) * 4 + c] = a[(y * W + (W - 1 - x)) * 4 + c]!;
      // Brighten so the luma differs well.
      for (let i = 0; i < flipped.length; i += 4) flipped[i] = Math.min(255, flipped[i]! + 90);
      d.push(flipped, f / 30);
    }
    expect(d.cuts.map((c) => Math.round(c * 30))).toEqual([60]);
  });

  it('noise, motion and a steady fade make no cuts', () => {
    const d = new SceneDetector();
    for (let f = 0; f < 150; f++) {
      const fade = 1 - f / 200; // slow fade to dark
      const c = Math.round(180 * fade);
      d.push(frame([c, c, Math.round(c * 0.8)], f / 30, 12, f), f / 30);
    }
    expect(d.cuts).toEqual([]);
  });

  it('a one-frame flash makes one cut at most, and min scene length holds', () => {
    const d = new SceneDetector({ minScene: 1 });
    for (let f = 0; f < 90; f++) {
      const flash = f === 45;
      d.push(frame(flash ? [255, 255, 255] : [60, 90, 140], f / 30, 4, f), f / 30);
    }
    expect(d.cuts.length).toBeLessThanOrEqual(1);
  });

  it('sensitivity: low misses a subtle cut that high finds', () => {
    const shots = (s: 'low' | 'high') => {
      const d = new SceneDetector({ sensitivity: s });
      for (let f = 0; f < 60; f++) d.push(frame([120, 110, 100], f / 30, 3, f), f / 30);
      for (let f = 60; f < 120; f++) d.push(frame([150, 135, 115], f / 30, 3, f), f / 30);
      return d.cuts.length;
    };
    expect(shots('high')).toBe(1);
    expect(shots('low')).toBe(0);
  });

  it('maps media times to the clip on the timeline (speed, trims, edges)', () => {
    const F = 1000;
    const clip = { start: 10 * F, duration: 4 * F, sourceIn: 2 * F, speed: 2 };
    // Media 2 s…10 s shows over 10 s…14 s.
    expect(sceneCutTimes([1, 2.02, 4, 6, 9.99, 12], clip, F, 100)).toEqual([11 * F, 12 * F]);
  });
});
