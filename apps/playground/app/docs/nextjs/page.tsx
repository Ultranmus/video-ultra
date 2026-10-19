import type { Metadata } from 'next';
import { Code, Note, PageNav } from '../parts';

export const metadata: Metadata = { title: 'Next.js' };

export default function NextJs() {
  return (
    <article>
      <h1>Next.js</h1>
      <p className="docs-lead">
        No config needed: the package marks itself as a client component and is safe to render on
        the server.
      </p>
      <h2>App Router</h2>
      <Code lang="tsx">{`
// app/edit/[id]/editor.tsx
'use client';

import { VideoEditor, type Project } from '@video-ultra/react';
import '@video-ultra/react/styles.css';
import { saveProject } from './actions';

export function Editor({ id, project }: { id: string; project: Project | null }) {
  return (
    <div style={{ height: '100dvh' }}>
      <VideoEditor
        initialProject={project ?? undefined}
        onSave={(p) => saveProject(id, p)}
      />
    </div>
  );
}
`}</Code>
      <Code lang="ts">{`
// app/edit/[id]/actions.ts
'use server';

import type { Project } from '@video-ultra/core';

export async function saveProject(id: string, project: Project) {
  await db.projects.update(id, { json: JSON.stringify(project) });
}
`}</Code>
      <Code lang="tsx">{`
// app/edit/[id]/page.tsx (a server component)
import { parseProject } from '@video-ultra/core';
import { Editor } from './editor';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.projects.get(id);
  const parsed = row ? parseProject(row.json) : null; // validates, migrates old files
  return <Editor id={id} project={parsed?.ok ? parsed.project : null} />;
}
`}</Code>
      <p>
        <code>@video-ultra/core</code> works on the server too: <code>parseProject</code> checks and
        upgrades a saved project, and the edit operations (<code>insertMain</code>,{' '}
        <code>updateItem</code>, …) build or change projects without a browser.
      </p>
      <Note>
        Phones on your Wi-Fi need https: <code>next dev --experimental-https</code>.
      </Note>
      <p>
        A complete app (a server component loading the project, a server action saving it) is in{' '}
        <code>apps/examples/nextjs</code> in the repository.
      </p>
      <h2>Pages Router</h2>
      <p>
        The same component works in a page; import the stylesheet in that page or in{' '}
        <code>_app.tsx</code>.
      </p>
      <PageNav href="/docs/nextjs" />
    </article>
  );
}
