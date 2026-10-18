import { current, isDraft, type Draft } from 'immer';
import {
  ALLOWED_KINDS,
  DEFAULT_TRANSFORM,
  findItem,
  itemEnd,
  laneKindFor,
  mainTrack,
  projectFrame,
  sourceSpan,
  type IdFactory,
} from '../model/project';
import type {
  Adjust,
  AnimationClip,
  AnimationLoop,
  Asset,
  Background,
  Crop,
  Filter,
  FreezeItem,
  Item,
  ItemAnimation,
  Project,
  TextStyle,
  Track,
  Transform,
  Transition,
} from '../model/schema';
import { fromSeconds, snapToFrame, type Time } from '../model/time';

/**
 * Edit operations. Each one mutates a draft `Project` in place (the history wraps them in Immer)
 * and either keeps every invariant in `checkInvariants` or throws an {@link EditError} without
 * changing anything it hasn't validated first. Times passed in are snapped to the frame grid.
 * Interactive edits (trim, speed) clamp to the nearest valid value instead of failing, so a drag
 * past a limit simply stops at the limit.
 */

/** Why an edit was refused. */
export type EditErrorCode = 'not-found' | 'locked' | 'invalid';

/** An edit that couldn't be applied. The project is unchanged. */
export class EditError extends Error {
  readonly code: EditErrorCode;
  constructor(code: EditErrorCode, message: string) {
    super(message);
    this.name = 'EditError';
    this.code = code;
  }
}

type MediaItem = Extract<Item, { speed: number }>;
const isMedia = (item: Item): item is MediaItem => item.kind === 'video' || item.kind === 'audio';

// ── helpers ────────────────────────────────────────────────────────────────

/** Deep copy that also works on Immer drafts (structuredClone can't clone a draft proxy). */
function copy<T>(value: T): T {
  return structuredClone(isDraft(value) ? (current(value as Draft<T>) as T) : value);
}

function snap(project: Project, time: Time): Time {
  return Math.max(0, snapToFrame(time, project.settings.frameRate));
}

/** Largest multiple of one frame that is ≤ `time`. */
function floorToFrame(project: Project, time: Time): Time {
  const frame = projectFrame(project);
  return Math.floor(time / frame) * frame;
}

function editable(project: Project, itemId: string) {
  const found = findItem(project, itemId);
  if (!found) throw new EditError('not-found', `No item ${itemId}`);
  if (found.track.locked) throw new EditError('locked', 'That track is locked');
  if (found.item.locked) throw new EditError('locked', 'That element is locked');
  return found;
}

function existing(project: Project, itemId: string) {
  const found = findItem(project, itemId);
  if (!found) throw new EditError('not-found', `No item ${itemId}`);
  return found;
}

function assetOf(project: Project, item: Item): Asset | null {
  return 'assetId' in item && item.assetId ? (project.assets[item.assetId] ?? null) : null;
}

/** Longest timeline duration the item can have, given its media and speed. */
function maxDuration(project: Project, item: Item): Time {
  if (!isMedia(item)) return Number.MAX_SAFE_INTEGER;
  const asset = assetOf(project, item);
  if (!asset) return Number.MAX_SAFE_INTEGER;
  return floorToFrame(project, Math.floor((asset.duration - item.sourceIn) / item.speed));
}

/** Keeps fades and animation lengths inside the item (after any change of its duration). */
function clampFades(item: Item): void {
  if ('animation' in item && item.animation) {
    const a = item.animation;
    if (a.in) a.in.duration = Math.min(a.in.duration, item.duration);
    if (a.out) a.out.duration = Math.min(a.out.duration, item.duration - (a.in?.duration ?? 0));
  }
  if (!('fadeIn' in item)) return;
  item.fadeIn = Math.min(item.fadeIn, item.duration);
  item.fadeOut = Math.min(item.fadeOut, item.duration - item.fadeIn);
}

/** Main track: items back to back from 0; transitions clamped to their neighbours. */
function layoutMain(project: Project): void {
  const frame = projectFrame(project);
  let cursor = 0;
  mainTrack(project).items.forEach((item, index, items) => {
    item.start = cursor;
    cursor += item.duration;
    if (!('transitionIn' in item) || !item.transitionIn) return;
    if (index === 0) {
      item.transitionIn = null;
      return;
    }
    const limit = Math.min(items[index - 1]!.duration, item.duration);
    if (limit < frame) item.transitionIn = null;
    else if (item.transitionIn.duration > limit)
      item.transitionIn.duration = floorToFrame(project, limit);
  });
}

