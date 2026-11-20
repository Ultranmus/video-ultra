'use client';

import { useState } from 'react';

const COPY = 'M9 9h10v10H9zM5 15V5h10';
const CHECK = 'M5 12.5l4.5 4.5L19 7.5';

/** Copies `text`; shows a tick for a moment and says "Copied" to screen readers. */
export function CopyButton({
  text,
  label = 'Copy code',
  className = 's-code-copy',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard (an insecure page, or denied): the text stays selectable.
    }
  };
  return (
    <button
      type="button"
      className={className}
      onClick={() => void copy()}
      aria-label={label}
      title={label}
      data-copied={copied ? '' : undefined}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d={copied ? CHECK : COPY}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="site-sr" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
