import type { Metadata } from 'next';
import { Code, Note, PageNav } from '../parts';

export const metadata: Metadata = { title: 'AI features' };

export default function Ai() {
  return (
    <article>
      <h1>AI features</h1>
      <Code lang="sh">{`npm install @video-ultra/ai`}</Code>
      <h2>Background removal (on the device)</h2>
      <Code lang="tsx">{`
import { createBackgroundRemover } from '@video-ultra/ai';

<VideoEditor backgroundRemover={createBackgroundRemover()} />;
`}</Code>
      <p>
        Removes the background of photos and image stickers on the device (a small model on phones,
        a sharper one on computers); nothing is uploaded and it can be undone.
      </p>
      <h2>AI editing (through your server)</h2>
      <Code lang="tsx">{`
import { createChatAssistant } from '@video-ultra/ai';

<VideoEditor assistant={createChatAssistant({ endpoint: '/api/assistant' })} />;
`}</Code>
      <p>
        An Assistant panel where people type what they want — &quot;make it warmer&quot;, &quot;add
        a title at the start&quot;, &quot;a fade between every clip&quot;. Your endpoint forwards to
        any OpenAI-compatible chat model; a description of the project (no media) is sent, and the
        answer is applied as one undo step. Keep the API key on your server.
      </p>
      <h2>Text to speech (through your server)</h2>
      <Code lang="tsx">{`
import { createSpeechEndpoint } from '@video-ultra/ai';

<VideoEditor speech={createSpeechEndpoint({ endpoint: '/api/speech' })} />;
`}</Code>
      <p>
        &quot;Text to speech&quot; in the Audio panel and &quot;Read aloud&quot; on texts add a
        spoken sound clip, from any OpenAI-compatible <code>/audio/speech</code> endpoint.
      </p>
      <p>
        The Speed slider works with every voice service: when yours ignores the speed, pass{' '}
        <code>appliesSpeed: false</code> (or leave <code>appliesSpeed</code> out of your own{' '}
        <code>SpeechGenerator</code>) and the editor asks for normal speed, then plays the clip at
        the chosen speed with the voice&apos;s pitch kept.
      </p>
      <Note>
        The demo app&apos;s <code>/api/assistant</code> and <code>/api/speech</code> routes show the
        server side.
      </Note>
      <PageNav href="/docs/ai" />
    </article>
  );
}
