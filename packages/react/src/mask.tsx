import {
  SHAPE_CATEGORIES,
  SHAPE_PRESETS,
  findItem,
  shapeCoverage,
  updateItem,
  type Item,
  type ShapeMask,
  type ShapePreset,
} from '@video-ultra/core';
import { useEffect, useState, type ReactElement } from 'react';
import { useController, useLabels } from './context';
import { EditSlider } from './controls';
import { isPicture } from './picture';

/**
 * Shape masks (v0.3): show a picture inside a circle, star, heart… The picker's tiles are the
 * same maths as the compositor (core `shapeCoverage`), drawn once per page into small alpha
 * images and coloured by CSS tokens. Drawing is spread over frames (a few tiles per frame), so
 * opening the picker never blocks the main thread.
 */

const TILE = 40;
/** Shape id → data URL of its alpha image (shared by every editor on the page). */
const tiles = new Map<string, string>();
const waiting = new Set<() => void>();
let queue: ShapePreset[] = [];
let scheduled = false;

function drawTile(p: ShapePreset): string {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TILE, TILE);
  // Stretched shapes are shown on a landscape box, the rest on a square.
  const aspect = p.stretch ? 1.5 : 1;
  const h = p.stretch ? TILE / aspect : TILE;
  const top = (TILE - h) / 2;
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const qy = ((y + 0.5 - top) / h) * 2 - 1;
      if (Math.abs(qy) > 1) continue;
      const qx = ((x + 0.5) / TILE) * 2 - 1;
      const cov = shapeCoverage(p, qx, qy, aspect, 2.4 / TILE, 0, false);
      const i = (y * TILE + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(cov * 255);
    }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function pump(): void {
  scheduled = false;
  const until = performance.now() + 6;
  while (queue.length && performance.now() < until) {
    const p = queue.shift()!;
    if (!tiles.has(p.id)) tiles.set(p.id, drawTile(p));
  }
  for (const notify of waiting) notify();
  if (queue.length) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(pump);
}

/** Re-renders as tiles become ready; starts drawing the ones not drawn yet. */
function useTiles(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const notify = () => setTick((t) => t + 1);
    waiting.add(notify);
    if (tiles.size < SHAPE_PRESETS.length && queue.length === 0) {
      queue = SHAPE_PRESETS.filter((p) => !tiles.has(p.id));
      schedule();
    }
    return () => {
      waiting.delete(notify);
    };
  }, []);
}

/** Shape mask for a picture: a shape (or none), its soft edge and "show outside". */
export function MaskTool({ item }: { item: Item }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  useTiles();
  if (!isPicture(item)) return <p className="vu-hint">{l.pictureOnly}</p>;
  const mask = item.mask ?? null;
  const set = (next: ShapeMask | null) =>
    ctl.run(l.shape, (d) => updateItem(d, item.id, { mask: next }));
  return (
    <div className="vu-picture-tool">
      {mask ? (
        <>
          <EditSlider
            label={l.shapeFeather}
            value={mask.feather}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0}
            format={(v) => `${Math.round(v * 100)}%`}
            recipe={(d, v) => {
              const found = findItem(d, item.id)?.item;
              if (found && isPicture(found) && found.mask)
                updateItem(d, item.id, { mask: { ...found.mask, feather: v } });
            }}
            commitLabel={l.shape}
            coalesceKey={`mask:feather:${item.id}`}
          />
          <button
            type="button"
            role="switch"
            aria-checked={!!mask.invert}
            className="vu-switch-row"
            onClick={() => set({ ...mask, invert: !mask.invert })}
          >
            <span>{l.shapeInvert}</span>
            <span className="vu-switch" aria-hidden="true">
              <span className="vu-switch-knob" />
            </span>
          </button>
        </>
      ) : (
        <p className="vu-hint">{l.shapeHint}</p>
      )}
      <ul className="vu-shape-grid" aria-label={l.shape}>
        <li>
          <button
            type="button"
            className="vu-shape-tile"
            aria-pressed={!mask}
            aria-label={l.shapeNone}
            data-tooltip={l.shapeNone}
            onClick={() => set(null)}
          >
            <span className="vu-shape-none" aria-hidden="true" />
          </button>
        </li>
      </ul>
      {SHAPE_CATEGORIES.map((category) => (
        <section key={category} className="vu-shape-section">
          <h4 className="vu-shape-heading">{l.shapeCategory(category)}</h4>
          <ul className="vu-shape-grid" aria-label={l.shapeCategory(category)}>
            {SHAPE_PRESETS.filter((p) => p.category === category).map((p) => {
              const url = tiles.get(p.id);
              const name = l.shapeName(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="vu-shape-tile"
                    aria-pressed={mask?.shape === p.id}
                    aria-label={name}
                    data-tooltip={name}
                    onClick={() =>
                      set({
                        shape: p.id,
                        feather: mask?.feather ?? 0,
                        ...(mask?.invert ? { invert: true } : {}),
                      })
                    }
                  >
                    <span
                      className="vu-shape-glyph"
                      aria-hidden="true"
                      style={url ? { ['--vu-shape-url' as string]: `url(${url})` } : undefined}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
