import { current, isDraft, type Draft } from 'immer';
import { hasAudioFx } from '../audio/fx';
import { shapePreset } from '../effects/shapes';
import { AudioFxSchema } from '../model/schema';
import {
  KEYFRAME_PROPS,
  hasKeyframes,
  keyedTransform,
  keyedValue,
  retimeKeyframes,
  sampleKeyframes,
  type KeyframeProp,
} from '../model/keyframes';
import {
  ALLOWED_KINDS,
  DEFAULT_TRANSFORM,
  NO_CROP,
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
  BlendMode,
  Bezier,
  Ease,
  ChromaKey,
  Crop,
  Cutout,
  Filter,
  FreezeItem,
  Item,
  ItemAnimation,
  Keyframe,
  LutRef,
  Marker,
  Project,
  RegionItem,
  ShapeMask,
  AudioFx,
  TextStyle,
  Track,
  Transform,
  Transition,
} from '../model/schema';
import { fromSeconds, snapToFrame, type Time } from '../model/time';
import type { CaptionLook, CaptionWord, TextItem } from '../model/schema';
import { captionWords, captionWordTimes } from '../captions/timing';
import { DEFAULT_CAPTION_PRESET, lookFromPreset, type CaptionPreset } from '../captions/presets';

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
    t.items.some(
      (i) =>
        ('assetId' in i && i.assetId === assetId) || ('lut' in i && i.lut?.assetId === assetId),
    ),
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
    retimeItemKeyframes(item, shift);
    item.duration -= shift;
    // The main track re-lays itself out; lane items keep their end and move their start.
    if (!isMain) item.start += shift;
    clampWords(item, shift);
  }
  if (edge === 'end') clampWords(item, 0);
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
  // Each part keeps its own share of the motion (a keyframe holds the value at the cut).
  retimeItemKeyframes(second, offset);
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
  // Captions (and any text with spoken words): each part keeps the words said in it.
  if (item.kind === 'text' && second.kind === 'text' && (item.words || track.kind === 'caption')) {
    const times = captionWordTimes({ ...item, duration: item.duration + second.duration });
    const before = times.filter((w) => w.start < offset);
    const after = times.filter((w) => w.start >= offset);
    if (before.length && after.length) {
      item.text = before.map((w) => w.text).join(' ');
      second.text = after.map((w) => w.text).join(' ');
      if (item.words) {
        item.words = before.map((w) => ({ ...w, end: Math.min(w.end, offset) }));
        second.words = after.map((w) => ({ ...w, start: w.start - offset, end: w.end - offset }));
      }
    }
  }
  clampFades(item);
  clampFades(second);
  track.items.splice(index + 1, 0, second);
  if (track.kind === 'main') layoutMain(project);
  else tidyLaneTransitions(project);
  return second.id;
}

/**
 * Splits an item at every time in `times` (timeline flicks; e.g. scene cuts) in one edit. Times
 * outside the item or within a frame of its ends or of each other are skipped. Returns the ids
 * of the item's parts in order (the first is `itemId`).
 */
export function splitItemAt(
  project: Project,
  itemId: string,
  times: readonly Time[],
  ids: IdFactory,
): string[] {
  const { item } = editable(project, itemId);
  const frame = projectFrame(project);
  const cuts: Time[] = [];
  for (const t of [...times].map((x) => snap(project, x)).sort((a, b) => a - b)) {
    if (t < item.start + frame || t > itemEnd(item) - frame) continue;
    if (cuts.length && t - cuts[cuts.length - 1]! < frame) continue;
    cuts.push(t);
  }
  const parts = [itemId];
  let current = itemId;
  for (const t of cuts) {
    current = splitItem(project, current, t, ids);
    parts.push(current);
  }
  return parts;
}

/** Keyframes for a part of the item that starts `offset` later in its old timing (keyframes.ts). */
function retimeItemKeyframes(item: Item, offset: Time): void {
  if ('keyframes' in item && item.keyframes)
    item.keyframes = retimeKeyframes(copy(item.keyframes), offset);
}

