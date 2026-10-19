import Link from 'next/link';
import type { ReactNode } from 'react';
import { PAGES } from './nav';

/** A code sample (plain, copy-ready). */
export function Code({ children, lang }: { children: string; lang?: string }) {
  return (
    // Focusable: a long line scrolls sideways, and keyboard users must be able to scroll it.
    <pre
      className="docs-code"
      data-lang={lang}
      tabIndex={0}
      aria-label={lang ? `${lang} example` : 'Example'}
    >
      <code>{children.replace(/^\n/, '').replace(/\s+$/, '')}</code>
    </pre>
  );
}

/** A short note set apart from the text. */
export function Note({ children }: { children: ReactNode }) {
  return <aside className="docs-note">{children}</aside>;
}

/** Previous / next page links at the bottom of a page. */
export function PageNav({ href }: { href: string }) {
  const i = PAGES.findIndex((p) => p.href === href);
  const prev = PAGES[i - 1];
  const next = PAGES[i + 1];
  return (
    <nav className="docs-pagenav" aria-label="More docs">
      {prev ? <Link href={prev.href}>← {prev.title}</Link> : <span />}
      {next ? <Link href={next.href}>{next.title} →</Link> : <span />}
    </nav>
  );
}
