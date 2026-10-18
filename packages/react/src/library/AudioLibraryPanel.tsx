import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels } from '../context';
import { Button } from '../controls';
import { Icon } from '../icons';
import type { AudioLibrary, AudioLibraryTrack } from './audio-library';

/**
 * The host's music & sound-effects library in the Audio panel (v0.2 B2): search, category chips,
 * a ▶ preview per row, the licence line, and Add (at the playhead, then selected so its sound
 * settings — e.g. "Lower under voice" — are right there).
 */

/** How long typing must pause before searching. */
const SEARCH_DEBOUNCE_MS = 250;

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; tracks: AudioLibraryTrack[]; next: string | null; more: boolean };

function formatLength(seconds: number | undefined): string {
  if (seconds === undefined || !(seconds > 0)) return '';
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** One shared preview player: one sound at a time, stops when the editor plays or the panel closes. */
function usePreview(library: AudioLibrary) {
  const ctl = useController();
  const l = useLabels();
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ id: string; loading: boolean } | null>(null);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    if (audio.current) {
      audio.current.pause();
      audio.current.removeAttribute('src');
      audio.current.load();
    }
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setState(null);
  }, []);

  const toggle = useCallback(
    async (track: AudioLibraryTrack) => {
      const same = state?.id === track.id;
      stop();
      if (same) return;
      ctl.pause();
      const controller = new AbortController();
      abort.current = controller;
      setState({ id: track.id, loading: true });
      try {
        let src = track.previewUrl;
        if (!src) {
          const blob = await library.load(track, controller.signal);
          if (controller.signal.aborted) return;
          src = url.current = URL.createObjectURL(blob);
        }
        const player = (audio.current ??= new Audio());
        player.onended = () => stop();
        player.src = src;
        await player.play();
        if (!controller.signal.aborted) setState({ id: track.id, loading: false });
      } catch {
        if (controller.signal.aborted) return;
        stop();
        ctl.toast(l.previewFailed, 'error');
      }
    },
    [ctl, l, library, state, stop],
  );

  // The editor's own playback and the preview never play over each other.
  useEffect(
    () =>
      ctl.ui.subscribe((s, prev) => {
        if (s.playing && !prev.playing) stop();
      }),
    [ctl, stop],
  );
  useEffect(() => stop, [stop]);
  return { previewing: state, toggle, stop };
}

