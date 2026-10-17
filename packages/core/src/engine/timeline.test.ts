import { describe, expect, it } from 'vitest';
import {
  addToLane,
  insertMain,
  moveMainToLane,
  setSpeed,
  setTrackFlags,
  setTransition,
} from '../edit/ops';
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
import {
  activeLayers,
  itemIndexAt,
  upcomingVideo,
  upcomingVideoItems,
  visibleSpan,
} from './timeline';

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

  it('has no transition info outside transitions', () => {
    const { project } = setup();
    expect(activeLayers(project, s(1)).every((l) => l.transition === null)).toBe(true);
  });
});

describe('timeline transitions', () => {
  // a: 0–4 s (vidA from 2 s), c: 4–8 s (vidB from 0 s, 4 s of media), 1 s dissolve into c.
  function transitionSetup(duration = 1) {
    const ids = sequentialIds('t');
    const project = fixtureProject();
    insertMain(project, videoItem('a', 'vidA', 4, 2));
    insertMain(project, videoItem('c', 'vidB', 4, 0));
    setTransition(project, 'c', { type: 'dissolve', duration: s(duration) });
    addToLane(project, textItem('title', 3, 2), ids);
    return project;
  }

  it('draws both clips over a window centred on the cut', () => {
    const project = transitionSetup();
    const at = (t: number) => activeLayers(project, s(t)).map((l) => l.item.id);
    expect(at(3.4)).toEqual(['a', 'title']);
    expect(at(3.5)).toEqual(['a', 'c', 'title']); // window starts half before the cut
    expect(at(4.2)).toEqual(['a', 'c', 'title']);
    expect(at(4.5)).toEqual(['c', 'title']); // and ends half after it
  });

  it('reports progress 0…1 across the window with out / in roles', () => {
    const project = transitionSetup();
    const [out, inn] = activeLayers(project, s(3.5));
    expect(out!.transition).toEqual({ type: 'dissolve', progress: 0, role: 'out' });
    expect(inn!.transition).toEqual({ type: 'dissolve', progress: 0, role: 'in' });
    const mid = activeLayers(project, s(4));
    expect(mid[0]!.transition!.progress).toBeCloseTo(0.5, 9);
    expect(mid[1]!.transition!.role).toBe('in');
    expect(activeLayers(project, s(4.25))[0]!.transition!.progress).toBeCloseTo(0.75, 9);
  });

  it('keeps the outgoing clip playing past its end and starts the incoming one early', () => {
    const project = transitionSetup();
    const [out, inn] = activeLayers(project, s(4.25));
    expect(out!.sourceTime).toBe(s(6.25)); // 2 s + 4.25 s: past the clip's end, media exists
    expect(out!.localTime).toBe(s(4.25));
    expect(inn!.sourceTime).toBe(s(0.25));
    const [, early] = activeLayers(project, s(3.75));
    expect(early!.sourceTime).toBe(0); // would be −0.25 s: holds the first frame
    expect(early!.localTime).toBe(-s(0.25));
  });

  it('holds the last frame when the outgoing media runs out', () => {
    const project = fixtureProject();
    insertMain(project, videoItem('a', 'vidB', 4, 0)); // vidB is exactly 4 s long
    insertMain(project, videoItem('c', 'vidA', 4, 0));
    setTransition(project, 'c', { type: 'fade', duration: s(2) });
    const [out] = activeLayers(project, s(4.9));
    expect(out!.sourceTime).toBe(s(4)); // clamped to the asset's duration
  });

  it('respects speed when extending a clip', () => {
    const ids = sequentialIds('v');
    const project = transitionSetup();
    setSpeed(project, 'a', 2, ids); // a: 0–2 s, reading 4 s of source from 2 s
    const [out] = activeLayers(project, s(2.25));
    expect(out!.item.id).toBe('a');
    expect(out!.sourceTime).toBe(s(2 + 2.25 * 2));
  });

  it('widens the visible span for prefetching', () => {
    const project = transitionSetup();
    const main = project.tracks[0]!;
    expect(visibleSpan(main, 0)).toEqual({ start: 0, end: s(4.5) });
    expect(visibleSpan(main, 1)).toEqual({ start: s(3.5), end: s(8) });
    // c is needed from 3.5 s, showing source 0 first.
    const soon = upcomingVideo(project, s(3), s(0.6));
    expect(soon.map((u) => u.item.id)).toEqual(['a', 'c']);
    expect(soon[1]!.visibleFrom).toBe(s(3.5));
    expect(soon[1]!.firstSourceTime).toBe(0);
    expect(upcomingVideoItems(project, s(3), s(0.4)).map((i) => i.id)).toEqual(['a']);
    expect(upcomingVideoItems(project, s(4.4), s(0.05)).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('clamps an over-long transition to its neighbours (defensive)', () => {
    const project = transitionSetup();
    const c = project.tracks[0]!.items[1]!;
    if ('transitionIn' in c && c.transitionIn) c.transitionIn.duration = s(100);
    // Clamped to 4 s: window 2 s … 6 s.
    expect(activeLayers(project, s(1.99)).map((l) => l.item.id)).toEqual(['a']);
    expect(activeLayers(project, s(2)).map((l) => l.item.id)).toEqual(['a', 'c']);
    expect(activeLayers(project, s(5.99)).map((l) => l.item.id)).toEqual(['a', 'c']);
    expect(activeLayers(project, s(6)).map((l) => l.item.id)).toEqual(['c']);
  });
});

describe('layer transitions', () => {
  it('two touching pictures on a layer cross over; the main track is untouched', () => {
    const project = fixtureProject();
    const ids = sequentialIds('n');
    insertMain(project, videoItem('main', 'vidA', 10));
    insertMain(project, imageItem('a', 3));
    const lane = moveMainToLane(project, 'a', s(1), ids, 1);
    const b = imageItem('b', 3);
    b.start = s(4);
    addToLane(project, b, ids, lane);
    setTransition(project, 'b', { type: 'fade', duration: s(1) });
    const at = (t: number) =>
      activeLayers(project, s(t)).map((l) => [l.item.id, l.transition?.role ?? null]);
    expect(at(3.7)).toEqual([
      ['main', null],
      ['a', 'out'],
      ['b', 'in'],
    ]);
    expect(at(2)).toEqual([
      ['main', null],
      ['a', null],
    ]);
  });
});
