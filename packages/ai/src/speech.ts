import type { SpeechGenerator, SpeechRequest, SpeechVoice } from '@video-ultra/core';

/** Options of {@link createSpeechEndpoint}. */
export interface SpeechEndpointOptions {
  /**
   * An OpenAI-compatible `/audio/speech` URL — your own server or proxy (it adds the key), a
   * hosted service, or a self-hosted open voice model with that API.
   */
  endpoint: string;
  /** Model name sent as `model`. */
  model?: string;
  /** The voices to offer. Default: the six common OpenAI-style voice ids. */
  voices?: SpeechVoice[];
  /** Audio format asked for (default `mp3`). */
  format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';
  headers?: Record<string, string>;
  /** For tests / custom transports. */
  fetch?: typeof fetch;
}

const DEFAULT_VOICES: SpeechVoice[] = [
  { id: 'alloy', name: 'Alloy' },
  { id: 'echo', name: 'Echo' },
  { id: 'fable', name: 'Fable' },
  { id: 'onyx', name: 'Onyx' },
  { id: 'nova', name: 'Nova' },
  { id: 'shimmer', name: 'Shimmer' },
];

/**
 * A {@link SpeechGenerator} for OpenAI-compatible `/audio/speech` endpoints (v0.4).
 *
 * ```tsx
 * import { createSpeechEndpoint } from '@video-ultra/ai';
 * <VideoEditor speech={createSpeechEndpoint({ endpoint: '/api/speech' })} />
 * ```
 */
export function createSpeechEndpoint(options: SpeechEndpointOptions): SpeechGenerator {
  const call = options.fetch ?? fetch.bind(globalThis);
  const format = options.format ?? 'mp3';
  return {
    voices: () => options.voices ?? DEFAULT_VOICES,
    async speak(request: SpeechRequest): Promise<Blob> {
      const response = await call(options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
        body: JSON.stringify({
          ...(options.model ? { model: options.model } : {}),
          input: request.text,
          voice: request.voice,
          speed: Math.min(2, Math.max(0.5, request.speed)),
          response_format: format,
        }),
        signal: request.signal,
      });
      if (!response.ok) throw new Error(`The voice service answered ${response.status}`);
      const blob = await response.blob();
      const type =
        blob.type && blob.type !== 'application/octet-stream'
          ? blob.type
          : `audio/${format === 'mp3' ? 'mpeg' : format}`;
      return new Blob([blob], { type });
    },
  };
}
