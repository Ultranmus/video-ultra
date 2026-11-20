/**
 * Runs the codec checks (`codec-checks.ts`) in a small worker (`probe.worker.js`): in Chrome a 4K
 * H.264 encoder check alone takes ~50 ms of synchronous work, too long for the main thread
 * (DECISIONS #211). Where workers can't do it, the main thread runs them one task apart.
 */
import { probeCodecs, type CodecSupport } from './codec-checks';

export type { CodecSupport } from './codec-checks';

/** Longest wait for the probe worker before the main thread checks itself (ms). */
const WORKER_WAIT_MS = 5000;

/**
 * The codec checks, in a worker where one can run them; else (no workers, no WebCodecs in
 * workers, the worker failed or took too long) on the main thread.
 */
export async function probeCodecsOffMain(): Promise<CodecSupport> {
  const video = typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined';
  // Nothing to check (all false), or nowhere else to check it.
  if (!video || typeof Worker === 'undefined') return probeCodecs();
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./probe.worker.js', import.meta.url), { type: 'module' });
    const w = worker;
    const found = await new Promise<CodecSupport | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), WORKER_WAIT_MS);
      w.onmessage = (e: MessageEvent<CodecSupport>) => {
        clearTimeout(timer);
        resolve(e.data);
      };
      w.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      w.postMessage('probe');
    });
    // Workers without WebCodecs (older engines) can't answer for the page.
    if (found?.webcodecs.video) return found;
  } catch {
    /* no module workers here */
  } finally {
    worker?.terminate();
  }
  return probeCodecs();
}
