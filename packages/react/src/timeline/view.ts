import {
  FLICKS_PER_SECOND,
  itemEnd,
  moveItem,
  projectDuration,
  projectFrame,
  reorderMain,
  TRANSITION_PRESETS,
  trimItem,
  type Item,
  type Project,
  type Time,
} from '@video-ultra/core';
import type { EditorController } from '../controller';
import { formatClock, formatDurationShort } from '../format';
import { itemTitle } from '../items';
import {
  addButtonRect,
  clampPps,
  contentHeight,
  hitTest,
  layoutRows,
  majorTickSeconds,
  reorderIndex,
  snapCandidates,
  snapTime,
  tickLabel,
  timeToX,
  xToTime,
  type Hit,
  type Row,
  type TimelineMetrics,
  type TimeScale,
} from './geometry';
import { TimelineMediaCache } from './media-cache';

/**
 * The timeline, drawn on a canvas (DECISIONS #25). An imperative view: it subscribes to the
 * project, the selection, the zoom and the playhead and redraws at most once per animation
 * frame — React never renders while playing or dragging. Drags keep their state here and commit
 * one edit on release (CLAUDE.md).
 *
 * Feel rules (owner review, 2026-10-17):
 * - A dragged clip follows the pointer in both directions as a floating copy; the timeline under
 *   it doesn't move. A drop outline shows where it will land. Nothing jumps while dragging.
 * - Trimming never moves the playhead: the preview shows the edge frame, a label shows the length.
 * - One line at a time: the snap guide only appears while snapped.
 * - A wheel/trackpad gesture scrolls one axis.
 *
 * Phone layout: the playhead is fixed in the centre and the film strip slides under it (one-thumb
 * scrubbing). Wider layouts: the playhead moves; click or drag the ruler to seek.
 */

interface Colors {
  bg: string;
  track: string;
  lane: string;
  laneHover: string;
  accentVideo: string;
  accentText: string;
  accentSticker: string;
  accentAudio: string;
  waveform: string;
  playhead: string;
  playheadText: string;
  trim: string;
  selection: string;
  guide: string;
  label: string;
  muted: string;
  subtle: string;
  surface: string;
  surfaceStrong: string;
  border: string;
  overlay: string;
  onMedia: string;
  grip: string;
  font: string;
}

type Drag =
  | {
      type: 'pending';
      id: number;
      x: number;
      y: number;
      hit: Hit;
      timer: ReturnType<typeof setTimeout> | null;
    }
  | { type: 'scrub'; id: number }
  | {
      type: 'pan';
      id: number;
      x: number;
      y: number;
      time: Time;
      scrollX: number;
      scrollY: number;
      axis: 'x' | 'y' | null;
      samples: { x: number; t: number }[];
    }
  | { type: 'trim'; id: number; x: number; item: Item; edge: 'start' | 'end'; delta: Time }
  | {
      type: 'move';
      id: number;
      item: Item;
      /** Pointer offset from the clip's top-left when grabbed (px). */
      grabX: number;
      grabY: number;
      pointer: { x: number; y: number };
      start: Time;
      trackId: string;
    }
  | {
      type: 'reorder';
      id: number;
      item: Item;
      grabX: number;
      grabY: number;
      pointer: { x: number; y: number };
      index: number;
    }
  | { type: 'pinch'; ids: [number, number]; distance: number; pps: number };

const LONG_PRESS_MS = 350;
const DRAG_SLOP = 5;
const TOUCH_SLOP = 8;
const FLASH_MS = 700;
/** Wheel events this close together belong to one gesture (one axis). */
const WHEEL_GESTURE_MS = 220;

export interface TimelineHooks {
  /** The "+" at the end of the main track. */
  onAddMedia(): void;
}

export class TimelineView {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #root: HTMLElement;
  readonly #ctl: EditorController;
  readonly #hooks: TimelineHooks;
  readonly #cache: TimelineMediaCache;
  #m: TimelineMetrics = { ruler: 24, mainTrack: 56, track: 48, gap: 6, header: 40, trimHandle: 12 };
  #radius = 6;
  #c!: Colors;
  #width = 0;
  #height = 0;
  #dpr = 1;
  #phone = false;
  #touch = false;
  /** Desktop horizontal scroll (CSS px) and vertical scroll of the rows. */
  #scrollX = 0;
  #scrollY = 0;
  #drag: Drag | null = null;
  readonly #pointers = new Map<number, { x: number; y: number }>();
  /** Project shown while trimming (not committed). */
  #ghost: Project | null = null;
  #snapGuide: Time | null = null;
  #lastSnap: Time | null = null;
  #hoverId: string | null = null;
  #hoverHeader: string | null = null;
  #flashes: { t: Time; until: number }[] = [];
  #wheel = { axis: null as 'x' | 'y' | null, at: 0 };
  #frame = 0;
  #momentum = 0;
  #disposers: (() => void)[] = [];
  #icons = new Map<string, Path2D>();

  constructor(
    root: HTMLElement,
    canvas: HTMLCanvasElement,
    ctl: EditorController,
    hooks: TimelineHooks,
  ) {
    this.#root = root;
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d', { alpha: false })!;
    this.#ctl = ctl;
    this.#hooks = hooks;
    this.#cache = new TimelineMediaCache(
      () => ctl.analyzer,
      ctl.caps?.tier ?? 'mid',
      () => this.invalidate(),
    );
    this.refreshTheme();

