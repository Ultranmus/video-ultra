import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '../site-header';
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
      <SiteHeader />
      <div className="docs-body">
        <DocsNav />
        <main className="docs-main">{children}</main>
      </div>
    </div>
  );
}
