import type { Metadata } from 'next';
import { PageNav } from '../parts';

export const metadata: Metadata = { title: 'Performance and devices' };

export default function Performance() {
  return (
    <article>
      <h1>Performance and devices</h1>
      <p className="docs-lead">
        The editor is built to stay smooth on budget phones and to keep memory flat on long 4K
        clips.
      </p>
      <ul>
        <li>
          <strong>Off the main thread:</strong> decoding, compositing, sound mixing, thumbnails,
          waveforms, captions and export run in workers or an audio worklet. The page stays
          responsive while it works.
        </li>
        <li>
          <strong>React never renders per frame:</strong> the playhead and timecode update through
          subscriptions; the timeline is a canvas.
        </li>
        <li>
          <strong>Flat memory:</strong> files are read in ranges, never whole; every decoded frame
          is closed as soon as it&apos;s drawn; caches have byte budgets per device tier.
        </li>
        <li>
          <strong>Device tiers:</strong> the editor measures the device (cores, memory, GPU) and
          sizes decoders, caches and preview resolution to it. On a busy device the preview lowers
          its resolution before it drops a frame, and drops a frame before the sound glitches.
        </li>
        <li>
          <strong>Proxies:</strong> heavy videos (4K; 1080p on budget phones) get a lighter editing
          copy in the background; previews use it, exports always use the original.
        </li>
        <li>
          <strong>Exports</strong> stream to disk with back-pressure, can be cancelled, and produce
          the same picture as the preview.
        </li>
        <li>
          <strong>No special headers:</strong> no <code>SharedArrayBuffer</code>, COOP or COEP
          needed — it embeds in any page.
        </li>
      </ul>
      <h2>Browsers</h2>
      <p>
        Current Chrome / Edge, Safari (iOS and macOS) and Firefox — wherever WebCodecs is available.
        WebGPU when present, WebGL2 otherwise, with the same picture.
      </p>
      <PageNav href="/docs/performance" />
    </article>
  );
}
