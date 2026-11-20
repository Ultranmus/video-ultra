'use client';

import { useState } from 'react';

const PLAY = 'M8 5.5v13l10.5-6.5z';
const COPY = 'M9 9h10v10H9zM5 15V5h10';
const CHECK = 'M5 12.5l4.5 4.5L19 7.5';

function Icon({ d, fill = false }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
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

/**
 * The editor on the home page. It starts as a picture (the editor itself is heavy: workers,
 * decoders), so the page stays fast on any phone. "Try it here" loads the real editor in place
 * on wide screens; on phones it opens the editor full screen, where it has room.
 */
export function LiveDemo() {
  const [live, setLive] = useState(false);
  const start = () => {
    if (window.matchMedia('(max-width: 760px)').matches) window.location.assign('/editor');
    else setLive(true);
  };
  return (
    <figure className="home-demo">
      <div className="home-demo-bar">
        <span className="home-demo-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="home-demo-title">{live ? 'Live editor' : 'VideoUltra editor'}</span>
        <a href="/editor" className="home-demo-full">
          Open full screen
        </a>
      </div>
      <div className="home-demo-view">
        {live ? (
          <iframe
            src="/editor"
            title="VideoUltra live editor"
            allow="fullscreen; camera; microphone; clipboard-write; autoplay"
          />
        ) : (
          <>
            <img
              src="/home/editor.jpg"
              alt="The VideoUltra editor: a clip on the timeline, its picture in the preview, and the ratio choices beside it."
              width={1680}
              height={828}
            />
            <button type="button" className="home-demo-play" onClick={start}>
              <Icon d={PLAY} fill />
              <span className="home-wide">Try it here</span>
              <span className="home-narrow">Open the editor</span>
            </button>
          </>
        )}
      </div>
      <figcaption>
        Runs in your browser; nothing is uploaded. Footage: Big Buck Bunny © Blender Foundation, CC
        BY 3.0.
      </figcaption>
    </figure>
  );
}

/** The install command with a copy button. */
export function Install({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard (an insecure page, or denied): the command stays selectable.
    }
  };
  return (
    <div className="home-install">
      <code>{command}</code>
      <button type="button" onClick={() => void copy()} aria-label="Copy the install command">
        <Icon d={copied ? CHECK : COPY} />
      </button>
      <span className="home-sr" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  );
}
