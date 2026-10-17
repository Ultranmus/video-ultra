import { itemEnd } from '../model/project';
import type { Direction, Ease, Item, Project, Track, Transition } from '../model/schema';
import type { Time } from '../model/time';

/**
 * What's on screen at a timeline time: the visual layers, bottom to top, each with the moment of
 * its media to show. Pure and allocation-light — the engine calls it every frame.
 *
 * Transitions: a main-track item's `transitionIn` plays over a window of `duration` centred on the
 * cut (the earlier half before it, the rest after). Inside the window both clips are drawn: the
 * outgoing one keeps playing past its end and the incoming one starts early, as far as their media
 * allows (beyond that, the edge frame is held).
 */

/** Item kinds that draw a picture. */
export type VisualItem = Extract<Item, { kind: 'video' | 'image' | 'freeze' | 'text' | 'sticker' }>;

/** A main-track layer taking part in a transition this frame. */
export interface LayerTransition {
  /** Transition preset id (`item.transitionIn.type`). */
  type: string;
  /** 0 at the start of the window, 1 at its end (0.5 = the cut). */
  progress: number;
  /** `out`: the clip before the cut; `in`: the clip after it (drawn on top). */
  role: 'out' | 'in';
  /** `transitionIn.direction` / `.ease` (undefined = the preset's own). */
  direction?: Direction | undefined;
  ease?: Ease | undefined;
}

function transitionInfo(t: Transition, progress: number, role: 'out' | 'in'): LayerTransition {
  return { type: t.type, progress, role, direction: t.direction, ease: t.ease };
}

/** One picture to draw this frame. */
export interface ActiveLayer {
  item: VisualItem;
  track: Track;
  /** For video: the source time to show (flicks). For freeze: its still time. Else 0. */
  sourceTime: Time;
  /**
   * Time since the item started on the timeline (flicks) — for animations. Negative for the
   * incoming clip of a transition before the cut.
   */
  localTime: Time;
  /** Set when this layer is half of a transition on the main track. */
  transition: LayerTransition | null;
}

