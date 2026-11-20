'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { GROUPS } from './nav';

/** The docs' pages in groups, the current one marked; on phones, a page picker instead. */
export function DocsNav() {
  const path = usePathname();
  const router = useRouter();
  // API pages (/docs/api/react…) mark "API reference".
  // Package pages (/docs/api/react…) mark "API reference".
  const active = (href: string) =>
    path === href || (href === '/docs/api' && path.startsWith('/docs/api/'));
  const pages = GROUPS.flatMap((g) => g.pages);
  // On a package page the picker shows "API reference".
  const current =
    pages.find((p) => active(p.href)) ??
    (path.startsWith('/docs/api') ? pages.find((p) => p.href === '/docs/api') : undefined);
  return (
    <>
      <nav className="docs-nav" aria-label="Docs">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="docs-nav-title">{g.title}</p>
            <ul>
              {g.pages.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} aria-current={active(p.href) ? 'page' : undefined}>
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="docs-nav-pick">
        <label className="site-sr" htmlFor="docs-pick">
          Docs page
        </label>
        <select
          id="docs-pick"
          value={current?.href ?? ''}
          onChange={(e) => router.push(e.target.value)}
        >
          {current ? null : <option value="">Choose a page</option>}
          {GROUPS.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.pages.map((p) => (
                <option key={p.href} value={p.href}>
                  {p.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>
  );
}
