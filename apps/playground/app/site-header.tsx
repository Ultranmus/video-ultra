import Link from 'next/link';

/** The site's top bar (home and docs): the VideoUltra mark and name, and the main links. */
export function SiteHeader() {
  return (
    <header className="docs-top">
      <Link href="/" className="docs-brand" aria-label="VideoUltra home">
        <picture>
          <source srcSet="/brand/mark-dark.svg" media="(prefers-color-scheme: dark)" />
          <img src="/brand/mark-light.svg" alt="" width={28} height={28} />
        </picture>
        <span aria-hidden="true">
          Video<span className="docs-brand-ultra">Ultra</span>
        </span>
      </Link>
      <nav className="docs-top-links" aria-label="Site">
        <Link href="/docs">Docs</Link>
        <Link href="/editor">Demo</Link>
        <a href="/api/index.html">API</a>
        <a href="https://github.com/Ultranmus/video-ultra">GitHub</a>
      </nav>
    </header>
  );
}
