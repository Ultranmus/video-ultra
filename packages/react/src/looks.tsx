import {
  ANIMATION_CATEGORIES,
  ANIMATION_PRESETS,
  FILTER_CATEGORIES,
  FILTER_PRESETS,
  findAnimationPreset,
  findItem,
  findTransitionPreset,
  fromSeconds,
  itemEnd,
  mainTrack,
  setAnimation,
  setTransition,
  TRANSITION_CATEGORIES,
  TRANSITION_PRESETS,
  updateItem,
  type AnimationSlot,
  type Direction,
  type Ease,
  type Item,
} from '@video-ultra/core';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Button, EditSlider, EmptyState, Segmented } from './controls';
import type { IconName } from './icons';
import { itemTitle } from './items';
import { useTargets, type LookItem } from './targets';

const TILE = 72;
const FLICKS = 705_600_000;

/**
 * When a look panel opens with nothing selected, select the clip it acts on, so the timeline's
 * selection outline shows exactly what will change.
 */
function useAutoSelect(id: string | null) {
  const ctl = useController();
  useEffect(() => {
    if (id && !ctl.ui.getState().selectedId) ctl.select(id, { keepPanel: true });
  }, [ctl, id]);
}

/** A scrolling row of category chips. */
function Categories({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="vu-chips vu-chips-scroll" role="radiogroup" aria-label={label}>
      {options.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={c.id === value}
          className="vu-chip"
          onClick={() => onChange(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────

/**
 * Filters for the selected clip (or the main clip under the playhead), by category, each tile
 * showing that clip's own frame with the filter applied — rendered by the engine in one pass.
 */
export function FilterStrip(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const { look, hasClips } = useTargets();
  useAutoSelect(look?.id ?? null);
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
  const current = item.filter?.id ?? null;
  const [category, setCategory] = useState<string>(
    () => FILTER_PRESETS.find((f) => f.id === current)?.category ?? FILTER_CATEGORIES[0]!.id,
  );
  const ids = useMemo<(string | null)[]>(
    () => [null, ...FILTER_PRESETS.filter((f) => f.category === category).map((f) => f.id)],
    [category],
  );
  const [tiles, setTiles] = useState<ImageBitmap[] | null>(null);
  const tilesRef = useRef<ImageBitmap[] | null>(null);
  // Re-render previews when the clip's picture inputs or the category change, not on every edit.
  const inputs = JSON.stringify([
    'adjust' in item ? item.adjust : null,
    'crop' in item ? item.crop : null,
    item.kind === 'video' ? item.sourceIn : 0,
  ]);

  useEffect(() => {
    let live = true;
    const engine = ctl.engine;
    if (!engine) return;
    const t = ctl.playhead.time;
    const at =
      t >= item.start && t < itemEnd(item) ? t : item.start + Math.floor(item.duration / 3);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const timer = setTimeout(() => {
      engine
        .filterPreviews(item.id, at, Math.round(TILE * dpr), ids)
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
  }, [ctl, item.id, inputs, ids]);
  useEffect(
    () => () => {
      for (const b of tilesRef.current ?? []) b.close();
      tilesRef.current = null;
    },
    [],
  );
  const ready = tiles && tiles.length === ids.length;

  return (
    <div className="vu-looks">
      <p className="vu-target" data-active="">
        {l.filtersFor(itemTitle(item, ctl.project.assets))}
      </p>
      <Categories
        label={l.category}
        value={category}
        options={FILTER_CATEGORIES}
        onChange={setCategory}
      />
      <div className="vu-filter-grid" role="radiogroup" aria-label={l.filter}>
        {ids.map((id, i) => (
          <button
            key={id ?? 'none'}
            type="button"
            role="radio"
            aria-checked={current === id}
            className="vu-filter-tile"
            onClick={() => ctl.applyFilter(item, id)}
          >
            <TileImage bitmap={ready ? (tiles[i] ?? null) : null} />
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
      <div className="vu-row">
        <Button
          icon="filter"
          label={l.applyFilterAll}
          variant="secondary"
          tip={l.applyFilterAllTip}
          onClick={() => {
            ctl.applyFilterToAll(current);
            ctl.toast(l.filterAppliedAll, 'success', { label: l.undo, run: () => ctl.undo() });
          }}
        />
      </div>
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

// ── Transitions ───────────────────────────────────────────────────────────

const DIRECTION_ICONS: Record<Direction, IconName> = {
  left: 'arrowLeft',
  right: 'arrowRight',
  up: 'arrowUp',
  down: 'arrowDown',
};

/**
 * A tile that shows what a transition does: clip A gives way to clip B, animated on hover/focus
 * (and while selected), styled by the transition's family.
 */
function TransitionTile({
  family,
  direction,
}: {
  family: string;
  direction: Direction | undefined;
}): ReactElement {
  return (
    <span className="vu-trx" data-family={family} data-dir={direction ?? 'left'} aria-hidden="true">
      <span className="vu-trx-a" />
      <span className="vu-trx-b" />
    </span>
  );
}

/**
 * Transitions for the cut before the selected clip (or the cut nearest the playhead): by category,
 * with direction / feel / length, and "apply to all cuts". Picking one plays it once.
 */
export function TransitionGrid(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const { transition, hasClips } = useTargets();
  useAutoSelect(transition?.id ?? null);
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
  const current = item.transitionIn;
  const preset = current ? findTransitionPreset(current.type) : undefined;
  const [category, setCategory] = useState<string>(
    preset?.category ?? TRANSITION_CATEGORIES[0]!.id,
  );
  const presets = TRANSITION_PRESETS.filter((p) => p.category === category);

  const preview = (duration: number) => {
    const half = Math.round(duration / 2);
    ctl.playRange(item.start - half - fromSeconds(0.6), item.start + half + fromSeconds(0.4));
  };
  const choose = (type: string | null, extra: { direction?: Direction; ease?: Ease } = {}) => {
    const p = type ? findTransitionPreset(type) : undefined;
    const same = current !== null && current.type === type;
    const duration = same ? current.duration : fromSeconds(p?.defaultDuration ?? 0.6);
    const direction = extra.direction ?? (same ? current.direction : p?.directions?.[0]);
    const ease = extra.ease ?? (same ? current.ease : undefined);
    ctl.run(l.transition, (d) =>
      setTransition(
        d,
        item.id,
        type
          ? { type, duration, ...(direction ? { direction } : {}), ...(ease ? { ease } : {}) }
          : null,
      ),
    );
    if (type) preview(duration);
  };

  return (
    <div className="vu-looks">
      <p className="vu-target" data-active="">
        {l.transitionsFor(itemTitle(item, ctl.project.assets))}
      </p>
      <Categories
        label={l.category}
        value={category}
        options={TRANSITION_CATEGORIES}
        onChange={setCategory}
      />
      <div className="vu-transition-grid" role="radiogroup" aria-label={l.transition}>
        <button
          type="button"
          role="radio"
          aria-checked={current === null}
          className="vu-transition-tile"
          onClick={() => choose(null)}
        >
          <TransitionTile family="cut" direction={undefined} />
          <span>{l.cut}</span>
        </button>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={preset?.id === p.id}
            className="vu-transition-tile"
            data-tooltip={p.label}
            onClick={() => choose(p.id)}
          >
            <TransitionTile
              family={p.category}
              direction={preset?.id === p.id ? current?.direction : p.directions?.[0]}
            />
            <span>{p.label}</span>
          </button>
        ))}
      </div>
      {current && preset ? (
        <>
          {preset.directions?.length ? (
            <Segmented
              label={l.direction}
              value={current.direction ?? preset.directions[0]!}
              options={preset.directions.map((d) => ({
                value: d,
                label: l.directionName(d),
                icon: DIRECTION_ICONS[d],
              }))}
              onChange={(direction) => choose(preset.id, { direction })}
            />
          ) : null}
          <Segmented
            label={l.feel}
            value={current.ease ?? preset.ease}
            options={(['linear', 'smooth', 'snappy', 'bounce'] as const).map((e) => ({
              value: e,
              label: l.easeName(e),
            }))}
            onChange={(ease) => choose(preset.id, { ease })}
          />
          <EditSlider
            label={l.duration}
            value={current.duration / FLICKS}
            min={0.1}
            max={2.5}
            step={0.1}
            defaultValue={preset.defaultDuration ?? 0.6}
            format={(v) => `${v.toFixed(1)} s`}
            recipe={(d, v) =>
              setTransition(d, item.id, { type: current.type, duration: fromSeconds(v) })
            }
            commitLabel={l.transition}
            coalesceKey={`transition:${item.id}`}
          />
          <div className="vu-row">
            <Button
              icon="play"
              label={l.playPreview}
              variant="secondary"
              onClick={() => preview(current.duration)}
            />
            <Button
              icon="transition"
              label={l.applyToAll}
              variant="secondary"
              onClick={() => {
                ctl.applyTransitionToAll(current.type, current.duration);
                ctl.toast(l.appliedToAll(preset.label), 'success', {
                  label: l.undo,
                  run: () => ctl.undo(),
                });
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Animations ────────────────────────────────────────────────────────────

type Animatable = Extract<Item, { kind: 'text' | 'sticker' | 'video' | 'image' | 'freeze' }>;

/**
 * Animate the selected text, sticker or picture-in-picture: an entrance, an exit and a loop.
 * Picking one plays it once.
 */
export function AnimatePanel(): ReactElement {
  const l = useLabels();
  const selectedId = useUi((s) => s.selectedId);
  const item = useProject((p) => (selectedId ? (findItem(p, selectedId)?.item ?? null) : null));
  const onMain = useProject((p) =>
    selectedId ? mainTrack(p).items.some((i) => i.id === selectedId) : false,
  );
  if (!item || item.kind === 'audio' || onMain) {
    return <EmptyState icon="sparkle" title={l.animateHint} />;
  }
  return <AnimateChoices item={item} />;
}

function AnimateChoices({ item }: { item: Animatable }) {
  const ctl = useController();
  const l = useLabels();
  const [slot, setSlot] = useState<AnimationSlot>('in');
  const anim = item.animation;
  const value = anim?.[slot];
  const forSlot = ANIMATION_PRESETS.filter(
    (p) => p.slot === slot && (!p.textOnly || item.kind === 'text'),
  );
  const categories = ANIMATION_CATEGORIES.filter((c) => forSlot.some((p) => p.category === c.id));
  const [category, setCategory] = useState<string>('basic');
  const shown = categories.some((c) => c.id === category) ? category : (categories[0]?.id ?? '');
  const presets = forSlot.filter((p) => p.category === shown);
  const currentId = value?.type ?? null;

  const preview = (s: AnimationSlot, duration: number) => {
    const end = itemEnd(item);
    if (s === 'in')
      ctl.playRange(item.start, Math.min(end, item.start + duration + fromSeconds(0.4)));
    else if (s === 'out')
      ctl.playRange(Math.max(item.start, end - duration - fromSeconds(0.4)), end);
    else ctl.playRange(item.start, Math.min(end, item.start + fromSeconds(2)));
  };
  const choose = (id: string | null) => {
    const p = id ? findAnimationPreset(slot, id) : undefined;
    const duration = fromSeconds(p?.defaultDuration ?? 0.5);
    ctl.run(l.animate, (d) => {
      if (!id) setAnimation(d, item.id, slot, null);
      else if (slot === 'loop') setAnimation(d, item.id, 'loop', { type: id, speed: 1 });
      else setAnimation(d, item.id, slot, { type: id, duration });
    });
    if (id) preview(slot, duration);
  };
  const clip = value && 'duration' in value ? value : null;

  return (
    <div className="vu-looks">
      <p className="vu-target" data-active="">
        {l.animateFor(itemTitle(item, ctl.project.assets))}
      </p>
      <Segmented
        label={l.animate}
        hideLabel
        value={slot}
        options={[
          { value: 'in', label: l.animIn, tip: l.animInTip },
          { value: 'out', label: l.animOut, tip: l.animOutTip },
          { value: 'loop', label: l.animLoop, tip: l.animLoopTip },
        ]}
        onChange={setSlot}
      />
      {categories.length > 1 ? (
        <Categories label={l.category} value={shown} options={categories} onChange={setCategory} />
      ) : null}
      <div className="vu-transition-grid" role="radiogroup" aria-label={l.animate}>
        <button
          type="button"
          role="radio"
          aria-checked={currentId === null}
          className="vu-transition-tile"
          onClick={() => choose(null)}
        >
          <span className="vu-anx" data-family="none" aria-hidden="true">
            <span className="vu-anx-dot" />
          </span>
          <span>{l.none}</span>
        </button>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={currentId === p.id}
            className="vu-transition-tile"
            data-tooltip={p.label}
            onClick={() => choose(p.id)}
          >
            <span className="vu-anx" data-family={p.category} data-slot={slot} aria-hidden="true">
              <span className="vu-anx-dot">{item.kind === 'text' ? 'Aa' : ''}</span>
            </span>
            <span>{p.label}</span>
          </button>
        ))}
      </div>
      {clip && slot !== 'loop' ? (
        <EditSlider
          label={l.duration}
          value={clip.duration / FLICKS}
          min={0.1}
          max={Math.max(0.2, Math.min(5, item.duration / FLICKS))}
          step={0.1}
          defaultValue={0.5}
          format={(v) => `${v.toFixed(1)} s`}
          recipe={(d, v) =>
            setAnimation(d, item.id, slot as 'in' | 'out', {
              type: clip.type,
              duration: fromSeconds(v),
            })
          }
          commitLabel={l.animate}
          coalesceKey={`anim:${slot}:${item.id}`}
        />
      ) : null}
      {slot === 'loop' && anim?.loop ? (
        <EditSlider
          label={l.speed}
          value={anim.loop.speed ?? 1}
          min={0.25}
          max={4}
          step={0.05}
          defaultValue={1}
          format={(v) => `${v.toFixed(2).replace(/\.?0+$/, '')}×`}
          recipe={(d, v) => setAnimation(d, item.id, 'loop', { type: anim.loop!.type, speed: v })}
          commitLabel={l.animate}
          coalesceKey={`anim:loop:${item.id}`}
        />
      ) : null}
      {value ? (
        <div className="vu-row">
          <Button
            icon="play"
            label={l.playPreview}
            variant="secondary"
            onClick={() => preview(slot, clip ? clip.duration : fromSeconds(1))}
          />
        </div>
      ) : null}
    </div>
  );
}
