import type { Metadata } from 'next';
import { captionsService, speechSetup } from '../api/speech/config';
import { PlaygroundClient } from './playground-client';
import '../site.css';
import './playground.css';

// Read the keys on each request (like /editor): a voice or captions key added later shows up.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Playground · VideoUltra',
  description:
    'Try VideoUltra with your own theme, size, tools and words, and copy the code for your app.',
};

/** The editor with options beside it: theme, size, tools, language and a live event log. */
export default function PlaygroundPage() {
  return <PlaygroundClient speech={speechSetup()} captions={captionsService()} />;
}
