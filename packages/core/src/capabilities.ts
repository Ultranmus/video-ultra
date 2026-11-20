// Plain WebCodecs checks (no media library) keep this module tiny; they run in a small worker.
import { probeCodecsOffMain } from './codec-probe';

/** Performance tier of the current device. Sets preview resolution, export limits and cache sizes. */
export type DeviceTier = 'high' | 'mid' | 'low';

/** What the current browser and device can do. Produced by {@link detectCapabilities}. */
export interface Capabilities {
  /** `navigator.gpu` exists and an adapter could be requested. */
  webgpu: boolean;
  /** A WebGL2 context can be created. */
  webgl2: boolean;
  /** `VideoDecoder`, `VideoEncoder`, `AudioDecoder` and `AudioEncoder` exist. */
  webcodecs: { video: boolean; audio: boolean };
  /** `OffscreenCanvas` exists and can be transferred to a worker. */
  offscreenCanvas: boolean;
  /** Origin Private File System is available. */
  opfs: boolean;
  /** File System Access API (`showOpenFilePicker`) is available — Chromium desktop only. */
  fileSystemAccess: boolean;
  /** Video codecs the device can decode at 1080p. */
  decode: { avc: boolean; hevc: boolean; vp9: boolean; av1: boolean };
  /** Codecs the device can encode. */
  encode: { avc1080: boolean; avc4k: boolean; vp9: boolean; aac: boolean; opus: boolean };
  /** Approximate RAM in GB (`navigator.deviceMemory`), or `null` when the browser hides it. */
  deviceMemoryGb: number | null;
  /** Logical CPU cores. */
  cores: number;
  /** Phone or tablet. */
  mobile: boolean;
  /** GPU description, when the browser exposes it. */
  gpu: string | null;
  /** Suggested performance tier. */
  tier: DeviceTier;
  /** Everything needed to edit video is present. */
  supported: boolean;
}

/**
 * Detects what the current browser and device support and suggests a {@link DeviceTier}.
 * Runs in the browser only; takes a few milliseconds (codec checks are async).
 */
export async function detectCapabilities(): Promise<Capabilities> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean };
    gpu?: GPU;
  };

  const webcodecs = {
    video: typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined',
    audio: typeof AudioDecoder !== 'undefined' && typeof AudioEncoder !== 'undefined',
  };
  // Codec checks start first, in their worker, while the GPU is asked about below.
  const probing = probeCodecsOffMain();
  const offscreenCanvas =
    typeof OffscreenCanvas !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'transferControlToOffscreen' in HTMLCanvasElement.prototype;

  let webgpu = false;
  let gpu: string | null = null;
  if (nav.gpu) {
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) {
        webgpu = true;
        const info = adapter.info;
        gpu = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || null;
      }
    } catch {
      webgpu = false;
    }
  }

  let webgl2 = false;
  await new Promise<void>((r) => setTimeout(r, 0));
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
    if (gl) {
      webgl2 = true;
      if (!gpu) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    webgl2 = false;
  }

  const { decode, encode } = await probing;

  const opfs = typeof nav.storage?.getDirectory === 'function';
  const fileSystemAccess =
    typeof (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
  const deviceMemoryGb = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  const cores = nav.hardwareConcurrency || 4;
  const mobile =
    nav.userAgentData?.mobile ??
    (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) ||
      // iPadOS reports itself as a Mac; touch points give it away.
      (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1));

  const capabilities: Omit<Capabilities, 'tier' | 'supported'> = {
    webgpu,
    webgl2,
    webcodecs,
    offscreenCanvas,
    opfs,
    fileSystemAccess,
    decode,
    encode,
    deviceMemoryGb,
    cores,
    mobile,
    gpu,
  };
  return {
    ...capabilities,
    tier: suggestTier({
      ...capabilities,
      ios:
        /iPhone|iPad|iPod/.test(nav.userAgent) ||
        (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1),
    }),
    supported: webcodecs.video && offscreenCanvas && (webgpu || webgl2) && decode.avc,
  };
}

/** Tier rules. Deliberately conservative: a wrong "low" costs some sharpness, a wrong "high" costs crashes. */
function suggestTier(
  c: Pick<Capabilities, 'deviceMemoryGb' | 'cores' | 'mobile'> & { ios: boolean },
): DeviceTier {
  const memory = c.deviceMemoryGb;
  // Safari on iOS reports a fixed, low core count and no memory size, so those numbers say nothing
  // there; an iPhone that passes the support checks (iOS 17+) played 4K60 HDR smoothly in tests.
  if (c.ios) return 'mid';
  if ((memory !== null && memory <= 3) || c.cores <= 4) return 'low';
  if (c.mobile) return 'mid';
  if ((memory === null || memory >= 8) && c.cores >= 8) return 'high';
  return 'mid';
}