/** Keeps a caption's word times inside it after its start moved by `shift` or its length changed. */
function clampWords(item: Item, shift: Time): void {
  if (item.kind !== 'text' || !item.words) return;
  item.words = item.words
    .map((w) => ({ ...w, start: w.start - shift, end: w.end - shift }))
    .filter((w) => w.end > 0 && w.start < item.duration)
    .map((w) => ({ ...w, start: Math.max(0, w.start), end: Math.min(item.duration, w.end) }));
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

/** A copied item and whether it was a clip of the main video (see {@link pasteItems}). */
export interface CopiedItem {
  item: Item;
  fromMain: boolean;
}

/**
 * Pastes copied items at `at` (usually the playhead), keeping their timing relative to each
 * other. Copies get new ids; groups stay groups (as new groups). Clips copied from the main
 * video go back into it, after the clip under `at`; everything else goes to a lane. Media the
 * project doesn't have yet (copied from another project) is added from `assets`. Returns the new
 * ids, in the order given.
 */
export function pasteItems(
  project: Project,
  copied: readonly CopiedItem[],
  assets: Readonly<Record<string, Asset>>,
  at: Time,
  ids: IdFactory,
): string[] {
  if (copied.length === 0) return [];
  let first = Infinity;
  for (const c of copied) if (!c.fromMain) first = Math.min(first, c.item.start);
  const groups = new Map<string, string>();
  const main = mainTrack(project);
  // After the clip under the playhead (its end is the next cut).
  let mainIndex = main.items.findIndex((i) => i.start <= at && at < itemEnd(i)) + 1;
  if (mainIndex === 0) mainIndex = at <= 0 ? 0 : main.items.length;
  const made: string[] = [];
  for (const { item: original, fromMain } of copied) {
    const item = copy(original) as Item;
    if ('assetId' in item && item.assetId && !project.assets[item.assetId]) {
      const asset = assets[item.assetId];
      if (!asset) throw new EditError('invalid', 'The copied media is no longer available');
      project.assets[asset.id] = copy(asset);
    }
    if ('cutout' in item && item.cutout && !project.assets[item.cutout.assetId]) {
      const cut = assets[item.cutout.assetId];
      if (cut) project.assets[cut.id] = copy(cut);
      else delete item.cutout;
    }
    if ('lut' in item && item.lut && !project.assets[item.lut.assetId]) {
      const lut = assets[item.lut.assetId];
      if (lut) project.assets[lut.id] = copy(lut);
      else delete item.lut;
    }
    item.id = ids();
    delete item.locked;
    delete item.groupId;
    if (fromMain) {
      insertMain(project, item, mainIndex++);
    } else {
      if (original.groupId) {
        const group = groups.get(original.groupId) ?? ids();
        groups.set(original.groupId, group);
        item.groupId = group;
      }
      item.start = at + (original.start - first);
      addToLane(project, item, ids);
    }
    made.push(item.id);
  }
  tidyGroups(project);
  return made;
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
  if (assetOf(project, item)?.kind === 'compound')
    throw new EditError('invalid', 'Freeze frame works on a video file, not a combined clip');
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
  /** Lower under voice, 0…1 of the volume taken away while someone speaks; 0 = off. */
  duck?: number;
  /** Sound effects (EQ, compressor, pitch); `null` removes them. */
  audioFx?: AudioFx | null;
  text?: string;
  style?: TextStyle;
  emoji?: string | null;
  /** Green screen; `null` turns it off. */
  key?: ChromaKey | null;
  /** LUT look (the asset must be a `lut`); `null` removes it. */
  lut?: LutRef | null;
  /** Lane items; `'normal'` (or `null`) removes the field. */
  blend?: BlendMode | null;
  /** Pictures: shape mask (the shape must be one of `SHAPE_PRESETS`); `null` removes it. */
  mask?: ShapeMask | null;
  /** Photos and image stickers: background removed (an image asset); `null` restores it. */
  cutout?: Cutout | null;
  /** Blurred areas. */
  effect?: RegionItem['effect'];
  shape?: RegionItem['shape'];
  amount?: number;
  width?: number;
  height?: number;
}

/** Fields that `null` (or `blend: 'normal'`) removes instead of setting. */
const REMOVABLE = new Set(['key', 'lut', 'blend', 'mask', 'cutout', 'audioFx']);
/** Size limits of a blurred area's box (fractions of the canvas). */
const REGION_MIN = 0.01;
const REGION_MAX = 4;
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

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
    'duck',
    'audioFx',
    'key',
    'lut',
    'blend',
    'mask',
  ],
  image: [
    'name',
    'transform',
    'crop',
    'fit',
    'filter',
    'adjust',
    'key',
    'lut',
    'blend',
    'mask',
    'cutout',
  ],
  freeze: ['name', 'transform', 'crop', 'fit', 'filter', 'adjust', 'key', 'lut', 'blend', 'mask'],
  audio: ['name', 'volume', 'muted', 'fadeIn', 'fadeOut', 'duck', 'audioFx'],
  text: ['name', 'text', 'style', 'transform', 'filter', 'adjust', 'blend'],
  sticker: ['name', 'transform', 'emoji', 'filter', 'adjust', 'blend', 'cutout'],
  region: ['name', 'transform', 'effect', 'shape', 'amount', 'width', 'height'],
};

