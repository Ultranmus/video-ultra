import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../model/project';
import { fixtureProject, imageItem, textItem } from '../test/fixtures';
import { EditError, addToLane, insertMain, updateItem } from '../edit/ops';
import { findItem } from '../model/project';
import {
  SHAPE_CATEGORIES,
  SHAPE_PRESETS,
  shapeCoverage,
  shapeDistance,
  shapePreset,
} from './shapes';

describe('shape masks', () => {
  it('has a big library: 100+ shapes with unique ids in every category', () => {
    expect(SHAPE_PRESETS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(SHAPE_PRESETS.map((p) => p.id)).size).toBe(SHAPE_PRESETS.length);
    for (const c of SHAPE_CATEGORIES)
      expect(SHAPE_PRESETS.filter((p) => p.category === c).length).toBeGreaterThan(5);
  });

  it('every shape covers part of a 2:1 picture and leaves part of it out', () => {
    for (const p of SHAPE_PRESETS) {
      let inside = 0;
      const n = 60;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
          inside += shapeCoverage(
            p,
            ((x + 0.5) / n) * 2 - 1,
            ((y + 0.5) / n) * 2 - 1,
            2,
            0.02,
            0,
            false,
          );
      const share = inside / (n * n);
      expect(share, p.id).toBeGreaterThan(0.05);
      // Stretched shapes fill the box but for their rounded corners; the rest fit the height.
      expect(share, p.id).toBeLessThan(p.stretch ? 1 : 0.6);
    }
  });

  it('is negative inside and positive far outside', () => {
    for (const p of SHAPE_PRESETS) {
      expect(shapeDistance(p, 3, 3), p.id).toBeGreaterThan(0);
      expect(Number.isFinite(shapeDistance(p, 0.01, 0.02)), p.id).toBe(true);
    }
    expect(shapeDistance(shapePreset('circle')!, 0, 0)).toBeLessThan(0);
    expect(shapeDistance(shapePreset('ring')!, 0, 0)).toBeGreaterThan(0); // the hole
  });

  it('keeps proportions on a wide picture unless the shape stretches', () => {
    const circle = shapePreset('circle')!;
    const oval = shapePreset('oval')!;
    // Near the left edge of a 2:1 box: outside the circle (it fits the height), inside the oval.
    expect(shapeCoverage(circle, -0.9, 0, 2, 0.01, 0, false)).toBe(0);
    expect(shapeCoverage(oval, -0.9, 0, 2, 0.01, 0, false)).toBe(1);
  });

  it('inverts and feathers', () => {
    const circle = shapePreset('circle')!;
    expect(shapeCoverage(circle, 0, 0, 1, 0.01, 0, true)).toBe(0);
    const soft = shapeCoverage(circle, 0.97, 0, 1, 0.01, 0.4, false);
    expect(soft).toBeGreaterThan(0.05);
    expect(soft).toBeLessThan(0.95);
  });

  it('is an item property: set, clamped, removed; unknown shapes and text are refused', () => {
    const ids = sequentialIds('n');
    const project = fixtureProject();
    insertMain(project, imageItem('a', 3));
    addToLane(project, textItem('t', 0), ids);
    updateItem(project, 'a', { mask: { shape: 'heart', feather: 3 } });
    const item = findItem(project, 'a')!.item;
    expect('mask' in item && item.mask).toEqual({ shape: 'heart', feather: 1 });
    expect(() => updateItem(project, 'a', { mask: { shape: 'nope', feather: 0 } })).toThrow(
      EditError,
    );
    expect(() => updateItem(project, 't', { mask: { shape: 'heart', feather: 0 } })).toThrow(
      EditError,
    );
    updateItem(project, 'a', { mask: null });
    expect('mask' in findItem(project, 'a')!.item).toBe(false);
  });
});
