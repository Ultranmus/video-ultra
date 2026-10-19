import { describe, expect, it } from 'vitest';
import { fixtureProject, imageItem, textItem } from '../test/fixtures';
import { DEFAULT_TRANSFORM, findItem, sequentialIds } from './project';
import { fromSeconds as s } from './time';
import {
  EditError,
  addToLane,
  clearKeyframes,
  insertMain,
  moveKeyframe,
  removeKeyframe,
  setKeyframe,
  setKeyframeEase,
  splitItem,
  trimItem,
} from '../edit/ops';
import { checkInvariants } from './invariants';
import { ProjectSchema, type ImageItem, type TextItem } from './schema';
import {
  bezierAt,
  keyedTransform,
  keyedValue,
  retimeKeyframes,
  sampleKeyframes,
  type Keyframe,
} from './keyframes';

const keys = (...pairs: [number, number][]): Keyframe[] => pairs.map(([t, v]) => ({ t: s(t), v }));

describe('keyframes', () => {
  it('samples: holds before / after, eases between', () => {
    const list = keys([1, 0], [3, 10]);
    expect(sampleKeyframes(list, 0)).toBe(0);
    expect(sampleKeyframes(list, s(5))).toBe(10);
    expect(sampleKeyframes(list, s(2))).toBeCloseTo(5); // smooth is symmetric
    const linear: Keyframe[] = [
      { t: 0, v: 0, ease: 'linear' },
      { t: s(4), v: 8 },
    ];
    expect(sampleKeyframes(linear, s(1))).toBeCloseTo(2);
    const steps: Keyframe[] = [
      { t: 0, v: 0, ease: 'steps' },
      { t: s(6), v: 6 },
    ];
    expect(sampleKeyframes(steps, s(1.5))).toBeCloseTo(1);
  });

  it('cubic Bézier curves match CSS (linear and ease-in-out)', () => {
    for (const x of [0, 0.2, 0.5, 0.9, 1])
      expect(bezierAt([0.5, 0.5, 0.5, 0.5], x)).toBeCloseTo(x, 4);
    expect(bezierAt([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 4);
    expect(bezierAt([0.42, 0, 1, 1], 0.5)).toBeLessThan(0.5); // ease-in: slow start
    expect(bezierAt([0.2, 1.6, 0.8, 1.2], 0.5)).toBeGreaterThan(1); // overshoot
  });

  it('a keyed transform takes keyframed props and the rest from the item, without allocating', () => {
    const out = { ...DEFAULT_TRANSFORM };
    const base = { ...DEFAULT_TRANSFORM, x: 0.2, rotation: 15 };
    const r = keyedTransform(base, { x: keys([0, 0], [2, 1]), opacity: keys([0, 2]) }, s(1), out);
    expect(r).toBe(out);
    expect(r.x).toBeCloseTo(0.5);
    expect(r.rotation).toBe(15);
    expect(r.opacity).toBe(1); // clamped
  });

  it('edits: set (snap, replace), ease, move, remove (bakes the last value), clear', () => {
    const ids = sequentialIds('n');
    const project = fixtureProject();
    addToLane(project, textItem('t', 0, 4), ids);
    setKeyframe(project, 't', 'x', s(1) + 3, 0.1);
    setKeyframe(project, 't', 'x', s(3), 0.9);
    setKeyframe(project, 't', 'x', s(1), 0.2); // same frame: replaces
    let item = findItem(project, 't')!.item as TextItem;
    expect(item.keyframes!.x!.map((k: Keyframe) => [k.t / s(1), k.v])).toEqual([
      [1, 0.2],
      [3, 0.9],
    ]);
    setKeyframeEase(project, 't', 'x', s(1), [0.1, 0.7, 0.9, 0.3]);
    expect(item.keyframes!.x![0]!.ease).toEqual([0.1, 0.7, 0.9, 0.3]);
    moveKeyframe(project, 't', 'x', s(3), s(2), 0.7);
    expect(item.keyframes!.x!.map((k: Keyframe) => k.t / s(1))).toEqual([1, 2]);
    removeKeyframe(project, 't', 'x', s(1));
    removeKeyframe(project, 't', 'x', s(2));
    item = findItem(project, 't')!.item as TextItem;
    expect(item.keyframes).toBeUndefined();
    expect(item.transform.x).toBe(0.7);
    setKeyframe(project, 't', 'scale', 0, -5);
    expect((findItem(project, 't')!.item as TextItem).keyframes!.scale![0]!.v).toBeGreaterThan(0);
    clearKeyframes(project, 't');
    expect((findItem(project, 't')!.item as TextItem).keyframes).toBeUndefined();
    expect(() => setKeyframe(project, 't', 'volume' as never, 0, 1)).toThrow(EditError);
    expect(() => setKeyframe(project, 't', 'x', 0, Number.NaN)).toThrow(EditError);
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });

  it('split and trim keep the motion: each part moves exactly as before', () => {
    const ids = sequentialIds('n');
    const project = fixtureProject();
    insertMain(project, imageItem('a', 6));
    setKeyframe(project, 'a', 'x', 0, 0);
    setKeyframe(project, 'a', 'x', s(6), 6);
    const valueAt = (abs: number) => {
      for (const t of project.tracks)
        for (const i of t.items)
          if (i.start <= s(abs) && s(abs) < i.start + i.duration && 'keyframes' in i)
            return keyedValue(i.keyframes, 'x', s(abs) - i.start);
      return NaN;
    };
    const times = [0.5, 2, 3.5, 5];
    const before = times.map(valueAt);
    splitItem(project, 'a', s(3), ids);
    expect(times.map(valueAt)).toEqual(before);
    // Trimming 1 s off the start: the clip (now at 0) shows at 0 what it showed at 1 s.
    const at1 = valueAt(1);
    trimItem(project, 'a', 'start', s(1));
    expect(valueAt(0)).toBeCloseTo(at1!, 9);
    // New keyframes land where the part is now, in its own time.
    setKeyframe(project, 'a', 'x', s(1), 9);
    expect(keyedValue((findItem(project, 'a')!.item as ImageItem).keyframes, 'x', s(1))).toBe(9);
    expect(checkInvariants(project)).toEqual([]);
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });

  it('retimes by shifting (exact), adding to an earlier shift', () => {
    const k = retimeKeyframes({ x: keys([0, 1], [1, 2]), shift: s(1) }, s(2));
    expect(k.shift).toBe(s(3));
    expect(k.x).toHaveLength(2);
  });
});

describe('editing keyed transforms', () => {
  it('a drag at the playhead keys the keyed properties and moves the rest', async () => {
    const { setTransformAt, transformAt } = await import('../edit/ops');
    const ids = sequentialIds('n');
    const project = fixtureProject();
    addToLane(project, textItem('t', 2, 4), ids);
    setKeyframe(project, 't', 'x', 0, 0.2);
    setKeyframe(project, 't', 'x', s(4), 0.8);
    const item = () => findItem(project, 't')!.item as TextItem;
    // At 3 s on the timeline = 1 s into the item: x keyed, rotation not.
    const tf = { ...transformAt(item(), s(3))!, x: 0.1, rotation: 30 };
    setTransformAt(project, 't', tf, s(3));
    expect(item().keyframes!.x!.map((k: Keyframe) => [k.t / s(1), k.v])).toEqual([
      [0, 0.2],
      [1, 0.1],
      [4, 0.8],
    ]);
    expect(item().transform.rotation).toBe(30);
    expect(item().keyframes!.rotation).toBeUndefined();
    expect(transformAt(item(), s(3))!.x).toBeCloseTo(0.1);
  });
});
