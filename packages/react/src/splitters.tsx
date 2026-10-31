import { useLayoutEffect, useRef, type ReactElement, type RefObject } from 'react';
import { useLabels } from './context';

/**
 * Desktop: the side panel, the settings panel and the timeline can be resized by dragging their
 * inner edge (or with the arrow keys on it; double-click or Enter puts it back). Each size has a
 * floor and a ceiling, and the video always keeps room. While dragging, only a CSS variable on
 * the root changes (no React render per move); the sizes are kept in this browser on release.
 */

/** Which edge: the side panel's right edge, the settings panel's left edge, the timeline's top. */
export type SplitEdge = 'panel' | 'inspector' | 'timeline';

interface EdgeSpec {
  /** The root variable that holds the size. */
  variable: string;
  /** The element whose size it is. */
  target: string;
  min: number;
  /** Ceiling (px); the timeline also stops at `TIMELINE_MAX_SHARE` of the editor's height. */
  max: number;
  /** +1: dragging right / down grows it; -1: left / up does. */
  sign: 1 | -1;
  axis: 'x' | 'y';
}

const EDGES: Record<SplitEdge, EdgeSpec> = {
  panel: { variable: '--vu-panel-w', target: '.vu-panel', min: 280, max: 400, sign: 1, axis: 'x' },
  inspector: {
    variable: '--vu-inspector-w',
    target: '.vu-inspector',
    min: 280,
    max: 400,
    sign: -1,
    axis: 'x',
  },
  timeline: {
    variable: '--vu-timeline-h',
    target: '.vu-timeline-area',
    // Smaller than the default too, down to the ruler and the main video row (`timelineFloor`).
    min: 0,
    max: 420,
    sign: -1,
    axis: 'y',
  },
};

/** The timeline never takes more than this share of the editor's height. */
const TIMELINE_MAX_SHARE = 0.45;
/** The video keeps at least this much room when a panel grows. */
const STAGE_MIN_W = 320;
const STAGE_MIN_H = 200;
const KEY_STEP = 16;
const STORE_KEY = 'video-ultra:layout';

type Saved = { [E in SplitEdge]?: number | undefined };

function readSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}

function writeSaved(edge: SplitEdge, size: number | null): void {
  try {
    const saved = readSaved();
    // Unset sizes drop out of the JSON.
    saved[edge] = size === null ? undefined : Math.round(size);
    localStorage.setItem(STORE_KEY, JSON.stringify(saved));
  } catch {
    /* storage blocked: the size just isn't remembered */
  }
}

/**
 * The timeline's floor: its ruler and the whole main video row, nothing cut off — measured from
 * the same sizes the timeline draws with (they change with density).
 */
function timelineFloor(root: HTMLElement): number {
  const style = getComputedStyle(root);
  const px = (name: string, fallback: number) =>
    parseFloat(style.getPropertyValue(name)) || fallback;
  const gap = px('--vu-space-2', 8) * 0.75;
  return Math.ceil(px('--vu-size-ruler', 24) + gap + px('--vu-size-track-main', 56) + gap);
}

/** The smallest an edge may be. */
function floorOf(root: HTMLElement, edge: SplitEdge): number {
  return edge === 'timeline' ? timelineFloor(root) : EDGES[edge].min;
}

/** The allowed range for an edge right now (the video's room counts). */
function limits(root: HTMLElement, edge: SplitEdge, current: number): [number, number] {
  const spec = EDGES[edge];
  const min = floorOf(root, edge);
  const stage = root.querySelector('.vu-stage-area')?.getBoundingClientRect();
  if (spec.axis === 'x') {
    const room = stage ? current + stage.width - STAGE_MIN_W : spec.max;
    return [min, Math.max(min, Math.min(spec.max, room))];
  }
  const share = Math.min(spec.max, root.clientHeight * TIMELINE_MAX_SHARE);
  const room = stage ? current + stage.height - STAGE_MIN_H : share;
  return [min, Math.max(min, Math.min(share, room))];
}

function sizeOf(root: HTMLElement, edge: SplitEdge): number {
  const r = root.querySelector(EDGES[edge].target)?.getBoundingClientRect();
  return r ? (EDGES[edge].axis === 'x' ? r.width : r.height) : 0;
}

/**
 * Puts the sizes kept in this browser back. Call it in the component that renders the root
 * element (its ref is set by the time that component's layout effects run, not a child's).
 */
export function useSavedLayout(rootRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const saved = readSaved();
    for (const edge of Object.keys(EDGES) as SplitEdge[]) {
      const size = saved[edge];
      const spec = EDGES[edge];
      if (typeof size === 'number' && size >= floorOf(root, edge))
        root.style.setProperty(spec.variable, `${Math.min(size, spec.max)}px`);
    }
  }, [rootRef]);
}

