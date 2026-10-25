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
      <h2>Your own captions service (any language)</h2>
      <p>
        For other languages, or a speech service you already use, leave out{' '}
        <code>createOnDeviceTranscriber()</code> and connect your own endpoint with{' '}
        <code>createCaptionsEndpoint</code> from <code>@video-ultra/ai</code>. Your endpoint is a
        route on your server: it calls the speech service (its key stays there) and answers in one
        fixed format. The editor sends the sound in 30&nbsp;s pieces, one at a time, skips silence,
        retries a busy service, and turns the words into styled captions in sync with edits.
      </p>
      <Code lang="tsx">{`
import { createCaptionsEndpoint } from '@video-ultra/ai';

<VideoEditor transcriber={createCaptionsEndpoint({ endpoint: '/api/captions' })} />;
`}</Code>
      <h3>What your endpoint receives and answers</h3>
      <p>
        A <code>POST</code> to <code>/api/captions?language=hi</code> (an ISO 639-1 code, or{' '}
        <code>auto</code> to detect). The body is the sound: 32-bit float samples, little-endian,
        16&nbsp;kHz, mono, at most 31&nbsp;s. Answer:
      </p>
      <Code lang="json">{`
{
  "words": [
    { "text": "नमस्ते,", "start": 0.42, "end": 0.9 },
    { "text": "दोस्तों।", "start": 0.95, "end": 1.6 }
  ],
  "language": "hi"
}
`}</Code>
      <ul>
        <li>
          <strong>Times</strong> are seconds from the start of that piece. Give them when your
          service has them (most speech-to-text services do) — the word-by-word highlight follows
          them. Without times (<code>{`"words": ["नमस्ते,", "दोस्तों।"]`}</code>) the words are
          timed from the sound itself: close on steady speech, less exact.
        </li>
        <li>
          <strong>language</strong> is the language actually spoken. If none of the video was in the
          language chosen, the editor says which one it heard (&ldquo;This sounds like Hindi, not
          French&rdquo;) instead of making wrong captions.
        </li>
        <li>
          Chinese, Japanese, Thai and other scripts written without spaces work as they come: the
          editor joins and wraps them without spaces and highlights them character by character.
        </li>
      </ul>
      <p>
        Pass <code>languages</code> (e.g. <code>{`['en', 'hi', 'auto']`}</code>) to offer only the
        ones your service hears; by default the panel offers about 100 and Detect.
      </p>
      <Note>
        A speech-to-text service with the OpenAI transcription API (OpenAI, Groq, or a self-hosted
        Whisper server) returns exactly these words and times with{' '}
        <code>response_format: verbose_json</code> and word timestamps — map{' '}
        <code>words[].word</code> to <code>text</code>. The playground&apos;s own route does this.
      </Note>
      <h3>Fully custom</h3>
      <p>
        You can also implement <code>Transcriber</code> (from <code>@video-ultra/core</code>)
        yourself: the editor hands you the sound as 16&nbsp;kHz mono pieces and expects{' '}
        <code>{`{ words: [{ text, start, end }], language }`}</code> for the whole video.
      </p>
      <PageNav href="/docs/captions" />
    </article>
  );
}