function fits(track: Track, start: Time, end: Time, ignoreId?: string): boolean {
  return track.items.every(
    (other) => other.id === ignoreId || itemEnd(other) <= start || other.start >= end,
  );
}

function insertSorted(track: Track, item: Item): void {
  const index = track.items.findIndex((other) => other.start > item.start);
  if (index === -1) track.items.push(item);
  else track.items.splice(index, 0, item);
}

/**
 * Puts a non-main item on a lane of the right kind: the preferred lane if it's free there,
 * else the first free lane of that kind, else a new lane above the others of that kind.
 */
function placeInLane(
  project: Project,
  item: Item,
  ids: IdFactory,
  preferredTrackId?: string,
): void {
  const kind = laneKindFor(item.kind);
  const end = itemEnd(item);
  const lanes = project.tracks.filter((t) => t.kind === kind && !t.locked);
  const preferred = lanes.find((t) => t.id === preferredTrackId);
  const target =
    (preferred && fits(preferred, item.start, end) ? preferred : null) ??
    lanes.find((t) => fits(t, item.start, end));
  if (target) {
    insertSorted(target, item);
    tidyLaneTransitions(project);
    return;
  }
  const lane: Track = {
    id: ids(),
    kind,
    muted: false,
    hidden: false,
    locked: false,
    items: [item],
  };
  let lastOfKind = -1;
  project.tracks.forEach((t, i) => {
    if (t.kind === kind) lastOfKind = i;
  });
  project.tracks.splice(lastOfKind === -1 ? project.tracks.length : lastOfKind + 1, 0, lane);
}

/**
 * Layer transitions play only where two pictures touch on the same lane (one ends exactly where
 * the next starts). After any lane edit: a transition whose clips no longer touch is removed, and
 * one longer than either clip is shortened (the main track has `layoutMain` for this).
 */
function tidyLaneTransitions(project: Project): void {
  const frame = projectFrame(project);
  for (const track of project.tracks) {
    if (track.kind !== 'overlay') continue;
    track.items.forEach((item, index) => {
      if (!('transitionIn' in item) || !item.transitionIn) return;
      const previous = track.items[index - 1];
      if (!previous || !('transitionIn' in previous) || itemEnd(previous) !== item.start) {
        item.transitionIn = null;
        return;
      }
      const limit = Math.min(previous.duration, item.duration);
      if (limit < frame) item.transitionIn = null;
      else if (item.transitionIn.duration > limit)
        item.transitionIn.duration = floorToFrame(project, limit);
    });
  }
}

function removeEmptyLanes(project: Project): void {
  tidyLaneTransitions(project);
  tidyGroups(project);
  project.tracks = project.tracks.filter((t) => t.kind === 'main' || t.items.length > 0);
}

/** A group needs two members on lanes: a lone member (or a main-track clip) leaves its group. */
function tidyGroups(project: Project): void {
  const count = new Map<string, number>();
  for (const track of project.tracks) {
    for (const item of track.items) {
      if (!item.groupId) continue;
      if (track.kind === 'main') delete item.groupId;
      else count.set(item.groupId, (count.get(item.groupId) ?? 0) + 1);
    }
  }
  for (const track of project.tracks)
    for (const item of track.items)
      if (item.groupId && (count.get(item.groupId) ?? 0) < 2) delete item.groupId;
}

/** Moves an item to another lane if it now overlaps its neighbours. */
function resolveLaneOverlap(project: Project, track: Track, item: Item, ids: IdFactory): void {
  if (track.kind === 'main' || fits(track, item.start, itemEnd(item), item.id)) return;
  track.items.splice(track.items.indexOf(item), 1);
  placeInLane(project, item, ids, undefined);
  removeEmptyLanes(project);
}

// ── assets ────────────────────────────────────────────────────────────────

/** Registers an imported media file. */
export function addAsset(project: Project, asset: Asset): void {
  if (project.assets[asset.id]) throw new EditError('invalid', `Asset ${asset.id} already exists`);
  project.assets[asset.id] = asset;
}

/** Removes a media file that no item uses any more. */
export function removeAsset(project: Project, assetId: string): void {
  if (!project.assets[assetId]) throw new EditError('not-found', `No asset ${assetId}`);
  const used = project.tracks.some((t) =>
    t.items.some((i) => 'assetId' in i && i.assetId === assetId),
  );
  if (used) throw new EditError('invalid', 'That media is still used in the timeline');
  Reflect.deleteProperty(project.assets, assetId);
}

