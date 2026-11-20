import { EditorClient } from './editor-client';
import { captionsService, speechSetup } from '../api/speech/config';

// Read the keys on each request, not once at build time: a key added on the host later still
// turns text to speech and service captions on (a prerendered page kept them hidden).
export const dynamic = 'force-dynamic';

/**
 * The plain editor, full screen (editor-client.tsx). Here on the server: whether text to speech has a
 * voice service (and its voices), so the editor never offers it when it can't speak, and
 * whether captions have a service (else English on the device).
 */
export default function EditorPage() {
  return <EditorClient speech={speechSetup()} captions={captionsService()} />;
}