/** Changes look/sound properties of an item (transform, filter, volume, text, …). */
export function updateItem(project: Project, itemId: string, patch: ItemPatch): void {
  const { item } = editable(project, itemId);
  const allowed = FIELDS_BY_KIND[item.kind];
  const target = item as Record<string, unknown>;
  if (patch.cutout) {
    const asset = project.assets[patch.cutout.assetId];
    if (!asset || asset.kind !== 'image')
      throw new EditError('not-found', `No image ${patch.cutout.assetId}`);
  }
  if (patch.audioFx && !AudioFxSchema.safeParse(patch.audioFx).success)
    throw new EditError('invalid', 'Sound effect settings out of range');
  if (patch.audioFx && !hasAudioFx(patch.audioFx, 1) && !patch.audioFx.keepPitch)
    patch = { ...patch, audioFx: null };
  if (patch.mask && !shapePreset(patch.mask.shape))
    throw new EditError('invalid', `No mask shape ${patch.mask.shape}`);
  if (patch.lut) {
    const asset = project.assets[patch.lut.assetId];
    if (!asset || asset.kind !== 'lut')
      throw new EditError('not-found', `No LUT file ${patch.lut.assetId}`);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!allowed.includes(key)) throw new EditError('invalid', `${item.kind} items have no ${key}`);
    if (REMOVABLE.has(key) && (value === null || value === 'normal')) {
      Reflect.deleteProperty(target, key);
      continue;
    }
    target[key] = copy(value);
  }
  if ('key' in item && item.key) {
    item.key.tolerance = clamp01(item.key.tolerance);
    item.key.softness = clamp01(item.key.softness);
    item.key.spill = clamp01(item.key.spill);
  }
  if ('lut' in item && item.lut) item.lut.intensity = clamp01(item.lut.intensity);
  if ('mask' in item && item.mask) item.mask.feather = clamp01(item.mask.feather);
  if (item.kind === 'region') {
    item.amount = clamp01(item.amount);
    const size = (v: number) =>
      Number.isFinite(v) ? Math.min(REGION_MAX, Math.max(REGION_MIN, v)) : REGION_MIN;
    item.width = size(item.width);
    item.height = size(item.height);
  }
  if ('volume' in item) item.volume = Math.min(2, Math.max(0, item.volume));
  if ('volume' in item && item.duck !== undefined) {
    // 0 (or nonsense) turns ducking off: the field goes away rather than storing "off".
    const duck = Number.isFinite(item.duck) ? Math.min(1, item.duck) : 0;
    if (duck > 0) item.duck = duck;
    else delete item.duck;
  }
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

/**
 * Sets (or clears, with `null`) the part of the timeline to export — the in / out points. Times
 * are rounded to whole flicks; the range must not be empty. It isn't clamped to the video's
 * length here (edits may shorten the video later); exports clamp it.
 */
export function setExportRange(project: Project, range: { start: Time; end: Time } | null): void {
  if (!range) {
    delete project.settings.exportRange;
    return;
  }
  const start = Math.max(0, Math.round(range.start));
  const end = Math.round(range.end);
  if (!(end > start))
    throw new EditError('invalid', 'The end of the part to export must come after its start');
  project.settings.exportRange = { start, end };
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

// ── captions (v0.2 A) ─────────────────────────────────────────────────────

/** A caption to add: when it shows, its text, and (optionally) its words' times within it. */
export interface CaptionInput {
  start: Time;
  end: Time;
  text: string;
  words?: CaptionWord[];
}

/** How wide captions may get before they wrap (fraction of the canvas width). */
const CAPTION_WRAP = 0.86;

/** The project's caption row, if it has one. */
export function captionTrack(project: Project): Track | null {
  return project.tracks.find((t) => t.kind === 'caption') ?? null;
}

/**
 * Adds captions to the caption row (made on first use, on top of everything). `replace` clears
 * the row first (new auto captions or an imported file). Captions are snapped to frames and
 * never overlap; new ones take the row's current look (or `preset` for a new row). Returns the
 * row's id.
 */
export function addCaptions(
  project: Project,
  captions: readonly CaptionInput[],
  ids: IdFactory,
  options: { replace?: boolean; preset?: CaptionPreset } = {},
): string {
  let track = captionTrack(project);
  if (track?.locked) throw new EditError('locked', 'The captions are locked');
  const preset = options.preset ?? DEFAULT_CAPTION_PRESET;
  const template = track?.items[0];
  if (!track) {
    track = {
      id: ids(),
      kind: 'caption',
      muted: false,
      hidden: false,
      locked: false,
      items: [],
      caption: lookFromPreset(preset),
    };
    project.tracks.push(track);
  }
  if (options.replace) track.items = [];
  const frame = projectFrame(project);
  const sorted = [...captions]
    .map((c) => ({ ...c, start: snap(project, c.start), end: snap(project, c.end) }))
    .filter((c) => c.text.trim())
    .sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    const end = Math.max(c.end, c.start + frame);
    if (!fits(track, c.start, end)) continue;
    const item: TextItem = {
      id: ids(),
      kind: 'text',
      start: c.start,
      duration: end - c.start,
      text: c.text.trim(),
      style: copy(template?.kind === 'text' ? template.style : preset.style),
      transform: copy(
        template && 'transform' in template
          ? template.transform
          : { ...DEFAULT_TRANSFORM, y: preset.y },
      ),
      filter: null,
      adjust: {},
      maxWidth: template?.kind === 'text' && template.maxWidth ? template.maxWidth : CAPTION_WRAP,
      ...(c.words?.length ? { words: copy(c.words) } : {}),
    };
    insertSorted(track, item);
  }
  if (track.items.length === 0) {
    project.tracks.splice(project.tracks.indexOf(track), 1);
    throw new EditError('invalid', 'There were no captions to add');
  }
  return track.id;
}

/** A change to every caption's look at once. */
export interface CaptionLookPatch {
  /** Apply a preset (text style, place and highlight). */
  preset?: CaptionPreset;
  highlight?: CaptionLook['highlight'];
  highlightColor?: string;
  style?: Partial<TextStyle>;
  /** Where captions sit (centre, fractions of the canvas) and their size. */
  x?: number;
  y?: number;
  scale?: number;
}

