import type { Metadata } from 'next';
import Link from 'next/link';
import { Code, PageNav } from './parts';

export const metadata: Metadata = { title: 'Introduction' };

export default function Introduction() {
  return (
    <article>
      <h1>video-ultra</h1>
      <p className="docs-lead">
        A free (MIT), fast, fully typed video editor for React and Next.js. Simple enough for anyone
        on a phone, deep enough for pros on a desktop. It runs in the browser and never uploads the
        user&apos;s media.
      </p>
      <Code lang="tsx">{`
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';

<VideoEditor onSave={(project) => save(project)} onExport={({ blob }) => upload(blob)} />
`}</Code>
      <p>
        <Link href="/editor">Try the demo</Link> ·{' '}
        <Link href="/docs/getting-started">Get started</Link> ·{' '}
        <a href="/api/index.html">API reference</a>
      </p>

      <h2>What people can do with it</h2>
      <ul>
        <li>
          <strong>Everyday editing:</strong> add videos, photos and music; trim, split, speed,
          filters, transitions, text, stickers, voiceover; export MP4 or WebM — the same project on
          a phone and a desktop.
        </li>
        <li>
          <strong>Design tools:</strong> templates, text and element animations, layers, groups,
          align, blend modes, green screen, LUTs, blur areas, shape masks, animated stickers,
          background removal.
        </li>
        <li>
          <strong>Pro tools, out of the way:</strong> keyframes with a graph editor, roll / slip /
          slide, markers, scopes, sound effects (EQ, even out, pitch, clean up noise), edit several
          at once, combine clips into one, HEVC / AV1 export, proxies for heavy 4K files.
        </li>
        <li>
          <strong>Captions:</strong> on-device speech to text, styles with word highlight,
          <code>.srt</code> / <code>.vtt</code> import and export.
        </li>
      </ul>

      <h2>Packages</h2>
      <table tabIndex={0}>
        <thead>
          <tr>
            <th>Package</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>@video-ultra/react</code>
            </td>
            <td>The editor component, its controller and hooks</td>
          </tr>
          <tr>
            <td>
              <code>@video-ultra/core</code>
            </td>
            <td>The engine and the project model — framework-free, SSR-safe</td>
          </tr>
          <tr>
            <td>
              <code>@video-ultra/captions</code>
            </td>
            <td>Optional: on-device auto captions</td>
          </tr>
          <tr>
            <td>
              <code>@video-ultra/ai</code>
            </td>
            <td>Optional: background removal; AI editing and text to speech through your server</td>
          </tr>
        </tbody>
      </table>

      <h2>How it stays fast</h2>
      <p>
        Decoding, compositing (WebGPU, or WebGL2 with the same picture), sound and export run in
        workers. React never renders per frame; the timeline is a canvas. Media is read in ranges
        and every frame is closed as soon as it&apos;s drawn, so memory stays flat even with long 4K
        clips. When a device is busy the preview lowers its resolution before it drops frames. No
        cross-origin isolation (<code>SharedArrayBuffer</code>) is needed.
      </p>
      <PageNav href="/docs" />
    </article>
  );
}
