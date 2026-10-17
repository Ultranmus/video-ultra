import { itemEnd } from '../model/project';
import type { Item, Project, Track } from '../model/schema';
import type { Time } from '../model/time';

/**
 * What's on screen at a timeline time: the visual layers, bottom to top, each with the moment of
 * its media to show. Pure and allocation-light — the engine calls it every frame.
 */

/** Item kinds that draw a picture. */
export type VisualItem = Extract<Item, { kind: 'video' | 'image' | 'freeze' | 'text' | 'sticker' }>;

/** One picture to draw this frame. */
export interface ActiveLayer {
  item: VisualItem;
  track: Track;
  /** For video: the source time to show (flicks). For freeze: its still time. Else 0. */
  sourceTime: Time;
  /** Time since the item started on the timeline (flicks) — for animations. */
  localTime: Time;
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

/** Source time shown by a visual item at timeline time `t` (which must be inside the item). */
export function sourceTimeAt(item: VisualItem, t: Time): Time {
  switch (item.kind) {
    case 'video':
      return item.sourceIn + Math.round((t - item.start) * item.speed);
    case 'freeze':
      return item.sourceTime;
    default:
      return 0;
  }
}

/**
 * The visual layers at `t`, bottom to top: the main track first, then lanes in track order
 * (later tracks draw on top). Hidden tracks and audio are skipped.
 */
export function activeLayers(project: Project, t: Time, out: ActiveLayer[] = []): ActiveLayer[] {
  out.length = 0;
  for (const track of project.tracks) {
    if (track.hidden || track.kind === 'audio') continue;
    const index = itemIndexAt(track.items, t);
    if (index === -1) continue;
    const item = track.items[index]!;
    if (!isVisual(item)) continue;
    out.push({ item, track, sourceTime: sourceTimeAt(item, t), localTime: t - item.start });
  }
  return out;
}

/** Video items whose media will be needed in the window [t, t + ahead) — for prefetching decoders. */
export function upcomingVideoItems(project: Project, t: Time, ahead: Time): VisualItem[] {
  const result: VisualItem[] = [];
  const end = t + ahead;
  for (const track of project.tracks) {
    if (track.hidden || track.kind === 'audio') continue;
    for (const item of track.items) {
      if (item.start >= end) break;
      if (itemEnd(item) > t && (item.kind === 'video' || item.kind === 'freeze')) result.push(item);
    }
  }
  return result;
}
