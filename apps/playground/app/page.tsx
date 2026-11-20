import type { Metadata } from 'next';
import Link from 'next/link';
import { Code } from './docs/parts';
import { Install, LiveDemo } from './home-parts';
import { SiteHeader } from './site-header';
import './docs/docs.css';
import './home.css';

export const metadata: Metadata = {
  title: 'VideoUltra — the video editor for React and Next.js',
  description:
    'A free, fast, fully typed video editor for React and Next.js. Runs in the browser on phones and desktops; media never leaves the device.',
};

const FEATURES: [string, string][] = [
  [
    'Simple first',
    'Trim, add text, music and filters, and export in a few taps. Pro tools stay out of the way until someone asks for them.',
  ],
  [
    'Fast on every device',
    'Decoding, compositing, sound and export run in workers, on WebGPU or WebGL2. On a busy phone the preview lowers its resolution before it drops a frame.',
  ],
  [
    'Private by design',
    'Everything runs in the browser. Your users’ videos and photos never leave their device.',
  ],
  [
    'Projects you can keep',
    'Every edit is non-destructive and saved as versioned JSON. Save it, reopen it later, or export it again.',
  ],
  [
    'Captions on the device',
    'Speech to timed words in a worker, caption styles with word highlight, and .srt / .vtt in and out.',
  ],
  [
    'Pro tools when needed',
    'Keyframes, roll / slip / slide, markers, scopes, sound effects, HEVC and AV1 export, and light copies for heavy 4K files.',
  ],
  [
    'Yours to shape',
    'Theme it with CSS variables, add your own panels, buttons and media sources, or hide any tool.',
  ],
  [
    'Typed and accessible',
    'TypeScript strict, with no any in the public API. Keyboard and screen-reader ready, checked against WCAG 2.2 AA.',
  ],
];

/** The home page: what VideoUltra is, a live editor, what it does, and how to add it. */
export default function Home() {
  return (
    <div className="docs home">
      <SiteHeader />
      <main id="content">
        <section className="home-hero">
          <picture>
            <source srcSet="/brand/mark-dark.svg" media="(prefers-color-scheme: dark)" />
            <img
              className="home-hero-mark"
              src="/brand/mark-light.svg"
              alt=""
              width={88}
              height={88}
            />
          </picture>
          <h1>The video editor for React and Next.js</h1>
          <p className="home-lead">
            Free and MIT licensed. Drop a complete editor into your app: simple enough for anyone on
            a phone, deep enough for pros on a desktop.
          </p>
          <div className="home-actions">
            <Link className="home-button" href="/editor">
              Try the demo
            </Link>
            <Link className="home-button home-button-quiet" href="/docs/getting-started">
              Get started
            </Link>
          </div>
          <Install command="npm install @video-ultra/react" />
        </section>

        <LiveDemo />

        <section className="home-section" aria-labelledby="home-features">
          <h2 id="home-features">Everything a video editor needs</h2>
          <ul className="home-features">
            {FEATURES.map(([title, text]) => (
              <li key={title}>
                <strong>{title}</strong>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-section home-code" aria-labelledby="home-add">
          <div>
            <h2 id="home-add">Add it in a few lines</h2>
            <p>
              One component and one stylesheet. Save projects with <code>onSave</code>, upload the
              finished video with <code>onExport</code>, and theme it to match your app.
            </p>
            <p>
              <Link href="/docs/getting-started">Getting started</Link> ·{' '}
              <Link href="/docs/nextjs">Next.js</Link> · <Link href="/docs/vite">Vite</Link> ·{' '}
              <a href="/api/index.html">API reference</a>
            </p>
          </div>
          <Code lang="tsx">{`
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';

export default function Page() {
  return (
    <VideoEditor
      onSave={(project) => save(project)}
      onExport={({ blob }) => upload(blob)}
    />
  );
}
`}</Code>
        </section>
      </main>
      <footer className="home-footer">
        <span>VideoUltra · MIT licensed</span>
        <nav aria-label="More">
          <Link href="/docs">Docs</Link>
          <a href="/api/index.html">API</a>
          <a href="https://github.com/Ultranmus/video-ultra">GitHub</a>
          <Link href="/bench">Bench</Link>
        </nav>
      </footer>
    </div>
  );
}
