import {
  FLICKS_PER_SECOND,
  itemEnd,
  type Item,
  type Project,
  type Time,
  type Track,
} from '@video-ultra/core';

/**
 * Pure timeline maths: where rows and clips are, ruler ticks, snapping and hit-testing. The canvas
 * view draws from this; tests check it without a browser.
 */

/** Sizes in CSS pixels (read from the `--vu-size-*` tokens). */
export interface TimelineMetrics {
  ruler: number;
  mainTrack: number;
  track: number;
  /** Vertical gap between rows. */
  gap: number;
  /** Left column with lane icons (0 on phones). */
  header: number;
  trimHandle: number;
  /** The "new layer" drop slot above every row (0 = none). */
  slot: number;
}

/** Horizontal mapping between time and screen x. */
export interface TimeScale {
  /** Pixels per second. */
  pps: number;
  /** Screen x of time 0 (already includes header and scrolling). */
  x0: number;
}

export function timeToX(scale: TimeScale, t: Time): number {
  return scale.x0 + (t / FLICKS_PER_SECOND) * scale.pps;
}

export function xToTime(scale: TimeScale, x: number): Time {
  return Math.round(((x - scale.x0) / scale.pps) * FLICKS_PER_SECOND);
}

/** One drawn row (a track). */
export interface Row {
  track: Track;
  /** Index among rows (= track index). */
  index: number;
  top: number;
  height: number;
}

/** Picture and text layers (everything drawn over the main video except sound). */
export function isLayerTrack(track: Track): boolean {
  return track.kind === 'overlay' || track.kind === 'text';
}

/** Row group order: main video, picture layers, text, sound. */
export const GROUP_ORDER: Record<Track['kind'], number> = {
  main: 0,
  overlay: 1,
  text: 2,
  audio: 3,
};

/**
 * Rows top to bottom, shifted up by `scrollY`, grouped by kind so the timeline always reads the
 * same way: the main video, the "new layer" slot, picture layers, text, then sound (owner choice,
 * 2026-10-18). Within a group, track order (a lower row draws in front).
 */
export function layoutRows(project: Project, m: TimelineMetrics, scrollY = 0): Row[] {
  const order = project.tracks
    .map((track, index) => ({ track, index }))
    .sort((a, b) => GROUP_ORDER[a.track.kind] - GROUP_ORDER[b.track.kind] || a.index - b.index);
  const rows: Row[] = [];
  let y = m.ruler + m.gap;
  for (const { track, index } of order) {
    const height = track.kind === 'main' ? m.mainTrack : m.track;
    rows.push({ track, index, top: y - scrollY, height });
    y += height + m.gap;
    if (track.kind === 'main') y += m.slot;
  }
  return rows;
}

/** The "new layer" slot, right under the main video (drop a clip there to layer it over). */
export function slotRect(m: TimelineMetrics, scrollY = 0): { top: number; height: number } {
  return {
    top: m.ruler + m.gap + m.mainTrack + m.gap - scrollY,
    height: Math.max(0, m.slot - m.gap),
  };
}

/** Total height of all rows (for vertical scrolling). */
export function contentHeight(project: Project, m: TimelineMetrics): number {
  let y = m.ruler + m.gap + m.slot;
  for (const track of project.tracks) y += (track.kind === 'main' ? m.mainTrack : m.track) + m.gap;
  return y;
}

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Major tick spacing (seconds) so labels are at least `minPx` apart. */
export function majorTickSeconds(pps: number, minPx = 72): number {
  for (const step of TICK_STEPS) if (step * pps >= minPx) return step;
  return TICK_STEPS[TICK_STEPS.length - 1]!;
}

/** Ruler label for a tick: `0:05`, `1:30`, `0:02.5` (tenths only when ticks need them). */
export function tickLabel(seconds: number, step: number): string {
  const whole = Math.floor(seconds + 1e-6);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  const base = `${m}:${String(s).padStart(2, '0')}`;
  if (step >= 1) return base;
  const tenth = Math.round((seconds - whole) * 10);
  return tenth === 0 ? base : `${base}.${tenth}`;
}

/** Zoom limits (pixels per second). */
export const MIN_PPS = 2;
export const MAX_PPS = 600;

export function clampPps(pps: number): number {
  return Math.min(MAX_PPS, Math.max(MIN_PPS, pps));
}

/**
 * Snaps `t` to the nearest candidate within `thresholdPx`. Returns the snapped time and the
 * candidate (for drawing the guide), or the input when nothing is close.
 */
