import { EASES } from '@video-ultra/core/internal';
import {
  KEYFRAME_PROPS,
  clearKeyframes,
  curveAt,
  keyTime,
  keyedValue,
  moveKeyframe,
  removeKeyframe,
  setKeyframe,
  setKeyframeEase,
  transformAt,
  type Bezier,
  type Ease,
  type Item,
  type Keyframe,
  type KeyframeProp,
  type Keyframes,
  type Time,
} from '@video-ultra/core';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject } from './context';
import { Button, Chips, IconButton } from './controls';
import type { EditorController } from './controller';

/**
 * Keyframes (v0.4): ◆ buttons next to an element's position, size, turn and opacity, prev / next
 * keyframe, and a graph editor for one property (drag points; pick the curve between two, or
 * shape a custom one). Values shown are the element's at the playhead. React never renders per
 * frame: while playing, the controls keep the value they had; they catch up when it stops.
 */

/** The playhead time, re-rendering when it moves while paused (only for keyframed items). */
export function usePlayheadFor(item: Item): Time {
  const ctl = useController();
  const [time, setTime] = useState(() => ctl.playhead.time);
  const keyed = 'keyframes' in item && !!item.keyframes;
  useEffect(() => {
    if (!keyed) return;
    let frame = 0;
    const off = ctl.playhead.subscribe((t) => {
      if (ctl.ui.getState().playing) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTime(t));
    });
    // Playback stopped: show where it stopped.
    const offUi = ctl.ui.subscribe((s, prev) => {
      if (prev.playing && !s.playing) setTime(ctl.playhead.time);
    });
    return () => {
      cancelAnimationFrame(frame);
      off();
      offUi();
    };
  }, [ctl, keyed]);
  return keyed ? time : ctl.playhead.time;
}

type Group = 'position' | 'scale' | 'rotation' | 'opacity';
const GROUP_PROPS: Record<Group, readonly KeyframeProp[]> = {
  position: ['x', 'y'],
  scale: ['scale'],
  rotation: ['rotation'],
  opacity: ['opacity'],
};

/** Keyframe times (item time) of these properties, sorted, merged within half a frame. */
function keyTimes(keyframes: Keyframes | undefined, props: readonly KeyframeProp[]): Time[] {
  if (!keyframes) return [];
  const all = props
    .flatMap((p) => (keyframes[p] ?? []).map((k) => keyTime(keyframes, k)))
    .sort((a, b) => a - b);
  return all.filter((t, i) => i === 0 || t - all[i - 1]! > 1000);
}

function frameOf(ctl: EditorController): number {
  const r = ctl.project.settings.frameRate;
  return Math.round((705_600_000 * r.den) / r.num);
}

/** ◆ for a group of properties at the playhead, with ◀ ▶ to the previous / next keyframe. */
export function KeyframeButton({ item, group }: { item: Item; group: Group }): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const time = usePlayheadFor(item);
  if (!('transform' in item)) return null;
  const props = GROUP_PROPS[group];
  const local = time - item.start;
  const inside = local >= 0 && local <= item.duration;
  const times = keyTimes(item.keyframes, props);
  const half = frameOf(ctl) / 2;
  const here = times.some((t) => Math.abs(t - local) < half);
  const keyed = times.length > 0;
  const prev = [...times].reverse().find((t) => t < local - half);
  const next = times.find((t) => t > local + half);
  const toggle = () =>
    ctl.run(here ? l.removeKeyframe : l.addKeyframe, (d) => {
      const tf = transformAt(item, time)!;
      for (const p of props) {
        if (here) removeKeyframe(d, item.id, p, local);
        else setKeyframe(d, item.id, p, local, tf[p]);
      }
    });
  return (
    <span className="vu-keyframe" data-keyed={keyed || undefined}>
      {keyed ? (
        <IconButton
          icon="back"
          label={l.prevKeyframe}
          disabledReason={prev === undefined ? l.noKeyframeBefore : null}
          onClick={() => prev !== undefined && ctl.seek(item.start + prev)}
        />
      ) : null}
      <button
        type="button"
        className="vu-keyframe-diamond"
        aria-pressed={here}
        aria-label={
          here ? l.removeKeyframeOf(l.keyGroup(group)) : l.addKeyframeOf(l.keyGroup(group))
        }
        data-tooltip={
          !inside
            ? l.playheadOutsideSelection
            : here
              ? l.removeKeyframe
              : keyed
                ? l.addKeyframe
                : l.tipKeyframes
        }
        disabled={!inside}
        onClick={toggle}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z" />
        </svg>
      </button>
      {keyed ? (
        <IconButton
          icon="next"
          label={l.nextKeyframe}
          disabledReason={next === undefined ? l.noKeyframeAfter : null}
          onClick={() => next !== undefined && ctl.seek(item.start + next)}
        />
      ) : null}
    </span>
  );
}

