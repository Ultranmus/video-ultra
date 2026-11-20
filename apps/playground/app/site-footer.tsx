import Link from 'next/link';

const COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/editor', label: 'Open the editor' },
      { href: '/playground', label: 'Playground' },
      { href: '/bench', label: 'Performance bench' },
    ],
  },
  {
    title: 'Docs',
    links: [
      { href: '/docs/getting-started', label: 'Getting started' },
      { href: '/docs/theming', label: 'Theming' },
      { href: '/docs/api', label: 'API reference' },
    ],
  },
  {
    title: 'Project',
    links: [
      { href: 'https://github.com/Ultranmus/video-ultra', label: 'GitHub', external: true },
      {
        href: 'https://github.com/Ultranmus/video-ultra/blob/main/LICENSE',
        label: 'MIT licence',
        external: true,
      },
      { href: 'https://imageultra.ashvattech.com', label: 'ImageUltra', external: true },
    ],
  },
];

/** What matters most, highlighted under the logo. */
const FACTS = ['Free · MIT', 'Runs in the browser', 'Nothing uploaded', 'TypeScript'];

/** The site's footer: the mark and what VideoUltra is, the key facts, and links in groups. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-top">
        <div className="site-footer-brand">
          <Link href="/" className="site-footer-logo" aria-label="VideoUltra home">
            <picture>
              <source srcSet="/brand/mark-dark.svg" media="(prefers-color-scheme: dark)" />
              <img src="/brand/mark-light.svg" alt="" width={32} height={32} />
            </picture>
            <span aria-hidden="true">
              Video<span className="site-brand-ultra">Ultra</span>
            </span>
          </Link>
          <p>The video editor for React and Next.js: simple for anyone, deep enough for pros.</p>
          <ul className="site-footer-facts" aria-label="At a glance">
            {FACTS.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} className="site-footer-col" aria-label={col.title}>
            <p className="site-footer-title">{col.title}</p>
            <ul>
              {col.links.map((l) => (
                <li key={l.href}>
                  {l.external ? (
                    <a href={l.href}>
                      {l.label}
                      <span className="site-footer-out" aria-hidden="true">
                        ↗
                      </span>
                    </a>
                  ) : (
                    <Link href={l.href}>{l.label}</Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="site-footer-bottom">
        <p>© 2026 VideoUltra contributors · MIT licensed</p>
        <p>
          A sibling of <a href="https://imageultra.ashvattech.com">ImageUltra</a>, the image editor
        </p>
      </div>
    </footer>
  );
}
