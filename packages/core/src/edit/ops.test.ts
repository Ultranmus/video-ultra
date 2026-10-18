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
  moveItemToNewLane,
  reorderMain,
  setAnimation,
  setSpeed,
  setTrackFlags,
  setTransition,
  splitItem,
  trimItem,
  updateItem,
  moveMainToLane,
  moveLaneToMain,
  LAYER_SCALE,
  setItemFlags,
  groupItems,
  ungroupItems,
  shiftItems,
  arrangeItem,
  setExportRange,
  pasteItems,
} from './ops';
import { groupOf } from '../model/project';

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

  it('sets ducking on sounding items: clamped to 1, 0 removes it, pictures refuse it', () => {
    const { project, ids } = setup();
    updateItem(project, 'a', { duck: 0.6 });
    expect((findItem(project, 'a')!.item as { duck?: number }).duck).toBe(0.6);
    updateItem(project, 'a', { duck: 3 });
    expect((findItem(project, 'a')!.item as { duck?: number }).duck).toBe(1);
    // A split keeps it on both halves.
    splitItem(project, 'a', s(1), ids);
    const halves = mainTrack(project).items.filter(
      (i) => i.kind === 'video' && i.assetId === 'vidA',
    );
    expect(halves.length).toBe(2);
    expect(halves.every((i) => i.kind === 'video' && i.duck === 1)).toBe(true);
    updateItem(project, 'a', { duck: 0 });
    expect('duck' in findItem(project, 'a')!.item).toBe(false);
    expect(() => updateItem(project, 'b', { duck: 0.5 })).toThrow(EditError);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('refuses edits on locked tracks', () => {
    const { project, ids } = setup();
    setTrackFlags(project, mainTrack(project).id, { locked: true });
    expect(() => splitItem(project, 'a', s(1), ids)).toThrow(/locked/);
  });
});

describe('moveItemToNewLane', () => {
  it('moves a lane item to a new lane at the given position and drops the empty one', () => {
    const p = fixtureProject();
    const ids = sequentialIds('n');
    addToLane(p, textItem('ta', 0), ids);
    addToLane(p, textItem('tb', 5), ids);
    const before = p.tracks.length;
    const lane = moveItemToNewLane(p, 'tb', s(1), ids, 1);
    expect(p.tracks[1]!.id).toBe(lane);
    expect(p.tracks[1]!.items.map((i) => i.id)).toEqual(['tb']);
    expect(p.tracks.length).toBe(before + 1);
    expect(checkInvariants(p)).toEqual([]);
  });
});

