import type { SpeechGenerator } from '@video-ultra/core';
import { createSpeechEndpoint } from '@video-ultra/ai';

/**
 * The playground's voice: the server's voice service behind `/api/speech` when it has a key,
 * otherwise an offline demo that "speaks" a soft tone per syllable — enough to try the flow
 * without an account. Not part of the package.
 */
export function createPlaygroundSpeech(): SpeechGenerator {
  const remote = createSpeechEndpoint({ endpoint: '/api/speech' });
  let offline = false;
  return {
    voices: () => remote.voices(),
    async speak(request) {
      if (!offline) {
        try {
          return await remote.speak(request);
        } catch (error) {
          if (!String(error).includes('501')) throw error;
          offline = true;
        }
      }
      return demoVoice(request.text, request.voice, request.speed);
    },
  };
}

/** A WAV of gliding tones, one per syllable-ish chunk, pitch by voice (offline demo). */
export function demoVoice(text: string, voice: string, speed: number): Blob {
  const rate = 24000;
  const syllables = text.match(/[aeiouy]+[^aeiouy\s]*|\S+/gi) ?? ['-'];
  const pitch = 110 + (voice.charCodeAt(0) % 6) * 30;
  const syllable = Math.round((0.17 / speed) * rate);
  const gap = Math.round((0.04 / speed) * rate);
  const pcm = new Int16Array(syllables.length * (syllable + gap) + rate / 4);
  let at = 0;
  syllables.forEach((s, i) => {
    const f0 =
      pitch * (1 + 0.12 * Math.sin(i * 1.7)) * (s.endsWith('.') || s.endsWith('?') ? 0.85 : 1);
    let phase = 0;
    for (let n = 0; n < syllable; n++) {
      const t = n / syllable;
      phase += (2 * Math.PI * f0 * (1 - 0.1 * t)) / rate;
      const env = Math.sin(Math.PI * t) ** 0.7;
      // A buzzy voice-ish tone: the fundamental and a few harmonics.
      const v = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase);
      pcm[at + n] = Math.round(v * env * 7000);
    }
    at += syllable + gap;
  });
  const header = new DataView(new ArrayBuffer(44));
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  header.setUint32(4, 36 + pcm.byteLength, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  str(36, 'data');
  header.setUint32(40, pcm.byteLength, true);
  return new Blob([header.buffer, pcm.buffer], { type: 'audio/wav' });
}