/** Search, browse and add sounds from the host's {@link AudioLibrary}. */
export function AudioLibraryPanel({ library }: { library: AudioLibrary }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const headingId = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Results belong to one search; a newer search shows "loading" until its own results arrive.
  const key = `${attempt}\n${category ?? ''}\n${query}`;
  const [result, setResult] = useState<{ key: string; list: ListState } | null>(null);
  const list: ListState = result?.key === key ? result.list : { status: 'loading' };
  const setList = (next: ListState) => setResult({ key, list: next });
  const updateList = (update: (now: ListState) => ListState) =>
    setResult((now) => (now && now.key === key ? { key, list: update(now.list) } : now));
  const [adding, setAdding] = useState<string | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const { previewing, toggle, stop } = usePreview(library);
  const title = library.title ?? l.audioLibrary;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  // First page whenever the search or the category changes (the previous request is aborted).
  useEffect(() => {
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const forKey = key;
    library
      .search({ text: query, category, cursor: null }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted)
          setResult({
            key: forKey,
            list: {
              status: 'ready',
              tracks: [...page.tracks],
              next: page.next ?? null,
              more: false,
            },
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key: forKey, list: { status: 'error' } });
      });
    return () => controller.abort();
  }, [library, query, category, key]);

  const showMore = () => {
    if (list.status !== 'ready' || !list.next || list.more) return;
    const controller = new AbortController();
    searchAbort.current = controller;
    const cursor = list.next;
    setList({ ...list, more: true });
    library
      .search({ text: query, category, cursor }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        updateList((now) =>
          now.status === 'ready'
            ? {
                status: 'ready',
                tracks: [...now.tracks, ...page.tracks],
                next: page.next ?? null,
                more: false,
              }
            : now,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          updateList((now) => (now.status === 'ready' ? { ...now, more: false } : now));
          ctl.toast(l.libraryFailed, 'error');
        }
      });
  };

  const add = async (track: AudioLibraryTrack) => {
    if (adding) return;
    stop();
    setAdding(track.id);
    try {
      await ctl.addLibrarySound(track);
    } finally {
      setAdding(null);
    }
  };

  const categories = library.categories ?? [];
  return (
    <section className="vu-audiolib" aria-labelledby={headingId}>
      <h3 className="vu-audiolib-title" id={headingId}>
        {title}
      </h3>
      <label className="vu-search">
        <Icon name="search" size={16} />
        <input
          type="search"
          placeholder={l.searchSounds}
          aria-label={l.searchSounds}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      </label>
      {categories.length ? (
        <div className="vu-chips vu-chips-scroll" role="radiogroup" aria-label={l.category}>
          {[{ id: null, label: l.allSounds }, ...categories].map((c) => (
            <button
              key={c.id ?? ''}
              type="button"
              role="radio"
              aria-checked={c.id === category}
              className="vu-chip"
              onClick={() => setCategory(c.id)}
            >
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {list.status === 'loading' ? (
        <p className="vu-audiolib-status" role="status">
          <span className="vu-spinner" aria-hidden="true" />
          <span>{l.libraryLoading}</span>
        </p>
      ) : list.status === 'error' ? (
        <div className="vu-audiolib-status" role="alert">
          <Icon name="warning" size={16} />
          <span>{l.libraryFailed}</span>
          <Button label={l.tryAgain} variant="secondary" onClick={() => setAttempt((n) => n + 1)} />
        </div>
      ) : list.tracks.length === 0 ? (
        <p className="vu-audiolib-status" role="status">
          {query ? l.noSoundsFound(query) : l.noSoundsHere}
        </p>
      ) : (
        <ul className="vu-audiolib-list" aria-label={title}>
          {list.tracks.map((track) => {
            const playing = previewing?.id === track.id;
            const busy = adding === track.id;
            const who =
              track.artist ??
              (track.credit && track.credit !== library.notice
                ? track.credit
                : track.kind === 'sound'
                  ? l.soundKind
                  : l.musicKind);
            const meta = [formatLength(track.duration), who].filter(Boolean).join(' · ');
            return (
              <li key={track.id} className="vu-audiolib-row" data-playing={playing || undefined}>
                <button
                  type="button"
                  className="vu-audiolib-play"
                  aria-pressed={playing}
                  aria-label={playing ? l.stopPreview(track.title) : l.previewSound(track.title)}
                  data-tooltip={playing ? l.stopPreview(track.title) : l.previewSound(track.title)}
                  onClick={() => void toggle(track)}
                >
                  {playing && previewing.loading ? (
                    <span className="vu-spinner" aria-hidden="true" />
                  ) : (
                    <Icon name={playing ? 'stop' : 'play'} size={16} />
                  )}
                </button>
                <span className="vu-audiolib-text">
                  <span className="vu-audiolib-name">{track.title}</span>
                  <span className="vu-audiolib-meta">{meta}</span>
                </span>
                <button
                  type="button"
                  className="vu-audiolib-add"
                  aria-label={busy ? l.addingSound(track.title) : l.addSound(track.title)}
                  aria-busy={busy || undefined}
                  aria-disabled={(adding && !busy) || undefined}
                  data-tooltip={busy ? l.addingSound(track.title) : l.addSound(track.title)}
                  onClick={() => void add(track)}
                >
                  {busy ? (
                    <span className="vu-spinner" aria-hidden="true" />
                  ) : (
                    <Icon name="plus" size={16} />
                  )}
                  <span>{l.add}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {list.status === 'ready' && list.next ? (
        <Button
          label={l.showMore}
          variant="secondary"
          className="vu-wide"
          disabledReason={list.more ? l.libraryLoading : null}
          onClick={showMore}
        />
      ) : null}
      {library.notice ? <p className="vu-audiolib-notice">{library.notice}</p> : null}
    </section>
  );
}