/** Restyles all captions (they share one look, DECISIONS #125). */
export function setCaptionLook(project: Project, patch: CaptionLookPatch): void {
  const track = captionTrack(project);
  if (!track) throw new EditError('not-found', 'There are no captions');
  if (track.locked) throw new EditError('locked', 'The captions are locked');
  const look = track.caption ?? lookFromPreset(DEFAULT_CAPTION_PRESET);
  if (patch.preset) Object.assign(look, lookFromPreset(patch.preset));
  if (patch.highlight) look.highlight = patch.highlight;
  if (patch.highlightColor) look.highlightColor = patch.highlightColor;
  track.caption = look;
  for (const item of track.items) {
    if (item.kind !== 'text') continue;
    if (patch.preset) {
      item.style = copy(patch.preset.style);
      item.transform = { ...item.transform, x: 0.5, y: patch.preset.y, scale: 1, rotation: 0 };
    }
    if (patch.style) item.style = { ...item.style, ...copy(patch.style) };
    if (patch.x !== undefined) item.transform.x = patch.x;
    if (patch.y !== undefined) item.transform.y = patch.y;
    if (patch.scale !== undefined) item.transform.scale = Math.min(4, Math.max(0.2, patch.scale));
  }
}

/** Changes one caption's text; its word times stay when the words still line up. */
export function setCaptionText(project: Project, itemId: string, text: string): void {
  const { item } = editable(project, itemId);
  if (item.kind !== 'text') throw new EditError('invalid', 'Only captions have text');
  const next = text.replace(/\s+/g, ' ').trim();
  if (!next) throw new EditError('invalid', 'A caption needs some text');
  const before = captionWords(item.text);
  const after = captionWords(next);
  if (item.words && before.length === after.length && item.words.length === before.length)
    item.words = item.words.map((w, i) => ({ ...w, text: after[i]! }));
  else delete item.words;
  item.text = next;
}

/** Joins a caption with the next one on its row (text, time and words). */
export function mergeCaptionWithNext(project: Project, itemId: string): void {
  const { track, item, index } = editable(project, itemId);
  const next = track.items[index + 1];
  if (!next || item.kind !== 'text' || next.kind !== 'text')
    throw new EditError('invalid', 'There is no caption after this one');
  if (next.locked) throw new EditError('locked', 'That element is locked');
  const gap = next.start - item.start;
  const ownTimes = item.words ? item.words : captionWordTimes(item);
  const nextTimes = next.words ? next.words : captionWordTimes(next);
  const words =
    item.words || next.words
      ? [...ownTimes, ...nextTimes.map((w) => ({ ...w, start: w.start + gap, end: w.end + gap }))]
      : undefined;
  item.text = `${item.text} ${next.text}`.trim();
  item.duration = itemEnd(next) - item.start;
  if (words) item.words = words;
  track.items.splice(index + 1, 1);
}

// ── keyframes (v0.4) ──────────────────────────────────────────────────────

type Keyed = Extract<Item, { transform: Transform }>;

function keyed(project: Project, itemId: string): Keyed {
  const { item } = editable(project, itemId);
  if (!('transform' in item)) throw new EditError('invalid', 'Sound has no position to animate');
  return item;
}

function checkProp(prop: string): asserts prop is KeyframeProp {
  if (!(KEYFRAME_PROPS as readonly string[]).includes(prop))
    throw new EditError('invalid', `${prop} can't take keyframes`);
}

/** Index of the keyframe within half a frame of `t`, or -1. */
function keyAt(project: Project, list: readonly Keyframe[], t: Time): number {
  const near = projectFrame(project) / 2;
  return list.findIndex((k) => Math.abs(k.t - t) < near);
}

function tidyKeyframes(item: Keyed): void {
  if (!item.keyframes) return;
  for (const prop of KEYFRAME_PROPS)
    if (item.keyframes[prop]?.length === 0) Reflect.deleteProperty(item.keyframes, prop);
  if (!hasKeyframes(item.keyframes)) delete item.keyframes;
  else if (item.keyframes.shift === 0) delete item.keyframes.shift;
}

/**
 * Sets a keyframe of `prop` at `t` (flicks from the item's start, snapped to a frame and kept
 * inside the item): replaces one there, else adds one. The first keyframe of a property makes
 * it follow its keyframes instead of the transform.
 */
export function setKeyframe(
  project: Project,
  itemId: string,
  prop: KeyframeProp,
  t: Time,
  value: number,
  ease?: Ease | Bezier,
): void {
  checkProp(prop);
  const item = keyed(project, itemId);
  if (!Number.isFinite(value)) throw new EditError('invalid', 'A keyframe needs a number');
  const at = Math.max(0, Math.min(item.duration, snap(project, t))) + (item.keyframes?.shift ?? 0);
  const v = prop === 'opacity' ? clamp01(value) : prop === 'scale' ? Math.max(0.001, value) : value;
  item.keyframes ??= {};
  const list = (item.keyframes[prop] ??= []);
  const i = keyAt(project, list, at);
  if (i !== -1) {
    list[i]!.v = v;
    if (ease !== undefined) list[i]!.ease = copy(ease);
    return;
  }
  const key: Keyframe = { t: at, v, ...(ease !== undefined ? { ease: copy(ease) } : {}) };
  const after = list.findIndex((k) => k.t > at);
  if (after === -1) list.push(key);
  else list.splice(after, 0, key);
}

