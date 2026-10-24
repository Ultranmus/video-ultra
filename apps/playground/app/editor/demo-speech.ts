import type { SpeechGenerator, SpeechVoice } from '@video-ultra/core';
import { createSpeechEndpoint } from '@video-ultra/ai';

/**
 * The playground's voice: the server's voice service behind `/api/speech` (the key stays on the
 * server), with that service's voices. The editor page offers it only when the server has one.
 * Not part of the package.
 */
export function createPlaygroundSpeech(voices?: SpeechVoice[]): SpeechGenerator {
  return createSpeechEndpoint({ endpoint: '/api/speech', ...(voices ? { voices } : {}) });
}
