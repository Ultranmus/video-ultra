'use client';

/**
 * "Get the code": a dialog with this setup as React props or CSS, and a copy button.
 * A native <dialog> (focus stays inside, Esc closes, focus returns to the button).
 */
import { useEffect, useRef, useState } from 'react';
import { CopyButton } from '../copy-button';
import { cssCode, propsCode, type Setup } from './options';

export function CodeDialog({ setup, onClose }: { setup: Setup; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [as, setAs] = useState<'props' | 'css'>('props');
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const code = as === 'css' ? cssCode(setup) : propsCode(setup);
  return (
    <dialog
      ref={ref}
      className="pg-dialog"
      aria-labelledby="pg-code-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop (the dialog itself, outside its box) closes it.
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="pg-dialog-box">
        <div className="pg-dialog-head">
          <div>
            <h2 id="pg-code-title">Your editor, in code</h2>
            <p>Paste it where the editor goes in your app.</p>
          </div>
          <button
            type="button"
            className="pg-dialog-close"
            aria-label="Close"
            onClick={() => ref.current?.close()}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6 6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="pg-dialog-bar">
          <div className="pg-choice" role="group" aria-label="Code as">
            {(['props', 'css'] as const).map((c) => (
              <button key={c} type="button" aria-pressed={as === c} onClick={() => setAs(c)}>
                {c === 'props' ? 'React props' : 'CSS'}
              </button>
            ))}
          </div>
          <CopyButton text={code} label="Copy the code" className="pg-copy" />
        </div>
        <pre className="pg-dialog-code" tabIndex={0} aria-label="Code for this setup">
          <code data-testid="pg-code">{code}</code>
        </pre>
        <p className="pg-dialog-note">
          {as === 'props'
            ? 'Services (music library, captions, assistant, background removal) are your own objects: see the docs for each.'
            : 'For apps that theme with a stylesheet. Load it after @video-ultra/react/styles.css.'}
        </p>
      </div>
    </dialog>
  );
}
