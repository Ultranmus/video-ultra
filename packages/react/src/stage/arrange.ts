import type { Box } from './geometry';

/**
 * Align and distribute maths (pure; tested). Works on the boxes elements draw in, in canvas px,
 * and returns how far each centre moves — the caller turns that into transform changes.
 */

/** An axis-aligned rectangle in canvas px. */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where to line elements up. */
export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** A centre offset in canvas px. */
export interface Offset {
  dx: number;
  dy: number;
}

/** The upright rectangle around a (possibly rotated) box. */
export function boundsOf(box: Box): Bounds {
  const rad = (box.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const hw = (box.width * c + box.height * s) / 2;
  const hh = (box.width * s + box.height * c) / 2;
  return { left: box.cx - hw, top: box.cy - hh, right: box.cx + hw, bottom: box.cy + hh };
}

/** The rectangle around all of them. */
export function unionBounds(list: readonly Bounds[]): Bounds {
  return list.reduce(
    (u, b) => ({
      left: Math.min(u.left, b.left),
      top: Math.min(u.top, b.top),
      right: Math.max(u.right, b.right),
      bottom: Math.max(u.bottom, b.bottom),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

/**
 * Lines boxes up on an edge or centre line: one box against the canvas frame, several against
 * the rectangle around them all.
 */
export function alignOffsets(
  boxes: readonly Box[],
  edge: AlignEdge,
  canvasW: number,
  canvasH: number,
): Offset[] {
  const bounds = boxes.map(boundsOf);
  const target: Bounds =
    boxes.length === 1 ? { left: 0, top: 0, right: canvasW, bottom: canvasH } : unionBounds(bounds);
  return bounds.map((b) => {
    switch (edge) {
      case 'left':
        return { dx: target.left - b.left, dy: 0 };
      case 'right':
        return { dx: target.right - b.right, dy: 0 };
      case 'center':
        return { dx: (target.left + target.right - b.left - b.right) / 2, dy: 0 };
      case 'top':
        return { dx: 0, dy: target.top - b.top };
      case 'bottom':
        return { dx: 0, dy: target.bottom - b.bottom };
      case 'middle':
        return { dx: 0, dy: (target.top + target.bottom - b.top - b.bottom) / 2 };
    }
  });
}

/**
 * Spaces three or more boxes evenly along an axis: the first and last (by position) stay, the
 * gaps between neighbours become equal. Returns offsets in the input order.
 */
export function distributeOffsets(boxes: readonly Box[], axis: 'x' | 'y'): Offset[] {
  const out: Offset[] = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (boxes.length < 3) return out;
  const bounds = boxes.map(boundsOf);
  const lo = (b: Bounds) => (axis === 'x' ? b.left : b.top);
  const hi = (b: Bounds) => (axis === 'x' ? b.right : b.bottom);
  const order = bounds
    .map((b, i) => ({ b, i }))
    .sort((p, q) => lo(p.b) + hi(p.b) - (lo(q.b) + hi(q.b)));
  const first = order[0]!.b;
  const last = order[order.length - 1]!.b;
  const sizes = order.reduce((sum, { b }) => sum + hi(b) - lo(b), 0);
  const gap = (hi(last) - lo(first) - sizes) / (order.length - 1);
  let cursor = lo(first);
  for (const { b, i } of order) {
    const shift = cursor - lo(b);
    out[i] = axis === 'x' ? { dx: shift, dy: 0 } : { dx: 0, dy: shift };
    cursor += hi(b) - lo(b) + gap;
  }
  return out;
}
