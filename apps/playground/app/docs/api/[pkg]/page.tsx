import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Code, highlight } from '../../../code';
import { KINDS, KIND_LABEL, PACKAGES, itemHref, loadApi, resolveLink } from '../data';
import { Doc, type LinkResolver } from '../doc';
import { ApiToc } from '../toc';
import type { ApiItem } from '../types';
import '../api.css';

/** Only the four packages exist; anything else is a 404. */
export const dynamicParams = false;

/** One page per package, made at build time. */
export function generateStaticParams() {
  return PACKAGES.map((p) => ({ pkg: p.slug }));
}

type Props = { params: Promise<{ pkg: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pkg } = await params;
  const info = PACKAGES.find((p) => p.slug === pkg);
  return info ? { title: `${info.name} API`, description: info.blurb } : { title: 'API reference' };
}

/** A package's exports: an index grouped by kind, then each one with its docs and declaration. */
export default async function ApiPackagePage({ params }: Props) {
  const { pkg: slug } = await params;
  const at = PACKAGES.findIndex((p) => p.slug === slug);
  const info = PACKAGES[at];
  if (!info) notFound();
  const api = loadApi();
  const pkg = api.find((p) => p.slug === slug);
  const items = pkg?.items ?? [];
  const own = items.filter((i) => !i.fromCore);
  const link: LinkResolver = (target) => {
    const href = resolveLink(api, slug, target);
    // Same page: just the anchor (no navigation).
    return href?.startsWith(`/docs/api/${slug}#`) ? href.slice(href.indexOf('#')) : href;
  };
  const prev = PACKAGES[at - 1];
  const next = PACKAGES[at + 1];

  const toc = KINDS.map(([kind, title]) => ({
    id: `kind-${kind}`,
    title,
    items: own.filter((i) => i.kind === kind).map((i) => i.name),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="api-layout">
      <article className="api">
        <p className="api-crumb">
          <Link href="/docs/api">API reference</Link>
        </p>
        <h1 className="api-title">{info.name}</h1>
        <p className="docs-lead">{info.blurb}</p>
        <Code lang="bash">{`npm install ${info.name}`}</Code>

        {items.length === 0 ? (
          <aside className="docs-note">
            <p>
              The reference data isn&apos;t generated in this build. Build the packages, then run{' '}
              <code>pnpm docs:api</code>.
            </p>
          </aside>
        ) : (
          <nav className="api-index" aria-label={`${info.name} exports`}>
            {KINDS.map(([kind, title]) => {
              const group = items.filter((i) => i.kind === kind);
              if (group.length === 0) return null;
              return (
                <div key={kind}>
                  <h2 className="api-index-title">
                    {title} <span className="api-count">{group.length}</span>
                  </h2>
                  <ul>
                    {group.map((item) => (
                      <li key={item.name}>
                        <a href={item.fromCore ? itemHref(slug, item) : `#${item.name}`}>
                          {item.name}
                        </a>
                        {item.fromCore ? (
                          <span className="api-from" title="Documented on the core page">
                            core
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
        )}

        {items.some((i) => i.fromCore) ? (
          <p className="api-hint">
            Names marked <span className="api-from">core</span> are re-exported from{' '}
            <Link href="/docs/api/core">@video-ultra/core</Link> and documented there — import them
            from either package.
          </p>
        ) : null}

        {KINDS.map(([kind, title]) => {
          const group = own.filter((i) => i.kind === kind);
          if (group.length === 0) return null;
          return (
            <section key={kind} className="api-group">
              <h2 id={`kind-${kind}`}>{title}</h2>
              {group.map((item) => (
                <Entry key={item.name} item={item} link={link} />
              ))}
            </section>
          );
        })}

        <nav className="docs-pagenav" aria-label="More API reference">
          <Link href={prev ? `/docs/api/${prev.slug}` : '/docs/api'}>
            <small>Previous</small>
            {prev ? prev.name : 'API overview'}
          </Link>
          {next ? (
            <Link href={`/docs/api/${next.slug}`} className="docs-pagenav-next">
              <small>Next</small>
              {next.name}
            </Link>
          ) : null}
        </nav>
      </article>
      <ApiToc
        packages={PACKAGES.map((p) => ({ slug: p.slug, name: p.name }))}
        current={slug}
        groups={toc}
      />
    </div>
  );
}

/** One export: name (a link to itself, # on hover), kind, its doc comment, its declaration. */
async function Entry({ item, link }: { item: ApiItem; link: LinkResolver }) {
  const html = await highlight(item.declaration, 'tsx');
  return (
    <article className="api-item" id={item.name}>
      <div className="api-item-head">
        <h3>
          <a href={`#${item.name}`}>
            <code>{item.name}</code>
          </a>
        </h3>
        <span className="api-tag">{KIND_LABEL[item.kind]}</span>
      </div>
      {item.doc ? <Doc text={item.doc} link={link} /> : null}
      <div className="s-code api-decl" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
