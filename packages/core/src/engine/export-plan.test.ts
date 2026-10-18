import { describe, expect, it } from 'vitest';
import { fromSeconds } from '../model/time';
import {
  audioFramesFor,
  exportAudioBitrate,
  exportBitrate,
  exportFrameCount,
  exportFrameTime,
  exportSize,
  maxExportHeight,
} from './export-plan';

describe('export bitrates', () => {
  it('scale with picture size, frame rate and quality, the same in every browser', () => {
    const b = (h: number, fps: number, q: 'low' | 'medium' | 'high') =>
      exportBitrate((h * 16) / 9, h, fps, q);
    expect(b(1080, 30, 'medium')).toBeCloseTo(5_598_720, -3); // ≈ 5.6 Mb/s
    expect(b(1080, 60, 'medium')).toBe(2 * b(1080, 30, 'medium'));
    expect(b(720, 30, 'low')).toBeLessThan(b(720, 30, 'medium'));
    expect(b(720, 30, 'medium')).toBeLessThan(b(720, 30, 'high'));
    expect(exportBitrate(1920, 1080, 30, 'medium', 'vp9')).toBeLessThan(b(1080, 30, 'medium'));
    expect(exportBitrate(16, 16, 24, 'low')).toBe(400_000); // floor
    expect(exportAudioBitrate('medium')).toBe(128_000);
  });
});

describe('export plan', () => {
  it('uses the shorter side as the height setting', () => {
    expect(exportSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(exportSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(exportSize(1080, 1080, 480)).toEqual({ width: 480, height: 480 });
    // 4:5 at 1080 → 1080 × 1350; 21:9 rounds to even pixels.
    expect(exportSize(1080, 1350, 1080)).toEqual({ width: 1080, height: 1350 });
    const wide = exportSize(2520, 1080, 720);
    expect(wide.height).toBe(720);
    expect(wide.width % 2).toBe(0);
  });

  it('counts frames and places them on exact flicks', () => {
    expect(exportFrameCount(fromSeconds(17), 30)).toBe(510);
    expect(exportFrameCount(fromSeconds(17), 24)).toBe(408);
    expect(exportFrameCount(fromSeconds(0.001), 60)).toBe(1);
    for (const fps of [24, 30, 60]) {
      expect(Number.isInteger(exportFrameTime(7, fps))).toBe(true);
      expect(exportFrameTime(fps, fps)).toBe(fromSeconds(1));
    }
  });

  it('trims audio to the video length', () => {
    expect(audioFramesFor(510, 30)).toBe(17 * 48000);
    expect(audioFramesFor(1, 24)).toBe(2000);
    expect(audioFramesFor(1, 30)).toBe(1600);
  });

  it('caps resolution per tier', () => {
    expect(maxExportHeight('low')).toBe(1080);
    expect(maxExportHeight('mid')).toBe(1440);
    expect(maxExportHeight('high')).toBe(2160);
  });
});
