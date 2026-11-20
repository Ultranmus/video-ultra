/**
 * The codec checks of `detectCapabilities` (plain WebCodecs, no media library), as run by the
 * probe worker (`probe-worker.ts`) or the main thread. Kept apart from `codec-probe.ts`, which
 * starts that worker: the worker's code must not include its own `new Worker(...)` — the Next.js
 * production build followed that circle forever (2026-11-21).
 */

const CODEC = {
  avc1080: 'avc1.640028', // H.264 High, level 4.0
  avc4k: 'avc1.640033', // H.264 High, level 5.1
  hevc: 'hvc1.1.6.L120.90', // HEVC Main, level 4.0
  vp9: 'vp09.00.40.08',
  av1: 'av01.0.08M.08',
} as const;

/** What the codec checks found (all false where WebCodecs is missing). */
export interface CodecSupport {
  /** `VideoDecoder` / `VideoEncoder` and `AudioDecoder` / `AudioEncoder` exist here. */
  webcodecs: { video: boolean; audio: boolean };
  decode: { avc: boolean; hevc: boolean; vp9: boolean; av1: boolean };
  encode: { avc1080: boolean; avc4k: boolean; vp9: boolean; aac: boolean; opus: boolean };
}

async function decodes(codec: string, width: number, height: number): Promise<boolean> {
  return (
    (await VideoDecoder.isConfigSupported({ codec, codedWidth: width, codedHeight: height }))
      .supported === true
  );
}

async function encodes(codec: string, width: number, height: number): Promise<boolean> {
  return (
    (
      await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 8_000_000,
        framerate: 30,
      })
    ).supported === true
  );
}

async function encodesAudio(codec: string): Promise<boolean> {
  return (
    (
      await AudioEncoder.isConfigSupported({
        codec,
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128_000,
      })
    ).supported === true
  );
}

/**
 * Runs every codec check, started one task apart (still at the same time) so no two add up to
 * one long task where this runs on the main thread.
 */
export async function probeCodecs(): Promise<CodecSupport> {
  const webcodecs = {
    video: typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined',
    audio: typeof AudioDecoder !== 'undefined' && typeof AudioEncoder !== 'undefined',
  };
  const safe = async (check: () => Promise<boolean>): Promise<boolean> => {
    if (!webcodecs.video) return false;
    try {
      return await check();
    } catch {
      return false;
    }
  };
  const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));
  const checks: (() => Promise<boolean>)[] = [
    () => safe(() => decodes(CODEC.avc1080, 1920, 1080)),
    () => safe(() => decodes(CODEC.hevc, 1920, 1080)),
    () => safe(() => decodes(CODEC.vp9, 1920, 1080)),
    () => safe(() => decodes(CODEC.av1, 1920, 1080)),
    () => safe(() => encodes(CODEC.avc1080, 1920, 1080)),
    () => safe(() => encodes(CODEC.avc4k, 3840, 2160)),
    () => safe(() => encodes(CODEC.vp9, 1920, 1080)),
    () => safe(() => (webcodecs.audio ? encodesAudio('mp4a.40.2') : Promise.resolve(false))),
    () => safe(() => (webcodecs.audio ? encodesAudio('opus') : Promise.resolve(false))),
  ];
  const running: Promise<boolean>[] = [];
  for (const check of checks) {
    running.push(check());
    await yieldTask();
  }
  const r = (await Promise.all(running)).map((x) => x === true);
  return {
    webcodecs,
    decode: { avc: r[0]!, hevc: r[1]!, vp9: r[2]!, av1: r[3]! },
    encode: { avc1080: r[4]!, avc4k: r[5]!, vp9: r[6]!, aac: r[7]!, opus: r[8]! },
  };
}