const W = 280;
const H = 150;
const PAD = 12;

/** The graph editor for one property. */
export function CurveEditor({
  item,
  prop,
}: {
  item: Item;
  prop: KeyframeProp;
}): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const time = usePlayheadFor(item);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Drag state stays here until the pointer goes up (one edit then).
  const [drag, setDrag] = useState<{ index: number; t: Time; v: number } | null>(null);
  const [handleDrag, setHandleDrag] = useState<{ which: 0 | 1; curve: Bezier } | null>(null);
  if (!('keyframes' in item) || !item.keyframes?.[prop]?.length) return null;
  const keyframes = item.keyframes;
  const list = keyframes[prop]!;
  const local = (k: Keyframe) => keyTime(keyframes, k);
  const shown: Keyframe[] = list.map((k, i) =>
    drag && drag.index === i ? { ...k, t: drag.t + (keyframes.shift ?? 0), v: drag.v } : k,
  );
  const values = shown.map((k) => k.v);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-6) {
    lo -= prop === 'rotation' ? 45 : 0.25;
    hi += prop === 'rotation' ? 45 : 0.25;
  }
  const span = hi - lo;
  lo -= span * 0.15;
  hi += span * 0.15;
  const dur = Math.max(1, item.duration);
  const xOf = (t: Time) => PAD + ((W - 2 * PAD) * Math.min(dur, Math.max(0, t))) / dur;
  const yOf = (v: number) => H - PAD - ((H - 2 * PAD) * (v - lo)) / (hi - lo);
  const fromX = (x: number) => ((x - PAD) / (W - 2 * PAD)) * dur;
  const fromY = (y: number) => lo + ((H - PAD - y) / (H - 2 * PAD)) * (hi - lo);
  const sorted = [...shown].sort((a, b) => a.t - b.t);
  const keyedList = { ...keyframes, [prop]: sorted };
  let d = '';
  for (let i = 0; i <= 120; i++) {
    const t = (dur * i) / 120;
    const v = keyedValue(keyedList, prop, t) ?? 0;
    d += `${i ? 'L' : 'M'}${xOf(t).toFixed(1)} ${yOf(v).toFixed(1)}`;
  }
  const point = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const seg = selected !== null && selected < list.length - 1 ? list[selected]! : null;
  const segEase = seg?.ease;
  const custom: Bezier | null =
    handleDrag?.curve ?? (Array.isArray(segEase) ? (segEase as Bezier) : null);
  const next = seg ? list[selected! + 1]! : null;
  // A custom curve's handles, drawn in the segment's own box.
  const handles =
    seg && next && custom
      ? ([0, 1] as const).map((h) => ({
          x: xOf(local(seg)) + (xOf(local(next)) - xOf(local(seg))) * custom[h * 2]!,
          y: yOf(seg.v) + (yOf(next.v) - yOf(seg.v)) * custom[h * 2 + 1]!,
        }))
      : null;
  return (
    <div className="vu-curve">
      <svg
        ref={svgRef}
        className="vu-curve-graph"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={l.curveOf(l.keyProp(prop))}
        onPointerMove={(e) => {
          if (drag) {
            const p = point(e);
            const f = frameOf(ctl);
            setDrag({
              index: drag.index,
              t: Math.max(0, Math.min(dur, Math.round(fromX(p.x) / f) * f)),
              v: fromY(p.y),
            });
          } else if (handleDrag && seg && next) {
            const p = point(e);
            const x0 = xOf(local(seg));
            const x1 = xOf(local(next));
            const y0 = yOf(seg.v);
            const y1 = yOf(next.v);
            const hx = Math.min(1, Math.max(0, (p.x - x0) / Math.max(1, x1 - x0)));
            const hy = Math.abs(y1 - y0) < 1 ? 0.5 : (p.y - y0) / (y1 - y0);
            const c = [...handleDrag.curve] as Bezier;
            c[handleDrag.which * 2] = hx;
            c[handleDrag.which * 2 + 1] = Math.max(-1, Math.min(2, hy));
            setHandleDrag({ which: handleDrag.which, curve: c });
          }
        }}
        onPointerUp={() => {
          if (drag) {
            const k = list[drag.index]!;
            ctl.run(l.moveKeyframe, (draft) =>
              moveKeyframe(draft, item.id, prop, local(k), drag.t, drag.v),
            );
            setDrag(null);
          }
          if (handleDrag && seg) {
            const curve = handleDrag.curve;
            ctl.run(l.curve, (draft) => setKeyframeEase(draft, item.id, prop, local(seg), curve));
            setHandleDrag(null);
          }
        }}
        onPointerCancel={() => {
          setDrag(null);
          setHandleDrag(null);
        }}
      >
        <line
          className="vu-curve-playhead"
          x1={xOf(time - item.start)}
          x2={xOf(time - item.start)}
          y1={PAD / 2}
          y2={H - PAD / 2}
        />
        <path className="vu-curve-line" d={d} />
        {sorted.slice(0, -1).map((k, i) => (
          <line
            key={`s${i}`}
            className="vu-curve-segment"
            data-selected={
              selected === list.indexOf(list.find((x) => x.t === k.t) ?? k) || undefined
            }
            x1={xOf(local(k))}
            x2={xOf(local(sorted[i + 1]!))}
            y1={H - 4}
            y2={H - 4}
            onPointerDown={() => setSelected(list.findIndex((x) => x.t === k.t))}
          />
        ))}
        {handles && seg && next ? (
          <>
            <line
              className="vu-curve-arm"
              x1={xOf(local(seg))}
              y1={yOf(seg.v)}
              x2={handles[0]!.x}
              y2={handles[0]!.y}
            />
            <line
              className="vu-curve-arm"
              x1={xOf(local(next))}
              y1={yOf(next.v)}
              x2={handles[1]!.x}
              y2={handles[1]!.y}
            />
            {handles.map((h, which) => (
              <circle
                key={`h${which}`}
                className="vu-curve-handle"
                cx={h.x}
                cy={h.y}
                r={5}
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  setHandleDrag({ which: which as 0 | 1, curve: custom! });
                }}
              />
            ))}
          </>
        ) : null}
        {shown.map((k, i) => (
          <rect
            key={i}
            className="vu-curve-key"
            data-selected={selected === i || undefined}
            x={xOf(local(k)) - 5}
            y={yOf(k.v) - 5}
            width={10}
            height={10}
            transform={`rotate(45 ${xOf(local(k))} ${yOf(k.v)})`}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setSelected(i);
              setDrag({ index: i, t: local(k), v: k.v });
            }}
          />
        ))}
      </svg>
      {seg ? (
        <>
          <Chips
            label={l.curve}
            value={Array.isArray(segEase) ? 'custom' : ((segEase as Ease | undefined) ?? 'smooth')}
            options={[
              ...EASES.map((e) => ({ value: e, label: l.easeName(e) })),
              { value: 'custom', label: l.customCurve },
            ]}
            onChange={(v) =>
              ctl.run(l.curve, (draft) =>
                setKeyframeEase(
                  draft,
                  item.id,
                  prop,
                  local(seg),
                  v === 'custom' ? [0.4, 0, 0.2, 1] : (v as Ease),
                ),
              )
            }
          />
          <p className="vu-hint">
            {l.curveHint(curveAt(segEase as Ease | Bezier | undefined, 0.5) > 0.5)}
          </p>
        </>
      ) : (
        <p className="vu-hint">{l.curvePickHint}</p>
      )}
    </div>
  );
}

