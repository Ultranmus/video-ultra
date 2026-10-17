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
  type Transition,
} from '@video-ultra/core';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Button, EditSlider, EmptyState, Segmented } from './controls';
import type { IconName } from './icons';
import { itemTitle } from './items';
import { EASES, easeAt } from '@video-ultra/core/internal';
import { CategoryBrowser, useNearView } from './browse';
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

// ── Filters ───────────────────────────────────────────────────────────────

/**
 * Filters for the selected clip (or the main clip under the playhead), by category, each tile
 * showing that clip's own frame with the filter applied — rendered by the engine in one pass.
 */
export function FilterStrip(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const { look, lookNote, hasClips } = useTargets();
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
  return <FilterGrid item={look} note={lookNote} />;
}

function FilterGrid({ item, note }: { item: LookItem; note: string | null }) {
  const ctl = useController();
  const l = useLabels();
  const current = item.filter?.id ?? null;
  // Previews are re-rendered when the clip's picture inputs change, not on every edit.
  const inputs = JSON.stringify([
    'adjust' in item ? item.adjust : null,
    'crop' in item ? item.crop : null,
    item.kind === 'video' ? item.sourceIn : 0,
  ]);
  const sections = useMemo(
    () => [
      { id: 'original', label: l.original, ids: [null] as (string | null)[] },
      ...FILTER_CATEGORIES.map((c) => ({
        id: c.id as string,
        label: c.label,
        ids: FILTER_PRESETS.filter((f) => f.category === c.id).map((f) => f.id) as (
          string | null
        )[],
      })),
    ],
    [l.original],
  );
  const initial = current ? (FILTER_PRESETS.find((f) => f.id === current)?.category ?? null) : null;

  return (
    <div className="vu-looks">
      <p className="vu-target" data-active="">
        {l.filtersFor(itemTitle(item, ctl.project.assets))}
      </p>
      {note ? <p className="vu-hint">{note}</p> : null}
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
      <CategoryBrowser label={l.category} categories={sections} initial={initial}>
        {(section) => (
          <FilterSection
            key={`${section.id}:${inputs}`}
            item={item}
            ids={section.ids}
            current={current}
          />
        )}
      </CategoryBrowser>
    </div>
  );
}

/** One category's filter tiles; asks the engine for its previews when it scrolls near the view. */
function FilterSection({
  item,
  ids,
  current,
}: {
  item: LookItem;
  ids: (string | null)[];
  current: string | null;
}) {
  const ctl = useController();
  const l = useLabels();
  const [tiles, setTiles] = useState<ImageBitmap[] | null>(null);
  const tilesRef = useRef<ImageBitmap[] | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      for (const b of tilesRef.current ?? []) b.close();
      tilesRef.current = null;
    };
  }, []);
  const ref = useNearView<HTMLDivElement>(() => {
    // The engine may still be starting, or the clip's media still opening: try a few times.
    const request = (attempt: number) => {
      if (!live.current) return;
      const retry = () => {
        if (attempt < 5) setTimeout(() => request(attempt + 1), 400 * (attempt + 1));
      };
      const engine = ctl.engine;
      if (!engine) return retry();
      const t = ctl.playhead.time;
      const at =
        t >= item.start && t < itemEnd(item) ? t : item.start + Math.floor(item.duration / 3);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      engine
        .filterPreviews(item.id, at, Math.round(TILE * dpr), ids)
        .then((bitmaps) => {
          if (!live.current) {
            for (const b of bitmaps) b.close();
            return;
          }
          if (bitmaps.length === 0) return retry();
          tilesRef.current = bitmaps;
          setTiles(bitmaps);
        })
        .catch(retry);
    };
    request(0);
  });
  return (
    <div ref={ref} className="vu-filter-grid" role="radiogroup" aria-label={l.filter}>
      {ids.map((id, i) => (
        <button
          key={id ?? 'none'}
          type="button"
          role="radio"
          aria-checked={current === id}
          className="vu-filter-tile"
          onClick={() => {
            ctl.applyFilter(item, id);
            // Picking a look for a clip makes that clip the selection, so it's clear what changed.
            ctl.select(item.id, { keepPanel: true });
          }}
        >
          <TileImage bitmap={tiles?.[i] ?? null} />
          <span className="vu-filter-name">
            {id ? (FILTER_PRESETS.find((f) => f.id === id)?.label ?? id) : l.original}
          </span>
        </button>
      ))}
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
/** The curve of a timing ease as an SVG path in a 40 × 28 box (computed once per ease). */
const EASE_PATHS = new Map<Ease, string>();
function easePath(ease: Ease): string {
  let d = EASE_PATHS.get(ease);
  if (!d) {
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = i / 40;
      pts.push(`${(2 + x * 36).toFixed(1)},${(23 - easeAt(ease, x) * 18).toFixed(1)}`);
    }
    d = `M${pts.join('L')}`;
    EASE_PATHS.set(ease, d);
  }
  return d;
}