describe('main ↔ layers', () => {
  it('lifts a main clip onto a new layer, closes the gap and shrinks it to an element', () => {
    const { project, ids } = setup();
    setTransition(project, 'c', { type: 'fade', duration: s(1) });
    const lane = moveMainToLane(project, 'b', s(2), ids, 1);
    expect(starts(project)).toEqual([
      ['a', 0, 5],
      ['c', 5, 4],
    ]);
    const track = project.tracks.find((t) => t.id === lane)!;
    expect(track.kind).toBe('overlay');
    const b = track.items[0]!;
    expect(b.start).toBe(s(2));
    expect('transform' in b && b.transform.scale).toBe(LAYER_SCALE);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('keeps a clip the user already sized', () => {
    const { project, ids } = setup();
    updateItem(project, 'b', {
      transform: {
        x: 0.3,
        y: 0.5,
        scale: 0.4,
        rotation: 0,
        opacity: 1,
        flipX: false,
        flipY: false,
      },
    });
    const lane = moveMainToLane(project, 'b', 0, ids, 1);
    const b = project.tracks.find((t) => t.id === lane)!.items[0]!;
    expect('transform' in b && b.transform.scale).toBe(0.4);
  });

  it('puts a layer picture back into the sequence', () => {
    const { project, ids } = setup();
    moveMainToLane(project, 'b', s(1), ids, 1);
    moveLaneToMain(project, 'b', 0);
    expect(starts(project)).toEqual([
      ['b', 0, 3],
      ['a', 3, 5],
      ['c', 8, 4],
    ]);
    expect(project.tracks.length).toBe(1);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('refuses stickers on the main track', () => {
    const { project, ids } = setup();
    addToLane(project, stickerItem('st', 0), ids);
    expect(() => moveLaneToMain(project, 'st', 0)).toThrow();
  });
});

describe('layer transitions', () => {
  const layered = () => {
    const { project, ids } = setup();
    const lane = moveMainToLane(project, 'b', s(1), ids, 1);
    const pic2 = imageItem('pic2', 2);
    pic2.start = s(4); // touches b (1 s + 3 s)
    addToLane(project, pic2, ids, lane);
    return { project, ids, lane };
  };

  it('plays between two touching pictures on a layer', () => {
    const { project, lane } = layered();
    setTransition(project, 'pic2', { type: 'fade', duration: s(1) });
    const track = project.tracks.find((t) => t.id === lane)!;
    expect(track.items.map((i) => i.id)).toEqual(['b', 'pic2']);
    const pic2 = track.items[1]!;
    expect('transitionIn' in pic2 && pic2.transitionIn?.type).toBe('fade');
    expect(checkInvariants(project)).toEqual([]);
  });

  it('is refused across a gap and removed when the clips are moved apart', () => {
    const { project, ids } = layered();
    setTransition(project, 'pic2', { type: 'fade', duration: s(1) });
    moveItem(project, 'pic2', s(6), ids);
    const pic2 = findItem(project, 'pic2')!.item;
    expect('transitionIn' in pic2 && pic2.transitionIn).toBe(null);
    expect(() => setTransition(project, 'pic2', { type: 'fade', duration: s(1) })).toThrow();
    expect(checkInvariants(project)).toEqual([]);
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

describe('lock, hide, group (file version 3)', () => {
  function layers() {
    const { project, ids } = setup();
    addToLane(project, textItem('t', 1, 3), ids);
    addToLane(project, stickerItem('st', 0, 2), ids);
    addToLane(project, stickerItem('st2', 1, 2), ids); // overlaps st → second sticker lane
    return { project, ids };
  }
  const lane = (project: ReturnType<typeof layers>['project'], id: string) =>
    findItem(project, id)!.track.id;

  it('a locked element refuses edits but can be unlocked, hidden and duplicated', () => {
    const { project, ids } = layers();
    setItemFlags(project, 'st', { locked: true });
    expect(() => updateItem(project, 'st', { name: 'x' })).toThrow(EditError);
    expect(() => deleteItem(project, 'st')).toThrow(EditError);
    expect(() => moveItem(project, 'st', s(3), ids)).toThrow(EditError);
    expect(() => trimItem(project, 'st', 'end', s(1))).toThrow(EditError);
    setItemFlags(project, 'st', { hidden: true });
    expect(findItem(project, 'st')!.item.hidden).toBe(true);
    const copy = duplicateItem(project, 'st', ids);
    expect(findItem(project, copy)!.item.locked).toBeUndefined();
    setItemFlags(project, 'st', { locked: false, hidden: false });
    expect(findItem(project, 'st')!.item).not.toHaveProperty('locked');
    expect(findItem(project, 'st')!.item).not.toHaveProperty('hidden');
    updateItem(project, 'st', { name: 'x' });
    expect(checkInvariants(project)).toEqual([]);
  });

  it('groups lane items; a group of one dissolves; main clips never join', () => {
    const { project, ids } = layers();
    expect(() => groupItems(project, ['t'], ids)).toThrow(EditError);
    expect(() => groupItems(project, ['t', 'a'], ids)).toThrow(EditError);
    const g = groupItems(project, ['t', 'st'], ids);
    expect(groupOf(project, 'st').sort()).toEqual(['st', 't']);
    expect(groupOf(project, 'st2')).toEqual(['st2']);
    // A duplicate stays outside the group; deleting one of two members dissolves the group.
    const copy = duplicateItem(project, 't', ids);
    expect(findItem(project, copy)!.item.groupId).toBeUndefined();
    deleteItem(project, 'st');
    expect(findItem(project, 't')!.item.groupId).toBeUndefined();
    expect(g).toBeTruthy();
    const g2 = groupItems(project, ['t', 'st2'], ids);
    ungroupItems(project, g2);
    expect(groupOf(project, 't')).toEqual(['t']);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('a split member keeps both halves in the group; lifting into the main video leaves it', () => {
    const { project, ids } = setup();
    addToLane(project, imageItem('p', 4), ids);
    addToLane(project, textItem('t', 0, 4), ids);
    groupItems(project, ['p', 't'], ids);
    const half = splitItem(project, 't', s(2), ids);
    expect(groupOf(project, 'p').sort()).toEqual(['p', half, 't'].sort());
    moveLaneToMain(project, 'p', 0);
    expect(findItem(project, 'p')!.item.groupId).toBeUndefined();
    expect(groupOf(project, 't').sort()).toEqual([half, 't'].sort());
    expect(checkInvariants(project)).toEqual([]);
  });

  it('shiftItems moves several lane items by one amount, clamped at 0', () => {
    const { project, ids } = layers();
    const lanes = ['t', 'st', 'st2'].map((id) => lane(project, id));
    expect(shiftItems(project, ['t', 'st', 'st2'], s(2), ids)).toBe(s(2));
    expect(['t', 'st', 'st2'].map((id) => findItem(project, id)!.item.start)).toEqual([
      s(3),
      s(2),
      s(3),
    ]);
    expect(['t', 'st', 'st2'].map((id) => lane(project, id))).toEqual(lanes);
    expect(shiftItems(project, ['t', 'st'], -s(10), ids)).toBe(-s(2)); // st hits 0
    expect(findItem(project, 'st')!.item.start).toBe(0);
    expect(() => shiftItems(project, ['t', 'a'], s(1), ids)).toThrow(EditError);
    expect(checkInvariants(project)).toEqual([]);
  });

  it('arrangeItem changes the stack at the playhead, never below the main video', () => {
    const { project, ids } = layers();
    const order = () =>
      project.tracks
        .filter((t) => t.kind !== 'main')
        .map((t) => t.items.map((i) => i.id).join('+'));
    // Lanes in the order they were made; later lanes draw on top.
    expect(order()).toEqual(['t', 'st', 'st2']);
    arrangeItem(project, 'st', 'front', s(1.5), ids);
    expect(order()).toEqual(['t', 'st2', 'st']);
    arrangeItem(project, 'st', 'backward', s(1.5), ids);
    expect(order()).toEqual(['t', 'st', 'st2']);
    arrangeItem(project, 'st2', 'back', s(1.5), ids);
    expect(order()).toEqual(['st2', 't', 'st']);
    expect(() => arrangeItem(project, 'st2', 'backward', s(1.5), ids)).toThrow(EditError);
    expect(() => arrangeItem(project, 'st', 'forward', s(1.5), ids)).toThrow(EditError);
    expect(() => arrangeItem(project, 'a', 'forward', s(1.5), ids)).toThrow(EditError);
    expect(project.tracks[0]!.kind).toBe('main');
    expect(checkInvariants(project)).toEqual([]);
  });

  it('arranging an element that shares its lane moves only that element', () => {
    const { project, ids } = setup();
    addToLane(project, stickerItem('x', 0, 2), ids);
    addToLane(project, stickerItem('y', 3, 2), ids); // same lane as x
    addToLane(project, textItem('t', 0, 5), ids);
    expect(lane(project, 'x')).toBe(lane(project, 'y'));
    arrangeItem(project, 'x', 'front', s(1), ids);
    expect(lane(project, 'x')).not.toBe(lane(project, 'y'));
    const kinds = project.tracks.map((t) => t.items.map((i) => i.id).join('+'));
    expect(kinds.slice(1)).toEqual(['y', 't', 'x']);
    expect(checkInvariants(project)).toEqual([]);
  });
});

describe('setExportRange', () => {
  it('sets, replaces and clears the in / out points', () => {
    const { project } = setup();
    setExportRange(project, { start: s(1.5), end: s(4) });
    expect(project.settings.exportRange).toEqual({ start: s(1.5), end: s(4) });
    expect(checkInvariants(project)).toEqual([]);
    setExportRange(project, { start: -5, end: s(2) });
    expect(project.settings.exportRange).toEqual({ start: 0, end: s(2) });
    setExportRange(project, null);
    expect('exportRange' in project.settings).toBe(false);
  });

  it('refuses an empty range', () => {
    const { project } = setup();
    expect(() => setExportRange(project, { start: s(3), end: s(3) })).toThrow(EditError);
    expect(() => setExportRange(project, { start: s(3), end: s(1) })).toThrow(EditError);
  });
});

describe('paste', () => {
  it('pastes lane items at the playhead, keeping their spacing and grouping', () => {
    const { project, ids } = setup();
    addToLane(project, textItem('t1', 1, 2), ids);
    addToLane(project, textItem('t2', 2, 2), ids);
    groupItems(project, ['t1', 't2'], ids);
    const copied = ['t1', 't2'].map((id) => ({
      item: findItem(project, id)!.item,
      fromMain: false,
    }));
    const made = pasteItems(project, copied, project.assets, s(6), ids);
    const [a, b] = made.map((id) => findItem(project, id)!.item);
    expect(a!.start).toBe(s(6));
    expect(b!.start).toBe(s(7));
    expect(a!.groupId).toBeDefined();
    expect(a!.groupId).toBe(b!.groupId);
    expect(a!.groupId).not.toBe(findItem(project, 't1')!.item.groupId);
    checkInvariants(project);
  });

  it('pastes main clips into the main video after the clip under the playhead', () => {
    const { project, ids } = setup();
    const copied = [{ item: findItem(project, 'c')!.item, fromMain: true }];
    const [id] = pasteItems(project, copied, project.assets, s(1), ids);
    expect(mainTrack(project).items.map((i) => i.id)).toEqual(['a', id, 'b', 'c']);
    checkInvariants(project);
  });

  it('adds media from another project and refuses media that is gone', () => {
    const { project, ids } = setup();
    const other = fixtureProject();
    const asset = { ...project.assets.vidA!, id: 'elsewhere' };
    const clip = { ...videoItem('x', 'elsewhere', 2) };
    pasteItems(other, [{ item: clip, fromMain: true }], { elsewhere: asset }, 0, ids);
    expect(other.assets.elsewhere).toBeDefined();
    expect(() =>
      pasteItems(other, [{ item: { ...clip, assetId: 'gone' }, fromMain: true }], {}, 0, ids),
    ).toThrow(EditError);
  });
});
