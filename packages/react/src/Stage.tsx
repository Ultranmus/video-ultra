import { findItem, itemEnd, updateItem, type Item, type Transform } from '@video-ultra/core';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
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
    };

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
  const status = useUi((s) => s.status);

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
    void ctl.engine
      ?.setViewSize(Math.round(frame.w * dpr), Math.round(frame.h * dpr))
      .catch(() => {});
  }, [ctl, frame.w, frame.h]);

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
    el.style.width = `${box.width * scale}px`;
    el.style.height = `${box.height * scale}px`;
    el.style.transform = `translate(${box.cx * scale - (box.width * scale) / 2}px, ${box.cy * scale - (box.height * scale) / 2}px) rotate(${box.rotation}deg)`;
  };

  // Show the box only while the item is on screen (playhead subscription, no re-render per frame).
  useEffect(() => {
    if (!item) {
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
  }, [ctl, item, pw, ph, scale]);

  // ── gestures ─────────────────────────────────────────────────────────

  const drag = useRef<StageDrag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

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
    const p = toCanvas(e);
    pointers.current.set(e.pointerId, p);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const current = ctl.selectedItem();

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
      (touch ? 12 : 4) / scale,
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
    const d = drag.current;
    if (!d) return;
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
      const sx = snapCentre(d.tf.x + (p.x - d.x) / pw, 6 / scale / pw);
      const sy = snapCentre(d.tf.y + (p.y - d.y) / ph, 6 / scale / ph);
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
    const d = drag.current;
    if (!d) return;
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
        role="img"
        aria-label={l.timeline}
      >
        {frame.w > 0 ? <ScrubPreview width={frame.w} height={frame.h} /> : null}
        <div ref={guideX} className="vu-guide vu-guide-x" hidden />
        <div ref={guideY} className="vu-guide vu-guide-y" hidden />
        <div ref={boxRef} className="vu-selection-box" hidden>
          <span className="vu-handle" data-handle="nw" />
          <span className="vu-handle" data-handle="ne" />
          <span className="vu-handle" data-handle="sw" />
          <span className="vu-handle" data-handle="se" />
          <span className="vu-handle vu-handle-rotate" data-handle="rotate" />
        </div>
      </div>
    </div>
  );
}

function clampScale(s: number): number {
  return Math.min(8, Math.max(0.03, s));
}