// ── adding ────────────────────────────────────────────────────────────────

function checkNewItem(project: Project, item: Item): void {
  if (findItem(project, item.id)) throw new EditError('invalid', `Item ${item.id} already exists`);
  if (item.duration < projectFrame(project))
    throw new EditError('invalid', 'Item is shorter than one frame');
  const asset = assetOf(project, item);
  if ('assetId' in item && item.assetId && !asset)
    throw new EditError('not-found', `No asset ${item.assetId}`);
  if (isMedia(item) && item.duration > maxDuration(project, item)) {
    item.duration = maxDuration(project, item);
    if (item.duration < projectFrame(project))
      throw new EditError('invalid', 'No media left to show');
  }
  clampFades(item);
}

/** Adds a video / photo / freeze item to the main track at `index` (default: the end). */
export function insertMain(project: Project, item: Item, index?: number): void {
  if (!ALLOWED_KINDS.main.includes(item.kind)) {
    throw new EditError('invalid', `${item.kind} items can't go on the main track`);
  }
  const main = mainTrack(project);
  if (main.locked) throw new EditError('locked', 'The main track is locked');
  item.duration = Math.max(projectFrame(project), floorToFrame(project, item.duration));
  checkNewItem(project, item);
  const at = Math.max(0, Math.min(index ?? main.items.length, main.items.length));
  if (at === 0 && 'transitionIn' in item) item.transitionIn = null;
  main.items.splice(at, 0, item);
  layoutMain(project);
}

/** Adds an item to a lane (text, stickers, picture-in-picture, audio) at `item.start`. */
export function addToLane(project: Project, item: Item, ids: IdFactory, trackId?: string): void {
  item.start = snap(project, item.start);
  item.duration = Math.max(projectFrame(project), floorToFrame(project, item.duration));
  if ('transitionIn' in item) item.transitionIn = null;
  checkNewItem(project, item);
  placeInLane(project, item, ids, trackId);
}

// ── moving ────────────────────────────────────────────────────────────────

/** Moves a main-track item to a new position in the sequence. */
export function reorderMain(project: Project, itemId: string, toIndex: number): void {
  const { track, index } = editable(project, itemId);
  if (track.kind !== 'main')
    throw new EditError('invalid', 'Only main-track items can be reordered');
  const target = Math.max(0, Math.min(toIndex, track.items.length - 1));
  if (target === index) return;
  const [item] = track.items.splice(index, 1);
  track.items.splice(target, 0, item!);
  layoutMain(project);
}

/** Moves a lane item in time (and optionally to another lane of the same kind). */
export function moveItem(
  project: Project,
  itemId: string,
  start: Time,
  ids: IdFactory,
  trackId?: string,
): void {
  const { track, item, index } = editable(project, itemId);
  if (track.kind === 'main') throw new EditError('invalid', 'Use reorderMain for main-track items');
  if (trackId) {
    const target = project.tracks.find((t) => t.id === trackId);
    if (!target) throw new EditError('not-found', `No track ${trackId}`);
    if (target.kind !== track.kind)
      throw new EditError('invalid', 'Items can only move between lanes of the same kind');
    if (target.locked) throw new EditError('locked', 'That track is locked');
  }
  track.items.splice(index, 1);
  item.start = snap(project, start);
  placeInLane(project, item, ids, trackId ?? track.id);
  removeEmptyLanes(project);
}

/**
 * Moves a lane item to a brand-new lane inserted at track position `atIndex` (1 = right under the
 * main track), starting at `start`. Returns the new track's id. The timeline uses it when a clip
 * is dropped between lanes or where it would overlap.
 */
export function moveItemToNewLane(
  project: Project,
  itemId: string,
  start: Time,
  ids: IdFactory,
  atIndex: number,
): string {
  const { track, item, index } = editable(project, itemId);
  if (track.kind === 'main') throw new EditError('invalid', 'Use reorderMain for main-track items');
  track.items.splice(index, 1);
  item.start = snap(project, start);
  const lane: Track = {
    id: ids(),
    kind: track.kind,
    muted: false,
    hidden: false,
    locked: false,
    items: [item],
  };
  // Count the position before empty lanes disappear, so the lane lands where it was dropped.
  const at = Math.max(1, Math.min(Math.round(atIndex), project.tracks.length));
  project.tracks.splice(at, 0, lane);
  removeEmptyLanes(project);
  return lane.id;
}

