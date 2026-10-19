import {
  findItem,
  setAnimation,
  setSpeed,
  setTransition,
  updateItem,
  type EditContext,
  type Item,
  type Project,
} from '@video-ultra/core';
import type { EditorController } from './controller';

/**
 * Editing several at once (DECISIONS #153). The tools edit one item; inside the multi-selection
 * inspector they get a controller whose edits (and live previews) also reach every other selected
 * item that has the same setting: whatever the tool changed on its item — speed, sound, fades,
 * effects, filter, adjustments, blend, opacity, transition in, entrance / exit — is set the same way on the
 * others. Speed goes through `setSpeed` (so later clips on the main track move up); everything
 * else through `updateItem` / `setAnimation`, one field at a time, so a field an item doesn't have
 * is simply skipped. One undo step for all.
 */

/** Settings that may be copied across (never place, size, timing, text or identity). */
const SHARED = new Set([
  'volume',
  'muted',
  'fadeIn',
  'fadeOut',
  'duck',
  'audioFx',
  'filter',
  'adjust',
  'blend',
  'lut',
]);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * After `recipe` ran on `draft`: copies what changed on the one selected item it edited (as
 * against `base`) to the other selected items. Pure on the draft; exported for tests.
 */
export function spread(
  base: Project,
  draft: Project,
  ids: readonly string[],
  ctx: EditContext,
): void {
  const changed: { before: Item; after: Item }[] = [];
  for (const id of ids) {
    const before = findItem(base, id)?.item;
    const after = findItem(draft, id)?.item;
    // A clip moving along (a speed change ripples later ones) isn't an edit of that clip.
    if (before && after && !same({ ...before, start: 0 }, { ...after, start: 0 }))
      changed.push({ before, after });
  }
  // Only a change to exactly one item is spread (a tool that already acts on several — group
  // moves, align — is left alone).
  if (changed.length !== 1) return;
  const { before, after } = changed[0]!;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const was = before as Record<string, unknown>;
  const now = after as Record<string, unknown>;
  const others = ids.filter((id) => id !== after.id);
  for (const id of others) {
    const target = findItem(draft, id)?.item;
    if (!target || target.locked) continue;
    const t = target as Record<string, unknown>;
    for (const key of keys) {
      if (same(was[key], now[key])) continue;
      try {
        if (key === 'speed' && 'speed' in target) {
          setSpeed(draft, id, now.speed as number, ctx.ids);
        } else if (SHARED.has(key)) {
          // A setting the tool removed: "off" for each field's own kind.
          const off = key === 'duck' ? 0 : null;
          const value = now[key] === undefined ? off : clone(now[key]);
          updateItem(draft, id, { [key]: value });
        } else if (key === 'transitionIn' && 'transitionIn' in target) {
          // The same transition into each selected clip that has a cut before it.
          setTransition(draft, id, clone(now.transitionIn ?? null) as never);
        } else if (key === 'animation' && 'transform' in target) {
          const a = (was.animation ?? {}) as Record<string, unknown>;
          const b = (now.animation ?? {}) as Record<string, unknown>;
          for (const slot of ['in', 'out', 'loop'] as const)
            if (!same(a[slot], b[slot]))
              setAnimation(draft, id, slot, clone(b[slot] ?? null) as never);
        } else if (key === 'transform' && 'transform' in target) {
          // Opacity is the one transform setting shared (place, size and turn stay each item's).
          const from = was.transform as { opacity: number };
          const to = now.transform as { opacity: number };
          if (from.opacity !== to.opacity)
            updateItem(draft, id, {
              transform: { ...(t.transform as object), opacity: to.opacity } as never,
            });
        }
      } catch {
        // This item can't take that setting (another kind): it keeps its own.
      }
    }
  }
}

/**
 * The controller as seen by tools acting on several selected items: every call made through it
 * runs with the controller's fan-out on, so the edits it makes (directly or inside a controller
 * method, like `applyFilter`) are spread to all of them (see {@link spread}).
 */
export function fanOutController(ctl: EditorController, ids: readonly string[]): EditorController {
  return new Proxy(ctl, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function') return value;
      // Methods use private fields: call them on the controller itself, fan-out on meanwhile.
      return (...args: unknown[]) => {
        const before = target.fanOut;
        target.fanOut = ids;
        try {
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        } finally {
          target.fanOut = before;
        }
      };
    },
  });
}
