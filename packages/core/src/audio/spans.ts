import { itemEnd } from '../model/project';
import type { Item, Track } from '../model/schema';
import type { Time } from '../model/time';
import { transitionLead, transitionLength } from '../engine/timeline';

/**
 * When an item's sound plays, and how a picture transition shapes it. At a cut with a transition
 * the outgoing clip keeps sounding past the cut (if its media goes on) while fading out, and the
 * incoming one starts before the cut (if it has media before its in-point) while fading in —
 * an equal-power crossfade over the transition window. With no spare media on a side, that side
 * fades inside its own clip instead: a soft dip, never a hard cut.
 */
export interface AudioSpan {
  /** Timeline time the sound starts / ends (may extend past the item for a crossfade). */
  start: Time;
  end: Time;
  /** Fade in from silence over [fadeInFrom, fadeInTo] (equal power); empty when none. */
  fadeInFrom: Time;
  fadeInTo: Time;
  /** Fade out to silence over [fadeOutFrom, fadeOutTo]; empty when none. */
  fadeOutFrom: Time;
  fadeOutTo: Time;
}

/**
 * The span of `track.items[index]`, written into `span` (reused by the mixer). `mediaDuration` is the asset's length (flicks), to know how
 * far past its out-point the media goes.
 */
export function audioSpan(
  track: Track,
  index: number,
  mediaDuration: Time,
  span: AudioSpan = { start: 0, end: 0, fadeInFrom: 0, fadeInTo: 0, fadeOutFrom: 0, fadeOutTo: 0 },
): AudioSpan {
  const item = track.items[index]!;
  const end = itemEnd(item);
  span.start = item.start;
  span.end = end;
  span.fadeInFrom = item.start;
  span.fadeInTo = item.start;
  span.fadeOutFrom = end;
  span.fadeOutTo = end;
  if (track.kind !== 'main' && track.kind !== 'overlay') return span;
  const speed = 'speed' in item ? item.speed : 1;
  const sourceIn = 'sourceIn' in item ? item.sourceIn : 0;

  // Into this item from the previous one.
  const previous = track.items[index - 1];
  if (previous) {
    const length = transitionLength(previous, item);
    if (length > 0) {
      const lead = transitionLead(length);
      const before = Math.min(lead, Math.floor(sourceIn / speed));
      span.start = item.start - before;
      span.fadeInFrom = item.start - before;
      span.fadeInTo = item.start + (length - lead);
    }
  }
  // Out of this item into the next one.
  const next = track.items[index + 1];
  if (next) {
    const length = transitionLength(item, next);
    if (length > 0) {
      const lead = transitionLead(length);
      const usedTo = sourceIn + Math.round(item.duration * speed);
      const spare = Math.max(0, Math.floor((mediaDuration - usedTo) / speed));
      const after = Math.min(length - lead, spare);
      span.end = end + after;
      span.fadeOutFrom = end - lead;
      span.fadeOutTo = end + after;
    }
  }
  return span;
}

/** The crossfade gain (0…1, equal power) of a span at timeline time `t`. */
export function spanGain(span: AudioSpan, t: Time): number {
  let g = 1;
  if (t < span.fadeInTo && span.fadeInTo > span.fadeInFrom) {
    const p = Math.max(0, (t - span.fadeInFrom) / (span.fadeInTo - span.fadeInFrom));
    g *= Math.sin((p * Math.PI) / 2);
  }
  if (t > span.fadeOutFrom && span.fadeOutTo > span.fadeOutFrom) {
    const p = Math.min(1, (t - span.fadeOutFrom) / (span.fadeOutTo - span.fadeOutFrom));
    g *= Math.cos((p * Math.PI) / 2);
  }
  return g;
}

/** Whether an item makes sound (so its span matters). */
export function isAudible(item: Item): item is Extract<Item, { kind: 'video' | 'audio' }> {
  return item.kind === 'video' || item.kind === 'audio';
}
