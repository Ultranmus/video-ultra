import type { Metadata } from 'next';
import Link from 'next/link';
import { Code } from './code';
import { EditorWindow, Install, PromoVideo } from './home-parts';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import './site.css';
import './home.css';

export const metadata: Metadata = {
  title: 'VideoUltra — the video editor for React and Next.js',
  description:
    'A free, fast, fully typed video editor for React and Next.js. Runs in the browser on phones and desktops; media never leaves the device.',
};

/** Simple line icons (24 × 24, drawn for this page). */
const ICONS = {
  simple: 'M4 12h16M12 4v16',
  fast: 'M13 3 5 14h6l-1 7 8-11h-6z',
  private: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  json: 'M8 4c-2 0-3 1-3 3v2c0 1.5-1 2-2 3 1 1 2 1.5 2 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 2 2 3-1 1-2 1.5-2 3v2c0 2-1 3-3 3',
  captions: 'M3 6h18v12H3zM7 11h4M7 14h7M14 11h3',
  pro: 'M4 18h16M6 14l4-6 4 4 4-7',
  theme:
    'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5S13 18 13 17s.8-1.5 2-1.5h2a4 4 0 0 0 4-4C21 6.8 17 3 12 3zM7.5 12h.01M10 7.5h.01M15 7.5h.01',
  a11y: 'M12 5h.01M5 8l7 1 7-1M12 9v5l-3 6M12 14l3 6',
} as const;

const FEATURES: { icon: keyof typeof ICONS; title: string; text: string }[] = [
  {
    icon: 'simple',
    title: 'Simple first',
    text: 'Trim, add text, music and filters, and export in a few taps. Pro tools stay out of the way until someone asks for them.',
  },
  {
    icon: 'fast',
    title: 'Fast on every device',
    text: 'Decoding, compositing, sound and export run in workers, on WebGPU or WebGL2. A busy phone lowers the preview’s resolution before it drops a frame.',
  },
  {
    icon: 'private',
    title: 'Private by design',
    text: 'Everything runs in the browser. Your users’ videos and photos never leave their device.',
  },
  {
    icon: 'json',
    title: 'Projects you can keep',
    text: 'Every edit is non-destructive and saved as versioned JSON. Save it, reopen it later, or export it again.',
  },
  {
    icon: 'captions',
    title: 'Captions on the device',
    text: 'Speech to timed words in a worker, caption styles with word highlight, and .srt / .vtt in and out.',
  },
  {
    icon: 'pro',
    title: 'Pro tools when needed',
    text: 'Keyframes, roll / slip / slide, markers, scopes, sound effects, HEVC and AV1 export, and light copies for heavy 4K files.',
  },
  {
    icon: 'theme',
    title: 'Yours to shape',
    text: 'Theme it with props or CSS variables, add your own panels, buttons and media sources, or hide any tool.',
  },
  {
    icon: 'a11y',
    title: 'Typed and accessible',
    text: 'TypeScript strict, with no any in the public API. Keyboard and screen-reader ready, checked against WCAG 2.2 AA.',
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The home page: what VideoUltra is, the promo, the live editor, what it does, how to add it. */
export default function Home() {
  return (
    <div className="site home">
      <SiteHeader />
      <main id="content">
        <section className="home-hero">
          <p className="home-eyebrow">Free · MIT licensed · Open source</p>
          <h1>The video editor for React and Next.js</h1>
          <p className="home-lead">
            Drop a complete video editor into your app: simple enough for anyone on a phone, deep
            enough for pros on a desktop, and fast on both.
          </p>
          <div className="home-actions">
            <Link className="s-btn" href="/docs/getting-started">
              Get started
            </Link>
            <Link className="s-btn s-btn-quiet" href="/playground">
              Open the playground
            </Link>
          </div>
          <Install command="npm install @video-ultra/react" />
        </section>

        <PromoVideo />

        <section className="home-section" aria-labelledby="home-try">
          <div className="home-heading">
            <h2 id="home-try">Try it right here</h2>
            <p>
              This is the real editor, not a video. Add your own clips: they stay on your device.
            </p>
          </div>
          <EditorWindow />
        </section>

        <section className="home-section" aria-labelledby="home-features">
          <div className="home-heading">
            <h2 id="home-features">Everything a video editor needs</h2>
            <p>For the people using it, and for you adding it.</p>
          </div>
          <ul className="home-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className="home-feature-icon">
                  <Icon d={ICONS[f.icon]} />
                </span>
                <strong>{f.title}</strong>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-section home-split" aria-labelledby="home-theme">
          <div>
            <h2 id="home-theme">Make it look like your app</h2>
            <p>
              Dark, light or the device’s choice. Your accent, colours, corners and font, with a
              contrast check as you go. Hide the tools your users don’t need, change any word, or
              read right to left.
            </p>
            <p>
              <Link className="s-btn s-btn-quiet" href="/playground">
                Theme it in the playground
              </Link>
            </p>
          </div>
          <Code lang="tsx">{`
<VideoEditor
  theme="auto"
  themeOverrides={{
    accent: '#2563eb',
    radius: '12px',
    fontFamily: 'Inter, sans-serif',
  }}
  customize={{ hide: ['stickers', 'keyframes'] }}
/>
`}</Code>
        </section>

        <section className="home-section home-split" aria-labelledby="home-add">
          <div>
            <h2 id="home-add">Add it in a few lines</h2>
            <p>
              One component and one stylesheet. Save projects with <code>onSave</code>, upload the
              finished video with <code>onExport</code>, and listen to everything else with{' '}
              <code>onEvent</code>.
            </p>
            <ul className="home-links">
              <li>
                <Link href="/docs/getting-started">Getting started</Link>
              </li>
              <li>
                <Link href="/docs/nextjs">Next.js</Link>
              </li>
              <li>
                <Link href="/docs/vite">Vite</Link>
              </li>
              <li>
                <Link href="/docs/api">API reference</Link>
              </li>
            </ul>
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

        <section className="home-cta" aria-labelledby="home-cta">
          <h2 id="home-cta">Ready when you are</h2>
          <p>Free forever, MIT licensed, and no account needed.</p>
          <div className="home-actions">
            <Link className="s-btn" href="/docs/getting-started">
              Get started
            </Link>
            <Link className="s-btn s-btn-quiet" href="/editor">
              Open the editor
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