/** A thin handle on one edge; drag, arrow keys, or double-click / Enter to reset. */
export function Splitter({ edge }: { edge: SplitEdge }): ReactElement {
  const l = useLabels();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; from: number; start: number; range: [number, number] } | null>(
    null,
  );
  const spec = EDGES[edge];
  const root = () => ref.current?.closest<HTMLElement>('.vu-root') ?? null;
  /** Tells assistive tech the size and its range (a focusable separator must have them). */
  const describe = (r: HTMLElement, size: number) => {
    const [min, max] = limits(r, edge, size);
    ref.current?.setAttribute('aria-valuenow', String(Math.round(size)));
    ref.current?.setAttribute('aria-valuemin', String(Math.round(min)));
    ref.current?.setAttribute('aria-valuemax', String(Math.round(max)));
  };
  const apply = (r: HTMLElement, size: number) => {
    r.style.setProperty(spec.variable, `${Math.round(size)}px`);
    describe(r, size);
  };
  // From the start, not only after a drag (the size itself stays the layout's own).
  useLayoutEffect(() => {
    const r = root();
    if (r) describe(r, sizeOf(r, edge));
    // Once, when the handle appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const reset = () => {
    const r = root();
    if (!r) return;
    r.style.removeProperty(spec.variable);
    writeSaved(edge, null);
    requestAnimationFrame(() => apply(r, sizeOf(r, edge)));
  };
  const label =
    edge === 'panel' ? l.resizePanel : edge === 'inspector' ? l.resizeInspector : l.resizeTimeline;
  return (
    <div
      ref={ref}
      className="vu-splitter"
      data-edge={edge}
      role="separator"
      tabIndex={0}
      aria-orientation={spec.axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      data-tooltip={l.resizeTip}
      onPointerDown={(e) => {
        const r = root();
        if (!r || e.button > 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const start = sizeOf(r, edge);
        drag.current = {
          id: e.pointerId,
          from: spec.axis === 'x' ? e.clientX : e.clientY,
          start,
          range: limits(r, edge, start),
        };
        e.currentTarget.toggleAttribute('data-dragging', true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const r = root();
        if (!d || d.id !== e.pointerId || !r) return;
        const delta = (spec.axis === 'x' ? e.clientX : e.clientY) - d.from;
        apply(r, Math.min(d.range[1], Math.max(d.range[0], d.start + spec.sign * delta)));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        e.currentTarget.toggleAttribute('data-dragging', false);
        const r = root();
        if (d && r) writeSaved(edge, sizeOf(r, edge));
      }}
      onPointerCancel={(e) => {
        drag.current = null;
        e.currentTarget.toggleAttribute('data-dragging', false);
      }}
      onDoubleClick={reset}
      onFocus={() => {
        const r = root();
        if (r) apply(r, sizeOf(r, edge));
      }}
      onKeyDown={(e) => {
        const r = root();
        if (!r) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          reset();
          return;
        }
        const grow = spec.axis === 'x' ? (spec.sign > 0 ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';
        const shrink =
          spec.axis === 'x' ? (spec.sign > 0 ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
        const now = sizeOf(r, edge);
        const [min, max] = limits(r, edge, now);
        const next =
          e.key === grow
            ? now + KEY_STEP
            : e.key === shrink
              ? now - KEY_STEP
              : e.key === 'Home'
                ? min
                : e.key === 'End'
                  ? max
                  : null;
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        const size = Math.min(max, Math.max(min, next));
        apply(r, size);
        writeSaved(edge, size);
      }}
    />
  );
}

// ── Phone: the timeline's height, in three steps ────────────────────────────────────────

/** Phone timeline sizes: only the play bar, today's height, or most of the screen. */
export type PhoneTimelineSize = 'minimal' | 'normal' | 'full';

const PHONE_SIZES: readonly PhoneTimelineSize[] = ['minimal', 'normal', 'full'];
const PHONE_KEY = 'video-ultra:phone-timeline';
/** "Full" still leaves the video this much room (px). */
const PHONE_STAGE_MIN = 160;

function readPhoneSize(): PhoneTimelineSize {
  try {
    const v = localStorage.getItem(PHONE_KEY);
    return v === 'minimal' || v === 'full' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

/** The timeline area's height (px) for a size; null: the layout's own (normal). */
function phoneHeight(root: HTMLElement, size: PhoneTimelineSize): number | null {
  if (size === 'normal') return null;
  if (size === 'minimal') return 0;
  const area = root.querySelector<HTMLElement>('.vu-timeline-area');
  const stage = root.querySelector<HTMLElement>('.vu-stage-area');
  if (!area || !stage) return null;
  // Grow the timeline by all the video's room above its floor.
  return Math.max(0, area.offsetHeight + stage.offsetHeight - PHONE_STAGE_MIN);
}

/**
 * Phones: a grip on top of the play bar resizes the timeline — drag it down to leave only the
 * play bar (the video gets the room), up for more lanes; it snaps to minimal / normal / full on
 * release (arrow keys step through them). While dragging, the height follows the
 * finger through one CSS variable (no React render per move); the size is kept in this browser.
 */
export function PhoneTimelineGrip(): ReactElement {
  const l = useLabels();
  const ref = useRef<HTMLDivElement>(null);
  const size = useRef<PhoneTimelineSize>('normal');
  const drag = useRef<{
    id: number;
    y: number;
    dy: number;
    moved: boolean;
    start: number;
    max: number;
  } | null>(null);
  const root = () => ref.current?.closest<HTMLElement>('.vu-root') ?? null;
  const name = (s: PhoneTimelineSize) =>
    s === 'minimal' ? l.timelineMinimal : s === 'full' ? l.timelineFull : l.timelineNormal;

  const apply = (next: PhoneTimelineSize, save: boolean) => {
    const r = root();
    if (!r) return;
    size.current = next;
    // Measure "full" from the normal layout, so it doesn't depend on the size before.
    r.style.removeProperty('--vu-timeline-phone-h');
    const h = phoneHeight(r, next);
    if (h !== null) r.style.setProperty('--vu-timeline-phone-h', `${Math.round(h)}px`);
    r.dataset.timelineSize = next;
    const el = ref.current;
    if (el) {
      el.setAttribute('aria-valuenow', String(PHONE_SIZES.indexOf(next)));
      el.setAttribute('aria-valuetext', name(next));
    }
    if (save) {
      try {
        localStorage.setItem(PHONE_KEY, next);
      } catch {
        /* storage blocked: the size just isn't remembered */
      }
    }
  };

  // The kept size on open; "full" follows the screen when it changes (rotation, keyboard).
  useLayoutEffect(() => {
    const r = root();
    if (!r) return;
    apply(readPhoneSize(), false);
    let w = r.clientWidth;
    let h = r.clientHeight;
    const ro = new ResizeObserver(() => {
      if (r.clientWidth === w && r.clientHeight === h) return;
      w = r.clientWidth;
      h = r.clientHeight;
      if (size.current === 'full' && !r.hasAttribute('data-keyboard')) apply('full', false);
    });
    ro.observe(r);
    return () => {
      ro.disconnect();
      r.style.removeProperty('--vu-timeline-phone-h');
      delete r.dataset.timelineSize;
    };
    // Once, when the grip appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = (by: number) => {
    const i = PHONE_SIZES.indexOf(size.current);
    apply(PHONE_SIZES[Math.max(0, Math.min(PHONE_SIZES.length - 1, i + by))]!, true);
  };

  return (
    <div
      ref={ref}
      className="vu-phone-grip"
      role="slider"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={l.resizeTimeline}
      aria-valuemin={0}
      aria-valuemax={PHONE_SIZES.length - 1}
      data-tooltip={l.phoneTimelineTip}
      onPointerDown={(e) => {
        if (e.button > 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = root();
        const area = r?.querySelector<HTMLElement>('.vu-timeline-area');
        if (!r || !area) return;
        drag.current = {
          id: e.pointerId,
          y: e.clientY,
          dy: 0,
          moved: false,
          start: area.offsetHeight,
          max: phoneHeight(r, 'full') ?? area.offsetHeight,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        d.dy = e.clientY - d.y;
        if (!d.moved && Math.abs(d.dy) < 6) return;
        d.moved = true;
        const r = root();
        if (!r) return;
        // Up grows the lanes, down shrinks them, between the play bar only and "large".
        const h = Math.max(0, Math.min(d.max, d.start - d.dy));
        r.style.setProperty('--vu-timeline-phone-h', `${Math.round(h)}px`);
        r.dataset.timelineSize = h < 1 ? 'minimal' : 'normal';
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.id !== e.pointerId) return;
        // A tap does nothing: only a drag resizes (a stray tap near the play bar resized the
        // video; owner, 2026-10-31). The keyboard steps through the sizes.
        if (!d.moved) return;
        // Where the drag ended picks the size: a clear flick down / up moves one step or two.
        const r = root();
        if (!r) return;
        const now = Math.max(0, Math.min(d.max, d.start - d.dy));
        const options = PHONE_SIZES.map((s) => ({
          s,
          h: s === 'normal' ? normalHeight(r) : s === 'full' ? d.max : 0,
        }));
        let best = options[0]!;
        for (const o of options) if (Math.abs(o.h - now) < Math.abs(best.h - now)) best = o;
        apply(best.s, true);
      }}
      onPointerCancel={() => {
        if (drag.current) apply(size.current, false);
        drag.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        e.stopPropagation();
        step(e.key === 'ArrowUp' ? 1 : -1);
      }}
    >
      <span className="vu-phone-grip-bar" aria-hidden="true" />
    </div>
  );
}

/** The phone timeline's normal height (the layout's token). */
function normalHeight(root: HTMLElement): number {
  return parseFloat(getComputedStyle(root).getPropertyValue('--vu-size-timeline-phone')) || 184;
}
