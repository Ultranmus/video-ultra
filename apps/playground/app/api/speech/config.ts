import type { SpeechVoice } from '@video-ultra/core';

/** The voice service's key on the server (`SPEECH_API_KEY`, else `ASSISTANT_API_KEY`). */
export const speechKey = (): string | undefined =>
  process.env.SPEECH_API_KEY ?? process.env.ASSISTANT_API_KEY;

/**
 * The captions service `/api/captions` uses (DECISIONS #164), first one set up wins:
 * 1. `CAPTIONS_API_KEY`: a speech-to-text service with the OpenAI transcription API — real word
 *    times, ~99 languages. Groq for a `gsk_` key, else OpenAI; `CAPTIONS_URL` / `CAPTIONS_MODEL`
 *    for another (e.g. a self-hosted Whisper server).
 * 2. A Google key (the voice key): Gemini — any language, words timed from the sound.
 * Null: none (the editor captions English on the device).
 */
export function captionsSetup():
  | { kind: 'transcription'; key: string; url: string; model: string }
  | { kind: 'gemini'; key: string }
  | null {
  const key = process.env.CAPTIONS_API_KEY;
  if (key) {
    const groq = key.startsWith('gsk_');
    return {
      kind: 'transcription',
      key,
      url:
        process.env.CAPTIONS_URL ??
        (groq
          ? 'https://api.groq.com/openai/v1/audio/transcriptions'
          : 'https://api.openai.com/v1/audio/transcriptions'),
      // Groq: large-v3 times words a little better than turbo (measured 2026-10-25).
      model: process.env.CAPTIONS_MODEL ?? (groq ? 'whisper-large-v3' : 'whisper-1'),
    };
  }
  const google = speechProvider() === 'gemini' ? speechKey() : undefined;
  return google ? { kind: 'gemini', key: google } : null;
}

/** Whether `/api/captions` can make captions. */
export const captionsService = (): boolean => captionsSetup() !== null;

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
