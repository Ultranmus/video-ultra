'use client';

import { useDeferredValue, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ApiSearchEntry } from './types';

/** How many matches are listed at once (the count says how many there are). */
const SHOWN = 40;

/** Ranks a match: exact name, name start, word start in the name, name contains, summary. */
function score(entry: ApiSearchEntry, q: string): number {
  const name = entry.n.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  // A word inside a camelCase / CONSTANT_CASE name: "editor" → createEditor, VideoEditorProps.
  const words = entry.n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  if (
    words
      .toLowerCase()
      .split(' ')
      .some((w) => w.startsWith(q))
  )
    return 2;
  if (name.includes(q)) return 3;
  if (entry.s.toLowerCase().includes(q)) return 4;
  return -1;
}

/**
 * Filters every export of every package as you type (name first, then its one-line summary).
 * Arrow keys move between the results; the count is announced.
 */
export function ApiSearch({ index }: { index: ApiSearchEntry[] }) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const q = deferred.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!q) return [];
    return index
      .map((entry) => ({ entry, rank: score(entry, q) }))
      .filter((m) => m.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.entry.n.localeCompare(b.entry.n))
      .map((m) => m.entry);
  }, [index, q]);

  const status = !q
    ? ''
    : matches.length === 0
      ? `No exports match “${deferred.trim()}”.`
      : `${matches.length} ${matches.length === 1 ? 'export matches' : 'exports match'}${
          matches.length > SHOWN ? ` — showing the first ${SHOWN}` : ''
        }.`;

  const links = () => Array.from(list.current?.querySelectorAll('a') ?? []);
  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      links()[0]?.focus();
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') return;
    e.preventDefault();
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    const input = document.getElementById(`${id}-q`);
    if (e.key === 'Escape') {
      input?.focus();
      return;
    }
    const next = at + (e.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) input?.focus();
    else all[Math.min(next, all.length - 1)]?.focus();
  };

  return (
    <div className="api-search" role="search">
      <label htmlFor={`${id}-q`} className="api-search-label">
        Search the API
      </label>
      <div className="api-search-box">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          id={`${id}-q`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="e.g. VideoEditor, splitItem, Project"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-status`}
        />
      </div>
      <p id={`${id}-status`} className="api-search-status" role="status" aria-live="polite">
        {status}
      </p>
      {matches.length > 0 ? (
        <ul className="api-results" ref={list} onKeyDown={onListKey} aria-label="Matching exports">
          {matches.slice(0, SHOWN).map((m) => (
            <li key={`${m.p}-${m.n}`}>
              <a href={`/docs/api/${m.p}#${m.n}`}>
                <span className="api-results-head">
                  <code>{m.n}</code>
                  <span className="api-tag">{m.k}</span>
                  <span className="api-results-pkg">@video-ultra/{m.p}</span>
                </span>
                {m.s ? <span className="api-results-summary">{m.s}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