/** Size a full-frame clip takes when it becomes a layer, so it reads as an element over the video. */
export const LAYER_SCALE = 0.6;

/**
 * Lifts a main-track clip onto a brand-new overlay lane at track position `atIndex`, starting at
 * `start`: the clip becomes a layer over the video, and the main track closes the gap. A clip still
 * at full-frame size shrinks to {@link LAYER_SCALE} so it shows as an element (and its own
 * animation, filter and so on visibly apply to it alone). Returns the new lane's id.
 */
export function moveMainToLane(
  project: Project,
  itemId: string,
  start: Time,
  ids: IdFactory,
  atIndex: number,
): string {
  const { track, item, index } = editable(project, itemId);
  if (track.kind !== 'main') throw new EditError('invalid', 'Only main-track clips can be lifted');
  track.items.splice(index, 1);
  layoutMain(project);
  if ('transitionIn' in item) item.transitionIn = null;
  delete item.groupId;
  item.start = snap(project, start);
  if ('transform' in item) {
    const t = item.transform;
    const d = DEFAULT_TRANSFORM;
    if (t.x === d.x && t.y === d.y && t.scale === d.scale && t.rotation === d.rotation)
      item.transform = { ...t, scale: LAYER_SCALE };
  }
  const lane: Track = {
    id: ids(),
    kind: 'overlay',
    muted: false,
    hidden: false,
    locked: false,
    items: [item],
  };
  project.tracks.splice(Math.max(1, Math.min(Math.round(atIndex), project.tracks.length)), 0, lane);
  return lane.id;
}

/**
 * Puts a picture from an overlay lane into the main sequence at position `toIndex` (the clips
 * after it move later). Stickers can't join the main track.
 */
export function moveLaneToMain(project: Project, itemId: string, toIndex: number): void {
  const { track, item, index } = editable(project, itemId);
  if (track.kind === 'main') throw new EditError('invalid', 'Use reorderMain for main-track items');
  if (!ALLOWED_KINDS.main.includes(item.kind))
    throw new EditError('invalid', `A ${item.kind} can't go on the main track`);
  const main = mainTrack(project);
  if (main.locked) throw new EditError('locked', 'That track is locked');
  track.items.splice(index, 1);
  if ('transitionIn' in item) item.transitionIn = null;
  delete item.groupId;
  main.items.splice(Math.max(0, Math.min(Math.round(toIndex), main.items.length)), 0, item);
  layoutMain(project);
  removeEmptyLanes(project);
}

/**
 * Moves several lane items in time by the same amount — a group, or a selection dragged together.
 * Clamped so none starts before 0. Each keeps its lane when it fits there (the moved items never
 * block each other); one that would overlap a neighbour moves to a free lane of its kind.
 * Returns the applied shift.
 */
export function shiftItems(
  project: Project,
  itemIds: readonly string[],
  delta: Time,
  ids: IdFactory,
): Time {
  const found = [...new Set(itemIds)].map((id) => editable(project, id));
  if (found.some((f) => f.track.kind === 'main'))
    throw new EditError('invalid', 'Main-track clips move by reordering');
  if (found.length === 0) return 0;
  const earliest = Math.min(...found.map((f) => f.item.start));
  const shift = Math.max(-earliest, snapToFrame(delta, project.settings.frameRate));
  if (shift === 0) return 0;
  for (const { track, item } of found) track.items.splice(track.items.indexOf(item), 1);
  for (const { track, item } of found) {
    item.start = snap(project, item.start + shift);
    placeInLane(project, item, ids, track.id);
  }
  removeEmptyLanes(project);
  return shift;
}

/** Where {@link arrangeItem} moves an element in the stack. */
export type ArrangeTo = 'forward' | 'backward' | 'front' | 'back';

/**
 * Moves an element up or down the stack of what is on screen at `t` (Bring forward / Send
 * backward / Bring to front / Send to back). Stacking follows lane order (later lanes draw on
 * top), so the element's lane moves — or, when the lane holds other items too, the element moves
 * to a new lane at that place and the others stay where they are. The main video is always at
 * the back. Throws when there is nowhere to go.
 */
