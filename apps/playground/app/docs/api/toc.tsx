'use client';

/**
 * The API page's right column: the packages, then "On this page" (each group and its exports).
 * The export being read is marked as the page scrolls.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';

export interface TocGroup {
  id: string;
  title: string;
  items: string[];
}

export function ApiToc({
  packages,
  current,
  groups,
}: {
  packages: { slug: string; name: string }[];
  current: string;
  groups: TocGroup[];
}) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const ids = groups.flatMap((g) => [g.id, ...g.items]);
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    // The topmost heading in the upper part of the screen is the one being read.
    const observer = new IntersectionObserver(
      (entries) => {
        const shown = entries.filter((e) => e.isIntersecting);
        if (shown.length === 0) return;
        shown.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActive(shown[0]!.target.id);
      },
      { rootMargin: '-80px 0px -65% 0px' },
    );
    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, [groups]);
  const activeGroup = groups.find((g) => g.id === active || g.items.includes(active ?? ''))?.id;

  return (
    <aside className="api-toc" aria-label="On this page">
      <p className="api-toc-title">Packages</p>
      <ul className="api-toc-packages">
        {packages.map((p) => (
          <li key={p.slug}>
            <Link
              href={`/docs/api/${p.slug}`}
              aria-current={p.slug === current ? 'page' : undefined}
            >
              {p.name}
            </Link>
          </li>
        ))}
      </ul>
      <p className="api-toc-title">On this page</p>
      <ul className="api-toc-groups">
        {groups.map((g) => (
          <li key={g.id}>
            <a href={`#${g.id}`} data-active={activeGroup === g.id ? '' : undefined}>
              {g.title}
              <span>{g.items.length}</span>
            </a>
            {activeGroup === g.id ? (
              <ul>
                {g.items.map((name) => (
                  <li key={name}>
                    <a href={`#${name}`} aria-current={active === name ? 'location' : undefined}>
                      {name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}
