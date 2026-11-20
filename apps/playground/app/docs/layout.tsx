import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DocsNav } from './sidebar';
import './docs.css';

export const metadata: Metadata = {
  title: { template: '%s · VideoUltra docs', default: 'VideoUltra docs' },
  description: 'A free, fast, fully typed video editor for React and Next.js.',
};

/** The docs: a sidebar of pages, the page, links to the demo and the API reference. */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs">
      <header className="docs-top">
        <Link href="/docs" className="docs-brand">
          <picture>
            <source srcSet="/brand/mark-dark.svg" media="(prefers-color-scheme: dark)" />
            <img src="/brand/mark-light.svg" alt="" width={28} height={28} />
          </picture>
          <span>
            Video<span className="docs-brand-ultra">Ultra</span>
          </span>
        </Link>
        <nav className="docs-top-links" aria-label="Site">
          <Link href="/editor">Demo</Link>
          <a href="/api/index.html">API reference</a>
          <a href="https://github.com/Ultranmus/video-ultra">GitHub</a>
        </nav>
      </header>
      <div className="docs-body">
        <DocsNav />
        <main className="docs-main">{children}</main>
      </div>
    </div>
  );
}