export function arrangeItem(
  project: Project,
  itemId: string,
  to: ArrangeTo,
  t: Time,
  ids: IdFactory,
): void {
  const { track, item } = editable(project, itemId);
  if (track.kind === 'main' || track.kind === 'audio')
    throw new EditError('invalid', 'Only elements over the video can change order');
  // The stack at t, bottom to top: tracks with a visual item there (this element counts even if
  // the playhead isn't on it, so arranging from the timeline works too).
  const stack = project.tracks.filter(
    (tr) =>
      tr === track ||
      (tr.kind !== 'audio' &&
        tr.items.some((i) => i.kind !== 'audio' && i.start <= t && t < itemEnd(i))),
  );
  const at = stack.indexOf(track);
  const firstLane = stack.findIndex((tr) => tr.kind !== 'main');
  const target =
    to === 'forward'
      ? stack[at + 1]
      : to === 'front'
        ? at < stack.length - 1
          ? stack[stack.length - 1]
          : undefined
        : to === 'backward'
          ? at - 1 >= firstLane
            ? stack[at - 1]
            : undefined
          : at > firstLane
            ? stack[firstLane]
            : undefined;
  if (!target || target === track) {
    throw new EditError(
      'invalid',
      to === 'forward' || to === 'front' ? 'Already at the front' : 'Already at the back',
    );
  }
  const above = to === 'forward' || to === 'front';
  let lane: Track;
  if (track.items.length === 1) {
    project.tracks.splice(project.tracks.indexOf(track), 1);
    lane = track;
  } else {
    track.items.splice(track.items.indexOf(item), 1);
    lane = {
      id: ids(),
      kind: track.kind,
      muted: false,
      hidden: false,
      locked: false,
      items: [item],
    };
  }
  const targetIndex = project.tracks.indexOf(target);
  project.tracks.splice(Math.max(1, above ? targetIndex + 1 : targetIndex), 0, lane);
  removeEmptyLanes(project);
}

// ── lock, hide, group ─────────────────────────────────────────────────────

/**
 * Locks (can be selected, not moved or edited) or hides (not drawn) an item. Works on locked
 * items — it's how they are unlocked.
 */
export function setItemFlags(
  project: Project,
  itemId: string,
  flags: { locked?: boolean; hidden?: boolean },
): void {
  const { item } = existing(project, itemId);
  if (flags.locked !== undefined) {
    if (flags.locked) item.locked = true;
    else delete item.locked;
  }
  if (flags.hidden !== undefined) {
    if (flags.hidden) item.hidden = true;
    else delete item.hidden;
  }
}

/**
 * Groups lane items (two or more) so they select, move and scale together. Members of other
 * groups join the new one. Locked items can join (they still don't move). Returns the group id.
 */
export function groupItems(project: Project, itemIds: readonly string[], ids: IdFactory): string {
  const found = [...new Set(itemIds)].map((id) => existing(project, id));
  if (found.length < 2) throw new EditError('invalid', 'Select two or more elements to group');
  if (found.some((f) => f.track.kind === 'main'))
    throw new EditError('invalid', 'Clips in the main video can’t be grouped');
  const groupId = ids();
  for (const { item } of found) item.groupId = groupId;
  tidyGroups(project);
  return groupId;
}

/** Ungroups: the members become separate elements again (they stay where they are). */
export function ungroupItems(project: Project, groupId: string): void {
  for (const track of project.tracks)
    for (const item of track.items) if (item.groupId === groupId) delete item.groupId;
}

// ── trimming, splitting, speed ─────────────────────────────────────────────

/**
 * Moves an edge of an item by `delta` (positive = later on the timeline), clamped to what the
 * media and neighbours allow. Dragging the start edge left reveals earlier media. On the main
 * track the following items ripple; on lanes neighbours act as walls.
 */