/** Removes the keyframe of `prop` at `t` (if there is one). */
export function removeKeyframe(
  project: Project,
  itemId: string,
  prop: KeyframeProp,
  t: Time,
): void {
  checkProp(prop);
  const item = keyed(project, itemId);
  const list = item.keyframes?.[prop];
  if (!list) return;
  const i = keyAt(project, list, t + (item.keyframes!.shift ?? 0));
  if (i === -1) return;
  // The value the property had there stays as its plain value once the last keyframe goes.
  if (list.length === 1) item.transform[prop] = list[0]!.v;
  list.splice(i, 1);
  tidyKeyframes(item);
}

/** Moves a keyframe of `prop` from `from` to `to` (and to `value`, when given). */
export function moveKeyframe(
  project: Project,
  itemId: string,
  prop: KeyframeProp,
  from: Time,
  to: Time,
  value?: number,
): void {
  checkProp(prop);
  const item = keyed(project, itemId);
  const list = item.keyframes?.[prop];
  const i = list ? keyAt(project, list, from + (item.keyframes!.shift ?? 0)) : -1;
  if (!list || i === -1) throw new EditError('not-found', 'No keyframe there');
  const [key] = list.splice(i, 1);
  tidyKeyframes(item);
  setKeyframe(project, itemId, prop, to, value ?? key!.v, key!.ease);
}

/** Sets the curve from the keyframe of `prop` at `t` to the next (`null`: the default). */
export function setKeyframeEase(
  project: Project,
  itemId: string,
  prop: KeyframeProp,
  t: Time,
  ease: Ease | Bezier | null,
): void {
  checkProp(prop);
  const item = keyed(project, itemId);
  const list = item.keyframes?.[prop];
  const i = list ? keyAt(project, list, t + (item.keyframes!.shift ?? 0)) : -1;
  if (!list || i === -1) throw new EditError('not-found', 'No keyframe there');
  if (ease === null) delete list[i]!.ease;
  else list[i]!.ease = copy(ease);
}

/**
 * Removes every keyframe of `prop` (or of all properties): the property keeps the value it has
 * at `bakeAt` (flicks from the item's start) as its plain value.
 */
export function clearKeyframes(
  project: Project,
  itemId: string,
  prop?: KeyframeProp,
  bakeAt: Time = 0,
): void {
  const item = keyed(project, itemId);
  if (!item.keyframes) return;
  for (const p of prop ? [prop] : KEYFRAME_PROPS) {
    const list = item.keyframes[p];
    if (!list?.length) continue;
    item.transform[p] = sampleKeyframes(list, bakeAt + (item.keyframes.shift ?? 0));
    Reflect.deleteProperty(item.keyframes, p);
  }
  tidyKeyframes(item);
}

/**
 * Sets an item's transform as it should look at timeline time `at` (the playhead): keyframed
 * properties get a keyframe there (added, or changed to the new value); the others change for the
 * whole item, as without keyframes. What stage drags, sliders and align use.
 */
export function setTransformAt(
  project: Project,
  itemId: string,
  transform: Readonly<Transform>,
  at: Time,
): void {
  const item = keyed(project, itemId);
  const local = at - item.start;
  const next: Transform = { ...item.transform, flipX: transform.flipX, flipY: transform.flipY };
  for (const prop of KEYFRAME_PROPS) {
    const now = keyedValue(item.keyframes, prop, local);
    if (now === null) next[prop] = transform[prop];
    else if (Math.abs(now - transform[prop]) > 1e-9)
      setKeyframe(project, itemId, prop, local, transform[prop]);
  }
  updateItem(project, itemId, { transform: next });
}

/** An item's transform at timeline time `at` (keyframes sampled; a new object). */
export function transformAt(item: Item, at: Time): Transform | null {
  if (!('transform' in item)) return null;
  return keyedTransform(item.transform, item.keyframes, at - item.start, { ...item.transform });
}

// ── pro trims (v0.4): roll, slip, slide ───────────────────────────────────

/** The source span (flicks) an item may still reach past its current end / before its start. */
function sourceRoom(project: Project, item: Item): { before: Time; after: Time } {
  if (!isMedia(item)) {
    // Photos, freezes, text… can be any length.
    return { before: Number.MAX_SAFE_INTEGER, after: Number.MAX_SAFE_INTEGER };
  }
  return {
    before: floorToFrame(project, Math.floor(item.sourceIn / item.speed)),
    after: Math.max(0, maxDuration(project, item) - item.duration),
  };
}

/** Trims the start of an item by `delta` (flicks; > 0 shortens it) without moving its end. */
function trimStartBy(item: Item, delta: Time): void {
  if (isMedia(item)) item.sourceIn = Math.max(0, item.sourceIn + Math.round(delta * item.speed));
  retimeItemKeyframes(item, delta);
  item.start += delta;
  item.duration -= delta;
  clampWords(item, delta);
  clampFades(item);
}

