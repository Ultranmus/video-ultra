import Link from 'next/link';

/** The site's footer (home, docs, API, bench). */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        VideoUltra · free and MIT licensed · a sibling of{' '}
        <a href="https://imageultra.ashvattech.com">ImageUltra</a>
      </p>
      <nav aria-label="More">
        <Link href="/docs">Docs</Link>
        <Link href="/playground">Playground</Link>
        <Link href="/docs/api">API</Link>
        <Link href="/bench">Bench</Link>
        <Link href="/editor">Editor</Link>
        <a href="https://github.com/Ultranmus/video-ultra">GitHub</a>
      </nav>
    </footer>
  );
}