/** How the transition moves: every timing curve as a tile showing its shape. */
function EasePicker({ value, onChange }: { value: Ease; onChange: (ease: Ease) => void }) {
  const l = useLabels();
  return (
    <div className="vu-field">
      <span className="vu-field-row" id="vu-feel-label">
        {l.feel}
        <span className="vu-field-value">{l.easeName(value)}</span>
      </span>
      <div className="vu-ease-grid" role="radiogroup" aria-labelledby="vu-feel-label">
        {EASES.map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={e === value}
            className="vu-ease"
            data-tooltip={l.easeTip(e)}
            onClick={() => onChange(e)}
          >
            <svg viewBox="0 0 40 28" aria-hidden="true">
              <path className="vu-ease-axis" d="M2 23H38" />
              <path className="vu-ease-curve" d={easePath(e)} />
            </svg>
            <span>{l.easeName(e)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const FLIP_FRAMES = 12;
const FLIP_W = 160;
const FLIP_H = 96;
const FLIP_CACHE = 12;

type Flipbooks = {
  /** Clip A | clip B, split down the middle: every tile's still. */
  rest: ImageBitmap | null;
  load: (transition: Transition) => Promise<ImageBitmap[] | null>;
};

/**
 * Hover previews for transition tiles: the engine plays each transition on the real cut (the
 * previous clip into this one) as a short flip-book. Fetched on first hover, a few kept, all
 * closed when the panel closes or the cut's clips change.
 */
function useFlipbooks(item: Extract<Item, { transitionIn: unknown }>): Flipbooks {
  const ctl = useController();
  const prevId = useProject((p) => {
    const items = findItem(p, item.id)?.track.items ?? [];
    const i = items.findIndex((x) => x.id === item.id);
    return i > 0 ? items[i - 1]!.id : null;
  });
  const signature = `${item.id}:${prevId}:${item.kind === 'video' ? item.sourceIn : 0}`;
  const cache = useRef(new Map<string, Promise<ImageBitmap[] | null>>());
  const [rest, setRest] = useState<ImageBitmap | null>(null);
  useEffect(() => {
    const map = cache.current;
    const engine = ctl.engine;
    let live = true;
    let still: ImageBitmap | null = null;
    if (engine && prevId) {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      // A linear wipe at its midpoint is exactly "clip A | clip B".
      void engine
        .transitionPreview(
          item.id,
          { type: 'wipe', duration: fromSeconds(0.6), direction: 'right', ease: 'linear' },
          Math.round((FLIP_W * dpr) / 2),
          Math.round((FLIP_H * dpr) / 2),
          3,
        )
        .then((b) => {
          b.forEach((x, i) => i !== 1 && x.close());
          const mid = b[1];
          if (!mid) return;
          if (!live) return mid.close();
          still = mid;
          setRest(mid);
        })
        .catch(() => {});
    }
    return () => {
      live = false;
      still?.close();
      setRest(null);
      for (const p of map.values()) void p.then((b) => b?.forEach((x) => x.close()));
      map.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const load = useCallback(
    (transition: Transition) => {
      const engine = ctl.engine;
      if (!engine || !prevId) return Promise.resolve(null);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const key = JSON.stringify(transition);
      const map = cache.current;
      let hit = map.get(key);
      if (hit) {
        map.delete(key);
        map.set(key, hit);
        return hit;
      }
      hit = engine
        .transitionPreview(
          item.id,
          transition,
          Math.round((FLIP_W * dpr) / 2),
          Math.round((FLIP_H * dpr) / 2),
          FLIP_FRAMES,
        )
        .catch(() => null);
      map.set(key, hit);
      while (map.size > FLIP_CACHE) {
        const [oldKey, old] = map.entries().next().value!;
        map.delete(oldKey);
        void old.then((b) => b?.forEach((x) => x.close()));
      }
      return hit;
    },
    // `signature` resets the cache when the cut's clips change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctl, item.id, prevId, signature],
  );
  return useMemo(() => ({ rest, load }), [rest, load]);
}

/**
 * Plays an engine flip-book on a canvas while its tile is hovered or focused (and while chosen):
 * `hold` seconds on the first frame, `play` seconds through, `after` seconds on the last, repeat.
 * Shows `rest` (or nothing — the tile's own still shows through) otherwise.
 */
function FlipCanvas({
  load,
  loadKey,
  rest = null,
  timing = { hold: 0.25, play: 1, after: 0.45 },
}: {
  load: (() => Promise<ImageBitmap[] | null>) | null;
  loadKey: string;
  rest?: ImageBitmap | null;
  timing?: { hold: number; play: number; after: number };
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const draw = useCallback((bitmap: ImageBitmap | null) => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g || !bitmap) return false;
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    try {
      g.drawImage(bitmap, 0, 0);
      return true;
    } catch {
      return false; // closed: the clip changed
    }
  }, []);

  useEffect(() => {
    if (!playing) draw(rest);
  }, [rest, playing, draw]);

  useEffect(() => {
    const tile = canvasRef.current?.closest<HTMLElement>('[role="radio"]');
    if (!tile || !loadKey) return;
    let frame = 0;
    let active = false;
    let token = 0;
    const stop = () => {
      active = false;
      token++;
      cancelAnimationFrame(frame);
      setPlaying(false);
    };
    const start = () => {
      if (active || !loadRef.current) return;
      active = true;
      const mine = ++token;
      void loadRef.current().then((bitmaps) => {
        if (mine !== token || !bitmaps?.length) return;
        setPlaying(true);
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const began = performance.now();
        const cycle = timing.hold + timing.play + timing.after;
        const loop = (now: number) => {
          if (mine !== token) return;
          const t = ((now - began) / 1000) % cycle;
          const p = reduce ? 0.5 : Math.min(1, Math.max(0, (t - timing.hold) / timing.play));
          if (!draw(bitmaps[Math.round(p * (bitmaps.length - 1))] ?? null)) return;
          if (!reduce) frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
      });
    };
    const chosen = tile.getAttribute('aria-checked') === 'true';
    const leave = () => {
      if (!chosen) stop();
    };
    tile.addEventListener('pointerenter', start);
    tile.addEventListener('pointerleave', leave);
    tile.addEventListener('focus', start);
    tile.addEventListener('blur', leave);
    if (chosen) start();
    return () => {
      stop();
      tile.removeEventListener('pointerenter', start);
      tile.removeEventListener('pointerleave', leave);
      tile.removeEventListener('focus', start);
      tile.removeEventListener('blur', leave);
    };
    // Timing is constant per tile kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, draw]);

  return (
    <canvas
      ref={canvasRef}
      className="vu-flip"
      data-playing={playing || undefined}
      data-rest={rest ? '' : undefined}
    />
  );
}

/**
 * A transition tile. At rest: clip A and clip B side by side. On hover or focus (and while
 * chosen): the real transition on this cut, from the engine.
 */
function TransitionTile({
  family,
  transition,
  flipbook,
}: {
  family: string;
  transition?: Transition;
  flipbook?: Flipbooks;
}): ReactElement {
  const key = transition ? JSON.stringify(transition) : '';
  return (
    <span className="vu-trx" data-family={family} aria-hidden="true">
      <span className="vu-trx-a" />
      <span className="vu-trx-b" />
      {flipbook ? (
        <FlipCanvas
          load={transition ? () => flipbook.load(transition) : null}
          loadKey={transition ? `${key}:${flipbook.rest ? 1 : 0}` : ''}
          rest={flipbook.rest}
        />
      ) : null}
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
  const { transition, transitionNote, hasClips } = useTargets();
  useAutoSelect(transition?.id ?? null);
  if (!transition || !('transitionIn' in transition)) {
    return (
      <EmptyState
        icon="transition"
        title={transitionNote ?? l.transitionsNeedTwo}
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
  return <TransitionChoices item={transition} note={transitionNote} />;
}

function TransitionChoices({
  item,
  note,
}: {
  item: Extract<Item, { transitionIn: unknown }>;
  note: string | null;
}) {
  const ctl = useController();
  const l = useLabels();
  const current = item.transitionIn;
  const preset = current ? findTransitionPreset(current.type) : undefined;
  const flipbook = useFlipbooks(item);

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
    ctl.select(item.id, { keepPanel: true });
    if (type) preview(duration);
  };

  return (
    <div className="vu-looks">
      <p className="vu-target" data-active="">
        {l.transitionsFor(itemTitle(item, ctl.project.assets))}
      </p>
      {note ? <p className="vu-hint">{note}</p> : null}
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
          <EasePicker
            value={current.ease ?? preset.ease}
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
            recipe={(d, v) => setTransition(d, item.id, { ...current, duration: fromSeconds(v) })}
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
      <div className="vu-transition-grid" role="radiogroup" aria-label={l.transition}>
        <button
          type="button"
          role="radio"
          aria-checked={current === null}
          className="vu-transition-tile"
          onClick={() => choose(null)}
        >
          <TransitionTile family="cut" flipbook={flipbook} />
          <span>{l.cut}</span>
        </button>
      </div>
      <CategoryBrowser
        label={l.category}
        categories={TRANSITION_CATEGORIES}
        initial={preset?.category ?? null}
      >
        {(c) => (
          <div className="vu-transition-grid" role="radiogroup" aria-label={c.label}>
            {TRANSITION_PRESETS.filter((p) => p.category === c.id).map((p) => (
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
                  flipbook={flipbook}
                  transition={{
                    type: p.id,
                    duration:
                      preset?.id === p.id && current
                        ? current.duration
                        : fromSeconds(p.defaultDuration ?? 0.6),
                    ...(preset?.id === p.id && current
                      ? {
                          ...(current.direction ? { direction: current.direction } : {}),
                          ...(current.ease ? { ease: current.ease } : {}),
                        }
                      : p.directions?.[0]
                        ? { direction: p.directions[0] }
                        : {}),
                  }}
                />
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        )}
      </CategoryBrowser>
    </div>
  );
}

// ── Animations ────────────────────────────────────────────────────────────

type Animatable = Extract<Item, { kind: 'text' | 'sticker' | 'video' | 'image' | 'freeze' }>;

type AnimationBooks = {
  /** The element at rest (no animation), drawn on every tile. */
  rest: ImageBitmap | null;
  load: (presetId: string) => Promise<ImageBitmap[] | null>;
};

/**
 * Animation picker previews: the real element drawn by the engine — once at rest for every tile,
 * and as a flip-book of each animation on first hover (a few kept). All closed when the panel
 * closes or the element's look changes.
 */
function useAnimationBooks(item: Animatable, slot: AnimationSlot): AnimationBooks {
  const ctl = useController();
  const signature = JSON.stringify([
    item.id,
    item.duration,
    'text' in item ? item.text : null,
    'style' in item ? item.style : null,
    'filter' in item ? item.filter : null,
    'crop' in item ? item.crop : null,
    'emoji' in item ? item.emoji : null,
  ]);
  const [rest, setRest] = useState<ImageBitmap | null>(null);
  const cache = useRef(new Map<string, Promise<ImageBitmap[] | null>>());
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const root = document.querySelector('.vu-root');
    const bg =
      (root && getComputedStyle(root).getPropertyValue('--vu-surface-3').trim()) || '#26262d';
    return { w: Math.round((FLIP_W * dpr) / 2), h: Math.round((FLIP_H * dpr) / 2), bg };
  };
  useEffect(() => {
    const engine = ctl.engine;
    const map = cache.current;
    let live = true;
    let still: ImageBitmap | null = null;
    if (engine) {
      const { w, h, bg } = size();
      void engine
        .itemPreview(item.id, null, [item.start + Math.floor(item.duration / 2)], w, h, bg)
        .then(([b]) => {
          if (!b) return;
          if (!live) return b.close();
          still = b;
          setRest(b);
        })
        .catch(() => {});
    }
    return () => {
      live = false;
      still?.close();
      setRest(null);
      for (const p of map.values()) void p.then((b) => b?.forEach((x) => x.close()));
      map.clear();
    };
    // `signature` captures what the picture depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, signature]);

  const load = useCallback(
    (presetId: string) => {
      const engine = ctl.engine;
      if (!engine) return Promise.resolve(null);
      const key = `${slot}:${presetId}`;
      const map = cache.current;
      const hit = map.get(key);
      if (hit) return hit;
      const p = findAnimationPreset(slot, presetId);
      const end = item.start + item.duration;
      const duration = Math.min(item.duration, fromSeconds(p?.defaultDuration ?? 0.5));
      const span = slot === 'loop' ? Math.min(item.duration, fromSeconds(1.6)) : duration;
      const from = slot === 'out' ? end - span : item.start;
      const times = Array.from({ length: FLIP_FRAMES }, (_, i) =>
        Math.round(from + (span * i) / (FLIP_FRAMES - 1)),
      );
      const animation =
        slot === 'loop'
          ? { loop: { type: presetId, speed: 1 } }
          : { [slot]: { type: presetId, duration } };
      const { w, h, bg } = size();
      const next = engine.itemPreview(item.id, animation, times, w, h, bg).catch(() => null);
      map.set(key, next);
      while (map.size > FLIP_CACHE) {
        const [oldKey, old] = map.entries().next().value!;
        map.delete(oldKey);
        void old.then((b) => b?.forEach((x) => x.close()));
      }
      return next;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctl, slot, signature],
  );
  return { rest, load };
}

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
  const currentId = value?.type ?? null;
  const books = useAnimationBooks(item, slot);

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
      <div className="vu-transition-grid" role="radiogroup" aria-label={l.animate}>
        <button
          type="button"
          role="radio"
          aria-checked={currentId === null}
          className="vu-transition-tile"
          onClick={() => choose(null)}
        >
          <span className="vu-trx vu-anx-tile" aria-hidden="true">
            <FlipCanvas load={null} loadKey="" rest={books.rest} />
          </span>
          <span>{l.none}</span>
        </button>
      </div>
      <CategoryBrowser
        key={slot}
        label={l.category}
        categories={categories}
        initial={currentId ? (findAnimationPreset(slot, currentId)?.category ?? null) : null}
      >
        {(c) => (
          <div className="vu-transition-grid" role="radiogroup" aria-label={c.label}>
            {forSlot
              .filter((p) => p.category === c.id)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={currentId === p.id}
                  className="vu-transition-tile"
                  data-tooltip={p.label}
                  onClick={() => choose(p.id)}
                >
                  <span className="vu-trx vu-anx-tile" aria-hidden="true">
                    <FlipCanvas
                      load={() => books.load(p.id)}
                      loadKey={`${slot}:${p.id}:${books.rest ? 1 : 0}`}
                      rest={books.rest}
                      timing={
                        slot === 'loop'
                          ? { hold: 0, play: 1.6, after: 0 }
                          : slot === 'out'
                            ? { hold: 0.35, play: 0.9, after: 0.35 }
                            : { hold: 0.35, play: 0.9, after: 0.6 }
                      }
                    />
                  </span>
                  <span>{p.label}</span>
                </button>
              ))}
          </div>
        )}
      </CategoryBrowser>
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
