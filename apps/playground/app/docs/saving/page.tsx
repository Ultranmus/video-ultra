import type { Metadata } from 'next';
import { Code, Note, PageNav } from '../parts';

export const metadata: Metadata = { title: 'Saving and projects' };

export default function Saving() {
  return (
    <article>
      <h1>Saving and projects</h1>
      <h2>A project is JSON</h2>
      <p>
        Everything the user does is an edit to a <code>Project</code> — plain JSON: the canvas size,
        the tracks and their items, and the media files they use (assets). Nothing is ever written
        into the media itself. Projects are validated when they open and carry a file version; older
        files are upgraded automatically, so a project saved today always opens later.
      </p>
      <Code lang="ts">{`
import { parseProject } from '@video-ultra/core';

const result = parseProject(json); // a string or an object
if (result.ok) open(result.project); // result.warnings: anything that was repaired
else showError(result.error);
`}</Code>

      <h2>Three ways to keep work</h2>
      <ul>
        <li>
          <strong>Autosave (built in, on by default):</strong> each edit goes into the
          browser&apos;s private file system, with crash recovery; reopening the editor brings the
          last project back. Turn it off with <code>autosave={'{false}'}</code>.
        </li>
        <li>
          <strong>Your storage:</strong> <code>onSave(project)</code> runs about a second after each
          edit. Store the JSON and pass it back as <code>initialProject</code>. This is the durable
          save — browsers may clear their own storage.
        </li>
        <li>
          <strong>Your videos:</strong> with autosave on, the top bar&apos;s Your videos lets people
          keep several videos on the device, make a copy of one (the media is shared, not copied),
          start a new one or delete one. Hide it with{' '}
          <code>customize={"{{ hide: ['videos'] }}"}</code> when your app has its own list.
        </li>
      </ul>

      <h2>Media files</h2>
      <p>
        Imported files are copied into the browser&apos;s private storage (in pieces, never all in
        memory) and the project refers to them by id. To keep media on your side — so a project
        opens on another device — store the files yourself, give assets a <code>url</code> source
        and answer <code>resolveMedia</code>:
      </p>
      <Code lang="tsx">{`
<VideoEditor
  initialProject={project}
  resolveMedia={async (asset) => {
    if (asset.source.type !== 'url') return null; // let the editor use its own storage
    const response = await fetch(asset.source.url);
    return response.ok ? response.blob() : null;
  }}
/>
`}</Code>
      <Note>
        Exports never depend on the network: stickers, templates and library sounds are stored in
        the project when they&apos;re added.
      </Note>

      <h2>Export</h2>
      <p>
        People export from the Export button: MP4 (H.264, or HEVC / AV1 where the device can encode
        them) or WebM, a part of the video, sound only (M4A, Ogg, WAV) or one frame as a picture.
        You get the files through <code>onExport</code>, <code>onExportAudio</code> and{' '}
        <code>onSaveFrame</code>. Exports run in a worker, stream to disk and can be cancelled.
      </p>
      <PageNav href="/docs/saving" />
    </article>
  );
}
