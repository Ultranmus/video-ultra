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
