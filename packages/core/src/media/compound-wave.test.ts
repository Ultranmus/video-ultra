import { describe, expect, it } from 'vitest';
import { combineItems, insertMain, setSpeed } from '../edit/ops';
import { mainTrack, sequentialIds } from '../model/project';
import type { Project, VideoItem } from '../model/schema';
import { fixtureProject, videoItem } from '../test/fixtures';
import { compoundSoundParts, mixPeaks } from './compound-wave';
import type { Waveform } from './peaks';

/** A file waveform whose bucket i holds `level(i / 100 s)`. */
function wave(seconds: number, level: (t: number) => number): Waveform {
  const peaks = new Float32Array(seconds * 100);
  for (let i = 0; i < peaks.length; i++) peaks[i] = level(i / 100);
  return { peaksPerSecond: 100, peaks, duration: seconds };
}

/** vidA: 0.1 for its first 5 s, 0.5 after; vidB: a steady 0.2. */
const waves: Record<string, Waveform> = {
  vidA: wave(10, (t) => (t < 5 ? 0.1 : 0.5)),
  vidB: wave(4, () => 0.2),
};
const waveOf = (id: string) => waves[id] ?? null;
const at = (w: Waveform, seconds: number) => w.peaks[Math.floor(seconds * w.peaksPerSecond)]!;

function combined(): { p: Project; clip: VideoItem } {
  const p = fixtureProject();
  insertMain(p, videoItem('a', 'vidA', 3, 4)); // vidA 4…7 s
  insertMain(p, videoItem('b', 'vidB', 4));
  const id = combineItems(p, ['a', 'b'], sequentialIds('n'));
  return { p, clip: mainTrack(p).items.find((i) => i.id === id) as VideoItem };
}

describe('combined clip waveform', () => {
  it('places each sound at its place and trim inside', () => {
    const { p, clip } = combined();
    const { parts } = compoundSoundParts(p, clip.assetId);
    expect(parts.map((x) => [x.assetId, x.at, x.end, x.from, x.speed])).toEqual([
      ['vidA', 0, 3, 4, 1],
      ['vidB', 3, 7, 0, 1],
    ]);
    const w = mixPeaks(7, parts, waveOf);
    expect(at(w, 0.5)).toBeCloseTo(0.1); // vidA at 4.5 s
    expect(at(w, 1.5)).toBeCloseTo(0.5); // vidA at 5.5 s
    expect(at(w, 4)).toBeCloseTo(0.2); // vidB
  });

  it('leaves out muted clips and muted tracks, scales by volume', () => {
    const { p, clip } = combined();
    const inside = p.assets[clip.assetId]!.tracks![0]!;
    (inside.items[0] as VideoItem).muted = true;
    (inside.items[1] as VideoItem).volume = 0.5;
    const w = mixPeaks(7, compoundSoundParts(p, clip.assetId).parts, waveOf);
    expect(at(w, 1)).toBe(0);
    expect(at(w, 4)).toBeCloseTo(0.1);
    inside.muted = true;
    expect(compoundSoundParts(p, clip.assetId).parts).toEqual([]);
  });

  it('reads through a combined clip inside another, with its speed', () => {
    const { p, clip } = combined();
    setSpeed(p, clip.id, 2, sequentialIds('q')); // the inside at 2×: 3.5 s long
    const outer = combineItems(p, [clip.id], sequentialIds('o'));
    const top = mainTrack(p).items.find((i) => i.id === outer) as VideoItem;
    const { parts, compounds } = compoundSoundParts(p, top.assetId);
    expect(compounds).toEqual([top.assetId, clip.assetId]);
    expect(parts.map((x) => [x.assetId, x.at, x.end, x.from, x.speed])).toEqual([
      ['vidA', 0, 1.5, 4, 2],
      ['vidB', 1.5, 3.5, 0, 2],
    ]);
    const w = mixPeaks(3.5, parts, waveOf);
    expect(at(w, 0.2)).toBeCloseTo(0.1); // vidA at 4.4 s
    expect(at(w, 1)).toBeCloseTo(0.5); // vidA at 6 s
    expect(at(w, 2)).toBeCloseTo(0.2);
    expect(w.duration).toBe(3.5);
  });

  it('adds overlapping sounds (clamped to 1) and skips files not known yet', () => {
    const parts = [
      { assetId: 'vidA', at: 0, end: 2, from: 5, speed: 1, gain: 1.5 },
      { assetId: 'vidB', at: 1, end: 2, from: 0, speed: 1, gain: 1 },
      { assetId: 'nope', at: 0, end: 2, from: 0, speed: 1, gain: 1 },
    ];
    const w = mixPeaks(2, parts, waveOf);
    expect(at(w, 0.5)).toBeCloseTo(0.75);
    expect(at(w, 1.5)).toBeCloseTo(0.95);
    parts[0]!.gain = 2;
    expect(at(mixPeaks(2, parts, waveOf), 1.5)).toBe(1);
  });
});
