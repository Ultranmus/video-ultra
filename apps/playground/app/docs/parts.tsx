import Link from 'next/link';
import type { ReactNode } from 'react';
import { PAGES } from './nav';

export { Code } from '../code';

/** A short note set apart from the text. */
export function Note({ children }: { children: ReactNode }) {
  return <aside className="docs-note">{children}</aside>;
}

/** "Try it in the playground" under a sample: opens the playground with these options. */
export function TryIt({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p>
      <Link className="docs-try" href={href}>
        {children} →
      </Link>
    </p>
  );
}

/** Previous / next page links at the bottom of a page. */
export function PageNav({ href }: { href: string }) {
  const i = PAGES.findIndex((p) => p.href === href);
  const prev = i > 0 ? PAGES[i - 1] : undefined;
  const next = i >= 0 ? PAGES[i + 1] : undefined;
  return (
    <nav className="docs-pagenav" aria-label="More docs">
      {prev ? (
        <Link href={prev.href}>
          <small>Previous</small>
          {prev.title}
        </Link>
      ) : null}
      {next ? (
        <Link href={next.href} className="docs-pagenav-next">
          <small>Next</small>
          {next.title}
        </Link>
      ) : null}
    </nav>
  );
}
