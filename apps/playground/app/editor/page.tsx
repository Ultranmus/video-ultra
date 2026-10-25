import { EditorClient } from './editor-client';
import { captionsService, speechSetup } from '../api/speech/config';

/**
 * The editor, full screen (editor-client.tsx). Here on the server: whether text to speech has a
 * voice service (and its voices), so the editor never offers it when it can't speak, and
 * whether captions have a service (else English on the device).
 */
export default function EditorPage() {
  return <EditorClient speech={speechSetup()} captions={captionsService()} />;
}