/**
 * Roll edit: moves the cut between an item and the one right after it (touching, same track) by
 * `delta` — one gets longer, the other shorter by the same amount, so nothing else moves.
 * Clamped to the media both have and to one frame each. Returns the applied delta.
 */
export function rollEdit(project: Project, itemId: string, delta: Time): Time {
  const { track, item: left, index } = editable(project, itemId);
  const right = track.items[index + 1];
  if (!right || right.start !== itemEnd(left))
    throw new EditError('invalid', 'Pick a clip that touches the next one');
  if (right.locked) throw new EditError('locked', 'The next clip is locked');
  const frame = projectFrame(project);
  let d = snapToFrame(delta, project.settings.frameRate);
  const l = sourceRoom(project, left);
  const r = sourceRoom(project, right);
  d = Math.min(d, l.after, right.duration - frame);
  d = Math.max(d, -(left.duration - frame), -r.before);
  if (d === 0) return 0;
  left.duration += d;
  clampWords(left, 0);
  clampFades(left);
  trimStartBy(right, d);
  if (track.kind === 'main') layoutMain(project);
  else tidyLaneTransitions(project);
  return d;
}

/**
 * Slip: shows a different part of a video or sound in the same place — the clip keeps its spot
 * and length, the media slides under it by `delta` (flicks of timeline time; > 0 shows later
 * media). Returns the applied delta.
 */
export function slipItem(project: Project, itemId: string, delta: Time): Time {
  const { item } = editable(project, itemId);
  if (!isMedia(item)) throw new EditError('invalid', 'Only video and sound can slip');
  const room = sourceRoom(project, item);
  const d = Math.max(
    -room.before,
    Math.min(room.after, snapToFrame(delta, project.settings.frameRate)),
  );
  item.sourceIn = Math.max(0, item.sourceIn + Math.round(d * item.speed));
  return d;
}

/**
 * Slide: moves a main-video clip by `delta` between its neighbours — the one before gets longer
 * (or shorter), the one after shorter (or longer); the clip itself and the video's length don't
 * change. Returns the applied delta.
 */
export function slideItem(project: Project, itemId: string, delta: Time): Time {
  const { track, index } = editable(project, itemId);
  if (track.kind !== 'main') throw new EditError('invalid', 'Slide moves clips of the main video');
  const prev = track.items[index - 1];
  const next = track.items[index + 1];
  if (!prev || !next) throw new EditError('invalid', 'Slide needs a clip before and after it');
  if (prev.locked || next.locked) throw new EditError('locked', 'A neighbouring clip is locked');
  const frame = projectFrame(project);
  let d = snapToFrame(delta, project.settings.frameRate);
  const p = sourceRoom(project, prev);
  const n = sourceRoom(project, next);
  d = Math.min(d, p.after, next.duration - frame);
  d = Math.max(d, -(prev.duration - frame), -n.before);
  if (d === 0) return 0;
  prev.duration += d;
  clampWords(prev, 0);
  clampFades(prev);
  trimStartBy(next, d);
  layoutMain(project);
  return d;
}

// ── markers (v0.4) ─────────────────────────────────────────────────────────

/** Adds a marker at `time` (snapped to a frame, inside the video). Returns its id. */
export function addMarker(project: Project, time: Time, ids: IdFactory, label?: string): string {
  const at = Math.max(0, snap(project, time));
  const marker: Marker = { id: ids(), time: at, ...(label ? { label: label.slice(0, 200) } : {}) };
  const list = (project.markers ??= []);
  const after = list.findIndex((m) => m.time > at);
  if (after === -1) list.push(marker);
  else list.splice(after, 0, marker);
  return marker.id;
}

/** Changes a marker's time or label (an empty label removes it). */
export function updateMarker(
  project: Project,
  markerId: string,
  patch: { time?: Time; label?: string },
): void {
  const list = project.markers ?? [];
  const marker = list.find((m) => m.id === markerId);
  if (!marker) throw new EditError('not-found', 'No such marker');
  if (patch.time !== undefined) marker.time = Math.max(0, snap(project, patch.time));
  if (patch.label !== undefined) {
    if (patch.label.trim()) marker.label = patch.label.slice(0, 200);
    else delete marker.label;
  }
  list.sort((a, b) => a.time - b.time);
}

/** Removes a marker. */
export function removeMarker(project: Project, markerId: string): void {
  if (!project.markers) return;
  project.markers = project.markers.filter((m) => m.id !== markerId);
  if (project.markers.length === 0) delete project.markers;
}

// ── combined clips (DECISIONS #155) ──────────────────────────────────────

/** Every track list in the project: its own, then each combined clip's. */
export function allTrackLists(project: Project): Track[][] {
  const lists = [project.tracks];
  for (const asset of Object.values(project.assets))
    if (asset.kind === 'compound' && asset.tracks) lists.push(asset.tracks);
  return lists;
}

/** Whether any item (on the timeline or inside a combined clip) uses the asset. */
export function assetInUse(project: Project, assetId: string): boolean {
  return allTrackLists(project).some((tracks) =>
    tracks.some((t) =>
      t.items.some(
        (i) =>
          ('assetId' in i && i.assetId === assetId) || ('lut' in i && i.lut?.assetId === assetId),
      ),
    ),
  );
}

