import { describe, expect, it } from 'vitest';
import { addToLane, insertMain, setSpeed, setTrackFlags } from '../edit/ops';
import { sequentialIds } from '../model/project';
import { fromSeconds as s } from '../model/time';
import {
  audioItem,
  fixtureProject,
  imageItem,
  stickerItem,
  textItem,
  videoItem,
} from '../test/fixtures';
import { activeLayers, itemIndexAt, upcomingVideoItems } from './timeline';

function setup() {
  const ids = sequentialIds('t');
  const project = fixtureProject();
  insertMain(project, videoItem('a', 'vidA', 4, 2)); // 0–4 s, source from 2 s
  insertMain(project, imageItem('b', 3)); // 4–7 s
  addToLane(project, textItem('title', 1, 2), ids); // 1–3 s
  addToLane(project, stickerItem('st', 2, 4), ids); // 2–6 s (overlay lane)
  addToLane(project, audioItem('music', 0, 10), ids);
  return { project, ids };
}

describe('timeline', () => {
  it('finds the item at a time (binary search, end exclusive)', () => {
    const { project } = setup();
    const main = project.tracks[0]!.items;
    expect(itemIndexAt(main, 0)).toBe(0);
    expect(itemIndexAt(main, s(4) - 1)).toBe(0);
    expect(itemIndexAt(main, s(4))).toBe(1);
    expect(itemIndexAt(main, s(7))).toBe(-1);
  });

  it('stacks main track, then lanes in track order; skips audio', () => {
    const { project } = setup();
    const at = (t: number) => activeLayers(project, s(t)).map((l) => l.item.id);
    expect(at(0.5)).toEqual(['a']);
    expect(at(2.5)).toEqual(['a', 'title', 'st']);
    expect(at(5)).toEqual(['b', 'st']);
    expect(at(8)).toEqual([]);
  });

  it('maps timeline time to source time, including speed', () => {
    const { project, ids } = setup();
    const [layer] = activeLayers(project, s(1));
    expect(layer!.sourceTime).toBe(s(3)); // sourceIn 2 s + 1 s
    setSpeed(project, 'a', 2, ids); // a is now 2 s long, reading 4 s of source
    const [fast] = activeLayers(project, s(1));
    expect(fast!.sourceTime).toBe(s(4)); // 2 s + 1 s × 2
  });

  it('hides hidden tracks', () => {
    const { project } = setup();
    const textTrack = project.tracks.find((t) => t.kind === 'text')!;
    setTrackFlags(project, textTrack.id, { hidden: true });
    expect(activeLayers(project, s(2.5)).map((l) => l.item.id)).toEqual(['a', 'st']);
  });

  it('lists video items needed soon (for decoder prefetch)', () => {
    const { project } = setup();
    expect(upcomingVideoItems(project, s(3), s(2)).map((i) => i.id)).toEqual(['a']);
    expect(upcomingVideoItems(project, s(5), s(2)).map((i) => i.id)).toEqual([]);
  });
});