export function trimItem(
  project: Project,
  itemId: string,
  edge: 'start' | 'end',
  delta: Time,
): void {
  const { track, item, index } = editable(project, itemId);
  const frame = projectFrame(project);
  const step = snapToFrame(delta, project.settings.frameRate);
  const isMain = track.kind === 'main';

  if (edge === 'end') {
    let max = maxDuration(project, item);
    if (!isMain) {
      const next = track.items[index + 1];
      if (next) max = Math.min(max, next.start - item.start);
    }
    item.duration = Math.max(frame, Math.min(item.duration + step, max));
  } else {
    let shift = step;
    // Can't start before the media does…
    if (isMedia(item)) {
      shift = Math.max(shift, -floorToFrame(project, Math.floor(item.sourceIn / item.speed)));
    }
    // …or before time 0 / the previous lane item…
    if (!isMain) {
      const previous = track.items[index - 1];
      shift = Math.max(shift, (previous ? itemEnd(previous) : 0) - item.start);
    }
    // …and at least one frame must remain.
    shift = Math.min(shift, item.duration - frame);
    if (isMedia(item)) item.sourceIn = Math.max(0, item.sourceIn + Math.round(shift * item.speed));
    item.duration -= shift;
    // The main track re-lays itself out; lane items keep their end and move their start.
    if (!isMain) item.start += shift;
  }
  clampFades(item);
  if (isMain) layoutMain(project);
  else tidyLaneTransitions(project);
}

/** Splits an item in two at `at`. Returns the id of the second part. */
export function splitItem(project: Project, itemId: string, at: Time, ids: IdFactory): string {
  const { track, item, index } = editable(project, itemId);
  const frame = projectFrame(project);
  const cut = snap(project, at);
  if (cut < item.start + frame || cut > itemEnd(item) - frame) {
    throw new EditError('invalid', 'Move the playhead inside the clip to split it');
  }
  const offset = cut - item.start;
  const second = copy(item) as Item;
  second.id = ids();
  second.start = cut;
  second.duration = item.duration - offset;
  item.duration = offset;
  if (isMedia(second) && isMedia(item))
    second.sourceIn = item.sourceIn + Math.round(offset * item.speed);
  if ('fadeIn' in second && 'fadeOut' in item) {
    second.fadeIn = 0;
    item.fadeOut = 0;
  }
  if ('transitionIn' in second) second.transitionIn = null;
  // The first part keeps the entrance, the second the exit; both keep the loop.
  if ('animation' in item && item.animation && 'animation' in second && second.animation) {
    delete item.animation.out;
    delete second.animation.in;
  }
  clampFades(item);
  clampFades(second);
  track.items.splice(index + 1, 0, second);
  if (track.kind === 'main') layoutMain(project);
  else tidyLaneTransitions(project);
  return second.id;
}

/** Deletes an item. The main track closes the gap; empty lanes disappear. */
export function deleteItem(project: Project, itemId: string): void {
  const { track, index } = editable(project, itemId);
  track.items.splice(index, 1);
  if (track.kind === 'main') layoutMain(project);
  removeEmptyLanes(project);
}

/**
 * Duplicates an item right after itself. Returns the new id. A locked item can be duplicated; the
 * copy is unlocked and outside any group.
 */
export function duplicateItem(project: Project, itemId: string, ids: IdFactory): string {
  const { track, item, index } = existing(project, itemId);
  if (track.locked) throw new EditError('locked', 'That track is locked');
  const dup = copy(item) as Item;
  dup.id = ids();
  dup.start = itemEnd(item);
  delete dup.locked;
  delete dup.groupId;
  if (track.kind === 'main') {
    if ('transitionIn' in dup) dup.transitionIn = null;
    track.items.splice(index + 1, 0, dup);
    layoutMain(project);
  } else {
    placeInLane(project, dup, ids, track.id);
  }
  return dup.id;
}

/** Changes playback speed; the item gets shorter or longer on the timeline. */
export function setSpeed(project: Project, itemId: string, speed: number, ids: IdFactory): void {
  const { track, item } = editable(project, itemId);
  if (!isMedia(item)) throw new EditError('invalid', 'Only video and audio have a speed');
  if (!Number.isFinite(speed)) throw new EditError('invalid', 'Speed must be a number');
  const clamped = Math.min(100, Math.max(0.05, speed));
  const span = sourceSpan(item);
  item.speed = clamped;
  item.duration = Math.max(
    projectFrame(project),
    floorToFrame(project, Math.floor(span / clamped)),
  );
  // Very slow speeds can't stretch past the end of the media.
  item.duration = Math.min(
    item.duration,
    Math.max(projectFrame(project), maxDuration(project, item)),
  );
  clampFades(item);
  if (track.kind === 'main') layoutMain(project);
  else {
    resolveLaneOverlap(project, track, item, ids);
    tidyLaneTransitions(project);
  }
}

/**
 * Inserts a still frame of a main-track video at `at`, lasting `duration` (default 3 s).
 * Returns the freeze item's id.
 */
