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

const ARROW = { prev: 'M15 18l-6-6 6-6', next: 'M9 18l6-6-6-6' } as const;

function Arrow({ way }: { way: 'prev' | 'next' }) {
  return (
    <svg
      className="docs-pagenav-arrow"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
    >
      <path
        d={ARROW[way]}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Previous / next cards at the bottom of a page, with arrows (docs and API pages). */
export function PrevNext({
  prev,
  next,
  label,
}: {
  prev?: { href: string; title: string } | undefined;
  next?: { href: string; title: string } | undefined;
  label: string;
}) {
  return (
    <nav className="docs-pagenav" aria-label={label}>
      {prev ? (
        <Link href={prev.href} className="docs-pagenav-prev">
          <Arrow way="prev" />
          <span>
            <small>Previous</small>
            {prev.title}
          </span>
        </Link>
      ) : null}
      {next ? (
        <Link href={next.href} className="docs-pagenav-next">
          <span>
            <small>Next</small>
            {next.title}
          </span>
          <Arrow way="next" />
        </Link>
      ) : null}
    </nav>
  );
}

/** Previous / next docs pages, in reading order. */
export function PageNav({ href }: { href: string }) {
  const i = PAGES.findIndex((p) => p.href === href);
  return (
    <PrevNext
      prev={i > 0 ? PAGES[i - 1] : undefined}
      next={i >= 0 ? PAGES[i + 1] : undefined}
      label="More docs"
    />
  );
}
