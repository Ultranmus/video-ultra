'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CopyButton } from './copy-button';

// The editor is heavy (workers, decoders): its code loads only when the window is near the screen.
const HomeEditor = dynamic(() => import('./home-editor'), {
  ssr: false,
  loading: () => <p className="home-window-loading">Loading the editor…</p>,
});

const PLAY = 'M8 5.5v13l10.5-6.5z';

function Icon({ d, fill = false, size = 18 }: { d: string; fill?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d={d}
        fill={fill ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SIZES = [
  { id: 'desktop', label: 'Desktop', width: 0 },
  { id: 'tablet', label: 'Tablet', width: 820 },
  { id: 'phone', label: 'Phone', width: 393 },
] as const;

/**
 * The editor window: the real editor (loaded when it's near the screen) at desktop, tablet or
 * phone width. On a phone the editor needs the whole screen, so it shows a picture and opens
 * /editor instead.
 */
export function EditorWindow() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [size, setSize] = useState<(typeof SIZES)[number]['id']>('desktop');
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);
  const width = SIZES.find((s) => s.id === size)!.width;
  return (
    <div className="home-window" ref={ref}>
      <div className="home-window-bar">
        <div className="s-seg" role="group" aria-label="Editor size">
          {SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={size === s.id}
              onClick={() => setSize(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="home-window-links">
          <Link href="/playground">Theme it</Link>
          <Link href="/editor">Full screen</Link>
        </div>
      </div>
      <div className="home-window-view" data-size={size}>
        {narrow ? (
          <div className="home-window-phone">
            <img
              src="/home/editor.jpg"
              alt="The VideoUltra editor: a clip on the timeline, its picture in the preview, and the ratio choices beside it."
              width={1680}
              height={828}
            />
            <Link className="s-btn" href="/editor">
              <Icon d={PLAY} fill />
              Open the editor
            </Link>
          </div>
        ) : (
          <div className="home-window-frame" style={width ? { width } : undefined}>
            {near ? <HomeEditor /> : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** The install command with a copy button. */
export function Install({ command }: { command: string }) {
  return (
    <div className="home-install">
      <span aria-hidden="true">$</span>
      <code>{command}</code>
      <CopyButton text={command} label="Copy the install command" className="home-install-copy" />
    </div>
  );
}