/** Length of a combined clip's content (its last item's end), at least one frame. */
export function compoundLength(project: Project, tracks: readonly Track[]): Time {
  let end = 0;
  for (const t of tracks) for (const i of t.items) end = Math.max(end, itemEnd(i));
  return Math.max(projectFrame(project), end);
}

/** Whether combined clip `assetId` contains itself (directly or through another one). */
export function compoundCycle(project: Project, assetId: string): boolean {
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    const asset = project.assets[id];
    if (!asset || asset.kind !== 'compound' || !asset.tracks) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    for (const t of asset.tracks)
      for (const i of t.items) {
        if (!('assetId' in i) || !i.assetId) continue;
        if (i.assetId === assetId || visit(i.assetId)) return true;
      }
    return false;
  };
  return visit(assetId);
}

/**
 * After the inside of combined clip `assetId` changed: its length and sound follow the content,
 * and clips that play it are shortened if they now read past its end.
 */
export function refreshCompound(project: Project, assetId: string): void {
  const asset = project.assets[assetId];
  if (!asset || asset.kind !== 'compound' || !asset.tracks) return;
  if (compoundCycle(project, assetId))
    throw new EditError('invalid', "A combined clip can't contain itself");
  asset.duration = compoundLength(project, asset.tracks);
  asset.hasAudio = asset.tracks.some(
    (t) =>
      t.kind !== 'caption' &&
      t.items.some(
        (i) => i.kind === 'audio' || (i.kind === 'video' && !!project.assets[i.assetId]?.hasAudio),
      ),
  );
  const frame = projectFrame(project);
  for (const tracks of allTrackLists(project)) {
    const own = tracks === asset.tracks;
    for (const track of tracks) {
      if (own) continue;
      for (const item of track.items) {
        if (item.kind !== 'video' || item.assetId !== assetId) continue;
        if (item.sourceIn >= asset.duration) item.sourceIn = 0;
        if (item.sourceIn + sourceSpan(item) > asset.duration + 1)
          item.duration = Math.max(
            frame,
            Math.floor((asset.duration - item.sourceIn) / item.speed / frame) * frame,
          );
        clampFades(item);
      }
      if (track.kind === 'main' && tracks === project.tracks) layoutMain(project);
    }
  }
}

/**
 * Combines items into one clip (a video item playing a new `compound` asset). Main-track clips
 * must sit next to each other: the combined clip takes their place on the main track (the
 * transition into the first one comes along); the selected layers inside their span go into it.
 * Only layers: the combined clip goes on a layer at the first one's start. Captions stay out.
 * Returns the combined clip's id.
 */
export function combineItems(
  project: Project,
  itemIds: readonly string[],
  ids: IdFactory,
  name = 'Combined clip',
): string {
  const picked = [...new Set(itemIds)].map((id) => editable(project, id));
  if (picked.length === 0) throw new EditError('invalid', 'Nothing to combine');
  if (picked.some((p) => p.track.kind === 'caption'))
    throw new EditError('invalid', "Captions can't go into a combined clip");
  const main = mainTrack(project);
  const mains = picked.filter((p) => p.track === main).sort((a, b) => a.index - b.index);
  if (mains.some((p, i) => i > 0 && p.index !== mains[i - 1]!.index + 1))
    throw new EditError('invalid', 'Pick clips that sit next to each other on the main track');
  const lanes = picked.filter((p) => p.track !== main);
  const start = mains.length ? mains[0]!.item.start : Math.min(...lanes.map((p) => p.item.start));
  if (mains.length && lanes.some((p) => p.item.start < start))
    throw new EditError(
      'invalid',
      'Layers that start before the first picked clip can only be combined on their own',
    );
  const frame = projectFrame(project);

  // The inside: a main track, then a lane per original lane (same order and kind).
  const inner: Track[] = [
    { id: ids(), kind: 'main', muted: false, hidden: false, locked: false, items: [] },
  ];
  let incoming: Transition | null = null;
  for (const [i, p] of mains.entries()) {
    const item = copy(p.item);
    item.start -= start;
    if (i === 0 && 'transitionIn' in item) {
      incoming = item.transitionIn;
      item.transitionIn = null;
    }
    inner[0]!.items.push(item);
  }
  const laneFor = new Map<string, Track>();
  for (const track of project.tracks) {
    if (track === main) continue;
    for (const p of lanes) {
      if (p.track !== track) continue;
      let lane = laneFor.get(track.id);
      if (!lane) {
        lane = {
          id: ids(),
          kind: track.kind,
          muted: track.muted,
          hidden: track.hidden,
          locked: false,
          items: [],
        };
        laneFor.set(track.id, lane);
        inner.push(lane);
      }
      const item = copy(p.item);
      item.start -= start;
      lane.items.push(item);
    }
  }
  for (const lane of inner) lane.items.sort((a, b) => a.start - b.start);
  // A group only partly picked: its members inside leave it (the ones outside are tidied below).
  const members = new Map<string, number>();
  for (const lane of inner)
    for (const i of lane.items)
      if (i.groupId) members.set(i.groupId, (members.get(i.groupId) ?? 0) + 1);
  for (const lane of inner)
    for (const i of lane.items) {
      if (!i.groupId) continue;
      const whole = project.tracks.every((t) =>
        t.items.every((o) => o.groupId !== i.groupId || picked.some((p) => p.item === o)),
      );
      if (!whole || (members.get(i.groupId) ?? 0) < 2 || lane === inner[0]) delete i.groupId;
    }

  const asset: Asset = {
    id: ids(),
    kind: 'compound',
    name,
    mimeType: 'application/x-video-ultra-compound',
    size: 0,
    duration: compoundLength(project, inner),
    width: project.settings.width,
    height: project.settings.height,
    hasAudio: false,
    source: { type: 'compound' },
    tracks: inner,
  };
  project.assets[asset.id] = asset;
  refreshCompound(project, asset.id);

  // Out of the timeline (last index first so the others stay valid).
  for (const p of [...picked].sort((a, b) => b.index - a.index)) {
    const at = p.track.items.indexOf(p.item);
    if (at !== -1) p.track.items.splice(at, 1);
  }
  const span = mains.length ? mains.reduce((sum, p) => sum + p.item.duration, 0) : asset.duration;
  const clip: Item = {
    id: ids(),
    kind: 'video',
    name,
    assetId: asset.id,
    start,
    duration: Math.max(frame, Math.min(span, asset.duration)),
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
    crop: { ...NO_CROP },
    fit: 'fit',
    filter: null,
    adjust: {},
    transitionIn: null,
  };
  if (mains.length) {
    main.items.splice(mains[0]!.index, 0, clip);
    if (clip.kind === 'video') clip.transitionIn = incoming;
    layoutMain(project);
  } else {
    placeInLane(project, clip, ids);
  }
  removeEmptyLanes(project);
  return clip.id;
}

