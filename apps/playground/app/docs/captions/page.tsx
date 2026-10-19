import type { Metadata } from 'next';
import { Code, Note, PageNav } from '../parts';

export const metadata: Metadata = { title: 'Captions' };

export default function Captions() {
  return (
    <article>
      <h1>Captions</h1>
      <p className="docs-lead">
        People can always import <code>.srt</code> / <code>.vtt</code> files or type captions. For
        automatic captions, give the editor a transcriber.
      </p>
      <Code lang="sh">{`npm install @video-ultra/captions`}</Code>
      <Code lang="tsx">{`
import { createOnDeviceTranscriber } from '@video-ultra/captions';

const transcriber = createOnDeviceTranscriber();

<VideoEditor transcriber={transcriber} />;
`}</Code>
      <p>
        Speech becomes timed words on the device, in a worker (WebGPU, or WebAssembly), and nothing
        is uploaded. The model downloads once (tens of MB; a larger one for languages the small
        models hear badly) and is cached. Silence, wind and room noise don&apos;t turn into made-up
        text, and captions say plainly when a browser can&apos;t read the sound.
      </p>
      <Note>
        Long videos on phones take a while; the panel shows progress and can be cancelled. Some
        languages need a computer — the panel says so before starting.
      </Note>
      <h2>Your own service</h2>
      <p>
        Implement <code>Transcriber</code> (from <code>@video-ultra/core</code>): the editor hands
        you the speech as 16 kHz mono pieces and expects timed words back. The editor groups words
        into captions, styles them and keeps them in sync with edits.
      </p>
      <PageNav href="/docs/captions" />
    </article>
  );
}