export function snapTime(
  t: Time,
  candidates: readonly Time[],
  pps: number,
  thresholdPx = 8,
): { time: Time; snapped: Time | null } {
  const limit = (thresholdPx / pps) * FLICKS_PER_SECOND;
  let best: Time | null = null;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d <= limit && d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best === null ? { time: t, snapped: null } : { time: best, snapped: best };
}

/** Snap targets: time 0, the playhead and every item edge except the excluded item's. */
export function snapCandidates(project: Project, playhead: Time, excludeId?: string): Time[] {
  const out: Time[] = [0, playhead];
  for (const track of project.tracks) {
    for (const item of track.items) {
      if (item.id === excludeId) continue;
      out.push(item.start, itemEnd(item));
    }
  }
  return out;
}

/**
 * Whether items `i - 1` and `i` form a cut a transition can go on: two pictures that touch (on
 * the main track they always do).
 */
export function isCut(items: readonly Item[], i: number): boolean {
  const a = items[i - 1];
  const b = items[i];
  return !!a && !!b && 'transitionIn' in a && 'transitionIn' in b && itemEnd(a) === b.start;
}

/** What a pointer is over. */
export type Hit =
  | { type: 'ruler'; time: Time }
  | { type: 'trim'; item: Item; row: Row; edge: 'start' | 'end' }
  | { type: 'item'; item: Item; row: Row }
  | { type: 'transition'; item: Item; row: Row }
  | { type: 'add'; row: Row }
  | { type: 'row'; row: Row; time: Time }
  | { type: 'empty'; time: Time };

/** Size of the "+" (add media) button at the end of the main track. */
export function addButtonRect(
  row: Row,
  scale: TimeScale,
  end: Time,
): { x: number; y: number; size: number } {
  const size = Math.min(row.height - 8, 40);
  return { x: timeToX(scale, end) + 8, y: row.top + (row.height - size) / 2, size };
}

/** Finds what's under (x, y). `selectedId` gets trim handles, which win over the clip body. */
export function hitTest(
  rows: readonly Row[],
  m: TimelineMetrics,
  scale: TimeScale,
  x: number,
  y: number,
  selectedId: string | null,
  touch: boolean,
): Hit {
  const time = Math.max(0, xToTime(scale, x));
  if (y < m.ruler) return { type: 'ruler', time };
  const slop = touch ? 6 : 2;
  for (const row of rows) {
    if (y < row.top - m.gap / 2 || y >= row.top + row.height + m.gap / 2) continue;
    const items = row.track.items;
    const selected = selectedId ? items.find((i) => i.id === selectedId) : undefined;
    if (selected) {
      const left = timeToX(scale, selected.start);
      const right = timeToX(scale, itemEnd(selected));
      const w = m.trimHandle;
      if (x >= left - w - slop && x <= left + slop)
        return { type: 'trim', item: selected, row, edge: 'start' };
      if (x >= right - slop && x <= right + w + slop)
        return { type: 'trim', item: selected, row, edge: 'end' };
    }
    // Transition markers sit on the cuts: every cut of the main track, and where two pictures
    // touch on a layer.
    if (row.track.kind === 'main' || row.track.kind === 'overlay') {
      const r = touch ? 14 : 10;
      for (let i = 1; i < items.length; i++) {
        if (!isCut(items, i)) continue;
        const cx = timeToX(scale, items[i]!.start);
        const cy = row.top + row.height / 2;
        if (
          Math.abs(x - cx) <= r &&
          Math.abs(y - cy) <= r &&
          (items[i]!.duration / FLICKS_PER_SECOND) * scale.pps > r * 3
        )
          return { type: 'transition', item: items[i]!, row };
      }
      if (row.track.kind === 'main') {
        const last = items[items.length - 1];
        const add = addButtonRect(row, scale, last ? itemEnd(last) : 0);
        if (x >= add.x && x <= add.x + add.size && y >= add.y && y <= add.y + add.size)
          return { type: 'add', row };
      }
    }
    for (const item of items) {
      const left = timeToX(scale, item.start);
      const right = timeToX(scale, itemEnd(item));
      if (x >= left && x < right) return { type: 'item', item, row };
    }
    return { type: 'row', row, time };
  }
  return { type: 'empty', time };
}

/** Main-track insertion index for a dragged clip whose centre is at time `t`. */
export function reorderIndex(items: readonly Item[], draggedId: string, t: Time): number {
  const others = items.filter((i) => i.id !== draggedId);
  let index = 0;
  let cursor = 0;
  for (const item of others) {
    if (t < cursor + item.duration / 2) return index;
    cursor += item.duration;
    index++;
  }
  return index;
}
