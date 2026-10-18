/**
 * The transcriber interface (v0.2 A4, DECISIONS #115): audio in, timed words out. The optional
 * `@video-ultra/captions` package provides an on-device one; a host can plug in any other (its
 * own server, a cloud service) by implementing this. Times here are seconds from the start of
 * the audio it was given — the editor maps them onto the timeline.
 */

/** One recognised word and when it is spoken (seconds from the start of the audio). */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

/** Progress of a transcription, for a progress bar. */
export interface TranscribeProgress {
  /** `download`: fetching the speech model (first use only); `transcribe`: listening. */
  stage: 'download' | 'transcribe';
  /** 0…1. */
  fraction: number;
  /** Bytes downloaded so far / in total (download stage). */
  loaded?: number;
  total?: number;
}

/** What the editor hands a transcriber. */
export interface TranscribeRequest {
  /**
   * The sound, as 16 kHz mono PCM in order, in pieces of at most 30 s (so memory stays flat on
   * long videos). Pieces follow each other with no gap.
   */
  audio: AsyncIterable<Float32Array>;
  /** Length of the whole sound in seconds (for progress). */
  duration: number;
  /** Spoken language as an ISO 639-1 code (`'en'`, `'hi'`, …), or `'auto'` to detect it. */
  language: string;
  /** Cancels the transcription; the promise then rejects with an `AbortError`. */
  signal: AbortSignal;
  onProgress?: (progress: TranscribeProgress) => void;
}

/** The result: every word with its time, and the language heard. */
export interface TranscribeResult {
  words: TranscriptWord[];
  language: string;
}

/** Turns speech into timed words. Implement this to use your own speech service. */
export interface Transcriber {
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
  /** Frees its model / worker (optional). */
  dispose?(): void;
}

/** Sample rate the editor gives transcribers. */
export const TRANSCRIBE_SAMPLE_RATE = 16_000;
