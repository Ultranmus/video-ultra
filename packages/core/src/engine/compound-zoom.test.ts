import { describe, expect, it } from 'vitest';
import { NO_CROP } from '../model/project';
import { COMPOUND_MAX_ZOOM, compoundZoom } from './compose';

const look = (scale: number, fit: 'fit' | 'fill' = 'fit', crop = NO_CROP) => ({
  transform: { scale },
  crop,
  fit,
});

describe('combined clip target size', () => {
  it('stays at the fitted size up to 1× (and just above)', () => {
    expect(compoundZoom(1080, 1920, 1080, 1920, look(1))).toBe(1);
    expect(compoundZoom(1080, 1920, 1080, 1920, look(0.5))).toBe(1);
    expect(compoundZoom(1080, 1920, 1080, 1920, look(1.04))).toBe(1);
  });

  it('grows with the zoom in quarter steps, capped', () => {
    expect(compoundZoom(1080, 1920, 1080, 1920, look(1.3))).toBe(1.5);
    expect(compoundZoom(1080, 1920, 1080, 1920, look(1.5))).toBe(1.5);
    expect(compoundZoom(1080, 1920, 1080, 1920, look(5))).toBe(COMPOUND_MAX_ZOOM);
  });

  it('counts fill and crop (the picture shown bigger than fitted)', () => {
    // A 16:9 inside filling a 9:16 output: 1920 / 1080 × wider.
    expect(compoundZoom(1080, 608, 1080, 1920, look(1, 'fill'))).toBe(COMPOUND_MAX_ZOOM);
    // Half of it cropped away, shown at the same size: twice as big.
    const half = { left: 0.25, right: 0.25, top: 0.25, bottom: 0.25 };
    expect(compoundZoom(1080, 1920, 1080, 1920, look(1, 'fit', half))).toBe(2);
  });
});
