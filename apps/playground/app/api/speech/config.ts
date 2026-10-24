import type { SpeechVoice } from '@video-ultra/core';

/** The voice service's key on the server (`SPEECH_API_KEY`, else `ASSISTANT_API_KEY`). */
export const speechKey = (): string | undefined =>
  process.env.SPEECH_API_KEY ?? process.env.ASSISTANT_API_KEY;

/** Which API the key is for. */
export type SpeechProvider = 'openai' | 'gemini';

/**
 * The voice service, or null without a key. `SPEECH_PROVIDER=openai|gemini` says which; else an
 * OpenAI-compatible `SPEECH_URL` or an `sk-` key means OpenAI's format, anything else Google's.
 */
export function speechProvider(): SpeechProvider | null {
  const key = speechKey();
  if (!key) return null;
  const set = process.env.SPEECH_PROVIDER;
  if (set === 'openai' || set === 'gemini') return set;
  return process.env.SPEECH_URL || key.startsWith('sk-') ? 'openai' : 'gemini';
}

/** Google's voices offered in the editor (a few of its prebuilt ones). */
export const GEMINI_VOICES: SpeechVoice[] = [
  { id: 'Kore', name: 'Kore' },
  { id: 'Puck', name: 'Puck' },
  { id: 'Charon', name: 'Charon' },
  { id: 'Aoede', name: 'Aoede' },
  { id: 'Fenrir', name: 'Fenrir' },
  { id: 'Leda', name: 'Leda' },
];

/**
 * What the editor page needs: null = no voice service (text to speech hidden); `voices` unset =
 * the editor's default (OpenAI-style) voices.
 */
export function speechSetup(): { voices?: SpeechVoice[] } | null {
  const provider = speechProvider();
  if (!provider) return null;
  return provider === 'gemini' ? { voices: GEMINI_VOICES } : {};
}
