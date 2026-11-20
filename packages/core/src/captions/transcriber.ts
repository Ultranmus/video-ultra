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
  /**
   * How sure the recogniser is of this word, 0…1 (optional). Captions whose words average under
   * 0.6 are marked to check.
   */
  confidence?: number;
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
  /**
   * Spoken language as an ISO 639-1 code (`'en'`, …), `'hi-Latn'` for Hinglish (Hindi written in
   * Latin letters), or `'auto'` to detect it (one of `languages`).
   */
  language: string;
  /**
   * Names and words that may be said (people, brands, places), so they're spelled right — for
   * transcribers with `takesVocabulary`. Optional.
   */
  vocabulary?: readonly string[];
  /** Cancels the transcription; the promise then rejects with an `AbortError`. */
  signal: AbortSignal;
  onProgress?: (progress: TranscribeProgress) => void;
}

/** The result: every word with its time, and the language heard. */
export interface TranscribeResult {
  words: TranscriptWord[];
  language: string;
}

/** What transcribing a language would take on this device (shown before starting). */
export interface TranscriberCheck {
  /** False when it can't run here; `reason` says why. */
  available: boolean;
  /** True when it runs on the device (nothing is uploaded). */
  onDevice: boolean;
  /** One-time download in MB (first use only), if any. */
  downloadMB?: number;
  /** Roughly how many seconds of speech it hears per second (for "about N min"). */
  speed?: number;
  reason?: string;
  /**
   * True when it should work but may need more memory than this device can give (a large model
   * on a phone): the editor says so before the user starts.
   */
  memoryRisk?: boolean;
}

/** Turns speech into timed words. Implement this to use your own speech service. */
export interface Transcriber {
  /**
   * Languages it hears (ISO 639-1), plus `'auto'` if it can detect the language. The Captions
   * panel offers only these, and shows no choice when there's one. Default: the panel's own
   * list and Detect.
   */
  readonly languages?: readonly string[];
  /** It uses `TranscribeRequest.vocabulary`: the Captions panel offers a "Names to spell right" field. */
  readonly takesVocabulary?: boolean;
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
  /** Optional: whether and how `language` can be transcribed here, before starting. */
  check?(language: string): Promise<TranscriberCheck>;
  /** Frees its model / worker (optional). */
  dispose?(): void;
}

/** Sample rate the editor gives transcribers. */
export const TRANSCRIBE_SAMPLE_RATE = 16_000;
