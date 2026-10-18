import { describe, expect, it } from 'vitest';
import { alignOffsets, boundsOf, distributeOffsets, unionBounds } from './arrange';
import type { Box } from './geometry';

const box = (cx: number, cy: number, width: number, height: number, rotation = 0): Box => ({
  cx,
  cy,
  width,
  height,
  rotation,
});

describe('align and distribute', () => {
  it('bounds a rotated box', () => {
    const b = boundsOf(box(50, 50, 20, 10, 90));
    expect(b.left).toBeCloseTo(45);
    expect(b.right).toBeCloseTo(55);
    expect(b.top).toBeCloseTo(40);
    expect(b.bottom).toBeCloseTo(60);
    expect(unionBounds([boundsOf(box(10, 10, 4, 4)), boundsOf(box(30, 20, 4, 4))])).toEqual({
      left: 8,
      top: 8,
      right: 32,
      bottom: 22,
    });
  });

  it('one element lines up with the frame', () => {
    const [left] = alignOffsets([box(50, 50, 20, 10)], 'left', 200, 100);
    expect(left).toEqual({ dx: -40, dy: 0 });
    const [centre] = alignOffsets([box(50, 50, 20, 10)], 'center', 200, 100);
    expect(centre).toEqual({ dx: 50, dy: 0 });
    const [bottom] = alignOffsets([box(50, 50, 20, 10)], 'bottom', 200, 100);
    expect(bottom).toEqual({ dx: 0, dy: 45 });
  });

  it('several line up with each other', () => {
    const boxes = [box(20, 20, 10, 10), box(60, 40, 20, 20)];
    expect(alignOffsets(boxes, 'left', 200, 100)).toEqual([
      { dx: 0, dy: 0 },
      { dx: -35, dy: 0 },
    ]);
    expect(alignOffsets(boxes, 'middle', 200, 100)).toEqual([
      { dx: 0, dy: 12.5 },
      { dx: 0, dy: -7.5 },
    ]);
  });

  it('spaces three or more evenly, keeping the outer ones', () => {
    const boxes = [box(100, 0, 20, 10), box(10, 0, 20, 10), box(30, 0, 20, 10)];
    // Spans 0…110; sizes 60; two gaps of 25 → lefts 0, 45, 90.
    expect(distributeOffsets(boxes, 'x')).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 25, dy: 0 },
    ]);
    expect(distributeOffsets(boxes.slice(0, 2), 'x')).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
  });
});