export function freezeFrame(
  project: Project,
  itemId: string,
  at: Time,
  ids: IdFactory,
  duration: Time = fromSeconds(3),
): string {
  const { track, item, index } = editable(project, itemId);
  if (track.kind !== 'main' || item.kind !== 'video') {
    throw new EditError('invalid', 'Freeze frame works on main-track videos');
  }
  const frame = projectFrame(project);
  const cut = snap(project, at);
  if (cut < item.start || cut >= itemEnd(item))
    throw new EditError('invalid', 'Move the playhead inside the clip');
  const asset = assetOf(project, item);
  const sourceTime = Math.min(
    item.sourceIn + Math.round((cut - item.start) * item.speed),
    (asset?.duration ?? 1) - 1,
  );
  const freeze: FreezeItem = {
    id: ids(),
    kind: 'freeze',
    assetId: item.assetId,
    sourceTime: Math.max(0, sourceTime),
    start: cut,
    duration: Math.max(frame, floorToFrame(project, duration)),
    transform: copy(item.transform),
    crop: copy(item.crop),
    fit: item.fit,
    filter: copy(item.filter),
    adjust: copy(item.adjust),
    transitionIn: null,
  };
  let insertAt = index;
  if (cut >= item.start + frame && cut <= itemEnd(item) - frame) {
    splitItem(project, itemId, cut, ids);
    insertAt = index + 1;
  } else if (cut > item.start) {
    insertAt = index + 1;
  }
  track.items.splice(insertAt, 0, freeze);
  layoutMain(project);
  return freeze.id;
}

// ── properties ────────────────────────────────────────────────────────────

/** Fields that `updateItem` may change. Timing and media references have their own operations. */
export interface ItemPatch {
  name?: string;
  transform?: Transform;
  crop?: Crop;
  fit?: 'fit' | 'fill';
  filter?: Filter | null;
  adjust?: Adjust;
  volume?: number;
  muted?: boolean;
  fadeIn?: Time;
  fadeOut?: Time;
  text?: string;
  style?: TextStyle;
  emoji?: string | null;
}

const FIELDS_BY_KIND: Record<Item['kind'], readonly string[]> = {
  video: [
    'name',
    'transform',
    'crop',
    'fit',
    'filter',
    'adjust',
    'volume',
    'muted',
    'fadeIn',
    'fadeOut',
  ],
  image: ['name', 'transform', 'crop', 'fit', 'filter', 'adjust'],
  freeze: ['name', 'transform', 'crop', 'fit', 'filter', 'adjust'],
  audio: ['name', 'volume', 'muted', 'fadeIn', 'fadeOut'],
  text: ['name', 'text', 'style', 'transform', 'filter', 'adjust'],
  sticker: ['name', 'transform', 'emoji', 'filter', 'adjust'],
};

/** Changes look/sound properties of an item (transform, filter, volume, text, …). */
export function updateItem(project: Project, itemId: string, patch: ItemPatch): void {
  const { item } = editable(project, itemId);
  const allowed = FIELDS_BY_KIND[item.kind];
  const target = item as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!allowed.includes(key)) throw new EditError('invalid', `${item.kind} items have no ${key}`);
    target[key] = copy(value);
  }
  if ('volume' in item) item.volume = Math.min(2, Math.max(0, item.volume));
  if ('fadeIn' in item) {
    item.fadeIn = snap(project, item.fadeIn);
    item.fadeOut = snap(project, item.fadeOut);
  }
  if (item.kind === 'sticker' && item.emoji !== null) item.assetId = null;
  clampFades(item);
}

/**
 * Sets (or clears, with `null`) the transition into an item from the one before it: on the main
 * track, or on a layer where the two pictures touch.
 */
