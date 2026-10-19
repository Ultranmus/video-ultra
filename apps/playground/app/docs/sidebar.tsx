'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PAGES } from './nav';

/** The docs' page list; the current page is marked (and, on phones, a picker). */
export function DocsNav() {
  const path = usePathname();
  return (
    <nav className="docs-nav" aria-label="Docs">
      <ul>
        {PAGES.map((p) => (
          <li key={p.href}>
            <Link href={p.href} aria-current={path === p.href ? 'page' : undefined}>
              {p.title}
            </Link>
          </li>
        ))}
        <li>
          <a href="/api/index.html">API reference</a>
        </li>
      </ul>
    </nav>
  );
}
