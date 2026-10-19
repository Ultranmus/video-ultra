import type { Metadata } from 'next';
import { Code, PageNav } from '../parts';

export const metadata: Metadata = { title: 'Vite' };

export default function Vite() {
  return (
    <article>
      <h1>Vite</h1>
      <p className="docs-lead">One setting: workers as ES modules.</p>
      <Code lang="ts">{`
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
});
`}</Code>
      <Code lang="tsx">{`
// src/main.tsx
import { createRoot } from 'react-dom/client';
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';

createRoot(document.getElementById('root')!).render(
  <div style={{ height: '100dvh' }}>
    <VideoEditor />
  </div>,
);
`}</Code>
      <p>
        The engine&apos;s workers ship inside the package and are found with{' '}
        <code>new URL(…, import.meta.url)</code>, which Vite, Next.js (webpack or Turbopack) and
        other modern bundlers follow — nothing to copy by hand. A working example is in{' '}
        <code>apps/examples/vite</code> in the repository.
      </p>
      <PageNav href="/docs/vite" />
    </article>
  );
}
