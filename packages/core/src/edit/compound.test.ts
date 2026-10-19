import { describe, expect, it } from 'vitest';
import { parseProject } from '../model/migrate';
import { checkInvariants } from '../model/invariants';
import { mainTrack, sequentialIds } from '../model/project';
import type { Project, VideoItem } from '../model/schema';
import { fromSeconds } from '../model/time';
import { fixtureProject, imageItem, stickerItem, textItem, videoItem } from '../test/fixtures';
import {
  addToLane,
  assetInUse,
  combineItems,
  insertMain,
  refreshCompound,
  separateItem,
  setSpeed,
  setTransition,
  trimItem,
} from './ops';
import { EditError } from './ops';

const s = fromSeconds;

/** Main: a (5 s) b (4 s) c (3 s photo); lanes: a title over b, a sticker over c. */
function project(): Project {
  const p = fixtureProject();
  const ids = sequentialIds('x');
  insertMain(p, videoItem('a', 'vidA', 5));
  insertMain(p, videoItem('b', 'vidB', 4));
  insertMain(p, imageItem('c', 3));
  setTransition(p, 'b', { type: 'fade', duration: s(0.5) } as never);
  addToLane(p, textItem('t', 6, 2), ids);
  addToLane(p, stickerItem('k', 10, 1), ids);
  return p;
}

const ok = (p: Project) => expect(checkInvariants(p)).toEqual([]);

describe('combined clips', () => {
  it('combines next-to-each-other main clips and a layer into one clip in their place', () => {
    const p = project();
    const id = combineItems(p, ['b', 'c', 't'], sequentialIds('n'));
    ok(p);
    const main = mainTrack(p).items;
    expect(main.map((i) => i.id)).toEqual(['a', id]);
    const clip = main[1] as VideoItem;
    expect(clip.start).toBe(s(5));
    expect(clip.duration).toBe(s(7));
    // The transition into b now goes into the combined clip.
    expect(clip.transitionIn?.duration).toBe(s(0.5));
    const asset = p.assets[clip.assetId]!;
    expect(asset.kind).toBe('compound');
    expect(asset.duration).toBe(s(7));
    expect(asset.hasAudio).toBe(true); // vidB has sound
    // Inside: b and c back to back from 0, the title 1 s in.
    expect(asset.tracks![0]!.items.map((i) => [i.id, i.start])).toEqual([
      ['b', 0],
      ['c', s(4)],
    ]);
    expect(asset.tracks![1]!.items.map((i) => [i.id, i.start])).toEqual([['t', s(1)]]);
    // The title's lane is gone from the timeline; the sticker stays.
    expect(p.tracks.flatMap((t) => t.items.map((i) => i.id))).toEqual(['a', id, 'k']);
  });

  it('refuses clips that are not next to each other, and captions', () => {
    const p = project();
    expect(() => combineItems(p, ['a', 'c'], sequentialIds('n'))).toThrow(EditError);
  });

  it('layers alone become a combined layer at the first one’s start', () => {
    const p = project();
    const id = combineItems(p, ['t', 'k'], sequentialIds('n'));
    ok(p);
    const clip = p.tracks.flatMap((t) => t.items).find((i) => i.id === id) as VideoItem;
    expect(clip.start).toBe(s(6));
    expect(clip.duration).toBe(s(5)); // 6 s → 11 s
    expect(p.assets[clip.assetId]!.tracks![0]!.items).toEqual([]);
  });

  it('separate puts the pieces back where they were (round trip)', () => {
    const p = project();
    const before = structuredClone(p);
    const id = combineItems(p, ['b', 'c', 't'], sequentialIds('n'));
    const assetId = (mainTrack(p).items[1] as VideoItem).assetId;
    const pieces = separateItem(p, id, sequentialIds('m'));
    ok(p);
    expect(pieces).toHaveLength(3);
    expect(p.assets[assetId]).toBeUndefined();
    // Same places and lengths (a re-made lane may sit in another row of its kind).
    const timing = (q: Project) =>
      q.tracks
        .flatMap((t) => t.items.map((i) => `${t.kind}:${i.kind}:${i.start}:${i.duration}`))
        .sort();
    expect(timing(p)).toEqual(timing(before));
    expect((mainTrack(p).items[1] as VideoItem).transitionIn?.duration).toBe(s(0.5));
  });

  it('separate applies the clip’s trim and speed to the pieces', () => {
    const p = project();
    const id = combineItems(p, ['b', 'c'], sequentialIds('n'));
    trimItem(p, id, 'start', s(1)); // starts 1 s into b
    setSpeed(p, id, 2, sequentialIds('q'));
    ok(p);
    const pieces = separateItem(p, id, sequentialIds('m'));
    ok(p);
    const main = mainTrack(p).items;
    const [b, c] = pieces.map((pid) => main.find((i) => i.id === pid)!) as [VideoItem, VideoItem];
    expect(b.sourceIn).toBe(s(1));
    expect(b.speed).toBe(2);
    expect(b.duration).toBe(s(1.5)); // 3 s of b at 2×
    expect(c.duration).toBe(s(1.5)); // 3 s photo at 2×
  });

  it('clips playing a combined clip are shortened when its inside gets shorter', () => {
    const p = project();
    const id = combineItems(p, ['b', 'c'], sequentialIds('n'));
    const assetId = (mainTrack(p).items[1] as VideoItem).assetId;
    const asset = p.assets[assetId]!;
    asset.tracks![0]!.items.pop(); // the photo goes
    refreshCompound(p, assetId);
    ok(p);
    expect(asset.duration).toBe(s(4));
    expect(mainTrack(p).items.find((i) => i.id === id)!.duration).toBe(s(4));
  });

  it('a combined clip can’t contain itself', () => {
    const p = project();
    const id = combineItems(p, ['b', 'c'], sequentialIds('n'));
    const clip = mainTrack(p).items.find((i) => i.id === id) as VideoItem;
    const asset = p.assets[clip.assetId]!;
    asset.tracks![0]!.items.push({ ...structuredClone(clip), id: 'loop', start: s(7) });
    expect(() => refreshCompound(p, clip.assetId)).toThrow(EditError);
    expect(assetInUse(p, clip.assetId)).toBe(true);
  });

  it('saves and opens (validation, repair keep it as it is)', () => {
    const p = project();
    combineItems(p, ['b', 'c', 't'], sequentialIds('n'));
    const result = parseProject(JSON.stringify(p));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
      expect(result.project).toEqual(p);
    }
  });
});
