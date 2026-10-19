import { describe, expect, it } from 'vitest';
import { proxyHeightFor, proxyKey } from './proxy';

describe('proxies', () => {
  it('only heavy videos for the device get a copy, at the tier’s size', () => {
    expect(proxyHeightFor(3840, 2160, 'mid')).toBe(720);
    expect(proxyHeightFor(2160, 3840, 'mid')).toBe(720); // portrait phone 4K
    expect(proxyHeightFor(1920, 1080, 'mid')).toBeNull();
    expect(proxyHeightFor(1920, 1080, 'low')).toBe(540);
    expect(proxyHeightFor(1280, 720, 'low')).toBeNull();
    expect(proxyHeightFor(3840, 2160, 'high')).toBeNull();
    expect(proxyHeightFor(7680, 4320, 'high')).toBe(1080);
    // Already small on its short side: nothing to gain.
    expect(proxyHeightFor(4000, 500, 'low')).toBeNull();
  });

  it('keys are safe file names, one per asset and size', () => {
    expect(proxyKey('a/b:c', 540)).toBe('a_b_c-540p.mp4');
    expect(proxyKey('x', 720)).not.toBe(proxyKey('x', 540));
  });
});
