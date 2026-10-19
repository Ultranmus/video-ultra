import type { Metadata } from 'next';
import { Code, Note, PageNav } from '../parts';

export const metadata: Metadata = { title: 'Getting started' };

export default function GettingStarted() {
  return (
    <article>
      <h1>Getting started</h1>
      <h2>Install</h2>
      <Code lang="sh">{`npm install @video-ultra/react`}</Code>
      <p>
        React 18 or 19. The engine (<code>@video-ultra/core</code>) comes with it.
      </p>

      <h2>Show the editor</h2>
      <Code lang="tsx">{`
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';

export function Editor() {
  return (
    <div style={{ height: '100dvh' }}>
      <VideoEditor />
    </div>
  );
}
`}</Code>
      <p>
        The editor fills its container — give the container a height. It chooses the phone, tablet
        or desktop layout from its own width (container queries), so it works the same in a full
        page, a modal or a side panel.
      </p>
      <Note>
        The page must be secure (<code>https://</code>, or <code>localhost</code> while developing):
        browsers only offer WebCodecs, the private file system and audio worklets there. To try it
        on a phone on the same Wi-Fi, run your dev server over https.
      </Note>

      <h2>Keep the work</h2>
      <p>
        The editor autosaves to the browser for crash recovery. To keep a project for good, store
        what <code>onSave</code> gives you (plain JSON) and pass it back as{' '}
        <code>initialProject</code>:
      </p>
      <Code lang="tsx">{`
<VideoEditor
  initialProject={savedProject}
  onSave={async (project) => {
    await fetch('/api/projects/42', { method: 'PUT', body: JSON.stringify(project) });
  }}
  onExport={({ blob, extension }) => download(blob, 'my-video.' + extension)}
/>
`}</Code>
      <p>
        Media files stay on the device (the browser&apos;s private storage). To keep them with the
        project on your side, see <a href="/docs/saving">Saving and projects</a>.
      </p>

      <h2>When a device can&apos;t run it</h2>
      <p>
        Browsers without WebCodecs get a clear message in the editor. Pass{' '}
        <code>onUnsupported</code> to do something else (offer an upload instead, say).
      </p>
      <PageNav href="/docs/getting-started" />
    </article>
  );
}
