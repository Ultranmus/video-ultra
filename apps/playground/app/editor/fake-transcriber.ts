import type { Transcriber, TranscriptWord } from '@video-ultra/core';

/**
 * A stand-in transcriber for automated checks (`?transcriber=fake`): it listens to the whole
 * sound the editor sends (so the audio path is exercised) and "hears" a fixed sentence spread
 * over the parts that aren't silent. Deterministic; no model.
 */
export function createFakeTranscriber(): Transcriber {
  return {
    async check() {
      return { available: true, onDevice: true, downloadMB: 0, speed: 50 };
    },
    async transcribe({ audio, duration, signal, onProgress }) {
      const loud: number[] = [];
      let seconds = 0;
      for await (const piece of audio) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        // One loudness value per second of 16 kHz sound.
        for (let i = 0; i < piece.length; i += 16_000) {
          let sum = 0;
          const end = Math.min(piece.length, i + 16_000);
          for (let k = i; k < end; k++) sum += piece[k]! * piece[k]!;
          loud.push(Math.sqrt(sum / Math.max(1, end - i)));
        }
        seconds += piece.length / 16_000;
        onProgress?.({ stage: 'transcribe', fraction: Math.min(1, seconds / duration) });
      }
      const sentence = 'this is a test caption made from the sound of the video'.split(' ');
      const words: TranscriptWord[] = [];
      let w = 0;
      loud.forEach((level, s) => {
        if (level < 0.001) return;
        for (let k = 0; k < 2; k++) {
          const text = sentence[w++ % sentence.length]!;
          words.push({ text, start: s + k * 0.5, end: s + k * 0.5 + 0.4 });
        }
      });
      return { words, language: 'en' };
    },
  };
}