    const ro = new ResizeObserver(() => this.#resize());
    ro.observe(canvas.parentElement!);
    this.#disposers.push(() => ro.disconnect());
    this.#disposers.push(ctl.playhead.subscribe(() => this.#onPlayhead()));
    this.#disposers.push(ctl.editor.store.subscribe(() => this.invalidate()));
    this.#disposers.push(
      ctl.onCut((t) => {
        this.#flashes.push({ t, until: performance.now() + FLASH_MS });
        this.invalidate();
      }),
    );
    this.#disposers.push(
      ctl.ui.subscribe((s, prev) => {
        if (
          s.selectedId !== prev.selectedId ||
          s.pxPerSecond !== prev.pxPerSecond ||
          s.layout !== prev.layout
        ) {
          if (s.layout !== prev.layout) this.#applyLayout();
          this.invalidate();
        }
      }),
    );
    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.#disposers.push(() => canvas.removeEventListener(type, fn as EventListener));
    };
    listen('pointerdown', (e) => this.#down(e));
    listen('pointermove', (e) => this.#move(e));
    listen('pointerup', (e) => this.#up(e, false));
    listen('pointercancel', (e) => this.#up(e, true));
    listen('pointerleave', () => this.#leave());
    listen('lostpointercapture', (e) => this.#pointers.delete(e.pointerId));
    listen('wheel', (e) => this.#onWheel(e), { passive: false });
    listen('contextmenu', (e) => e.preventDefault());
    // iOS: stop the long-press callout, text selection and page scroll fighting our gestures.
    listen('touchstart', (e) => e.preventDefault(), { passive: false });
    this.#applyLayout();
    this.#resize();
  }

  destroy(): void {
    cancelAnimationFrame(this.#frame);
    cancelAnimationFrame(this.#momentum);
    this.#cancelDrag();
    for (const dispose of this.#disposers) dispose();
    this.#cache.destroy();
  }

  /** Re-reads colours and sizes from the `--vu-*` tokens (theme change). */
  refreshTheme(): void {
    const style = getComputedStyle(this.#root);
    const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const px = (name: string, fallback: number) => parseFloat(v(name, '')) || fallback;
    this.#c = {
      bg: v('--vu-timeline-bg', '#0e0e11'),
      track: v('--vu-track-bg', '#16161a'),
      lane: v('--vu-clip-lane', '#26262d'),
      laneHover: v('--vu-clip-lane-hover', '#2e2e36'),
      accentVideo: v('--vu-clip-video', '#3b3b46'),
      accentText: v('--vu-clip-text', '#c79a5c'),
      accentSticker: v('--vu-clip-sticker', '#5cc7a6'),
      accentAudio: v('--vu-clip-audio', '#6aa8e0'),
      waveform: v('--vu-waveform', 'rgba(255,255,255,0.55)'),
      playhead: v('--vu-playhead', '#9c479c'),
      playheadText: v('--vu-accent-contrast', '#fff'),
      trim: v('--vu-trim-handle', '#f5b54a'),
      selection: v('--vu-selection', '#9c479c'),
      guide: v('--vu-guide', '#ff2d95'),
      label: v('--vu-text', '#f4f4f5'),
      muted: v('--vu-text-muted', '#a1a1aa'),
      subtle: v('--vu-text-subtle', '#6b6b75'),
      surface: v('--vu-surface-2', '#1c1c21'),
      surfaceStrong: v('--vu-surface-3', '#26262d'),
      border: v('--vu-border-strong', 'rgba(255,255,255,0.16)'),
      overlay: v('--vu-overlay', 'rgba(0,0,0,0.55)'),
      onMedia: v('--vu-on-media', '#fff'),
      grip: v('--vu-trim-grip', 'rgba(0,0,0,0.55)'),
      font: style.fontFamily || 'system-ui, sans-serif',
    };
    this.#m = {
      ruler: px('--vu-size-ruler', 24),
      mainTrack: px('--vu-size-track-main', 56),
      track: px('--vu-size-track', 44),
      gap: px('--vu-space-2', 8) * 0.75,
      header: this.#phone ? 0 : px('--vu-size-touch', 40),
      trimHandle: px('--vu-size-trim-handle', 12),
    };
    this.#radius = px('--vu-radius-sm', 6);
    this.invalidate();
  }

  #applyLayout(): void {
    this.#phone = this.#ctl.ui.getState().layout === 'phone';
    this.refreshTheme();
  }

  #resize(): void {
    const box = this.#canvas.parentElement!.getBoundingClientRect();
    this.#dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.#width = Math.max(1, Math.floor(box.width));
    this.#height = Math.max(1, Math.floor(box.height));
    this.#canvas.width = Math.round(this.#width * this.#dpr);
    this.#canvas.height = Math.round(this.#height * this.#dpr);
    this.#canvas.style.width = `${this.#width}px`;
    this.#canvas.style.height = `${this.#height}px`;
    this.#draw();
  }

  /** Schedules a redraw on the next animation frame. */
  invalidate(): void {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#draw();
    });
  }

  // ── geometry helpers ───────────────────────────────────────────────────

  get #pps(): number {
    return this.#ctl.ui.getState().pxPerSecond;
  }

  #project(): Project {
    return this.#ghost ?? this.#ctl.project;
  }

  #scale(): TimeScale {
    const pps = this.#pps;
    if (this.#phone) {
      return { pps, x0: this.#width / 2 - (this.#ctl.playhead.time / FLICKS_PER_SECOND) * pps };
    }
    return { pps, x0: this.#m.header + 16 - this.#scrollX };
  }

  #maxScrollX(): number {
    const end = projectDuration(this.#project()) / FLICKS_PER_SECOND;
    return Math.max(0, end * this.#pps + 120 - (this.#width - this.#m.header - 16));
  }

  #maxScrollY(): number {
    return Math.max(0, contentHeight(this.#project(), this.#m) - this.#height + 8);
  }

  #onPlayhead(): void {
    if (!this.#phone && this.#drag?.type !== 'trim') {
      // Page along with the playhead while playing (or after a seek off-screen).
      const x = timeToX(this.#scale(), this.#ctl.playhead.time);
      const left = this.#m.header + 16;
      if (x > this.#width - 24 || x < left) {
        const t = this.#ctl.playhead.time / FLICKS_PER_SECOND;
        this.#scrollX = Math.min(
          this.#maxScrollX(),
          Math.max(0, t * this.#pps - (this.#width - left) * 0.15),
        );
      }
    }
    this.invalidate();
  }

  // ── input ──────────────────────────────────────────────────────────────

  #local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.#canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  #rows(project: Project = this.#project()): Row[] {
    return layoutRows(project, this.#m, this.#scrollY);
  }

  #hit(x: number, y: number): Hit {
    return hitTest(
      this.#rows(),
      this.#m,
      this.#scale(),
      x,
      y,
      this.#ctl.ui.getState().selectedId,
      this.#touch,
    );
  }

  #rowAt(y: number, project: Project = this.#ctl.project): Row | undefined {
    return this.#rows(project).find(
      (r) => y >= r.top - this.#m.gap / 2 && y < r.top + r.height + this.#m.gap / 2,
    );
  }

  #down(e: PointerEvent): void {
    this.#touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const p = this.#local(e);
    this.#pointers.set(e.pointerId, p);
    this.#canvas.setPointerCapture(e.pointerId);
    cancelAnimationFrame(this.#momentum);
    this.#setTooltip(null);

    // A second finger cancels what the first started and pinch-zooms (UI_VISION §6).
    if (this.#pointers.size === 2) {
      this.#cancelDrag();
      const [a, b] = [...this.#pointers.entries()];
      this.#drag = {
        type: 'pinch',
        ids: [a![0], b![0]],
        distance: Math.max(1, Math.abs(a![1].x - b![1].x)),
        pps: this.#pps,
      };
      return;
    }
    if (this.#pointers.size > 2 || e.button > 0) return;

    // Lane header icons toggle mute (sound) / hide (pictures).
    if (p.x < this.#m.header && p.y > this.#m.ruler) {
      const row = this.#rowAt(p.y);
      if (row) this.#ctl.toggleTrack(row.track.id);
      return;
    }

    const hit = this.#hit(p.x, p.y);
    if (this.#ctl.ui.getState().playing && hit.type !== 'add') this.#ctl.pause();

    switch (hit.type) {
      case 'add':
        this.#hooks.onAddMedia();
        return;
      case 'transition':
        this.#ctl.select(hit.item.id);
        if (this.#ctl.ui.getState().layout === 'desktop') this.#ctl.openPanel('transitions');
        else this.#ctl.openTool('transition');
        return;
      case 'trim':
        this.#drag = {
          type: 'trim',
          id: e.pointerId,
          x: p.x,
          item: hit.item,
          edge: hit.edge,
          delta: 0,
        };
        this.invalidate();
        return;
      case 'ruler':
        if (!this.#phone) {
          this.#drag = { type: 'scrub', id: e.pointerId };
          this.#ctl.seek(this.#snapPlayhead(hit.time));
          return;
        }
        break;
      default:
        break;
    }
    if (!this.#phone && (hit.type === 'row' || hit.type === 'empty')) {
      this.#ctl.select(null);
      this.#drag = { type: 'scrub', id: e.pointerId };
      this.#ctl.seek(hit.time);
      return;
    }
    const pending: Extract<Drag, { type: 'pending' }> = {
      type: 'pending',
      id: e.pointerId,
      x: p.x,
      y: p.y,
      hit,
      timer: null,
    };
    if (hit.type === 'item') {
      this.#ctl.select(hit.item.id);
      if (this.#touch) {
        // Long-press lifts a clip to move/reorder it; a plain drag scrolls the timeline.
        pending.timer = setTimeout(() => {
          if (this.#drag !== pending) return;
          navigator.vibrate?.(8);
          this.#startItemDrag(pending, pending.x, pending.y);
        }, LONG_PRESS_MS);
      }
    }
    this.#drag = pending;
  }

  #startItemDrag(pending: Extract<Drag, { type: 'pending' }>, x: number, y: number): void {
    if (pending.hit.type !== 'item' || pending.hit.row.track.locked) return;
    const item = pending.hit.item;
    const row = pending.hit.row;
    const left = timeToX(this.#scale(), item.start);
    const grabX = x - left;
    const grabY = y - row.top;
    if (row.track.kind === 'main') {
      const index = this.#ctl.project.tracks[0]!.items.findIndex((i) => i.id === item.id);
      this.#drag = {
        type: 'reorder',
        id: pending.id,
        item,
        grabX,
        grabY,
        pointer: { x, y },
        index,
      };
    } else {
      this.#drag = {
        type: 'move',
        id: pending.id,
        item,
        grabX,
        grabY,
        pointer: { x, y },
        start: item.start,
        trackId: row.track.id,
      };
    }
    this.#canvas.style.cursor = 'grabbing';
    this.invalidate();
  }

  #move(e: PointerEvent): void {
    const p = this.#local(e);
    const known = this.#pointers.get(e.pointerId);
    if (known) {
      known.x = p.x;
      known.y = p.y;
    }
    const drag = this.#drag;
    if (!drag) {
      if (e.pointerType === 'mouse') this.#hover(p.x, p.y);
      return;
    }
    switch (drag.type) {
      case 'pinch': {
        const a = this.#pointers.get(drag.ids[0]);
        const b = this.#pointers.get(drag.ids[1]);
        if (!a || !b) return;
        this.#zoomTo(
          drag.pps * (Math.max(1, Math.abs(a.x - b.x)) / drag.distance),
          (a.x + b.x) / 2,
        );
        return;
      }
      case 'pending': {
        const dx = p.x - drag.x;
        const dy = p.y - drag.y;
        const slop = this.#touch ? TOUCH_SLOP : DRAG_SLOP;
        if (Math.hypot(dx, dy) < slop) return;
        if (drag.timer) clearTimeout(drag.timer);
        if (!this.#touch && drag.hit.type === 'item') {
          this.#startItemDrag(drag, drag.x, drag.y);
          this.#move(e);
          return;
        }
        this.#drag = {
          type: 'pan',
          id: drag.id,
          x: drag.x,
          y: drag.y,
          time: this.#ctl.playhead.time,
          scrollX: this.#scrollX,
          scrollY: this.#scrollY,
          axis: null,
          samples: [],
        };
        this.#move(e);
        return;
      }
      case 'pan': {
        const dx = p.x - drag.x;
        const dy = p.y - drag.y;
        // Lock to one axis for the whole gesture.
        drag.axis ??= Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        if (drag.axis === 'y') {
          this.#scrollY = Math.min(this.#maxScrollY(), Math.max(0, drag.scrollY - dy));
          this.invalidate();
          return;
        }
        drag.samples.push({ x: p.x, t: performance.now() });
        if (drag.samples.length > 5) drag.samples.shift();
        if (this.#phone) {
          this.#ctl.seek(drag.time - (dx / this.#pps) * FLICKS_PER_SECOND);
        } else {
          this.#scrollX = Math.min(this.#maxScrollX(), Math.max(0, drag.scrollX - dx));
          this.invalidate();
        }
        return;
      }
      case 'scrub':
        this.#ctl.seek(this.#snapPlayhead(Math.max(0, xToTime(this.#scale(), p.x))));
        return;
      case 'trim': {
        const project = this.#ctl.project;
        const item = drag.item;
        const raw = ((p.x - drag.x) / this.#pps) * FLICKS_PER_SECOND;
        const edgeTime = drag.edge === 'start' ? item.start : itemEnd(item);
        const snap = snapTime(
          edgeTime + raw,
          snapCandidates(project, this.#ctl.playhead.time, item.id),
          this.#pps,
        );
        this.#setSnap(snap.snapped);
        drag.delta = snap.time - edgeTime;
        const { edge, delta } = drag;
        this.#ghost = this.#ctl.preview((d) => trimItem(d, item.id, edge, delta));
        // The preview shows the frame at the edge being trimmed; the playhead stays put.
        const trimmed = this.#ghost?.tracks.flatMap((t) => t.items).find((i) => i.id === item.id);
        if (trimmed) {
          const frame = projectFrame(project);
          this.#ctl.previewSeek(
            edge === 'start' ? trimmed.start : Math.max(trimmed.start, itemEnd(trimmed) - frame),
          );
        }
        this.invalidate();
        return;
      }
      case 'move': {
        drag.pointer = p;
        const item = drag.item;
        // Time from where the clip's left edge now is under the pointer.
        const raw = Math.max(0, xToTime(this.#scale(), p.x - drag.grabX));
        const candidates = snapCandidates(this.#ctl.project, this.#ctl.playhead.time, item.id);
        const s1 = snapTime(raw, candidates, this.#pps);
        const s2 = snapTime(raw + item.duration, candidates, this.#pps);
        let start = raw;
        let guide: Time | null = null;
        if (
          s1.snapped !== null &&
          (s2.snapped === null ||
            Math.abs(s1.time - raw) <= Math.abs(s2.time - raw - item.duration))
        ) {
          start = s1.time;
          guide = s1.snapped;
        } else if (s2.snapped !== null) {
          start = s2.time - item.duration;
          guide = s2.snapped;
        }
        this.#setSnap(guide);
        drag.start = Math.max(0, Math.round(start));
        // Vertical: a lane of the same kind under the ghost's centre.
        const own = this.#rows(this.#ctl.project).find((r) =>
          r.track.items.some((i) => i.id === item.id),
        );
        const over = this.#rowAt(p.y - drag.grabY + (own?.height ?? 0) / 2);
        if (over && own && over.track.kind === own.track.kind) drag.trackId = over.track.id;
        this.invalidate();
        return;
      }
      case 'reorder': {
        drag.pointer = p;
        const centre = xToTime(
          this.#scale(),
          p.x - drag.grabX + ((drag.item.duration / FLICKS_PER_SECOND) * this.#pps) / 2,
        );
        drag.index = reorderIndex(this.#ctl.project.tracks[0]!.items, drag.item.id, centre);
        this.invalidate();
        return;
      }
    }
  }

  #up(e: PointerEvent, cancelled: boolean): void {
    this.#pointers.delete(e.pointerId);
    const drag = this.#drag;
    if (!drag) return;
    if (drag.type === 'pinch') {
      if (this.#pointers.size < 2) this.#drag = null;
      return;
    }
    if (drag.id !== e.pointerId) return;
    this.#drag = null;
    this.#setSnap(null);
    this.#canvas.style.cursor = '';
    if (cancelled) {
      this.#cancelPreview();
      return;
    }
    const l = this.#ctl.labels;
    switch (drag.type) {
      case 'pending':
        if (drag.timer) clearTimeout(drag.timer);
        if (drag.hit.type === 'row' || drag.hit.type === 'empty') this.#ctl.select(null);
        if (drag.hit.type === 'ruler' && this.#phone) this.#ctl.seek(drag.hit.time);
        break;
      case 'pan':
        if (this.#phone && drag.axis === 'x') this.#fling(drag.samples);
        break;
      case 'trim': {
        this.#ghost = null;
        this.#ctl.previewSeek(null);
        const { item, edge, delta } = drag;
        if (delta !== 0) this.#ctl.run(l.trim, (d) => trimItem(d, item.id, edge, delta));
        else this.#ctl.preview(null);
        break;
      }
      case 'move': {
        const { item, start, trackId } = drag;
        if (start !== item.start || trackId !== this.#trackOf(item.id)) {
          this.#ctl.run(l.move, (d, ctx) => moveItem(d, item.id, start, ctx.ids, trackId));
        }
        break;
      }
      case 'reorder': {
        const { item, index } = drag;
        const from = this.#ctl.project.tracks[0]!.items.findIndex((i) => i.id === item.id);
        if (from !== index) this.#ctl.run(l.move, (d) => reorderMain(d, item.id, index));
        break;
      }
      default:
        break;
    }
    this.invalidate();
  }

  #leave(): void {
    if (this.#drag) return;
    this.#hoverId = null;
    this.#hoverHeader = null;
    this.#setTooltip(null);
    this.invalidate();
  }

  #trackOf(itemId: string): string | undefined {
    return this.#ctl.project.tracks.find((t) => t.items.some((i) => i.id === itemId))?.id;
  }

  #cancelPreview(): void {
    this.#ghost = null;
    this.#ctl.preview(null);
    this.#ctl.previewSeek(null);
    this.invalidate();
  }

  #cancelDrag(): void {
    const drag = this.#drag;
    if (drag?.type === 'pending' && drag.timer) clearTimeout(drag.timer);
    this.#drag = null;
    this.#setSnap(null);
    this.#canvas.style.cursor = '';
    if (this.#ghost) this.#cancelPreview();
  }

  /** Phone: keep scrolling a little after a quick flick. */
  #fling(samples: { x: number; t: number }[]): void {
    if (samples.length < 2) return;
    const a = samples[0]!;
    const b = samples[samples.length - 1]!;
    const dt = b.t - a.t;
    if (dt <= 0 || performance.now() - b.t > 80) return;
    let v = (b.x - a.x) / dt; // px per ms
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const ms = now - last;
      last = now;
      v *= Math.pow(0.995, ms);
      if (Math.abs(v) < 0.02) return;
      this.#ctl.seek(this.#ctl.playhead.time - ((v * ms) / this.#pps) * FLICKS_PER_SECOND);
      this.#momentum = requestAnimationFrame(step);
    };
    this.#momentum = requestAnimationFrame(step);
  }

  #snapPlayhead(t: Time): Time {
    const snap = snapTime(t, snapCandidates(this.#ctl.project, -1), this.#pps, 6);
    this.#setSnap(this.#drag?.type === 'scrub' ? snap.snapped : null);
    return snap.time;
  }

  /** Shows the snap guide; a light haptic tick when a new snap engages (phones). */
  #setSnap(t: Time | null): void {
    if (t !== null && t !== this.#lastSnap && this.#touch) navigator.vibrate?.(4);
    this.#lastSnap = t;
    this.#snapGuide = t;
  }

  /** The canvas's tooltip text (the tooltip layer follows the pointer over it). */
  #setTooltip(text: string | null): void {
    if (text) this.#canvas.dataset.tooltip = text;
    else delete this.#canvas.dataset.tooltip;
  }

  #hover(x: number, y: number): void {
    const l = this.#ctl.labels;
    let tip: string | null = null;
    let cursor = 'default';
    let hoverId: string | null = null;
    let hoverHeader: string | null = null;
    if (x < this.#m.header && y > this.#m.ruler) {
      const row = this.#rowAt(y);
      if (row) {
        hoverHeader = row.track.id;
        cursor = 'pointer';
        const sound = row.track.kind === 'main' || row.track.kind === 'audio';
        tip = sound ? l.tipLaneMute(row.track.muted) : l.tipLaneHide(row.track.hidden);
      }
    } else {
      const hit = this.#hit(x, y);
      switch (hit.type) {
        case 'trim':
          cursor = 'ew-resize';
          tip = hit.edge === 'start' ? l.tipTrimStart : l.tipTrimEnd;
          break;
        case 'item':
          cursor = 'grab';
          hoverId = hit.item.id;
          tip = l.tipClip(itemTitle(hit.item, this.#ctl.project.assets));
          break;
        case 'transition': {
          cursor = 'pointer';
          const t = 'transitionIn' in hit.item ? hit.item.transitionIn : null;
          tip = l.tipTransitionMarker(
            t ? (TRANSITION_PRESETS.find((p) => p.id === t.type)?.label ?? t.type) : null,
          );
          break;
        }
        case 'add':
          cursor = 'pointer';
          tip = l.tipAddMedia;
          break;
        case 'ruler':
          cursor = 'pointer';
          tip = l.tipRuler;
          break;
        default:
          break;
      }
    }
    if (this.#canvas.style.cursor !== cursor) this.#canvas.style.cursor = cursor;
    this.#setTooltip(tip);
    if (hoverId !== this.#hoverId || hoverHeader !== this.#hoverHeader) {
      this.#hoverId = hoverId;
      this.#hoverHeader = hoverHeader;
      this.invalidate();
    }
  }

  #onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.#local(e);
    if (e.ctrlKey || e.metaKey) {
      this.#zoomTo(this.#pps * Math.exp(-e.deltaY * 0.01), p.x);
      return;
    }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const dy = e.shiftKey ? 0 : e.deltaY;
    // One gesture scrolls one axis: decided by its first event, kept while events keep coming.
    const now = performance.now();
    if (!this.#wheel.axis || now - this.#wheel.at > WHEEL_GESTURE_MS) {
      const vertical = Math.abs(dy) > Math.abs(dx) && this.#maxScrollY() > 0;
      this.#wheel.axis = vertical ? 'y' : 'x';
    }
    this.#wheel.at = now;
    if (this.#wheel.axis === 'y') {
      this.#scrollY = Math.min(this.#maxScrollY(), Math.max(0, this.#scrollY + dy));
      this.invalidate();
      return;
    }
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    if (this.#phone) {
      if (this.#ctl.ui.getState().playing) this.#ctl.pause();
      this.#ctl.seek(this.#ctl.playhead.time + (delta / this.#pps) * FLICKS_PER_SECOND);
    } else {
      this.#scrollX = Math.min(this.#maxScrollX(), Math.max(0, this.#scrollX + delta));
      this.invalidate();
    }
  }

  /** Zooms keeping the time under `anchorX` in place (desktop) or the playhead (phone). */
  #zoomTo(pps: number, anchorX: number): void {
    const next = clampPps(pps);
    if (!this.#phone) {
      const t = xToTime(this.#scale(), anchorX) / FLICKS_PER_SECOND;
      this.#scrollX = Math.max(0, t * next - (anchorX - this.#m.header - 16));
    }
    this.#ctl.ui.setState({ pxPerSecond: next });
  }

  /** Zoom buttons. */
  zoomBy(factor: number): void {
    const x = this.#phone ? this.#width / 2 : timeToX(this.#scale(), this.#ctl.playhead.time);
    this.#zoomTo(this.#pps * factor, x);
  }

  /** Scrolls so `item` is visible (keyboard navigation). */
  reveal(item: Item): void {
    if (this.#phone) return;
    const scale = this.#scale();
    const left = timeToX(scale, item.start);
    const right = timeToX(scale, itemEnd(item));
    if (left < this.#m.header + 16)
      this.#scrollX = Math.max(0, this.#scrollX + left - this.#m.header - 32);
    else if (right > this.#width)
      this.#scrollX = Math.min(this.#maxScrollX(), this.#scrollX + right - this.#width + 32);
    this.invalidate();
  }

  // ── drawing ────────────────────────────────────────────────────────────

  #icon(name: string, d: string): Path2D {
    let path = this.#icons.get(name);
    if (!path) {
      path = new Path2D(d);
      this.#icons.set(name, path);
    }
    return path;
  }

  #draw(): void {
    const ctx = this.#ctx;
    const c = this.#c;
    const m = this.#m;
    const w = this.#width;
    const h = this.#height;
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);
    const project = this.#project();
    const scale = this.#scale();
    const rows = this.#rows(project);
    const selectedId = this.#ctl.ui.getState().selectedId;
    const contentLeft = m.header;
    const drag = this.#drag;

    // Rows and clips (clipped below the ruler).
    ctx.save();
    ctx.beginPath();
    ctx.rect(contentLeft, m.ruler, w - contentLeft, h - m.ruler);
    ctx.clip();
    for (const row of rows) {
      if (row.top > h || row.top + row.height < m.ruler) continue;
      ctx.fillStyle = c.track;
      this.#roundRect(contentLeft + 4, row.top, w - contentLeft - 8, row.height, this.#radius + 2);
      ctx.fill();
      this.#drawRow(row, scale, project, selectedId);
    }
    if (drag?.type === 'move' || drag?.type === 'reorder')
      this.#drawDrop(drag, scale, rows, project);
    this.#drawFlashes(scale);
    if (this.#snapGuide !== null) {
      const x = Math.round(timeToX(scale, this.#snapGuide)) + 0.5;
      ctx.strokeStyle = c.guide;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, m.ruler);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    if (m.header > 0) this.#drawHeader(rows);
    this.#drawRuler(scale);
    this.#drawPlayhead(scale);
    if (drag?.type === 'trim') this.#drawTrimLabel(drag, scale, rows, project);
    if (drag?.type === 'move' || drag?.type === 'reorder') this.#drawFloating(drag, project);
    this.#cache.flush();
  }

  #drawHeader(rows: Row[]): void {
    const ctx = this.#ctx;
    const m = this.#m;
    ctx.fillStyle = this.#c.bg;
    ctx.fillRect(0, 0, m.header, this.#height);
    const icons: Record<string, string> = {
      main: 'M3 6.5A2.5 2.5 0 015.5 4h13A2.5 2.5 0 0121 6.5v11a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5zM10 9v6l5-3z',
      text: 'M5 6V4.5h14V6M12 4.5v15M9 19.5h6',
      overlay: 'M20 12a8 8 0 11-8-8M20 12l-8-8M20 12h-5a3 3 0 01-3-3V4',
      audio: 'M9 18V5.5l11-2V16M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z',
      off: 'M3 3l18 18',
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, m.ruler, m.header, this.#height - m.ruler);
    ctx.clip();
    for (const row of rows) {
      const size = 16;
      const cx = m.header / 2;
      const cy = row.top + row.height / 2;
      const off = row.track.muted || row.track.hidden;
      if (this.#hoverHeader === row.track.id) {
        ctx.fillStyle = this.#c.surface;
        this.#roundRect(cx - 14, cy - 14, 28, 28, 8);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(cx - size / 2, cy - size / 2);
      ctx.scale(size / 24, size / 24);
      ctx.strokeStyle = off ? this.#c.subtle : this.#c.muted;
      ctx.lineWidth = 1.75;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(this.#icon(row.track.kind, icons[row.track.kind]!));
      if (off) ctx.stroke(this.#icon('off', icons.off!));
      ctx.restore();
    }
    ctx.restore();
  }

  #drawRow(row: Row, scale: TimeScale, project: Project, selectedId: string | null): void {
    const ctx = this.#ctx;
    const c = this.#c;
    const items = row.track.items;
    const left = this.#m.header;
    const drag = this.#drag;
    const lifted = drag?.type === 'move' || drag?.type === 'reorder' ? drag.item.id : null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const x1 = timeToX(scale, item.start);
      const x2 = timeToX(scale, itemEnd(item));
      if (x2 < left || x1 > this.#width) continue;
      // The lifted clip stays as a faint placeholder; its floating copy follows the pointer.
      const alpha = item.id === lifted ? 0.3 : row.track.hidden ? 0.45 : 1;
      this.#drawItem(item, x1, x2, row, project, item.id === selectedId && !lifted, alpha);
    }
    if (row.track.kind !== 'main') return;
    // Transition markers on cuts.
    for (let i = 1; i < items.length; i++) {
      const item = items[i]!;
      const x = timeToX(scale, item.start);
      if (x < left - 12 || x > this.#width + 12) continue;
      if ((item.duration / FLICKS_PER_SECOND) * scale.pps <= 30) continue;
      const has = 'transitionIn' in item && item.transitionIn !== null;
      const s = 18;
      const y = row.top + row.height / 2;
      ctx.fillStyle = has ? c.selection : c.surfaceStrong;
      ctx.strokeStyle = c.bg;
      ctx.lineWidth = 2;
      this.#roundRect(x - s / 2, y - s / 2, s, s, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = has ? c.playheadText : c.label;
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 3.5);
      ctx.lineTo(x - 1, y);
      ctx.lineTo(x - 5, y + 3.5);
      ctx.moveTo(x + 5, y - 3.5);
      ctx.lineTo(x + 1, y);
      ctx.lineTo(x + 5, y + 3.5);
      ctx.fill();
    }
    // "+" add media.
    const last = items[items.length - 1];
    const end = last ? itemEnd(last) : 0;
    const add = addButtonRect(row, scale, end);
    ctx.fillStyle = c.surface;
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 1;
    this.#roundRect(add.x + 0.5, add.y + 0.5, add.size - 1, add.size - 1, 10);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = c.label;
    ctx.lineWidth = 1.75;
    ctx.lineCap = 'round';
    const cx = add.x + add.size / 2;
    const cy = add.y + add.size / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy);
    ctx.lineTo(cx + 7, cy);
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx, cy + 7);
    ctx.stroke();
    if (items.length === 0) {
      ctx.fillStyle = c.muted;
      ctx.font = `13px ${c.font}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(this.#ctl.labels.emptyTimeline, add.x + add.size + 12, cy);
    }
  }

  /** Where a dragged clip will land: an outline (lanes) or an insertion bar (main track). */
  #drawDrop(
    drag: Extract<Drag, { type: 'move' | 'reorder' }>,
    scale: TimeScale,
    rows: Row[],
    project: Project,
  ): void {
    const ctx = this.#ctx;
    ctx.strokeStyle = this.#c.selection;
    ctx.fillStyle = this.#c.selection;
    if (drag.type === 'move') {
      const row = rows.find((r) => r.track.id === drag.trackId);
      if (!row) return;
      const x1 = timeToX(scale, drag.start);
      const x2 = timeToX(scale, drag.start + drag.item.duration);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      this.#roundRect(x1 + 1, row.top + 3, x2 - x1 - 2, row.height - 6, this.#radius);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    const main = rows[0];
    if (!main) return;
    // The bar sits on the cut (in today's layout) before the clip that will follow the drop.
    const all = project.tracks[0]!.items;
    const rest = all.filter((i) => i.id !== drag.item.id);
    const next = rest[drag.index];
    const x = next ? timeToX(scale, next.start) : timeToX(scale, itemEnd(all[all.length - 1]!));
    ctx.beginPath();
    ctx.roundRect(Math.round(x) - 2, main.top - 2, 4, main.height + 4, 2);
    ctx.fill();
  }

  /** The floating copy of a dragged clip, under the pointer (drawn above everything). */
  #drawFloating(drag: Extract<Drag, { type: 'move' | 'reorder' }>, project: Project): void {
    const ctx = this.#ctx;
    const own = this.#rows(this.#ctl.project).find((r) =>
      r.track.items.some((i) => i.id === drag.item.id),
    );
    if (!own) return;
    const width = Math.max(24, (drag.item.duration / FLICKS_PER_SECOND) * this.#pps);
    const shown = drag.type === 'reorder' ? Math.min(width, 160) : width;
    const grabX = drag.type === 'reorder' ? Math.min(drag.grabX, shown - 8) : drag.grabX;
    const x1 = drag.pointer.x - grabX;
    const top = drag.pointer.y - drag.grabY;
    ctx.save();
    ctx.shadowColor = this.#c.overlay;
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    this.#drawItem(drag.item, x1, x1 + shown, { ...own, top }, project, false, 0.92, true);
    ctx.restore();
  }

  #drawFlashes(scale: TimeScale): void {
    const now = performance.now();
    this.#flashes = this.#flashes.filter((f) => f.until > now);
    if (!this.#flashes.length) return;
    const ctx = this.#ctx;
    for (const f of this.#flashes) {
      const left = (f.until - now) / FLASH_MS;
      const x = timeToX(scale, f.t);
      ctx.save();
      ctx.globalAlpha = left;
      ctx.fillStyle = this.#c.onMedia;
      ctx.shadowColor = this.#c.selection;
      ctx.shadowBlur = 14;
      ctx.fillRect(Math.round(x) - 1.5, this.#m.ruler + 2, 3, this.#height);
      ctx.restore();
    }
    this.invalidate();
  }

  /** While trimming: the clip's new length next to the edge being dragged. */
  #drawTrimLabel(
    drag: Extract<Drag, { type: 'trim' }>,
    scale: TimeScale,
    rows: Row[],
    project: Project,
  ): void {
    const item = project.tracks.flatMap((t) => t.items).find((i) => i.id === drag.item.id);
    const row = rows.find((r) => r.track.items.some((i) => i.id === drag.item.id));
    if (!item || !row) return;
    const ctx = this.#ctx;
    const x = timeToX(scale, drag.edge === 'start' ? item.start : itemEnd(item));
    const text = formatDurationShort(item.duration);
    ctx.font = `600 11px ${this.#c.font}`;
    const tw = ctx.measureText(text).width + 14;
    const lx = Math.min(Math.max(x - tw / 2, this.#m.header + 2), this.#width - tw - 2);
    const ly = Math.max(this.#m.ruler + 2, row.top - 22);
    ctx.fillStyle = this.#c.trim;
    this.#roundRect(lx, ly, tw, 18, 9);
    ctx.fill();
    ctx.fillStyle = this.#c.grip;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + 7, ly + 9.5);
  }

  #roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.#ctx;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(0, w), h, Math.max(0, Math.min(r, w / 2, h / 2)));
  }

  #drawItem(
    item: Item,
    x1: number,
    x2: number,
    row: Row,
    project: Project,
    selected: boolean,
    alpha: number,
    lifted = false,
  ): void {
    const ctx = this.#ctx;
    const c = this.#c;
    const inset = 3;
    const top = row.top + inset;
    const height = row.height - inset * 2;
    const cutGap = row.track.kind === 'main' ? 1.5 : 1;
    const bx = x1 + cutGap;
    const bw = Math.max(2, x2 - x1 - cutGap * 2);
    const hovered = this.#hoverId === item.id && !selected;
    const picture = item.kind === 'video' || item.kind === 'image' || item.kind === 'freeze';
    ctx.save();
    ctx.globalAlpha = alpha;
    // Pictures carry their own colour (thumbnails); everything else is one calm neutral, with a
    // small kind accent — no loud colour blocks.
    ctx.fillStyle = picture ? c.accentVideo : hovered ? c.laneHover : c.lane;
    this.#roundRect(bx, top, bw, height, this.#radius);
    ctx.fill();
    ctx.save();
    ctx.clip();

    const asset = 'assetId' in item && item.assetId ? project.assets[item.assetId] : undefined;
    if (picture && asset) {
      this.#drawFilmStrip(
        item,
        asset.width && asset.height ? asset.width / asset.height : 16 / 9,
        bx,
        bw,
        top,
        height,
        x1,
      );
    } else if (item.kind === 'audio' && asset) {
      this.#drawWaveform(item, bx, bw, top, height, x1);
    }
    if (!picture) {
      ctx.fillStyle =
        item.kind === 'text'
          ? c.accentText
          : item.kind === 'sticker'
            ? c.accentSticker
            : c.accentAudio;
      ctx.fillRect(bx, top, 3, height);
    }

    // Label: an icon-free name, on a soft backing over thumbnails.
    const title =
      item.kind === 'sticker' && item.emoji
        ? item.emoji
        : item.kind === 'text'
          ? item.text.split('\n')[0] || this.#ctl.labels.text
          : itemTitle(item, project.assets);
    const showDuration = row.track.kind === 'main';
    const durationText = `${(item.duration / FLICKS_PER_SECOND).toFixed(1)}s`;
    ctx.font = item.kind === 'text' ? `600 12px ${c.font}` : `500 11px ${c.font}`;
    ctx.textBaseline = 'middle';
    const maxText = bw - 14;
    if (maxText > 14) {
      const label = this.#ellipsize(title, maxText - (showDuration && bw > 70 ? 36 : 0));
      const tw = ctx.measureText(label).width;
      if (picture && label) {
        ctx.fillStyle = c.overlay;
        this.#roundRect(bx + 4, top + 4, tw + 10, 17, 5);
        ctx.fill();
        ctx.fillStyle = c.onMedia;
        ctx.fillText(label, bx + 9, top + 13);
      } else if (label) {
        ctx.fillStyle = c.label;
        ctx.fillText(label, bx + 11, top + height / 2 + 0.5);
      }
      if (showDuration && bw > 70) {
        ctx.font = `500 11px ${c.font}`;
        const dw = ctx.measureText(durationText).width;
        ctx.fillStyle = c.overlay;
        this.#roundRect(bx + bw - dw - 14, top + height - 21, dw + 10, 17, 5);
        ctx.fill();
        ctx.fillStyle = c.onMedia;
        ctx.fillText(durationText, bx + bw - dw - 9, top + height - 12);
      }
      if ('muted' in item && item.muted && bw > 44) {
        ctx.fillStyle = c.overlay;
        this.#roundRect(bx + 4, top + height - 21, 17, 17, 5);
        ctx.fill();
        ctx.save();
        ctx.translate(bx + 6.5, top + height - 18.5);
        ctx.scale(12 / 24, 12 / 24);
        ctx.strokeStyle = c.onMedia;
        ctx.lineWidth = 2;
        ctx.stroke(this.#icon('muted', 'M4 9.5h3.5L12 5v14l-4.5-4.5H4zM16 9.5l5 5M21 9.5l-5 5'));
        ctx.restore();
      }
    }
    ctx.restore(); // clip

    if (selected) {
      ctx.strokeStyle = c.selection;
      ctx.lineWidth = 2;
      this.#roundRect(bx + 1, top + 1, bw - 2, height - 2, this.#radius);
      ctx.stroke();
      if (alpha > 0.9 && !row.track.locked) this.#drawTrimHandles(bx, bw, top, height);
    } else if (lifted) {
      ctx.strokeStyle = c.selection;
      ctx.lineWidth = 2;
      this.#roundRect(bx + 1, top + 1, bw - 2, height - 2, this.#radius);
      ctx.stroke();
    } else if (hovered) {
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 1;
      this.#roundRect(bx + 0.5, top + 0.5, bw - 1, height - 1, this.#radius);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawTrimHandles(bx: number, bw: number, top: number, height: number): void {
    const ctx = this.#ctx;
    const hw = this.#m.trimHandle;
    ctx.fillStyle = this.#c.trim;
    ctx.beginPath();
    ctx.roundRect(bx - hw + 1, top, hw, height, [this.#radius, 2, 2, this.#radius]);
    ctx.roundRect(bx + bw - 1, top, hw, height, [2, this.#radius, this.#radius, 2]);
    ctx.fill();
    ctx.strokeStyle = this.#c.grip;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const x of [bx - hw / 2 + 1, bx + bw + hw / 2 - 1]) {
      ctx.moveTo(x, top + height / 2 - 7);
      ctx.lineTo(x, top + height / 2 + 7);
    }
    ctx.stroke();
  }

  /** Continuous film strip: one frame per tile, from the media the clip actually shows. */
  #drawFilmStrip(
    item: Item,
    aspect: number,
    bx: number,
    bw: number,
    top: number,
    height: number,
    x1: number,
  ): void {
    const ctx = this.#ctx;
    const tileH = height;
    const tileW = Math.max(16, Math.min(tileH * 2.4, tileH * aspect));
    const pxHeight = Math.round(tileH * this.#dpr);
    const left = Math.max(bx, this.#m.header);
    const right = Math.min(bx + bw, this.#width);
    const first = Math.max(0, Math.floor((left - x1) / tileW));
    const pps = this.#pps;
    for (let i = first; x1 + i * tileW < right; i++) {
      const tx = x1 + i * tileW;
      let seconds = 0;
      const assetId = (item as { assetId: string }).assetId;
      if (item.kind === 'video') {
        const local = (i * tileW + tileW / 2) / pps;
        const raw = item.sourceIn / FLICKS_PER_SECOND + local * item.speed;
        // Quantise to a power-of-two grid so zooming reuses cached frames.
        const step = Math.pow(
          2,
          Math.round(Math.log2(Math.max(0.125, (tileW / pps) * item.speed))),
        );
        seconds = Math.floor(raw / step) * step;
      } else if (item.kind === 'freeze') {
        seconds = item.sourceTime / FLICKS_PER_SECOND;
      }
      const bitmap = this.#cache.thumbnail(assetId, seconds, pxHeight);
      if (!bitmap) continue;
      // Cover the tile, centred.
      const scale = Math.max(tileW / bitmap.width, tileH / bitmap.height);
      const dw = bitmap.width * scale;
      const dh = bitmap.height * scale;
      ctx.drawImage(bitmap, tx + (tileW - dw) / 2, top + (tileH - dh) / 2, dw, dh);
    }
  }

  #drawWaveform(
    item: Extract<Item, { kind: 'audio' }>,
    bx: number,
    bw: number,
    top: number,
    height: number,
    x1: number,
  ): void {
    const wave = this.#cache.waveform(item.assetId);
    if (!wave) return;
    const ctx = this.#ctx;
    ctx.fillStyle = this.#c.waveform;
    const mid = top + height / 2;
    const amp = (height - 10) / 2;
    const left = Math.max(bx, this.#m.header);
    const right = Math.min(bx + bw, this.#width);
    const pps = this.#pps;
    const bar = 2;
    const gain = item.muted ? 0 : Math.min(2, item.volume);
    ctx.save();
    ctx.globalAlpha *= 0.55;
    for (let x = left; x < right; x += bar + 1) {
      const t0 = item.sourceIn / FLICKS_PER_SECOND + ((x - x1) / pps) * item.speed;
      const t1 = t0 + ((bar + 1) / pps) * item.speed;
      const i0 = Math.max(0, Math.floor(t0 * wave.peaksPerSecond));
      const i1 = Math.min(wave.peaks.length, Math.max(i0 + 1, Math.ceil(t1 * wave.peaksPerSecond)));
      let peak = 0;
      for (let i = i0; i < i1; i++) peak = Math.max(peak, wave.peaks[i]!);
      // Decibel scale (−48 dB … 0 dB): quiet audio stays visible, like it sounds.
      const level = peak * gain;
      const db = level > 0 ? 1 + (20 * Math.log10(Math.min(1, level))) / 48 : 0;
      const hgt = Math.max(1, Math.max(0, db) * amp);
      ctx.fillRect(x, mid - hgt, bar, hgt * 2);
    }
    ctx.restore();
  }

  #ellipsize(text: string, max: number): string {
    const ctx = this.#ctx;
    if (max <= 0) return '';
    if (ctx.measureText(text).width <= max) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
      else hi = mid - 1;
    }
    return lo === 0 ? '' : `${text.slice(0, lo)}…`;
  }

  #drawRuler(scale: TimeScale): void {
    const ctx = this.#ctx;
    const c = this.#c;
    const m = this.#m;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, this.#width, m.ruler);
    // Labels under the playhead's capsule are skipped (no text on text).
    const ph = timeToX(scale, this.#ctl.playhead.time);
    const major = majorTickSeconds(scale.pps);
    const minor = major / (major >= 1 && major % 5 === 0 ? 5 : 2);
    const startT = Math.max(0, Math.floor((m.header - scale.x0) / scale.pps / minor) * minor);
    const endT = (this.#width - scale.x0) / scale.pps;
    ctx.strokeStyle = c.subtle;
    ctx.lineWidth = 1;
    ctx.font = `11px ${c.font}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = c.muted;
    ctx.beginPath();
    for (let i = Math.round(startT / minor); i * minor <= endT; i++) {
      const t = i * minor;
      const x = Math.round(scale.x0 + t * scale.pps) + 0.5;
      if (x < m.header) continue;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      ctx.moveTo(x, m.ruler - (isMajor ? 7 : 4));
      ctx.lineTo(x, m.ruler);
      if (isMajor) {
        const label = tickLabel(t, major);
        const lw = ctx.measureText(label).width;
        if (x + 4 + lw < ph - 36 || x + 4 > ph + 36) ctx.fillText(label, x + 4, m.ruler / 2 - 1);
      }
    }
    ctx.stroke();
  }

  /** The playhead spine: a 2 px accent line through every lane with a timecode capsule. */
  #drawPlayhead(scale: TimeScale): void {
    const ctx = this.#ctx;
    const c = this.#c;
    const t = this.#ctl.playhead.time;
    const x = Math.round(timeToX(scale, t));
    if (x < this.#m.header - 1 || x > this.#width + 1) return;
    ctx.fillStyle = c.playhead;
    ctx.fillRect(x - 1, this.#m.ruler - 2, 2, this.#height);
    ctx.font = `600 11px ${c.font}`;
    const text = formatClock(t);
    // Fixed capsule width (the widest digits), so it doesn't wobble while the time changes.
    const cw = ctx.measureText(text.replace(/\d/g, '0')).width + 14;
    const cx = Math.min(Math.max(x - cw / 2, this.#m.header), this.#width - cw);
    this.#roundRect(cx, 2, cw, this.#m.ruler - 6, 999);
    ctx.fill();
    ctx.fillStyle = c.playheadText;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, cx + cw / 2, 2 + (this.#m.ruler - 6) / 2 + 0.5);
    ctx.textAlign = 'left';
  }
}