export function setTransition(
  project: Project,
  itemId: string,
  transition: Transition | null,
): void {
  const { track, item, index } = editable(project, itemId);
  if ((track.kind !== 'main' && track.kind !== 'overlay') || !('transitionIn' in item)) {
    throw new EditError('invalid', 'Transitions go between video or photo clips');
  }
  if (transition === null) {
    item.transitionIn = null;
    return;
  }
  if (index === 0) throw new EditError('invalid', 'The first clip has nothing to transition from');
  const before = track.items[index - 1]!;
  if (track.kind === 'overlay' && (!('transitionIn' in before) || itemEnd(before) !== item.start))
    throw new EditError('invalid', 'Put the two clips right next to each other first');
  const limit = Math.min(track.items[index - 1]!.duration, item.duration);
  const duration = Math.min(
    floorToFrame(project, transition.duration),
    floorToFrame(project, limit),
  );
  if (duration < projectFrame(project))
    throw new EditError('invalid', 'These clips are too short for a transition');
  // Direction and ease: given = set; not given and the same preset = kept (a duration slider
  // doesn't have to repeat them); not given and another preset = the preset's own.
  const previous = item.transitionIn;
  const keep = previous !== null && previous.type === transition.type;
  const next: Transition = { type: transition.type, duration };
  const direction =
    'direction' in transition ? transition.direction : keep ? previous.direction : undefined;
  const ease = 'ease' in transition ? transition.ease : keep ? previous.ease : undefined;
  if (direction !== undefined) next.direction = direction;
  if (ease !== undefined) next.ease = ease;
  item.transitionIn = next;
}

/**
 * Sets (or clears, with `null`) one animation of a lane item — text, sticker or
 * picture-in-picture video / photo: its entrance (`in`), exit (`out`) or repeating `loop`.
 * Entrance and exit lengths are snapped to frames and clamped to the item (the slot being set
 * wins: the other one is shortened so they never overlap); loop speed is clamped to 0.25–4.
 * Unknown preset ids are stored as given (they play as nothing).
 */
export function setAnimation<S extends 'in' | 'out' | 'loop'>(
  project: Project,
  itemId: string,
  slot: S,
  value: (S extends 'loop' ? AnimationLoop : AnimationClip) | null,
): void {
  const { track, item } = editable(project, itemId);
  if (track.kind === 'main' || !ANIMATABLE.includes(item.kind)) {
    throw new EditError('invalid', 'Animations are for text, stickers and picture-in-picture');
  }
  const target = item as Extract<Item, { kind: 'text' | 'sticker' | 'video' | 'image' | 'freeze' }>;
  const animation: ItemAnimation = target.animation ? copy(target.animation) : {};
  if (value === null) {
    if (slot === 'in') delete animation.in;
    else if (slot === 'out') delete animation.out;
    else delete animation.loop;
  } else if (slot === 'loop') {
    const loop = value as AnimationLoop;
    const next: AnimationLoop = { type: loop.type };
    if (loop.speed !== undefined) {
      if (!Number.isFinite(loop.speed)) throw new EditError('invalid', 'Speed must be a number');
      next.speed = Math.min(4, Math.max(0.25, loop.speed));
    }
    animation.loop = next;
  } else {
    const clip = value as AnimationClip;
    if (!Number.isFinite(clip.duration)) throw new EditError('invalid', 'Length must be a number');
    const duration = Math.min(Math.max(0, snap(project, clip.duration)), item.duration);
    animation[slot as 'in' | 'out'] = { type: clip.type, duration };
    const other = slot === 'in' ? animation.out : animation.in;
    if (other) other.duration = Math.min(other.duration, item.duration - duration);
  }
  if (animation.in || animation.out || animation.loop) target.animation = animation;
  else delete target.animation;
}

const ANIMATABLE: readonly Item['kind'][] = ['text', 'sticker', 'video', 'image', 'freeze'];

// ── project & tracks ──────────────────────────────────────────────────────

/** Changes the canvas size (aspect ratio). Item positions are relative, so layouts follow. */
export function setCanvasSize(project: Project, width: number, height: number): void {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w < 16 || h < 16 || w > 8192 || h > 8192)
    throw new EditError('invalid', 'Canvas must be 16–8192 px');
  // Encoders need even dimensions.
  project.settings.width = w - (w % 2);
  project.settings.height = h - (h % 2);
}

/** Sets what shows behind the main track (colour or blurred video). */
export function setBackground(project: Project, background: Background): void {
  project.settings.background = copy(background);
}

/** Mutes, hides or locks a track. */
export function setTrackFlags(
  project: Project,
  trackId: string,
  flags: Partial<Pick<Track, 'muted' | 'hidden' | 'locked'>>,
): void {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new EditError('not-found', `No track ${trackId}`);
  if (flags.muted !== undefined) track.muted = flags.muted;
  if (flags.hidden !== undefined) track.hidden = flags.hidden;
  if (flags.locked !== undefined) track.locked = flags.locked;
}

/** Renames the project. */
export function renameProject(project: Project, name: string): void {
  project.name = name.trim().slice(0, 200) || 'Untitled video';
}
