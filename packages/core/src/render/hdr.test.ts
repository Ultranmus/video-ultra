import { describe, expect, it } from 'vitest';
import { HDR_CALIBRATIONS } from './hdr-calibration';
import {
  browserEngine,
  curvePixels,
  hdrCalibrationFor,
  UNIFORM_FLOATS,
  writeHdrUniforms,
} from './hdr';

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/155.0.0.0 Mobile/15E148 Safari/604.1',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0',
};

describe('browserEngine', () => {
  it('tells Chromium, WebKit and Gecko apart', () => {
    expect(browserEngine(UA.chromeMac)).toBe('chromium');
    expect(browserEngine(UA.chromeAndroid)).toBe('chromium');
    expect(browserEngine(UA.edge)).toBe('chromium');
    expect(browserEngine(UA.safariMac)).toBe('webkit');
    expect(browserEngine(UA.safariIphone)).toBe('webkit');
    expect(browserEngine(UA.firefox)).toBe('gecko');
  });

  it('treats every iPhone browser as WebKit (Chrome on iOS uses WebKit inside)', () => {
    expect(browserEngine(UA.chromeIphone)).toBe('webkit');
  });
});

describe('HDR calibration', () => {
  it('picks the measured calibration per engine and path', () => {
    expect(hdrCalibrationFor('chromium', 'webgpu')).toMatchObject({
      key: 'chromium-webgpu',
      verified: true,
    });
    expect(hdrCalibrationFor('chromium', 'webgl2')).toMatchObject({
      key: 'chromium-webgl2',
      verified: true,
    });
    expect(hdrCalibrationFor('webkit', 'webgl2')).toMatchObject({
      key: 'webkit-webgl2',
      verified: true,
    });
    expect(hdrCalibrationFor('webkit', 'webgpu')).toMatchObject({ verified: false });
  });

  it('decodes curves into 256 monotonic RGBA pixels that start near black', () => {
    for (const calibration of Object.values(HDR_CALIBRATIONS)) {
      const px = curvePixels(calibration);
      expect(px).toHaveLength(1024);
      for (let c = 0; c < 3; c++) {
        expect(px[c]).toBe(0); // pure black stays black
        expect(px[16 * 4 + c]).toBeLessThan(40); // no lifted or flat foot in the shadows
        for (let i = 1; i < 256; i++)
          expect(px[i * 4 + c]).toBeGreaterThanOrEqual(px[(i - 1) * 4 + c]!);
      }
    }
  });

  it('lays out the uniform block like the shader (vec4-aligned)', () => {
    const u = new Float32Array(UNIFORM_FLOATS);
    const calibration = HDR_CALIBRATIONS['chromium-webgl2'];
    writeHdrUniforms(u, calibration, true);
    expect(u[4]).toBe(1);
    expect(Array.from(u.slice(8, 11))).toEqual(calibration.matrix[0].map((v) => Math.fround(v)));
    expect(u[11]).toBe(0);
    writeHdrUniforms(u, calibration, false);
    expect(u[4]).toBe(0);
  });
});
