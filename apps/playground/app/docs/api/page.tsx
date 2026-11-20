import type { Metadata } from 'next';
import Link from 'next/link';
import { PageNav } from '../parts';
import { PACKAGES, loadApi } from './data';
import { ApiSearch } from './search';
import type { ApiSearchEntry } from './types';
import './api.css';

export const metadata: Metadata = {
  title: 'API reference',
  description: 'Every export of the VideoUltra packages, from their published TypeScript types.',
};

/** The API overview: one card per package and a search across all of them. */
export default function ApiOverview() {
  const api = loadApi();
  // Only what search needs (no declarations or full docs); re-exports appear once, under core.
  const index: ApiSearchEntry[] = api.flatMap((pkg) =>
    pkg.items
      .filter((item) => !item.fromCore)
      .map((item) => ({ n: item.name, k: item.kind, p: pkg.slug, s: item.summary })),
  );
  return (
    <article className="api">
      <h1>API reference</h1>
      <p className="docs-lead">
        Every export of the four packages, generated from their published TypeScript types — so it
        always matches what you install.
      </p>
      <aside className="docs-note">
        <p>
          <strong>Most apps only need</strong> <code>@video-ultra/react</code>: the{' '}
          <a href="/docs/api/react#VideoEditor">
            <code>VideoEditor</code>
          </a>{' '}
          component, its options and hooks. It re-exports the core types you&apos;re likely to
          touch, like <code>Project</code> and <code>ExportResult</code>.
        </p>
      </aside>

      {api.length === 0 ? (
        <aside className="docs-note">
          <p>
            The reference data isn&apos;t generated in this build. Build the packages, then run{' '}
            <code>pnpm docs:api</code>.
          </p>
        </aside>
      ) : (
        <ApiSearch index={index} />
      )}

      <h2 id="packages">Packages</h2>
      <ul className="docs-cards api-cards">
        {PACKAGES.map((info) => {
          const pkg = api.find((p) => p.slug === info.slug);
          const own = pkg?.items.filter((i) => !i.fromCore).length ?? 0;
          const reexported = (pkg?.items.length ?? 0) - own;
          return (
            <li key={info.slug}>
              <Link href={`/docs/api/${info.slug}`}>
                <strong>
                  <code>{info.name}</code>
                </strong>
                <span>{info.blurb}</span>
                <span className="api-cards-count">
                  {own} exports{reexported > 0 ? ` · ${reexported} from core` : ''}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p>
        New here? Start with <Link href="/docs/getting-started">Getting started</Link>, then{' '}
        <Link href="/docs/options">All options</Link> for every prop of the editor in one table.
      </p>
      <PageNav href="/docs/api" />
    </article>
  );
}
