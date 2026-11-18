import {
  findItem,
  itemEnd,
  mainTrack,
  updateItem,
  setTransformAt,
  transformAt,
  type Item,
  type Project,
  type Transform,
} from '@video-ultra/core';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Button, EmptyState } from './controls';
import { Icon } from './icons';
import { ScrubPreview } from './stage/ScrubPreview';
import { boundsOf, unionBounds, type Bounds } from './stage/arrange';
import {
  boxContains,
  hitStage,
  itemBox,
  snapCentre,
  visibleItemsAt,
  type Box,
} from './stage/geometry';
import { measureText as measure } from './stage/measure';
import { placeTextField } from './stage/text-edit';

/**
 * The preview. The canvas belongs to the engine worker (transferred); this component only sizes
 * it and draws the selection overlay. Direct manipulation (UI_VISION §2.3): drag to move, corner
 * handles to scale, the top handle to rotate, two fingers to pinch-scale and rotate. Several
 * selected elements (or a group) share one box and move, scale and rotate together; locked ones
 * stay put. Drags preview through the engine and commit one edit on release.
 */

/** A selected element a gesture changes, with its transform when the gesture started. */
interface Member {
  id: string;
  tf: Transform;
}

type StageDrag =
  /** Move, scale, rotate or pinch the selection: a similarity transform around `centre`. */
  | {
      type: 'move' | 'scale' | 'rotate';
      id: number;
      members: Member[];
      /** Canvas px: the selection box's centre and the press point. */
      centre: { x: number; y: number };
      x: number;
      y: number;
      startDist: number;
      startAngle: number;
      /** One element: rotation snaps to absolute 45° steps (several: the turn snaps). */
      single: boolean;
      moved: boolean;
    }
  | {
      type: 'pinch';
      members: Member[];
      centre: { x: number; y: number };
      ids: [number, number];
      dist: number;
      angle: number;
      mid: { x: number; y: number };
    }
  /** Two fingers with nothing selected: zoom the view (screen coordinates). */
  | {
      type: 'view';
      ids: [number, number];
      dist: number;
      mid: { x: number; y: number };
      start: View;
      /** Frame's top-left on screen with no zoom / pan. */
      base: { x: number; y: number };
    }
  /** One finger on empty stage while zoomed in: pan the view. */
  | { type: 'pan'; id: number; x: number; y: number; start: View; moved: boolean }
  /** Mouse drag on empty stage: a selection rectangle (canvas px). */
  | {
      type: 'marquee';
      id: number;
      x: number;
      y: number;
      add: boolean;
      moved: boolean;
      /** A click (no drag) selects this — the main video the box was started on. */
      click: string | null;
    }
  /**
   * A blurred area's side handle: changes its width or height, the opposite side stays put
   * (v0.2 C3). `w × h`: its box in canvas px when the drag started.
   */
  | {
      type: 'stretch';
      id: number;
      itemId: string;
      edge: 'n' | 'e' | 's' | 'w';
      x: number;
      y: number;
      tf: Transform;
      w: number;
      h: number;
      moved: boolean;
    };

/** How the stage view is zoomed and panned (CSS on the frame; the project doesn't change). */
interface View {
  z: number;
  x: number;
  y: number;
}
const MAX_ZOOM = 5;
const LONG_PRESS_MS = 500;

