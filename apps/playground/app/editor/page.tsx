import { EditorClient } from './editor-client';
import { speechSetup } from '../api/speech/config';

/**
 * The editor, full screen (editor-client.tsx). Here on the server: whether text to speech has a
 * voice service (and its voices), so the editor never offers it when it can't speak.
 */
export default function EditorPage() {
  return <EditorClient speech={speechSetup()} />;
}
