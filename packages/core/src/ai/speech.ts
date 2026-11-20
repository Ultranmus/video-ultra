/**
 * Text to speech (v0.4, optional): the editor hands text to a {@link SpeechGenerator} and adds
 * the spoken audio as a sound clip. `@video-ultra/ai` has `createSpeechEndpoint` for
 * OpenAI-compatible `/audio/speech` endpoints — a hosted service or a self-hosted open voice
 * model behind your server, so keys never reach the browser.
 */

/** A voice to pick. */
export interface SpeechVoice {
  id: string;
  /** Shown to people. */
  name: string;
  /** BCP-47 tag when known, e.g. `en`, `hi`. */
  language?: string;
}

/** What {@link SpeechGenerator.speak} gets. */
export interface SpeechRequest {
  text: string;
  voice: string;
  /**
   * 0.5…2, 1 = normal. Always 1 unless the generator says it applies the speed itself
   * ({@link SpeechGenerator.appliesSpeed}).
   */
  speed: number;
  signal: AbortSignal;
}

/** Turns text into speech. Implement it to use your own service. */
export interface SpeechGenerator {
  /** The voices to offer (first = default). */
  voices(): SpeechVoice[] | Promise<SpeechVoice[]>;
  /** The speech as an audio file the browser can decode (MP3, WAV, Opus…). */
  speak(request: SpeechRequest): Promise<Blob>;
  /**
   * `true`: the service speaks at {@link SpeechRequest.speed} itself. Otherwise (the default) the
   * editor asks for normal speed and plays the added clip at the chosen speed with the voice's
   * pitch kept ("Keep the voice natural"), so the speed works with any service.
   */
  appliesSpeed?: boolean;
}
