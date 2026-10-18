import { findItem, itemEnd, updateItem, type Item, type Transform } from '@video-ultra/core';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Button, EmptyState } from './controls';
import { ScrubPreview } from './stage/ScrubPreview';
import { hitStage, itemBox, snapCentre, type Box, type MeasureText } from './stage/geometry';

/**
 * The preview. The canvas belongs to the engine worker (transferred); this component only sizes
 * it and draws the selection overlay. Direct manipulation (UI_VISION §2.3): drag to move, corner
 * handles to scale, the top handle to rotate, two fingers to pinch-scale and rotate. Drags preview
 * through the engine and commit one edit on release.
 */

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
const measure: MeasureText = (font, text) => {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d');
  if (!measureCtx) return text.length * 10;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
};

type StageDrag =
  | { type: 'move'; id: number; item: Item; tf: Transform; x: number; y: number }
  | { type: 'scale'; id: number; item: Item; tf: Transform; box: Box; startDist: number }
  | { type: 'rotate'; id: number; item: Item; tf: Transform; box: Box; startAngle: number }
  | {
      type: 'pinch';
      item: Item;
      tf: Transform;
      ids: [number, number];
      dist: number;
      angle: number;
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
  | { type: 'pan'; id: number; x: number; y: number; start: View; moved: boolean };

/** How the stage view is zoomed and panned (CSS on the frame; the project doesn't change). */
interface View {
  z: number;
  x: number;
  y: number;
}
const MAX_ZOOM = 5;

export function Stage(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
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

  const selectedId = useUi((s) => s.selectedId);
  const item = useProject((p) => (selectedId ? (findItem(p, selectedId)?.item ?? null) : null));
  const scale = frame.w / pw || 0;

  const placeBox = (box: Box | null) => {
    const el = boxRef.current;
    if (!el) return;
    if (!box) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    // A little air around the item so handles never sit on top of small text or stickers.
    const pad = 6;
    const w = box.width * scale + pad * 2;
    const h = box.height * scale + pad * 2;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.transform = `translate(${box.cx * scale - w / 2}px, ${box.cy * scale - h / 2}px) rotate(${box.rotation}deg)`;
  };

  // Show the box only while the item is on screen (playhead subscription, no re-render per frame).
  const previewMode = useUi((s) => s.previewMode);
  useEffect(() => {
    if (!item || previewMode) {
      placeBox(null);
      return;
    }
    const box = itemBox(item, ctl.project, pw, ph, measure);
    const update = (t: number) => {
      const visible = t >= item.start && t < itemEnd(item);
      placeBox(visible ? box : null);
    };
    update(ctl.playhead.time);
    return ctl.playhead.subscribe(update);
    // placeBox reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, item, pw, ph, scale, previewMode]);

  // ── gestures ─────────────────────────────────────────────────────────

  const drag = useRef<StageDrag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

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

  /** The transform the preview shows now — committed on release. */
  const latestTf = useRef<Transform | null>(null);
  const previewTransform = (target: Item, tf: Transform) => {
    latestTf.current = tf;
    const next = ctl.preview((d) => updateItem(d, target.id, { transform: tf }));
    const moved = next ? findItem(next, target.id)?.item : null;
    if (moved) placeBox(itemBox(moved, next!, pw, ph, measure));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale === 0 || e.button > 0) return;
    // Preview mode is for watching: a tap plays or pauses, nothing moves.
    if (ctl.ui.getState().previewMode) {
      ctl.togglePlay();
      return;
    }
    const p = toCanvas(e);
    pointers.current.set(e.pointerId, p);
    screen.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer already ended */
    }
    const current = ctl.selectedItem();

    // Two fingers and nothing to transform: zoom the view around the fingers.
    if (pointers.current.size === 2 && !(current && 'transform' in current)) {
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

    if (pointers.current.size === 2 && current && 'transform' in current) {
      latestTf.current = null;
      ctl.preview(null);
      // Second finger: cancel the one-finger drag, pinch-scale and rotate the selection.
      const [a, b] = [...pointers.current.values()];
      drag.current = {
        type: 'pinch',
        item: current,
        tf: { ...current.transform },
        ids: [...pointers.current.keys()] as [number, number],
        dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        angle: Math.atan2(b!.y - a!.y, b!.x - a!.x),
      };
      return;
    }
    if (pointers.current.size > 1) return;
    if (ctl.ui.getState().playing) ctl.pause();

    const handle = (e.target as HTMLElement).dataset.handle;
    if (handle && current && 'transform' in current) {
      const box = itemBox(current, ctl.project, pw, ph, measure)!;
      if (handle === 'rotate') {
        drag.current = {
          type: 'rotate',
          id: e.pointerId,
          item: current,
          tf: { ...current.transform },
          box,
          startAngle: Math.atan2(p.y - box.cy, p.x - box.cx),
        };
      } else {
        drag.current = {
          type: 'scale',
          id: e.pointerId,
          item: current,
          tf: { ...current.transform },
          box,
          startDist: Math.max(1, Math.hypot(p.x - box.cx, p.y - box.cy)),
        };
      }
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
    // Keep the current selection when tapping inside it (it may be under another layer).
    const keep =
      current && 'transform' in current && itemBox(current, ctl.project, pw, ph, measure);
    const target =
      keep &&
      current &&
      ctl.playhead.time >= current.start &&
      ctl.playhead.time < itemEnd(current) &&
      hitInside(keep, p)
        ? current
        : hit;
    // Zoomed in, a drag on empty stage pans the view (a tap still clears the selection).
    if (!target && view.current.z > 1) {
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
    ctl.select(target?.id ?? null);
    if (target && 'transform' in target && !isLocked(target)) {
      drag.current = {
        type: 'move',
        id: e.pointerId,
        item: target,
        tf: { ...target.transform },
        x: p.x,
        y: p.y,
      };
    }
  };

  const isLocked = (target: Item) =>
    ctl.project.tracks.some((t) => t.locked && t.items.some((i) => i.id === target.id));
  const hitInside = (box: Box, p: { x: number; y: number }) => {
    const rad = (-box.rotation * Math.PI) / 180;
    const dx = p.x - box.cx;
    const dy = p.y - box.cy;
    return (
      Math.abs(dx * Math.cos(rad) - dy * Math.sin(rad)) <= box.width / 2 &&
      Math.abs(dx * Math.sin(rad) + dy * Math.cos(rad)) <= box.height / 2
    );
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toCanvas(e);
    pointers.current.set(e.pointerId, p);
    screen.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    if (d.type === 'pinch') {
      const a = pointers.current.get(d.ids[0]);
      const b = pointers.current.get(d.ids[1]);
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const tf = {
        ...d.tf,
        scale: clampScale(d.tf.scale * (dist / Math.max(1, d.dist))),
        rotation: d.tf.rotation + ((angle - d.angle) * 180) / Math.PI,
      };
      previewTransform(d.item, tf);
      return;
    }
    if (d.id !== e.pointerId) return;
    if (d.type === 'move') {
      const k = scale * view.current.z;
      const sx = snapCentre(d.tf.x + (p.x - d.x) / pw, 6 / k / pw);
      const sy = snapCentre(d.tf.y + (p.y - d.y) / ph, 6 / k / ph);
      showGuides(sx.snapped, sy.snapped);
      previewTransform(d.item, { ...d.tf, x: sx.value, y: sy.value });
    } else if (d.type === 'scale') {
      const dist = Math.hypot(p.x - d.box.cx, p.y - d.box.cy);
      previewTransform(d.item, { ...d.tf, scale: clampScale(d.tf.scale * (dist / d.startDist)) });
    } else {
      const angle = Math.atan2(p.y - d.box.cy, p.x - d.box.cx);
      let rotation = d.tf.rotation + ((angle - d.startAngle) * 180) / Math.PI;
      rotation = ((rotation + 540) % 360) - 180;
      // Snap to the nearest 45° within 4°.
      const nearest = Math.round(rotation / 45) * 45;
      if (Math.abs(rotation - nearest) < 4) rotation = nearest;
      previewTransform(d.item, { ...d.tf, rotation });
    }
  };

  const finish = (e: React.PointerEvent, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    screen.current.delete(e.pointerId);
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
    if (d.type === 'pinch') {
      if (pointers.current.size >= 2) return;
    } else if (d.id !== e.pointerId) return;
    drag.current = null;
    showGuides(false, false);
    const latest = latestTf.current;
    latestTf.current = null;
    if (cancelled || !latest) {
      ctl.preview(null);
      return;
    }
    ctl.run(l.edit, (draft) => updateItem(draft, d.item.id, { transform: latest }));
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
    >
      <div
        ref={frameRef}
        className="vu-stage-frame"
        style={{ width: frame.w, height: frame.h }}
        role="group"
        aria-label={l.previewLabel}
      >
        {frame.w > 0 ? <ScrubPreview width={frame.w} height={frame.h} /> : null}
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
        <div ref={boxRef} className="vu-selection-box" hidden>
          <span className="vu-handle" data-handle="nw" />
          <span className="vu-handle" data-handle="ne" />
          <span className="vu-handle" data-handle="sw" />
          <span className="vu-handle" data-handle="se" />
          <span className="vu-rotate-stem" aria-hidden="true" />
          <span className="vu-handle vu-handle-rotate" data-handle="rotate" />
        </div>
      </div>
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

function clampScale(s: number): number {
  return Math.min(8, Math.max(0.03, s));
}
