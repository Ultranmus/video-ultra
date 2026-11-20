'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/docs', label: 'Docs' },
  { href: '/playground', label: 'Playground' },
  { href: '/docs/api', label: 'API' },
  { href: '/bench', label: 'Bench' },
] as const;

const GITHUB =
  'M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z';

/** The site's top bar: the VideoUltra mark and name, the main links, GitHub and the editor. */
export function SiteHeader() {
  const path = usePathname();
  const current = (href: string) =>
    href === '/docs'
      ? path.startsWith('/docs') && !path.startsWith('/docs/api')
      : path === href || path.startsWith(`${href}/`);
  return (
    <>
      <a className="site-skip" href="#content">
        Skip to content
      </a>
      <header className="site-top">
        <Link href="/" className="site-brand" aria-label="VideoUltra home">
          <picture>
            <source srcSet="/brand/mark-dark.svg" media="(prefers-color-scheme: dark)" />
            <img src="/brand/mark-light.svg" alt="" width={28} height={28} />
          </picture>
          <span className="site-brand-word" aria-hidden="true">
            Video<span className="site-brand-ultra">Ultra</span>
          </span>
        </Link>
        <nav className="site-links" aria-label="Site">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current(l.href) ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="site-actions">
          <a
            className="site-icon-link"
            href="https://github.com/Ultranmus/video-ultra"
            aria-label="VideoUltra on GitHub"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d={GITHUB} fill="currentColor" />
            </svg>
          </a>
          <Link className="s-btn s-btn-small" href="/editor">
            Open the editor
          </Link>
        </div>
      </header>
    </>
  );
}
