import { probeCodecs, type CodecSupport } from './codec-probe';

/** The codec checks of `detectCapabilities`, off the main thread (DECISIONS #211). */

declare const self: {
  postMessage(message: CodecSupport): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};

self.onmessage = () => {
  void probeCodecs().then((found) => self.postMessage(found));
};