/** Index of the item in `items` (sorted by start, non-overlapping) that contains `t`, or -1. */
export function itemIndexAt(items: readonly Item[], t: Time): number {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = items[mid]!;
    if (t < item.start) hi = mid - 1;
    else if (t >= itemEnd(item)) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function isVisual(item: Item): item is VisualItem {
  return item.kind !== 'audio';
}

/**
 * Source time shown by a visual item at timeline time `t`. Inside the item this is exact; outside
 * it (transitions) it is extended at the item's speed and, when `project` is given, clamped to the
 * media that exists (0 … asset duration) — the edge frame is held.
 */
export function sourceTimeAt(item: VisualItem, t: Time, project?: Project): Time {
  switch (item.kind) {
    case 'video': {
      const raw = item.sourceIn + Math.round((t - item.start) * item.speed);
      const limit = project?.assets[item.assetId]?.duration;
      return Math.max(0, limit !== undefined && limit > 0 ? Math.min(raw, limit) : raw);
    }
    case 'freeze':
      return item.sourceTime;
    default:
      return 0;
  }
}

/** The transition's length, clamped to both neighbours (edits keep it so; this is defensive). */
export function transitionLength(previous: Item, item: Item): Time {
  if (!('transitionIn' in item) || !item.transitionIn) return 0;
  // On a layer, only clips that touch transition (the main track always touches).
  if (itemEnd(previous) !== item.start) return 0;
  return Math.max(0, Math.min(item.transitionIn.duration, previous.duration, item.duration));
}

/** The part of a transition window before the cut (the rest is after it). */
export function transitionLead(length: Time): Time {
  return Math.floor(length / 2);
}

/** Tracks whose touching pictures can transition: the main track and picture layers. */
function hasTransitions(track: Track): boolean {
  return track.kind === 'main' || track.kind === 'overlay';
}

/**
 * When the item at `index` of `track` is on screen: its own span, widened by the transitions into
 * it and out of it.
 */
export function visibleSpan(track: Track, index: number): { start: Time; end: Time } {
  const item = track.items[index]!;
  let start = item.start;
  let end = itemEnd(item);
  if (hasTransitions(track)) {
    const previous = track.items[index - 1];
    if (previous) start -= transitionLead(transitionLength(previous, item));
    const next = track.items[index + 1];
    if (next) {
      const length = transitionLength(item, next);
      end += length - transitionLead(length);
    }
  }
  return { start, end };
}

function layer(
  project: Project,
  track: Track,
  item: VisualItem,
  t: Time,
  transition: LayerTransition | null,
): ActiveLayer {
  return {
    item,
    track,
    sourceTime: sourceTimeAt(item, t, project),
    localTime: t - item.start,
    transition,
  };
}

/**
 * Pushes a track's layer(s) at `t`: one clip, or the two clips of a transition (main track, and
 * touching pictures on a layer).
 */
function trackLayers(project: Project, track: Track, t: Time, out: ActiveLayer[]): void {
  const items = track.items;
  const index = itemIndexAt(items, t);
  if (index === -1) return;
  const item = items[index]!;
  if (!isVisual(item)) return;
  // Transition out of this item into the next (the window's part before the cut)…
  const next = items[index + 1];
  if (next && isVisual(next)) {
    const length = transitionLength(item, next);
    const windowStart = next.start - transitionLead(length);
    if (length > 0 && t >= windowStart && 'transitionIn' in next && next.transitionIn) {
      const progress = (t - windowStart) / length;
      const tr = next.transitionIn;
      out.push(layer(project, track, item, t, transitionInfo(tr, progress, 'out')));
      out.push(layer(project, track, next, t, transitionInfo(tr, progress, 'in')));
      return;
    }
  }
  // …or into this item from the previous one (the part after the cut).
  const previous = items[index - 1];
  if (previous && isVisual(previous) && 'transitionIn' in item && item.transitionIn) {
    const length = transitionLength(previous, item);
    const windowStart = item.start - transitionLead(length);
    if (length > 0 && t < windowStart + length) {
      const progress = (t - windowStart) / length;
      const tr = item.transitionIn;
      out.push(layer(project, track, previous, t, transitionInfo(tr, progress, 'out')));
      out.push(layer(project, track, item, t, transitionInfo(tr, progress, 'in')));
      return;
    }
  }
  out.push(layer(project, track, item, t, null));
}

/**
 * The visual layers at `t`, bottom to top: the main track first (two clips during a transition,
 * the outgoing one below), then lanes in track order (later tracks draw on top). Hidden tracks and
 * audio are skipped.
 */
export function activeLayers(project: Project, t: Time, out: ActiveLayer[] = []): ActiveLayer[] {
  out.length = 0;
  for (const track of project.tracks) {
    if (track.hidden || track.kind === 'audio') continue;
    if (hasTransitions(track)) {
      trackLayers(project, track, t, out);
      continue;
    }
    const index = itemIndexAt(track.items, t);
    if (index === -1) continue;
    const item = track.items[index]!;
    if (!isVisual(item)) continue;
    out.push(layer(project, track, item, t, null));
  }
  return out;
}

/** A video/freeze item that will be needed soon, and the first source time it will show. */
export interface UpcomingItem {
  item: Extract<VisualItem, { kind: 'video' | 'freeze' }>;
  /** When it first appears (flicks), transitions included. */
  visibleFrom: Time;
  /** The source time it shows first. */
  firstSourceTime: Time;
}

/**
 * Video / freeze items whose media will be needed in the window [t, t + ahead) — transitions
 * included — for prefetching decoders and releasing idle ones.
 */
export function upcomingVideoItems(project: Project, t: Time, ahead: Time): VisualItem[] {
  return upcomingVideo(project, t, ahead).map((u) => u.item);
}

/** Like {@link upcomingVideoItems}, with when each item appears and its first source time. */
export function upcomingVideo(project: Project, t: Time, ahead: Time): UpcomingItem[] {
  const result: UpcomingItem[] = [];
  const end = t + ahead;
  for (const track of project.tracks) {
    if (track.hidden || track.kind === 'audio') continue;
    const items = track.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      // Main-track items can show up to half a transition early, never more than their length.
      if (item.start - item.duration >= end) break;
      if (item.kind !== 'video' && item.kind !== 'freeze') continue;
      const span = visibleSpan(track, i);
      if (span.start >= end || span.end <= t) continue;
      const visibleFrom = Math.max(span.start, t);
      result.push({ item, visibleFrom, firstSourceTime: sourceTimeAt(item, visibleFrom, project) });
    }
  }
  return result;
}
