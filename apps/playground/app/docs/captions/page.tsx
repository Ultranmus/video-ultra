import type { Metadata } from 'next';
import { Code, Note, PageNav } from '../parts';

export const metadata: Metadata = { title: 'Captions' };

export default function Captions() {
  return (
    <article>
      <h1>Captions</h1>
      <p className="docs-lead">
        People can always import <code>.srt</code> / <code>.vtt</code> files or type captions. For
        automatic captions, give the editor a transcriber: the on-device one for English, or your
        own speech service for any language.
      </p>
      <h2>On the device (English)</h2>
      <Code lang="sh">{`npm install @video-ultra/captions`}</Code>
      <Code lang="tsx">{`
import { createOnDeviceTranscriber } from '@video-ultra/captions';

const transcriber = createOnDeviceTranscriber();

<VideoEditor transcriber={transcriber} />;
`}</Code>
      <p>
        English speech becomes timed words on the device, in a worker, and nothing is uploaded. The
        model downloads once (tens of MB) and is cached. Silence, wind and room noise don&apos;t
        turn into made-up text, and captions say plainly when a browser can&apos;t read the sound.
      </p>
      <Note>
        Long videos on phones take a while; the panel shows progress and can be cancelled. The
        on-device model hears English only, so the panel shows no language choice with it.
      </Note>
      <h2>Your own captions service</h2>
      <p>
        For other languages, or to use a speech service you already pay for, leave out{' '}
        <code>createOnDeviceTranscriber()</code> (and the package) and pass your own{' '}
        <code>Transcriber</code> (from <code>@video-ultra/core</code>). The editor hands you the
        sound as 16 kHz mono pieces of at most 30 s and expects timed words back; it groups them
        into captions, styles them and keeps them in sync with edits. List your service&apos;s
        languages in <code>languages</code> (add <code>&apos;auto&apos;</code> if it can detect the
        language): the panel offers exactly those.
      </p>
      <Code lang="tsx">{`
import type { Transcriber, TranscriptWord } from '@video-ultra/core';

const transcriber: Transcriber = {
  languages: ['en', 'hi', 'es', 'auto'],
  async transcribe({ audio, duration, language, signal, onProgress }) {
    const words: TranscriptWord[] = [];
    let heardLanguage = language;
    let offset = 0;
    // One request per piece: memory stays flat on long videos.
    for await (const piece of audio) {
      const response = await fetch(\`/api/captions?language=\${language}\`, {
        method: 'POST',
        body: piece.slice(), // 32-bit float samples, 16 kHz, mono
        signal,
      });
      if (!response.ok) throw new Error(\`Captions failed (\${response.status})\`);
      const heard: { words: TranscriptWord[]; language: string } = await response.json();
      for (const w of heard.words)
        words.push({ text: w.text, start: w.start + offset, end: w.end + offset });
      heardLanguage = heard.language;
      offset += piece.length / 16_000;
      onProgress?.({ stage: 'transcribe', fraction: Math.min(1, offset / duration) });
    }
    return { words, language: heardLanguage };
  },
};

<VideoEditor transcriber={transcriber} />;
`}</Code>
      <p>
        Your <code>/api/captions</code> route keeps the service&apos;s key on your server: it turns
        the samples into what the service takes (e.g. a WAV file), and answers each word with its
        start and end in seconds from the start of that piece. Pick a service that gives per-word
        times — the word-by-word highlight depends on them. With no transcriber at all, the Captions
        panel offers import and typing only.
      </p>
      <PageNav href="/docs/captions" />
    </article>
  );
}