/** The Keyframes section: a row per animated property (graph, clear), and help. */
export function KeyframesTool({ item }: { item: Item }): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const time = usePlayheadFor(item);
  const keyframes = useProject((p) => {
    for (const t of p.tracks)
      for (const i of t.items) if (i.id === item.id && 'keyframes' in i) return i.keyframes;
    return undefined;
  });
  const props = KEYFRAME_PROPS.filter((p) => (keyframes?.[p]?.length ?? 0) > 0);
  const [graph, setGraph] = useState<KeyframeProp | null>(null);
  const shown = graph && props.includes(graph) ? graph : (props[0] ?? null);
  if (!('transform' in item)) return null;
  return (
    <div className="vu-keyframes">
      <div className="vu-keyframe-rows">
        {(['position', 'scale', 'rotation', 'opacity'] as const).map((g) => (
          <div key={g} className="vu-keyframe-row">
            <span>{l.keyGroup(g)}</span>
            <KeyframeButton item={item} group={g} />
          </div>
        ))}
      </div>
      {props.length ? (
        <>
          <Chips
            label={l.graphOf}
            value={shown}
            options={props.map((p) => ({ value: p, label: l.keyProp(p) }))}
            onChange={(p) => setGraph(p)}
          />
          {shown ? <CurveEditor item={item} prop={shown} /> : null}
          <Button
            icon="delete"
            label={l.clearKeyframes}
            variant="secondary"
            onClick={() =>
              ctl.run(l.clearKeyframes, (d) =>
                clearKeyframes(d, item.id, undefined, time - item.start),
              )
            }
          />
        </>
      ) : (
        <p className="vu-hint">{l.keyframesHint}</p>
      )}
    </div>
  );
}