/**
 * Puts a combined clip's pieces back on the timeline where it plays them (its trim and speed
 * applied to them; its own look, size and sound settings don't carry over). Pieces get new ids,
 * so another clip playing the same combined clip keeps it. Returns the new items' ids.
 */
export function separateItem(project: Project, itemId: string, ids: IdFactory): string[] {
  const { track, item, index } = editable(project, itemId);
  const asset = assetOf(project, item);
  if (item.kind !== 'video' || !asset || asset.kind !== 'compound' || !asset.tracks)
    throw new EditError('invalid', 'Only a combined clip can be separated');
  const frame = projectFrame(project);
  const speed = item.speed;
  const from = item.sourceIn;
  const to = item.sourceIn + sourceSpan(item);
  const toOuter = (t: Time) => item.start + Math.round((t - from) / speed);
  const groups = new Map<string, string>();
  const made: { piece: Item; main: boolean }[] = [];
  for (const inner of asset.tracks) {
    for (const child of inner.items) {
      const a = Math.max(child.start, from);
      const b = Math.min(itemEnd(child), to);
      if (b - a < frame) continue;
      const piece = copy(child);
      piece.id = ids();
      if (piece.groupId) {
        let g = groups.get(piece.groupId);
        if (!g) groups.set(piece.groupId, (g = ids()));
        piece.groupId = g;
      }
      const cut = a - child.start;
      if ('sourceIn' in piece) piece.sourceIn += Math.round(cut * piece.speed);
      if (cut > 0) retimeItemKeyframes(piece, cut);
      piece.start = toOuter(a);
      piece.duration = Math.max(frame, floorToFrame(project, Math.round((b - a) / speed)));
      clampWords(piece, cut);
      if ('speed' in piece && speed !== 1)
        piece.speed = Math.min(10, Math.max(0.1, piece.speed * speed));
      if ('fadeIn' in piece) {
        piece.fadeIn = Math.round(piece.fadeIn / speed);
        piece.fadeOut = Math.round(piece.fadeOut / speed);
      }
      clampFades(piece);
      made.push({ piece, main: inner.kind === 'main' });
    }
  }
  track.items.splice(index, 1);
  const mainPieces = made.filter((m) => m.main).map((m) => m.piece);
  if (track.kind === 'main') {
    if (mainPieces[0] && 'transitionIn' in mainPieces[0])
      mainPieces[0].transitionIn = item.transitionIn;
    track.items.splice(index, 0, ...mainPieces);
    // The pieces fill what the clip filled (rounding to frames can leave a frame either way).
    const filled = mainPieces.reduce((sum, p) => sum + p.duration, 0);
    const last = mainPieces.at(-1);
    if (last && filled !== item.duration)
      last.duration = Math.max(frame, last.duration + item.duration - filled);
    layoutMain(project);
  }
  for (const { piece, main } of made) {
    if (main && track.kind === 'main') continue;
    if ('transitionIn' in piece) piece.transitionIn = null;
    if (piece.kind === 'video' && main) delete piece.groupId;
    placeInLane(project, piece, ids);
  }
  if (!assetInUse(project, asset.id)) Reflect.deleteProperty(project.assets, asset.id);
  removeEmptyLanes(project);
  return made.map((m) => m.piece.id);
}
