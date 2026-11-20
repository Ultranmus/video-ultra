import type { SpeechGenerator, SpeechVoice } from '@video-ultra/core';
import { createSpeechEndpoint } from '@video-ultra/ai';

/**
 * The playground's voice: the server's voice service behind `/api/speech` (the key stays on the
 * server), with that service's voices. The editor page offers it only when the server has one.
 * `appliesSpeed`: the service changes its own pace; otherwise (Google's speech models, or no
 * service while a check mocks it) the editor plays the clip at the chosen speed, pitch kept.
 * Not part of the package.
 */
export function createPlaygroundSpeech(
  voices: SpeechVoice[] | undefined,
  appliesSpeed: boolean,
): SpeechGenerator {
  return createSpeechEndpoint({
    endpoint: '/api/speech',
    appliesSpeed,
    ...(voices ? { voices } : {}),
  });
}
