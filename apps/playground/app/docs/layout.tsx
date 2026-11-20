import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '../site-footer';
import { SiteHeader } from '../site-header';
import { DocsNav } from './sidebar';
import '../site.css';

export const metadata: Metadata = {
  title: { template: '%s · VideoUltra docs', default: 'VideoUltra docs' },
  description: 'A free, fast, fully typed video editor for React and Next.js.',
};

/** The docs: grouped pages on the left (a picker on phones), the page, the footer. */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      <SiteHeader />
      <div className="docs-body">
        <DocsNav />
        <main className="docs-main" id="content">
          {children}
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
