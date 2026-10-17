import { describe, expect, it } from 'vitest';
import { HDR_CALIBRATIONS } from './hdr-calibration';
import {
  browserEngine,
  curvePixels,
  frameIsHdr,
  hdrCalibrationFor,
  LAYER_FLOATS,
  writeLayerUniforms,
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

describe('frameIsHdr', () => {
  const srgb = { transfer: 'iec61966-2-1' } as unknown as VideoColorSpace;
  const hlg = { transfer: 'hlg' } as unknown as VideoColorSpace;
  it('trusts the track flag when Safari on iOS labels HDR frames as sRGB', () => {
    expect(frameIsHdr(srgb, true)).toBe(true);
    expect(frameIsHdr(srgb, false)).toBe(false);
    expect(frameIsHdr(hlg)).toBe(true);
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
    expect(hdrCalibrationFor('webkit', 'webgpu')).toMatchObject({
      key: 'webkit-webgl2',
      verified: true,
    });
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

  it('lays out the uniforms of a layer like the shader (vec4-aligned)', () => {
    const u = new Float32Array(LAYER_FLOATS * 2);
    const calibration = HDR_CALIBRATIONS['chromium-webgl2'];
    const geometry = Float32Array.from({ length: 12 }, (_, i) => i + 1);
    writeLayerUniforms(u, LAYER_FLOATS, geometry, 0.5, true, calibration, null, 0.25, 0.5);
    const o = LAYER_FLOATS;
    expect(Array.from(u.slice(o, o + 6))).toEqual([1, 2, 3, 4, 5, 6]); // pos + posT.xy
    expect(u[o + 6]).toBe(0.5); // opacity
    expect(u[o + 7]).toBe(1); // hdr
    expect(Array.from(u.slice(o + 8, o + 14))).toEqual([7, 8, 9, 10, 11, 12]); // uv + uvT.xy
    expect(Array.from(u.slice(o + 16, o + 19))).toEqual(
      calibration.matrix[0].map((v) => Math.fround(v)),
    );
    expect(u[o + 19]).toBe(0);
    // Effect block (identity): gain 1 1 1, contrast 1 … texel size from the renderer.
    expect(Array.from(u.slice(o + 28, o + 32))).toEqual([1, 1, 1, 1]);
    expect(u[o + 28 + 7]).toBe(1); // saturation
    expect([u[o + 28 + 26], u[o + 28 + 27]]).toEqual([0.25, 0.5]);
    expect(LAYER_FLOATS * 4).toBeLessThanOrEqual(256); // fits a WebGPU uniform slot
    expect(u[0]).toBe(0); // the first slot is untouched
  });
});