export function Stage(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const outlinesRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const guideX = useRef<HTMLDivElement>(null);
  const guideY = useRef<HTMLDivElement>(null);
  const { pw, ph } = useProject((p) => ({ pw: p.settings.width, ph: p.settings.height }));
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  // View zoom: kept in a ref and applied to the frame's style while gesturing (no render per
  // move); `zoom` state follows at the end (Fit button, sharper engine rendering).
  const view = useRef<View>({ z: 1, x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const applyView = (v: View) => {
    view.current = v;
    const el = frameRef.current;
    if (!el) return;
    el.style.transform =
      v.z === 1 && !v.x && !v.y ? '' : `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    // Handles and the outline divide by this to keep their on-screen size.
    el.style.setProperty('--vu-stage-zoom', String(v.z));
  };
  const resetView = () => {
    applyView({ z: 1, x: 0, y: 0 });
    setZoom(1);
  };
  const status = useUi((s) => s.status);
  const empty = useProject((p) => p.tracks.every((t) => t.items.length === 0));

  // Canvas size changed (9:16 → 1:1…): the frame morphs from its old box to the new one, centred
  // where it is, without stretching the picture (owner, 2026-11-18: it grew from its corner and the
  // old picture stretched, then snapped). The frame is laid out at the new size at once; it's
  // scaled uniformly (the `scale` / `translate` properties, so the view zoom's transform is
  // untouched) and clipped to the old box's shape, then both ease to the new box.
  const lastFrame = useRef<{ w: number; h: number; pw: number; ph: number } | null>(null);
  const morph = useRef<Animation | null>(null);
  useEffect(() => () => morph.current?.cancel(), []);
  useLayoutEffect(() => {
    const el = frameRef.current;
    const was = lastFrame.current;
    // The frame's size arrives a render after the canvas size: compare size changes only.
    if (was && was.w === frame.w && was.h === frame.h) return;
    lastFrame.current = { w: frame.w, h: frame.h, pw, ph };
    if (!el || !was || was.w === 0 || frame.w === 0) return;
    // Only a canvas size change (not the stage itself resizing: panels, rotation, keyboard).
    if (was.pw === pw && was.ph === ph) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof el.animate !== 'function') return;
    const w = frame.w;
    const h = frame.h;
    // Uniform scale that makes the new frame cover the old box; the clip trims it to that box.
    const k = Math.max(was.w / w, was.h / h);
    const ix = Math.max(0, (w - was.w / k) / 2);
    const iy = Math.max(0, (h - was.h / k) / 2);
    const style = getComputedStyle(el);
    const token = style.getPropertyValue('--vu-duration-slow').trim(); // "320ms" or "0.32s"
    const ms = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || 320;
    const easing = style.getPropertyValue('--vu-ease').trim() || 'ease-out';
    // (A second fit right after — the stage settling — must not cut it short: it runs to its
    // end, which is the frame's own box whatever its size.)
    morph.current?.cancel();
    morph.current = el.animate(
      [
        {
          scale: `${k}`,
          // Scaling from the top-left (the zoom's origin): move it so the centre stays put.
          translate: `${(w * (1 - k)) / 2}px ${(h * (1 - k)) / 2}px`,
          clipPath: `inset(${iy}px ${ix}px)`,
        },
        { scale: '1', translate: '0px 0px', clipPath: 'inset(0px 0px)' },
      ],
      { duration: ms, easing },
    );
  }, [frame.w, frame.h, pw, ph]);

  // Fit the project's aspect ratio inside the stage.
  useLayoutEffect(() => {
    const stage = stageRef.current!;
    const fit = () => {
      const style = getComputedStyle(stage);
      const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const bw = Math.max(1, stage.clientWidth - pad);
      const bh = Math.max(1, stage.clientHeight - padY);
      const scale = Math.min(bw / pw, bh / ph);
      setFrame({ w: Math.floor(pw * scale), h: Math.floor(ph * scale) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [pw, ph]);

  useEffect(() => {
    if (frame.w === 0) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // Zoomed in, render more pixels so it stays sharp — never beyond the project's own size.
    const k = Math.max(1, Math.min(zoom, pw / Math.max(1, frame.w * dpr)));
    void ctl.engine
      ?.setViewSize(Math.round(frame.w * dpr * k), Math.round(frame.h * dpr * k))
      .catch(() => {});
  }, [ctl, frame.w, frame.h, zoom, pw]);

  // The engine and its canvas. Strict mode runs this twice: the first run's async setup must not
  // leave an engine behind once cleaned up (BACKLOG).
  const ready = status === 'ready';
  const hasFrame = frame.w > 0;
  useEffect(() => {
    if (!ready || !hasFrame) return;
    let disposed = false;
    let dispose: (() => void) | null = null;
    const host = frameRef.current!;
    const canvas = document.createElement('canvas');
    canvas.className = 'vu-stage-canvas';
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(host.clientWidth * dpr);
    canvas.height = Math.round(host.clientHeight * dpr);
    canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    ctl
      .attachCanvas(canvas)
      .then((d) => {
        if (disposed) d();
        else dispose = d;
      })
      .catch((error: unknown) => {
        ctl.ui.setState({
          status: 'error',
          statusMessage: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      disposed = true;
      dispose?.();
      canvas.remove();
    };
  }, [ctl, ready, hasFrame]);

  // ── selection overlay ────────────────────────────────────────────────

  const selectedIds = useUi((s) => s.selectedIds);
  // The selected items as they are in the project (re-renders when any of them changes).
  const selected = useProject((p) =>
    selectedIds.map((id) => findItem(p, id)?.item).filter((i): i is Item => !!i),
  );
  const lockedKey = useProject((p) =>
    selectedIds.map((id) => (isLockedIn(p, id) ? '1' : '0')).join(''),
  );
  const scale = frame.w / pw || 0;

  /** Boxes of the selected pictures on screen at `t` (canvas px). */
  const boxesAt = (project: Project, items: readonly Item[], t: number) => {
    const out: { item: Item; box: Box }[] = [];
    for (const item of items) {
      if (!('transform' in item) || item.hidden || t < item.start || t >= itemEnd(item)) continue;
      const box = itemBox(item, project, pw, ph, measure, t);
      if (box) out.push({ item, box });
    }
    return out;
  };

  /**
   * Draws the selection: one element's own (rotated) box, or for several one upright box around
   * them all plus a faint outline on each. Locked: dashed, no handles.
   */
  const placeBox = (entries: { item: Item; box: Box }[], locked: boolean) => {
    const el = boxRef.current;
    const outlines = outlinesRef.current;
    if (!el || !outlines) return;
    if (entries.length === 0) {
      el.hidden = true;
      outlines.replaceChildren();
      return;
    }
    el.hidden = false;
    el.toggleAttribute('data-locked', locked);
    el.toggleAttribute('data-group', entries.length > 1);
    // A blurred area also stretches from its sides.
    // A blurred area also stretches from its sides — when it's big enough on screen that the
    // side handles don't crowd the corners.
    const only = entries.length === 1 ? entries[0]! : null;
    el.toggleAttribute(
      'data-sides',
      !!only &&
        only.item.kind === 'region' &&
        Math.min(only.box.width, only.box.height) * scale * view.current.z > 88,
    );
    // A little air around the item so handles never sit on top of small text or stickers.
    const pad = 6;
    const box: Box =
      entries.length === 1
        ? entries[0]!.box
        : boundsBox(unionBounds(entries.map((e) => boundsOf(e.box))));
    let w = box.width * scale + pad * 2;
    let h = box.height * scale + pad * 2;
    let x = box.cx * scale - w / 2;
    let y = box.cy * scale - h / 2;
    // Locked (dashed, no handles): an upright box is kept inside the frame, so an item as wide
    // or tall as the video (or bigger) still shows all four sides.
    let rotation = box.rotation;
    if (locked) {
      // Turned: its upright bounds (a locked item only needs to show where it is).
      if (box.rotation % 360 !== 0) {
        const b = boundsOf(box);
        w = (b.right - b.left) * scale + pad * 2;
        h = (b.bottom - b.top) * scale + pad * 2;
        x = b.left * scale - pad;
        y = b.top * scale - pad;
        rotation = 0;
      }
      const fw = pw * scale;
      const fh = ph * scale;
      const left = Math.max(1, x);
      const top = Math.max(1, y);
      w = Math.max(0, Math.min(fw - 1, x + w) - left);
      h = Math.max(0, Math.min(fh - 1, y + h) - top);
      x = left;
      y = top;
    }
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
    // Member outlines (several only), reusing the elements already there.
    const need = entries.length > 1 ? entries.length : 0;
    while (outlines.children.length > need) outlines.lastElementChild!.remove();
    while (outlines.children.length < need) {
      const o = document.createElement('div');
      o.className = 'vu-member-outline';
      outlines.append(o);
    }
    if (need)
      entries.forEach(({ box: b }, i) => {
        const o = outlines.children[i] as HTMLElement;
        const ow = b.width * scale;
        const oh = b.height * scale;
        o.style.width = `${ow}px`;
        o.style.height = `${oh}px`;
        o.style.transform = `translate(${b.cx * scale - ow / 2}px, ${b.cy * scale - oh / 2}px) rotate(${b.rotation}deg)`;
      });
  };

  // Show the box only while the selection is on screen (playhead subscription, no re-render per
  // frame).
  const previewMode = useUi((s) => s.previewMode);
  const picking = useUi((s) => s.picking !== null);
  // Hidden while playing: the picture moves (keyframes, animations) and the frame would lag it.
  const playing = useUi((s) => s.playing);
  useEffect(() => {
    if (selected.length === 0 || previewMode || playing) {
      placeBox([], false);
      return;
    }
    const locked = lockedKey.includes('1') && !lockedKey.includes('0');
    // Keyframed items move with the playhead: their frame follows every scrub.
    const keyed = selected.some((i) => 'keyframes' in i && !!i.keyframes);
    let shown = '';
    const update = (t: number) => {
      const entries = boxesAt(ctl.project, selected, t);
      const key = entries.map((e) => e.item.id).join('|');
      if (key === shown && key !== '' && !keyed) return;
      shown = key;
      placeBox(entries, locked);
    };
    update(ctl.playhead.time);
    return ctl.playhead.subscribe(update);
    // placeBox / boxesAt read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, selected, lockedKey, pw, ph, scale, previewMode, playing]);

  // ── typing on the stage ──────────────────────────────────────────────
  // Double-click a text (mouse) or tap a selected one (touch): a field opens over it, styled like
  // the text, and the engine hides the item meanwhile. The typing stays local (no store writes
  // per key) and commits as one edit when the field closes; Esc puts the old text back. The
  // field is always mounted so focus happens inside the tap — iOS only shows the keyboard then.

  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const editing = useRef<{ id: string; original: string } | null>(null);

  const layoutField = () => {
    const field = fieldRef.current;
    const ed = editing.current;
    const item = ed ? findItem(ctl.project, ed.id)?.item : null;
    if (!field || !ed || item?.kind !== 'text') return;
    const typed = { ...item, text: field.value || ' ' };
    const box = itemBox(typed, ctl.project, pw, ph, measure, ctl.playhead.time);
    if (!box) return;
    const shown = placeTextField(field, typed, box, pw, ph, scale, ctl.playhead.time);
    // The selection frame stays (without handles) and grows with the typing.
    const w = shown.width / (scale || 1);
    const h = shown.height / (scale || 1);
    placeBox([{ item: typed, box: { ...box, width: w, height: h } }], false);
  };

  /** `selectAll`: a mouse replaces the text; a finger types on at the end (keyboard up). */
  const startTyping = (id: string, selectAll: boolean) => {
    const field = fieldRef.current;
    const item = findItem(ctl.project, id)?.item;
    const caption = ctl.project.tracks.find((t) => t.kind === 'caption');
    if (!field || item?.kind !== 'text' || isLockedIn(ctl.project, id)) return;
    if (caption?.items.some((i) => i.id === id)) return;
    if (ctl.ui.getState().playing) ctl.pause();
    // Phones: the full-screen Edit sheet instead of typing on the video (the keyboard would
    // cover a text low in the video; owner, 2026-10-31).
    if (ctl.ui.getState().layout === 'phone') {
      if (ctl.ui.getState().selectedId !== id) ctl.select(id);
      if (ctl.ui.getState().tool !== 'text-edit') ctl.openTool('text-edit');
      return;
    }
    editing.current = { id, original: item.text };
    field.value = item.text;
    field.hidden = false;
    boxRef.current?.toggleAttribute('data-typing', true);
    layoutField();
    field.focus({ preventScroll: true });
    const end = field.value.length;
    field.setSelectionRange(selectAll ? 0 : end, end);
    ctl.preview((d) => {
      const found = findItem(d, id);
      if (found) found.item.hidden = true;
    });
  };

  const stopTyping = (keep: boolean) => {
    const field = fieldRef.current;
    const ed = editing.current;
    if (!field || !ed) return;
    editing.current = null;
    field.hidden = true;
    boxRef.current?.toggleAttribute('data-typing', false);
    // Ending the preview puts the frame back on the item as it is (onPreview below).
    ctl.preview(null);
    const text = field.value;
    if (keep && text !== ed.original && findItem(ctl.project, ed.id)) {
      ctl.run(l.edit, (d) => updateItem(d, ed.id, { text }));
    }
  };

  // The stage resized (phone keyboard, panels): keep the field over its text.
  useLayoutEffect(() => {
    if (editing.current) layoutField();
    // layoutField reads refs and the current scale only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, pw, ph]);

  // ── gestures ─────────────────────────────────────────────────────────

  const drag = useRef<StageDrag | null>(null);
  const touchDrag = useRef(false);

  // Touch: the engine draws the dragged item a frame or more after the finger moves (more on a
  // phone), while the selection frame is ours and could move at once — the two came apart. On
  // touch the frame moves when the engine says the picture with the move is on screen.
  useEffect(
    () =>
      ctl.onPreviewDrawn((project) => {
        const d = drag.current;
        if (!d || !touchDrag.current || editing.current) return;
        const items = ctl
          .selectedItems()
          .map((i) => findItem(project, i.id)?.item)
          .filter((i): i is Item => !!i);
        if (items.length > 0) placeBox(boxesAt(project, items, ctl.playhead.time), false);
      }),
    // placeBox reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctl, pw, ph, scale],
  );

  // A slider in the side panel previews without committing: the box follows it. The stage's own
  // drags place the box themselves.
  useEffect(() => {
    if (selected.length === 0 || previewMode) return;
    const locked = lockedKey.includes('1') && !lockedKey.includes('0');
    return ctl.onPreview((project) => {
      if (drag.current || editing.current) return;
      const shown = project ?? ctl.project;
      const items = selected.map((i) => findItem(shown, i.id)?.item).filter((i): i is Item => !!i);
      placeBox(boxesAt(shown, items, ctl.playhead.time), locked);
    });
    // placeBox / boxesAt read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, selected, lockedKey, pw, ph, scale, previewMode]);
  const tapToType = useRef<{ id: string; mouse: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(
    null,
  );

  // Project pixels under a screen point. Uses the frame's on-screen size, so it holds while the
  // view is zoomed or panned.
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = frameRef.current!.getBoundingClientRect();
    const k = r.width / pw || 1;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };
  const screen = useRef(new Map<number, { x: number; y: number }>());

  const showGuides = (x: boolean, y: boolean) => {
    if (guideX.current) guideX.current.hidden = !x;
    if (guideY.current) guideY.current.hidden = !y;
  };

  /** The selection's members a gesture changes: unlocked, with a transform. */
  const movable = (): Member[] =>
    ctl
      .selectedItems()
      .filter((i): i is Extract<Item, { transform: Transform }> => 'transform' in i)
      .filter((i) => !ctl.isLocked(i.id))
      // Where each is now (keyframes sampled at the playhead): gestures start from there.
      .map((i) => ({ id: i.id, tf: transformAt(i, ctl.playhead.time)! }));

  /** The box gestures turn around: the selection box on screen now. */
  const selectionBox = (): Box | null => {
    const entries = boxesAt(ctl.project, ctl.selectedItems(), ctl.playhead.time);
    if (entries.length === 0) return null;
    return entries.length === 1
      ? entries[0]!.box
      : boundsBox(unionBounds(entries.map((e) => boundsOf(e.box))));
  };

  /**
   * Applies a similarity transform (move by dx/dy, scale by k, turn by `turn` degrees around
   * `centre`, canvas px) to every member; previews it, and returns the transforms to commit.
   */
  const latest = useRef<Map<string, Transform> | null>(null);
  const previewMembers = (
    members: Member[],
    centre: { x: number; y: number },
    dx: number,
    dy: number,
    k: number,
    turn: number,
  ) => {
    const rad = (turn * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const next = new Map<string, Transform>();
    for (const m of members) {
      const px = m.tf.x * pw - centre.x;
      const py = m.tf.y * ph - centre.y;
      const kk = clampScale(m.tf.scale * k) / m.tf.scale;
      const x = centre.x + dx + (px * cos - py * sin) * kk;
      const y = centre.y + dy + (px * sin + py * cos) * kk;
      next.set(m.id, {
        ...m.tf,
        x: x / pw,
        y: y / ph,
        scale: m.tf.scale * kk,
        rotation: normalizeAngle(m.tf.rotation + turn),
      });
    }
    latest.current = next;
    const project = ctl.preview((d) => {
      for (const [id, tf] of next) setTransformAt(d, id, tf, ctl.playhead.time);
    });
    if (project) {
      const items = ctl
        .selectedItems()
        .map((i) => findItem(project, i.id)?.item)
        .filter((i): i is Item => !!i);
      const entries = boxesAt(project, items, ctl.playhead.time);
      if (!touchDrag.current) placeBox(entries, false);
    }
  };

  const rootPoint = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current?.closest('.vu-root')?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const cancelLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

  /** Latest width / height / transform of a blurred area being stretched. */
  const stretched = useRef<{ width: number; height: number; transform: Transform } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    // Touch drags move the selection frame with the drawn picture (see onPreviewDrawn below).
    if (e.isPrimary) touchDrag.current = e.pointerType !== 'mouse';
    if (scale === 0 || e.button > 0) return;
    // A new gesture (the first finger down, or any mouse press): anything left from an earlier
    // one is stale. iOS can end a touch without telling us (a menu appears under the finger,
    // capture fails) — kept, that finger would count as "down" forever and every later tap would
    // look like a second finger and be ignored.
    if (e.isPrimary && (pointers.current.size > 0 || drag.current)) {
      pointers.current.clear();
      screen.current.clear();
      cancelLongPress();
      if (drag.current && drag.current.type !== 'view' && drag.current.type !== 'pan') {
        latest.current = null;
        ctl.preview(null);
        showGuides(false, false);
      }
      placeMarquee(null);
      drag.current = null;
    }
    // Green screen "pick from video": this tap picks the colour.
    const pickingFor = ctl.ui.getState().picking;
    if (pickingFor) {
      const p = toCanvas(e);
      // Only a tap on the picture itself picks (outside it there's only the background — black
      // would remove nearly every dark or grey part); picking goes on for another tap.
      const item = findItem(ctl.project, pickingFor)?.item;
      const box = item ? itemBox(item, ctl.project, pw, ph, measure, ctl.playhead.time) : null;
      if (!box || !boxContains(box, p.x, p.y)) {
        ctl.toast(l.pickMissed, 'info');
        return;
      }
      void ctl.pickKeyColour(p.x / pw, p.y / ph);
      return;
    }
    // Preview mode is for watching: a tap plays or pauses, nothing moves.
    if (ctl.ui.getState().previewMode) {
      ctl.togglePlay();
      return;
    }
    ctl.closeMenu();
    const p = toCanvas(e);
    pointers.current.set(e.pointerId, p);
    screen.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer already ended */
    }
    const members = movable();

    // Two fingers and nothing to transform: zoom the view around the fingers.
    if (pointers.current.size === 2 && members.length === 0) {
      cancelLongPress();
      ctl.preview(null);
      const [a, b] = [...screen.current.values()];
      const r = frameRef.current!.getBoundingClientRect();
      drag.current = {
        type: 'view',
        ids: [...screen.current.keys()] as [number, number],
        dist: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)),
        mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
        start: { ...view.current },
        base: { x: r.left - view.current.x, y: r.top - view.current.y },
      };
      return;
    }

    if (pointers.current.size === 2) {
      // Second finger: cancel the one-finger drag, pinch-scale and rotate the selection.
      cancelLongPress();
      latest.current = null;
      ctl.preview(null);
      const box = selectionBox();
      const [a, b] = [...pointers.current.values()];
      drag.current = {
        type: 'pinch',
        members,
        centre: box ? { x: box.cx, y: box.cy } : { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
        ids: [...pointers.current.keys()] as [number, number],
        dist: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)),
        angle: Math.atan2(b!.y - a!.y, b!.x - a!.x),
        mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
      };
      return;
    }
    if (pointers.current.size > 1) return;
    if (ctl.ui.getState().playing) ctl.pause();

    const handle = (e.target as HTMLElement).dataset.handle;
    const box = selectionBox();
    const only = members.length === 1 ? ctl.selectedItem() : null;
    if (
      (handle === 'n' || handle === 'e' || handle === 's' || handle === 'w') &&
      box &&
      only?.kind === 'region'
    ) {
      stretched.current = null;
      drag.current = {
        type: 'stretch',
        id: e.pointerId,
        itemId: only.id,
        edge: handle,
        x: p.x,
        y: p.y,
        tf: { ...only.transform },
        w: box.width,
        h: box.height,
        moved: false,
      };
      return;
    }
    if (handle && box && members.length) {
      drag.current = {
        type: handle === 'rotate' ? 'rotate' : 'scale',
        id: e.pointerId,
        members,
        centre: { x: box.cx, y: box.cy },
        x: p.x,
        y: p.y,
        startDist: Math.max(1, Math.hypot(p.x - box.cx, p.y - box.cy)),
        startAngle: Math.atan2(p.y - box.cy, p.x - box.cx),
        single: members.length === 1,
        moved: false,
      };
      return;
    }
    const touch = e.pointerType !== 'mouse';
    const hit = hitStage(
      ctl.project,
      ctl.playhead.time,
      pw,
      ph,
      p.x,
      p.y,
      measure,
      (touch ? 12 : 4) / (scale * view.current.z),
    );
    // Keep the current selection when pressing inside its box (it may be under another layer).
    const inside = box && boxContains(box, p.x, p.y);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    // A click or tap on the one selected text types into it (checked on release, if it didn't
    // become a drag).
    tapToType.current =
      inside && !additive && only?.kind === 'text' ? { id: only.id, mouse: !touch } : null;
    // The main video fills the frame, so with a mouse a drag that starts on it (while it isn't
    // selected) draws a selection rectangle; a click still selects it.
    const onMain =
      !touch &&
      !inside &&
      hit !== null &&
      mainTrack(ctl.project).items.some((i) => i.id === hit.id);
    if (additive && hit && !onMain) {
      ctl.select(hit.id, { add: true });
      return;
    }
    const target = inside && ctl.selectedItems().length ? ctl.selectedItem() : hit;
    if (onMain) {
      drag.current = {
        type: 'marquee',
        id: e.pointerId,
        x: p.x,
        y: p.y,
        add: additive,
        moved: false,
        click: hit.id,
      };
      return;
    }
    if (!target) {
      // Zoomed in, a drag on empty stage pans the view; with a mouse it draws a selection
      // rectangle. A plain tap clears the selection.
      if (view.current.z > 1) {
        drag.current = {
          type: 'pan',
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          start: { ...view.current },
          moved: false,
        };
        return;
      }
      if (!touch) {
        drag.current = {
          type: 'marquee',
          id: e.pointerId,
          x: p.x,
          y: p.y,
          add: additive,
          moved: false,
          click: null,
        };
        return;
      }
      ctl.select(null);
      return;
    }
    if (!inside) ctl.select(target.id);
    const now = movable();
    const nowBox = selectionBox();
    if (now.length && nowBox) {
      drag.current = {
        type: 'move',
        id: e.pointerId,
        members: now,
        centre: { x: nowBox.cx, y: nowBox.cy },
        x: p.x,
        y: p.y,
        startDist: 1,
        startAngle: 0,
        single: now.length === 1,
        moved: false,
      };
    }
    // Touch: hold still to open the menu for what's under the finger.
    if (touch) {
      const at = rootPoint(e);
      longPress.current = {
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => {
          longPress.current = null;
          drag.current = null;
          latest.current = null;
          ctl.preview(null);
          showGuides(false, false);
          navigator.vibrate?.(8);
          ctl.openMenu(at.x, at.y);
        }, LONG_PRESS_MS),
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toCanvas(e);
    pointers.current.set(e.pointerId, p);
    screen.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const lp = longPress.current;
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) cancelLongPress();
    const d = drag.current;
    if (!d) return;
    if (d.type === 'view') {
      const a = screen.current.get(d.ids[0]);
      const b = screen.current.get(d.ids[1]);
      if (!a || !b) return;
      const z = Math.min(
        MAX_ZOOM,
        Math.max(1, (d.start.z * Math.hypot(a.x - b.x, a.y - b.y)) / d.dist),
      );
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Keep the point that was under the fingers under them.
      const px = (d.mid.x - d.base.x - d.start.x) / d.start.z;
      const py = (d.mid.y - d.base.y - d.start.y) / d.start.z;
      applyView(
        z === 1
          ? { z, x: 0, y: 0 }
          : { z, x: mid.x - d.base.x - px * z, y: mid.y - d.base.y - py * z },
      );
      return;
    }
    if (d.type === 'pan') {
      if (d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      applyView({ ...d.start, x: d.start.x + dx, y: d.start.y + dy });
      return;
    }
    if (d.type === 'marquee') {
      if (d.id !== e.pointerId) return;
      const k = scale * view.current.z;
      if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) * k < 4) return;
      d.moved = true;
      placeMarquee({
        left: Math.min(d.x, p.x),
        top: Math.min(d.y, p.y),
        right: Math.max(d.x, p.x),
        bottom: Math.max(d.y, p.y),
      });
      return;
    }
    if (d.type === 'pinch') {
      const a = pointers.current.get(d.ids[0]);
      const b = pointers.current.get(d.ids[1]);
      if (!a || !b || d.members.length === 0) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      previewMembers(
        d.members,
        d.centre,
        d.members.length > 1 ? mid.x - d.mid.x : 0,
        d.members.length > 1 ? mid.y - d.mid.y : 0,
        dist / d.dist,
        ((angle - d.angle) * 180) / Math.PI,
      );
      return;
    }
    if (d.id !== e.pointerId) return;
    const k = scale * view.current.z;
    // A finger wobbles a few pixels during a tap; only a real move starts a drag.
    const slop = e.pointerType === 'mouse' ? 2 : 10;
    if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) * k < slop) return;
    d.moved = true;
    if (d.type === 'stretch') {
      // The pointer's move along the box's own axes; the opposite side stays where it is.
      const rad = (d.tf.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      const along = d.edge === 'e' || d.edge === 'w' ? dx * cos + dy * sin : -dx * sin + dy * cos;
      const sign = d.edge === 'e' || d.edge === 's' ? 1 : -1;
      const min = 8 / k;
      const horizontal = d.edge === 'e' || d.edge === 'w';
      const size = Math.max(min, (horizontal ? d.w : d.h) + sign * along);
      const grow = size - (horizontal ? d.w : d.h);
      const shift = (sign * grow) / 2;
      const cx = d.tf.x * pw + (horizontal ? cos * shift : -sin * shift);
      const cy = d.tf.y * ph + (horizontal ? sin * shift : cos * shift);
      const s = d.tf.scale;
      const next = {
        width: horizontal ? size / (pw * s) : d.w / (pw * s),
        height: horizontal ? d.h / (ph * s) : size / (ph * s),
        transform: { ...d.tf, x: cx / pw, y: cy / ph },
      };
      stretched.current = next;
      const project = ctl.preview((draft) => updateItem(draft, d.itemId, next));
      const item = project ? findItem(project, d.itemId)?.item : null;
      if (project && item && !touchDrag.current)
        placeBox(boxesAt(project, [item], ctl.playhead.time), false);
      return;
    }
    if (d.type === 'move') {
      // The selection's centre snaps to the frame's centre lines.
      const sx = snapCentre((d.centre.x + p.x - d.x) / pw, 6 / k / pw);
      const sy = snapCentre((d.centre.y + p.y - d.y) / ph, 6 / k / ph);
      showGuides(sx.snapped, sy.snapped);
      previewMembers(
        d.members,
        d.centre,
        sx.value * pw - d.centre.x,
        sy.value * ph - d.centre.y,
        1,
        0,
      );
    } else if (d.type === 'scale') {
      const dist = Math.hypot(p.x - d.centre.x, p.y - d.centre.y);
      previewMembers(d.members, d.centre, 0, 0, dist / d.startDist, 0);
    } else {
      const angle = Math.atan2(p.y - d.centre.y, p.x - d.centre.x);
      let turn = ((angle - d.startAngle) * 180) / Math.PI;
      // Snap to 45°: one element by its own angle, several by how far they turn.
      const base = d.single ? d.members[0]!.tf.rotation : 0;
      const total = normalizeAngle(base + turn);
      const nearest = Math.round(total / 45) * 45;
      if (Math.abs(total - nearest) < 4) turn += nearest - total;
      previewMembers(d.members, d.centre, 0, 0, 1, turn);
    }
  };

  const placeMarquee = (b: Bounds | null) => {
    const el = marqueeRef.current;
    if (!el) return;
    if (!b) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.style.width = `${(b.right - b.left) * scale}px`;
    el.style.height = `${(b.bottom - b.top) * scale}px`;
    el.style.transform = `translate(${b.left * scale}px, ${b.top * scale}px)`;
  };

  const finish = (e: React.PointerEvent, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    screen.current.delete(e.pointerId);
    cancelLongPress();
    const d = drag.current;
    if (!d) return;
    if (d.type === 'view') {
      if (pointers.current.size >= 2) return;
      drag.current = null;
      setZoom(view.current.z);
      return;
    }
    if (d.type === 'pan') {
      if (d.id !== e.pointerId) return;
      drag.current = null;
      if (!d.moved) ctl.select(null);
      return;
    }
    if (d.type === 'marquee') {
      if (d.id !== e.pointerId) return;
      drag.current = null;
      placeMarquee(null);
      if (cancelled) return;
      if (!d.moved) {
        if (d.click) ctl.select(d.click, d.add ? { add: true } : undefined);
        else if (!d.add) ctl.select(null);
        return;
      }
      const p = toCanvas(e);
      const rect = {
        left: Math.min(d.x, p.x),
        top: Math.min(d.y, p.y),
        right: Math.max(d.x, p.x),
        bottom: Math.max(d.y, p.y),
      };
      selectInRect(rect, d.add);
      return;
    }
    if (d.type === 'stretch') {
      if (d.id !== e.pointerId) return;
      drag.current = null;
      const next = stretched.current;
      stretched.current = null;
      if (cancelled || !next) {
        ctl.preview(null);
        return;
      }
      ctl.run(l.resize, (draft) => updateItem(draft, d.itemId, next));
      return;
    }
    if (d.type === 'pinch') {
      if (pointers.current.size >= 2) return;
    } else if (d.id !== e.pointerId) return;
    drag.current = null;
    showGuides(false, false);
    const next = latest.current;
    latest.current = null;
    const typeInto = tapToType.current;
    tapToType.current = null;
    if (cancelled || !next) {
      ctl.preview(null);
      if (!cancelled && !next && d.type === 'move' && !d.moved && typeInto)
        startTyping(typeInto.id, typeInto.mouse);
      return;
    }
    const label =
      d.type === 'move'
        ? l.move
        : d.type === 'scale'
          ? l.resize
          : d.type === 'rotate'
            ? l.rotate
            : l.edit;
    // Captions share one place and size: moving one moves them all (rotation stays upright).
    const caption = ctl.project.tracks.find((t) => t.kind === 'caption');
    const only = next.size === 1 ? [...next][0]! : null;
    if (only && caption?.items.some((i) => i.id === only[0])) {
      ctl.setCaptionLook({ x: only[1].x, y: only[1].y, scale: only[1].scale });
      return;
    }
    ctl.run(label, (draft) => {
      for (const [id, tf] of next) setTransformAt(draft, id, tf, ctl.playhead.time);
    });
  };

  /** Selects the on-screen elements touching a rectangle (canvas px); Shift adds to the selection. */
  const selectInRect = (rect: Bounds, add: boolean) => {
    const project = ctl.project;
    const main = mainTrack(project);
    const hits = visibleItemsAt(project, ctl.playhead.time)
      .filter((i) => !main.items.includes(i))
      .filter((i) => {
        const box = itemBox(i, project, pw, ph, measure, ctl.playhead.time);
        if (!box) return false;
        const b = boundsOf(box);
        return (
          b.left < rect.right && b.right > rect.left && b.top < rect.bottom && b.bottom > rect.top
        );
      })
      .reverse();
    const state = ctl.ui.getState();
    const ids = [...(add ? state.selectedIds : [])];
    for (const item of hits) {
      if (item.groupId) {
        for (const track of project.tracks)
          for (const other of track.items)
            if (other.groupId === item.groupId && !ids.includes(other.id)) ids.push(other.id);
      } else if (!ids.includes(item.id)) ids.push(item.id);
    }
    if (ids.length === 0) {
      ctl.select(null);
      return;
    }
    ctl.ui.setState({ selectedId: ids[ids.length - 1]!, selectedIds: ids, tool: null });
  };

  // Desktop: Ctrl/⌘ + wheel (or a trackpad pinch) zooms the view around the pointer.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !frameRef.current) return;
      e.preventDefault();
      const v = view.current;
      const z = Math.min(MAX_ZOOM, Math.max(1, v.z * Math.exp(-e.deltaY * 0.01)));
      const r = frameRef.current.getBoundingClientRect();
      const base = { x: r.left - v.x, y: r.top - v.y };
      const px = (e.clientX - base.x - v.x) / v.z;
      const py = (e.clientY - base.y - v.y) / v.z;
      applyView(
        z === 1
          ? { z, x: 0, y: 0 }
          : { z, x: e.clientX - base.x - px * z, y: e.clientY - base.y - py * z },
      );
      setZoom(z);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={stageRef}
      className="vu-stage"
      data-picking={picking || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      // The browser took the pointer away without an up / cancel: end what it started.
      onLostPointerCapture={(e) => {
        if (pointers.current.has(e.pointerId)) finish(e, true);
      }}
      onDoubleClick={(e) => {
        if (scale === 0 || editing.current || ctl.ui.getState().previewMode) return;
        const p = toCanvas(e);
        const hit = hitStage(ctl.project, ctl.playhead.time, pw, ph, p.x, p.y, measure, 4 / scale);
        if (!hit) return;
        // Double-click a group member to pick just that one; a text then types.
        if (ctl.ui.getState().selectedIds.length >= 2) ctl.select(hit.id, { only: true });
        if (hit.kind === 'text') startTyping(hit.id, true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (scale === 0 || ctl.ui.getState().previewMode) return;
        const p = toCanvas(e);
        const hit = hitStage(ctl.project, ctl.playhead.time, pw, ph, p.x, p.y, measure, 4 / scale);
        if (hit && !ctl.ui.getState().selectedIds.includes(hit.id)) ctl.select(hit.id);
        const at = rootPoint(e);
        ctl.openMenu(at.x, at.y);
      }}
    >
      <div
        ref={frameRef}
        className="vu-stage-frame"
        style={{ width: frame.w, height: frame.h }}
        role="group"
        aria-label={l.previewLabel}
      >
        {frame.w > 0 ? <ScrubPreview width={frame.w} height={frame.h} /> : null}
        <Countdown />
        {empty ? (
          <div className="vu-stage-empty" onPointerDown={(e) => e.stopPropagation()}>
            <EmptyState
              icon="media"
              title={l.getStarted}
              body={l.getStartedBody}
              action={
                <Button
                  icon="plus"
                  label={l.addMedia}
                  variant="primary"
                  onClick={() => ctl.pickFiles()}
                />
              }
            />
          </div>
        ) : null}
        <div ref={guideX} className="vu-guide vu-guide-x" hidden />
        <div ref={guideY} className="vu-guide vu-guide-y" hidden />
        <div ref={outlinesRef} className="vu-member-outlines" aria-hidden="true" />
        <div ref={marqueeRef} className="vu-marquee" aria-hidden="true" hidden />
        <div ref={boxRef} className="vu-selection-box" hidden>
          <span className="vu-handle" data-handle="nw" />
          <span className="vu-handle" data-handle="ne" />
          <span className="vu-handle" data-handle="sw" />
          <span className="vu-handle" data-handle="se" />
          <span className="vu-handle vu-handle-side" data-handle="n" />
          <span className="vu-handle vu-handle-side" data-handle="e" />
          <span className="vu-handle vu-handle-side" data-handle="s" />
          <span className="vu-handle vu-handle-side" data-handle="w" />
          <span className="vu-rotate-stem" aria-hidden="true" />
          <span className="vu-handle vu-handle-rotate" data-handle="rotate" />
        </div>
        <textarea
          ref={fieldRef}
          className="vu-stage-text"
          aria-label={l.text}
          hidden
          rows={1}
          spellCheck
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onInput={layoutField}
          onBlur={() => stopTyping(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              const field = e.currentTarget;
              if (editing.current) field.value = editing.current.original;
              stopTyping(false);
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      {picking ? (
        <div className="vu-stage-pick" role="status" onPointerDown={(e) => e.stopPropagation()}>
          <Icon name="eyedropper" size={16} />
          <span>{l.pickingHint}</span>
          <button type="button" className="vu-text-button" onClick={() => ctl.startPicking(null)}>
            {l.pickCancel}
          </button>
        </div>
      ) : null}
      {zoom > 1 ? (
        <button
          type="button"
          className="vu-stage-fit"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={resetView}
        >
          {l.fitView} · {Math.round(zoom * 100)}%
        </button>
      ) : null}
    </div>
  );
}

function isLockedIn(project: Project, itemId: string): boolean {
  const found = findItem(project, itemId);
  return !!found && (!!found.item.locked || found.track.locked);
}

/** An upright box from a rectangle. */
function boundsBox(b: Bounds): Box {
  return {
    cx: (b.left + b.right) / 2,
    cy: (b.top + b.bottom) / 2,
    width: b.right - b.left,
    height: b.bottom - b.top,
    rotation: 0,
  };
}

function normalizeAngle(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

function clampScale(s: number): number {
  return Math.min(8, Math.max(0.03, s));
}

/** Voiceover: the 3, 2, 1 before recording starts, big on the video (renders once a second). */
function Countdown(): ReactElement | null {
  const l = useLabels();
  const n = useUi((s) => s.countdown);
  if (n === null) return null;
  return (
    <div className="vu-countdown" role="status">
      <span className="vu-sr-only">{l.recordingIn(n)}</span>
      <span key={n} className="vu-countdown-number" aria-hidden="true">
        {n}
      </span>
    </div>
  );
}
