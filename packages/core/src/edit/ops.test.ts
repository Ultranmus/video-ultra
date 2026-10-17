import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../model/invariants';
import { findItem, mainTrack, sequentialIds } from '../model/project';
import { fromSeconds as s, frameDuration } from '../model/time';
import {
  audioItem,
  fixtureProject,
  imageItem,
  stickerItem,
  textItem,
  videoItem,
} from '../test/fixtures';
import {
  EditError,
  addToLane,
  deleteItem,
  duplicateItem,
  freezeFrame,
  insertMain,
  moveItem,
  reorderMain,
  setAnimation,
  setSpeed,
  setTrackFlags,
  setTransition,
  splitItem,
  trimItem,
  updateItem,
} from './ops';

const frame = frameDuration({ num: 30, den: 1 });

function setup() {
  const ids = sequentialIds('n');
  const project = fixtureProject();
  insertMain(project, videoItem('a', 'vidA', 5));
  insertMain(project, imageItem('b', 3));
  insertMain(project, videoItem('c', 'vidB', 4));
  return { project, ids };
}

function starts(project: ReturnType<typeof fixtureProject>) {
  return mainTrack(project).items.map((i) => [i.id, i.start / s(1), i.duration / s(1)]);
}

describe('main track', () => {
  it('lays items back to back', () => {
    const { project } = setup();
    expect(starts(project)).toEqual([
      ['a', 0, 5],
      ['b', 5, 3],
      ['c', 8, 4],
    ]);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('splits a video and keeps the source continuous', () => {
    const { project, ids } = setup();
    const second = splitItem(project, 'a', s(2), ids);
    const item = findItem(project, second)!.item;
    expect(item.kind === 'video' && item.sourceIn).toBe(s(2));
    expect(starts(project).slice(0, 2)).toEqual([
      ['a', 0, 2],
      [second, 2, 3],
    ]);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('refuses to split at the edge of a clip', () => {
    const { project, ids } = setup();
    expect(() => splitItem(project, 'a', 0, ids)).toThrow(EditError);
    expect(() => splitItem(project, 'a', s(5), ids)).toThrow(EditError);
  });

  it('clamps trimming to the media length and ripples', () => {
    const { project } = setup();
    trimItem(project, 'c', 'end', s(100)); // vidB is only 4 s long
    expect(findItem(project, 'c')!.item.duration).toBe(s(4));
    trimItem(project, 'a', 'end', -s(3));
    expect(starts(project)).toEqual([
      ['a', 0, 2],
      ['b', 2, 3],
      ['c', 5, 4],
    ]);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('trims the start without reading before the media starts', () => {
    const { project } = setup();
    trimItem(project, 'a', 'start', s(1));
    const a = findItem(project, 'a')!.item;
    expect(a.kind === 'video' && a.sourceIn).toBe(s(1));
    expect(a.duration).toBe(s(4));
    trimItem(project, 'a', 'start', -s(5)); // try to extend before 0 of the source
    expect(findItem(project, 'a')!.item.duration).toBe(s(5));
    expect(checkInvariants(project)).toEqual([]);
  });

  it('keeps at least one frame when trimming', () => {
    const { project } = setup();
    trimItem(project, 'b', 'end', -s(100));
    expect(findItem(project, 'b')!.item.duration).toBe(frame);
  });

  it('deletes and closes the gap', () => {
    const { project } = setup();
    deleteItem(project, 'b');
    expect(starts(project)).toEqual([
      ['a', 0, 5],
      ['c', 5, 4],
    ]);
  });

  it('reorders', () => {
    const { project } = setup();
    reorderMain(project, 'c', 0);
    expect(mainTrack(project).items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('changes speed and duration together', () => {
    const { project, ids } = setup();
    setSpeed(project, 'a', 2, ids);
    expect(findItem(project, 'a')!.item.duration).toBe(s(2.5));
    setSpeed(project, 'a', 0.5, ids);
    expect(findItem(project, 'a')!.item.duration).toBe(s(10));
    expect(checkInvariants(project)).toEqual([]);
  });

  it('inserts a freeze frame of the right moment', () => {
    const { project, ids } = setup();
    const freezeId = freezeFrame(project, 'a', s(2), ids, s(1));
    const freeze = findItem(project, freezeId)!.item;
    expect(freeze.kind === 'freeze' && freeze.sourceTime).toBe(s(2));
    expect(
      starts(project)
        .map(([id, start]) => [id, start])
        .slice(0, 3),
    ).toEqual([
      ['a', 0],
      [freezeId, 2],
      [expect.any(String), 3],
    ]);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('clamps transitions to the shorter neighbour and drops them when a clip shrinks', () => {
    const { project } = setup();
    setTransition(project, 'b', { type: 'fade', duration: s(10) });
    const b = findItem(project, 'b')!.item;
    expect(b.kind === 'image' && b.transitionIn?.duration).toBe(s(3));
    expect(() => setTransition(project, 'a', { type: 'fade', duration: s(1) })).toThrow(EditError);
    trimItem(project, 'b', 'end', -s(2)); // b now 1 s
    expect(b.kind === 'image' && b.transitionIn?.duration).toBe(s(1));
    expect(checkInvariants(project)).toEqual([]);
  });

  it('duplicates right after the original', () => {
    const { project, ids } = setup();
    const copy = duplicateItem(project, 'a', ids);
    expect(mainTrack(project).items.map((i) => i.id)).toEqual(['a', copy, 'b', 'c']);
  });
});

describe('lanes', () => {
  it('stacks overlapping titles in separate lanes and removes empty lanes', () => {
    const { project, ids } = setup();
    addToLane(project, textItem('t1', 1), ids);
    addToLane(project, textItem('t2', 2), ids); // overlaps t1
    addToLane(project, textItem('t3', 4), ids); // fits after t1
    const textLanes = project.tracks.filter((t) => t.kind === 'text');
    expect(textLanes.map((t) => t.items.map((i) => i.id))).toEqual([['t1', 't3'], ['t2']]);
    deleteItem(project, 't2');
    expect(project.tracks.filter((t) => t.kind === 'text')).toHaveLength(1);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('puts each kind on its own kind of lane', () => {
    const { project, ids } = setup();
    addToLane(project, audioItem('m', 0), ids);
    addToLane(project, stickerItem('st', 1), ids);
    expect(project.tracks.map((t) => t.kind)).toEqual(['main', 'audio', 'overlay']);
  });

  it('moves an item into another lane when the target spot is taken', () => {
    const { project, ids } = setup();
    addToLane(project, textItem('t1', 0), ids);
    addToLane(project, textItem('t2', 5), ids);
    const lane = findItem(project, 't1')!.track.id;
    moveItem(project, 't2', s(1), ids, lane);
    expect(findItem(project, 't2')!.track.id).not.toBe(lane);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('trims lane items against their neighbours', () => {
    const { project, ids } = setup();
    addToLane(project, textItem('t1', 0, 2), ids);
    addToLane(project, textItem('t2', 3, 2), ids);
    trimItem(project, 't1', 'end', s(10));
    expect(findItem(project, 't1')!.item.duration).toBe(s(3));
    trimItem(project, 't2', 'start', -s(3));
    expect(findItem(project, 't2')!.item.start).toBe(s(3));
  });
});

describe('properties and locking', () => {
  it('updates allowed fields and rejects others', () => {
    const { project } = setup();
    updateItem(project, 'a', { volume: 5, fadeIn: s(10) });
    const a = findItem(project, 'a')!.item;
    expect(a.kind === 'video' && a.volume).toBe(2);
    expect(a.kind === 'video' && a.fadeIn).toBe(s(5));
    expect(() => updateItem(project, 'b', { volume: 1 })).toThrow(EditError);
  });

  it('refuses edits on locked tracks', () => {
    const { project, ids } = setup();
    setTrackFlags(project, mainTrack(project).id, { locked: true });
    expect(() => splitItem(project, 'a', s(1), ids)).toThrow(/locked/);
  });
});

describe('transition options', () => {
  it('stores direction and ease, keeps them when only the length changes', () => {
    const { project } = setup();
    setTransition(project, 'b', { type: 'push', duration: s(1), direction: 'up', ease: 'bounce' });
    const b = findItem(project, 'b')!.item;
    const tr = () => ('transitionIn' in b ? b.transitionIn : null);
    expect(tr()).toEqual({ type: 'push', duration: s(1), direction: 'up', ease: 'bounce' });
    // A duration slider sends only type + duration: the options stay.
    setTransition(project, 'b', { type: 'push', duration: s(0.5) });
    expect(tr()).toEqual({ type: 'push', duration: s(0.5), direction: 'up', ease: 'bounce' });
    // Explicitly unset.
    setTransition(project, 'b', { type: 'push', duration: s(0.5), direction: undefined });
    expect(tr()).toEqual({ type: 'push', duration: s(0.5), ease: 'bounce' });
    // Another preset starts from its own defaults.
    setTransition(project, 'b', { type: 'wipe', duration: s(0.5) });
    expect(tr()).toEqual({ type: 'wipe', duration: s(0.5) });
    expect(checkInvariants(project)).toEqual([]);
  });
});

describe('setAnimation', () => {
  function lanes() {
    const { project, ids } = setup();
    addToLane(project, textItem('t', 1, 3), ids);
    addToLane(project, stickerItem('st', 0, 2), ids);
    return { project, ids };
  }
  const anim = (project: ReturnType<typeof lanes>['project'], id: string) => {
    const item = findItem(project, id)!.item;
    return 'animation' in item ? item.animation : undefined;
  };

  it('sets, replaces and clears each slot', () => {
    const { project } = lanes();
    setAnimation(project, 't', 'in', { type: 'typewriter-in', duration: s(1.5) });
    setAnimation(project, 't', 'loop', { type: 'pulse', speed: 2 });
    setAnimation(project, 't', 'out', { type: 'fade-out', duration: s(0.5) });
    expect(anim(project, 't')).toEqual({
      in: { type: 'typewriter-in', duration: s(1.5) },
      loop: { type: 'pulse', speed: 2 },
      out: { type: 'fade-out', duration: s(0.5) },
    });
    setAnimation(project, 't', 'in', null);
    setAnimation(project, 't', 'loop', null);
    setAnimation(project, 't', 'out', null);
    expect(anim(project, 't')).toBeUndefined();
    expect(checkInvariants(project)).toEqual([]);
  });

  it('snaps to frames and clamps to the item; the slot being set wins', () => {
    const { project } = lanes();
    setAnimation(project, 'st', 'in', { type: 'pop-in', duration: s(5) });
    expect(anim(project, 'st')?.in?.duration).toBe(s(2));
    setAnimation(project, 'st', 'out', { type: 'fade-out', duration: s(1) });
    expect(anim(project, 'st')?.out?.duration).toBe(s(1));
    expect(anim(project, 'st')?.in?.duration).toBe(s(1));
    setAnimation(project, 'st', 'in', { type: 'pop-in', duration: s(0.5) + 7 });
    expect(anim(project, 'st')?.in?.duration).toBe(s(0.5));
    setAnimation(project, 'st', 'out', { type: 'fade-out', duration: s(1) });
    setAnimation(project, 'st', 'in', { type: 'pop-in', duration: s(1.5) });
    expect(anim(project, 'st')?.out?.duration).toBe(s(0.5));
    setAnimation(project, 'st', 'loop', { type: 'spin', speed: 50 });
    expect(anim(project, 'st')?.loop?.speed).toBe(4);
  });

  it('works on picture-in-picture, not on the main track or audio', () => {
    const { project, ids } = lanes();
    const pip = videoItem('pip', 'vidB', 2);
    addToLane(project, pip, ids);
    setAnimation(project, 'pip', 'in', { type: 'flip-in', duration: s(0.5) });
    expect(anim(project, 'pip')?.in?.type).toBe('flip-in');
    expect(() => setAnimation(project, 'a', 'in', { type: 'fade-in', duration: s(1) })).toThrow(
      EditError,
    );
    addToLane(project, audioItem('m', 0, 5), ids);
    expect(() => setAnimation(project, 'm', 'loop', { type: 'pulse' })).toThrow(EditError);
    expect(() => setAnimation(project, 'nope', 'loop', { type: 'pulse' })).toThrow(EditError);
  });

  it('trims shorten animations; a split keeps the entrance on the first part, the exit on the second', () => {
    const { project, ids } = lanes();
    setAnimation(project, 't', 'in', { type: 'rise-in', duration: s(1) });
    setAnimation(project, 't', 'out', { type: 'drop-out', duration: s(1) });
    setAnimation(project, 't', 'loop', { type: 'float' });
    trimItem(project, 't', 'end', -s(1.5)); // 3 s → 1.5 s
    expect(anim(project, 't')).toMatchObject({ in: { duration: s(1) }, out: { duration: s(0.5) } });
    const second = splitItem(project, 't', s(2), ids);
    expect(anim(project, 't')).toEqual({
      in: { type: 'rise-in', duration: s(1) },
      loop: { type: 'float' },
    });
    expect(anim(project, second)).toEqual({
      out: { type: 'drop-out', duration: s(0.5) },
      loop: { type: 'float' },
    });
    expect(checkInvariants(project)).toEqual([]);
  });
});
