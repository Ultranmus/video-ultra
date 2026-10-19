import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels } from '../context';
import type { MediaSource, MediaSourceItem } from '../embed';
import { Icon } from '../icons';

/**
 * A host's media sources in the Media panel (embedding API, v0.3): one search box over all of
 * them, a section of results per source, tap to add at the playhead (the file is stored in the
 * project, with its credit). Searches wait for typing to settle and are aborted when it goes on.
 */
export function MediaSources({ sources }: { sources: readonly MediaSource[] }): ReactElement {
  const l = useLabels();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <section className="vu-media-sources" aria-label={l.mediaSources}>
      <label className="vu-search">
        <Icon name="search" size={16} />
        <input
          type="search"
          placeholder={l.searchMedia}
          aria-label={l.searchMedia}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      </label>
      {sources.map((source) => (
        <SourceResults key={source.id} source={source} query={query} />
      ))}
    </section>
  );
}

function SourceResults({ source, query }: { source: MediaSource; query: string }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  // Results belong to the query they answer: a new query shows "Loading" until its page comes.
  const [page, setPage] = useState<{
    query: string;
    items: readonly MediaSourceItem[];
    next: string | null;
    error: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const load = (cursor: string | null) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    source
      .search({ text: query, cursor }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setPage((old) => ({
          query,
          items: cursor && old?.query === query ? [...old.items, ...result.items] : result.items,
          next: result.next ?? null,
          error: false,
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setPage({ query, items: [], next: null, error: true });
      });
  };
  useEffect(() => {
    load(null);
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new query starts over
  }, [query, source]);
  const current = page?.query === query ? page : null;
  const items = current?.items ?? null;
  const next = current?.next ?? null;
  const error = current?.error ?? false;

  const add = async (item: MediaSourceItem) => {
    if (busy) return;
    setBusy(item.id);
    const controller = new AbortController();
    try {
      const blob = await source.load(item, controller.signal);
      const ext = blob.type.split('/')[1]?.split(';')[0] ?? '';
      const name = ext && !item.name.includes('.') ? `${item.name}.${ext}` : item.name;
      await ctl.importFiles([new File([blob], name, { type: blob.type })], {
        ...(item.credit ? { credit: item.credit } : {}),
      });
    } catch {
      ctl.toast(l.mediaSourceFailed(item.name), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="vu-media-source">
      <h3 className="vu-browser-heading">{source.label}</h3>
      {error ? (
        <p className="vu-hint">{l.mediaSourceError}</p>
      ) : items === null ? (
        <p className="vu-hint">{l.loadingResults}</p>
      ) : items.length === 0 ? (
        <p className="vu-hint">{l.noMediaFound}</p>
      ) : (
        <ul className="vu-asset-grid">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="vu-asset"
                aria-label={l.addNamed(item.name)}
                data-tooltip={item.credit ? `${item.name} · ${item.credit}` : item.name}
                aria-busy={busy === item.id || undefined}
                onClick={() => void add(item)}
              >
                {item.thumbnailUrl ? (
                  <img
                    className="vu-asset-thumb"
                    src={item.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                ) : (
                  <Icon
                    name={
                      item.kind === 'audio' ? 'audio' : item.kind === 'image' ? 'image' : 'media'
                    }
                  />
                )}
                {item.duration ? (
                  <span className="vu-asset-badge">
                    {Math.floor(item.duration / 60)}:
                    {String(Math.round(item.duration % 60)).padStart(2, '0')}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {next && items?.length ? (
        <button
          type="button"
          className="vu-btn vu-wide"
          data-variant="secondary"
          onClick={() => load(next)}
        >
          {l.showMore}
        </button>
      ) : null}
    </div>
  );
}
