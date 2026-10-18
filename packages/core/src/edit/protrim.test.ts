import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../model/invariants';
import { findItem, mainTrack, projectDuration, sequentialIds } from '../model/project';
import { ProjectSchema } from '../model/schema';
import { fromSeconds as s } from '../model/time';
import { fixtureProject, imageItem, videoItem } from '../test/fixtures';
import {
  EditError,
  addMarker,
  insertMain,
  removeMarker,
  rollEdit,
  slideItem,
  slipItem,
  updateMarker,
} from './ops';

/** Main track: a (video 4 s of a 10 s file, from 2 s), b (photo 3 s), c (video 4 s from 1 s). */
function setup() {
  const project = fixtureProject();
  insertMain(project, videoItem('a', 'vidA', 4, 2));
  insertMain(project, imageItem('b', 3));
  insertMain(project, videoItem('c', 'vidA', 4, 1));
  return project;
}
const spans = (p: ReturnType<typeof setup>) =>
  mainTrack(p).items.map((i) => [
    i.id,
    i.start / s(1),
    i.duration / s(1),
    'sourceIn' in i ? i.sourceIn / s(1) : null,
  ]);

describe('pro trims', () => {
  it('roll moves a cut: one longer, the next shorter, the length unchanged', () => {
    const p = setup();
    const total = projectDuration(p);
    expect(rollEdit(p, 'a', s(1))).toBe(s(1));
    expect(spans(p)).toEqual([
      ['a', 0, 5, 2],
      ['b', 5, 2, null],
      ['c', 7, 4, 1],
    ]);
    expect(projectDuration(p)).toBe(total);
    // Into c: c starts later in its file.
    expect(rollEdit(p, 'b', s(1))).toBe(s(1));
    expect(spans(p)[2]).toEqual(['c', 8, 3, 2]);
    // Backwards past c's media start: clamped (c began at 2 s of its file → 2 s of room).
    expect(rollEdit(p, 'b', -s(5))).toBe(-s(2));
    expect(spans(p)[2]).toEqual(['c', 6, 5, 0]);
    expect(checkInvariants(p)).toEqual([]);
  });

  it('roll is clamped by the media left and by one frame', () => {
    const p = setup();
    // a can grow by 4 s at most (file 10 s, from 2 s, 4 s long); b only has 3 s.
    expect(rollEdit(p, 'a', s(9))).toBeLessThan(s(3));
    expect(() => rollEdit(p, 'c', s(1))).toThrow(EditError); // nothing after c
  });

  it('slip shows other media in the same place', () => {
    const p = setup();
    expect(slipItem(p, 'a', s(1.5))).toBe(s(1.5));
    expect(spans(p)[0]).toEqual(['a', 0, 4, 3.5]);
    expect(slipItem(p, 'a', s(20))).toBe(s(2.5)); // up to the file's end
    expect(slipItem(p, 'a', -s(20))).toBe(-s(6)); // back to its start
    expect(() => slipItem(p, 'b', s(1))).toThrow(EditError);
  });

  it('slide moves a clip between its neighbours; the video keeps its length', () => {
    const p = setup();
    const total = projectDuration(p);
    expect(slideItem(p, 'b', s(1))).toBe(s(1));
    expect(spans(p)).toEqual([
      ['a', 0, 5, 2],
      ['b', 5, 3, null],
      ['c', 8, 3, 2],
    ]);
    expect(projectDuration(p)).toBe(total);
    expect(slideItem(p, 'b', -s(2))).toBe(-s(2));
    expect(spans(p)).toEqual([
      ['a', 0, 3, 2],
      ['b', 3, 3, null],
      ['c', 6, 5, 0],
    ]);
    expect(() => slideItem(p, 'a', s(1))).toThrow(EditError);
    expect(checkInvariants(p)).toEqual([]);
  });
});

describe('markers', () => {
  it('are added in time order, renamed, moved and removed; the file stays valid', () => {
    const ids = sequentialIds('m');
    const p = setup();
    const b = addMarker(p, s(5), ids, 'Drop');
    const a = addMarker(p, s(2) + 7, ids);
    expect(p.markers!.map((m) => m.id)).toEqual([a, b]);
    expect(p.markers![0]!.time).toBe(s(2));
    updateMarker(p, a, { time: s(9), label: 'End' });
    expect(p.markers!.map((m) => m.label)).toEqual(['Drop', 'End']);
    updateMarker(p, a, { label: ' ' });
    expect(p.markers![1]!.label).toBeUndefined();
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    removeMarker(p, a);
    removeMarker(p, b);
    expect(p.markers).toBeUndefined();
    void findItem;
  });
});
