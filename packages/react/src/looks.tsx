import {
  FILTER_PRESETS,
  fromSeconds,
  itemEnd,
  setTransition,
  TRANSITION_PRESETS,
  updateItem,
  type Item,
} from '@video-ultra/core';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels } from './context';
import { Button, EditSlider, EmptyState } from './controls';
import { itemTitle } from './items';
import { useTargets, type LookItem } from './targets';

const TILE = 72;
const IDS: (string | null)[] = [null, ...FILTER_PRESETS.map((f) => f.id)];

/**
 * Filters for the selected clip (or the main clip under the playhead), each tile showing that
 * clip's own frame with the filter applied — rendered by the engine in one pass.
 */
export function FilterStrip(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const { look, hasClips } = useTargets();
  if (!look) {
    return (
      <EmptyState
        icon="filter"
        title={hasClips ? l.filtersPickHint : l.needClips}
        action={
          hasClips ? undefined : (
            <Button
              icon="plus"
              label={l.addMedia}
              variant="primary"
              onClick={() => ctl.pickFiles()}
            />
          )
        }
      />
    );
  }
  return <FilterGrid item={look} />;
}

function FilterGrid({ item }: { item: LookItem }) {
  const ctl = useController();
  const l = useLabels();
  const [tiles, setTiles] = useState<ImageBitmap[] | null>(null);
  const tilesRef = useRef<ImageBitmap[] | null>(null);
  // Re-render previews when the clip's picture inputs change, not on every edit.
  const inputs = JSON.stringify([
    'adjust' in item ? item.adjust : null,
    'crop' in item ? item.crop : null,
    item.kind === 'video' ? item.sourceIn : 0,
  ]);

  useEffect(() => {
    let live = true;
    const engine = ctl.engine;
    if (!engine) return;
    // A moment inside the clip: the playhead if it's there, else a third of the way in.
    const t = ctl.playhead.time;
    const at =
      t >= item.start && t < itemEnd(item) ? t : item.start + Math.floor(item.duration / 3);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const timer = setTimeout(() => {
      engine
        .filterPreviews(item.id, at, Math.round(TILE * dpr), IDS)
        .then((bitmaps) => {
          if (!live) {
            for (const b of bitmaps) b.close();
            return;
          }
          for (const b of tilesRef.current ?? []) b.close();
          tilesRef.current = bitmaps;
          setTiles(bitmaps);
        })
        .catch(() => {});
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `inputs` stands for the item's look; the item object changes on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, item.id, inputs]);
  useEffect(
    () => () => {
      for (const b of tilesRef.current ?? []) b.close();
      tilesRef.current = null;
    },
    [],
  );

  const current = item.filter?.id ?? null;
  return (
    <div className="vu-looks">
      <p className="vu-looks-target">{l.filtersFor(itemTitle(item, ctl.project.assets))}</p>
      <div className="vu-filter-grid" role="radiogroup" aria-label={l.filter}>
        {IDS.map((id, i) => (
          <button
            key={id ?? 'none'}
            type="button"
            role="radio"
            aria-checked={current === id}
            className="vu-filter-tile"
            onClick={() => ctl.applyFilter(item, id)}
          >
            <TileImage bitmap={tiles?.[i] ?? null} />
            <span className="vu-filter-name">
              {id ? (FILTER_PRESETS.find((f) => f.id === id)?.label ?? id) : l.original}
            </span>
          </button>
        ))}
      </div>
      {item.filter ? (
        <EditSlider
          label={l.intensity}
          value={item.filter.intensity}
          min={0}
          max={1}
          step={0.01}
          defaultValue={1}
          format={(v) => `${Math.round(v * 100)}%`}
          recipe={(d, v) =>
            updateItem(d, item.id, { filter: { id: item.filter!.id, intensity: v } })
          }
          commitLabel={l.filter}
          coalesceKey={`filter:${item.id}`}
        />
      ) : null}
    </div>
  );
}

function TileImage({ bitmap }: { bitmap: ImageBitmap | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !bitmap) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return (
    <canvas
      ref={ref}
      className="vu-filter-thumb"
      aria-hidden="true"
      data-ready={bitmap ? '' : undefined}
    />
  );
}

/** Small diagrams of each transition: clip A (outgoing) and clip B (incoming). */
function TransitionGlyph({ type }: { type: string }): ReactElement {
  const a = 'var(--vu-glyph-a)';
  const b = 'var(--vu-glyph-b)';
  const shapes: Record<string, ReactElement> = {
    fade: (
      <>
        <rect x="2" y="6" width="14" height="20" rx="2" fill={a} />
        <rect x="17" y="6" width="14" height="20" rx="2" fill="var(--vu-stage-canvas)" />
        <rect x="32" y="6" width="14" height="20" rx="2" fill={b} />
      </>
    ),
    dissolve: (
      <>
        <rect x="4" y="6" width="24" height="20" rx="2" fill={a} />
        <rect x="20" y="6" width="24" height="20" rx="2" fill={b} opacity="0.7" />
      </>
    ),
    'slide-left': (
      <>
        <rect x="2" y="6" width="18" height="20" rx="2" fill={a} />
        <rect x="22" y="6" width="24" height="20" rx="2" fill={b} />
        <path
          d="M30 16h10M30 16l4-4M30 16l4 4"
          stroke="var(--vu-glyph-ink)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
    'slide-up': (
      <>
        <rect x="8" y="2" width="32" height="12" rx="2" fill={a} />
        <rect x="8" y="16" width="32" height="14" rx="2" fill={b} />
        <path
          d="M24 27v-8M24 19l-4 4M24 19l4 4"
          stroke="var(--vu-glyph-ink)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
    zoom: (
      <>
        <rect x="4" y="4" width="40" height="24" rx="2" fill={a} />
        <rect x="14" y="10" width="20" height="12" rx="2" fill={b} />
      </>
    ),
    wipe: (
      <>
        <rect x="4" y="6" width="20" height="20" rx="2" fill={a} />
        <rect x="24" y="6" width="20" height="20" rx="2" fill={b} />
        <rect x="23" y="3" width="2" height="26" rx="1" fill="var(--vu-glyph-ink)" />
      </>
    ),
    blur: (
      <>
        <rect x="4" y="6" width="40" height="20" rx="2" fill={b} />
        <circle cx="16" cy="16" r="5" fill={a} opacity="0.5" />
        <circle cx="30" cy="14" r="4" fill={a} opacity="0.35" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 48 32" width="48" height="32" aria-hidden="true">
      {shapes[type] ?? shapes.dissolve}
    </svg>
  );
}

/**
 * Transitions for the cut before the selected clip (or the cut nearest the playhead), plus
 * "apply to all cuts". Explains itself when there's no cut yet.
 */
export function TransitionGrid(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const { transition, hasClips } = useTargets();
  if (!transition || !('transitionIn' in transition)) {
    return (
      <EmptyState
        icon="transition"
        title={l.transitionsNeedTwo}
        action={
          <Button
            icon="plus"
            label={l.addMedia}
            variant={hasClips ? 'secondary' : 'primary'}
            onClick={() => ctl.pickFiles()}
          />
        }
      />
    );
  }
  return <TransitionChoices item={transition} />;
}

function TransitionChoices({ item }: { item: Extract<Item, { transitionIn: unknown }> }) {
  const ctl = useController();
  const l = useLabels();
  const current = item.transitionIn?.type ?? null;
  const duration = item.transitionIn?.duration ?? fromSeconds(0.5);
  return (
    <div className="vu-looks">
      <p className="vu-looks-target">{l.transitionsFor(itemTitle(item, ctl.project.assets))}</p>
      <div className="vu-transition-grid" role="radiogroup" aria-label={l.transition}>
        <button
          type="button"
          role="radio"
          aria-checked={current === null}
          className="vu-transition-tile"
          onClick={() => ctl.applyTransition(item, null, duration)}
        >
          <svg viewBox="0 0 48 32" width="48" height="32" aria-hidden="true">
            <rect x="4" y="6" width="19" height="20" rx="2" fill="var(--vu-glyph-a)" />
            <rect x="25" y="6" width="19" height="20" rx="2" fill="var(--vu-glyph-b)" />
          </svg>
          <span>{l.cut}</span>
        </button>
        {TRANSITION_PRESETS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={current === t.id}
            className="vu-transition-tile"
            onClick={() => {
              ctl.applyTransition(item, t.id, duration);
              // Show it: play the transition from just before the cut.
              ctl.seek(Math.max(0, item.start - duration));
            }}
          >
            <TransitionGlyph type={t.id} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {current ? (
        <EditSlider
          label={l.duration}
          value={duration / 705_600_000}
          min={0.1}
          max={2}
          step={0.1}
          defaultValue={0.5}
          format={(v) => `${v.toFixed(1)} s`}
          recipe={(d, v) => setTransition(d, item.id, { type: current, duration: fromSeconds(v) })}
          commitLabel={l.transition}
          coalesceKey={`transition:${item.id}`}
        />
      ) : null}
      {current ? (
        <div className="vu-row">
          <Button
            icon="transition"
            label={l.applyToAll}
            variant="secondary"
            onClick={() => {
              ctl.applyTransitionToAll(current, duration);
              ctl.toast(
                l.appliedToAll(TRANSITION_PRESETS.find((t) => t.id === current)?.label ?? current),
                'success',
                {
                  label: l.undo,
                  run: () => ctl.undo(),
                },
              );
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
