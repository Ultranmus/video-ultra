import type { TranscriptWord } from '@video-ultra/core';

/**
 * Times words from the sound they were heard in (DECISIONS #163), for a speech service that
 * gives the words but no usable times (Gemini's drift by seconds over 30 s). The voice is where
 * the sound is loud enough (20 ms frames, gaps under 200 ms filled); words share it by length
 * (a digit counts as a few letters: "15" is said "fifteen"). A phrase end (punctuation) is
 * pinned to the nearest real pause when one is within 1.5 s of voice, so sentences start when
 * the speaker does. Measured against the on-device model's times: 0.14–0.25 s mean error on
 * three English clips (one over music), where Gemini's own were off by up to 11 s.
 */
export function alignWords(words: readonly string[], audio: Float32Array): TranscriptWord[] {
  const voiced = voicedFrames(audio);
  if (words.length === 0 || voiced.length === 0) return [];
  const pauses: number[] = [];
  for (let i = 1; i < voiced.length; i++) if (voiced[i]! - voiced[i - 1]! > FILL) pauses.push(i);
  const weights = words.map(spokenLength);
  const total = weights.reduce((a, b) => a + b, 0);
  // [word index, voiced index] pairs the words are spread between.
  const anchors: [number, number][] = [[0, 0]];
  let done = 0;
  let lastPause = 0;
  words.forEach((word, i) => {
    done += weights[i]!;
    if (!PHRASE_END.test(word) || i === words.length - 1) return;
    const ideal = (done / total) * voiced.length;
    let best = -1;
    for (const p of pauses)
      if (p > lastPause && (best < 0 || Math.abs(p - ideal) < Math.abs(best - ideal))) best = p;
    if (best >= 0 && Math.abs(best - ideal) <= TOLERANCE) {
      anchors.push([i + 1, best]);
      lastPause = best;
    }
  });
  anchors.push([words.length, voiced.length]);
  const at = (v: number) => voiced[Math.max(0, Math.min(voiced.length - 1, v))]! * FRAME_SECONDS;
  const out: TranscriptWord[] = [];
  for (let k = 0; k < anchors.length - 1; k++) {
    const [w0, v0] = anchors[k]!;
    const [w1, v1] = anchors[k + 1]!;
    const span = weights.slice(w0, w1).reduce((a, b) => a + b, 0) || 1;
    let before = 0;
    for (let i = w0; i < w1; i++) {
      const from = v0 + Math.floor((before / span) * (v1 - v0));
      before += weights[i]!;
      const to = Math.max(from, v0 + Math.ceil((before / span) * (v1 - v0)) - 1);
      out.push({ text: words[i]!, start: at(from), end: at(to) + FRAME_SECONDS });
    }
  }
  return out;
}

/** Share of a piece with voice in it (0…1): under a few percent, nobody speaks. */
export function voicedShare(audio: Float32Array): number {
  const frames = Math.floor(audio.length / FRAME);
  return frames ? voicedFrames(audio).length / frames : 0;
}

const FRAME = 320; // 20 ms at 16 kHz
const FRAME_SECONDS = 0.02;
/** Quiet gaps up to this many frames (200 ms) are inside the speech, not pauses. */
const FILL = 10;
/** How far (frames of voice, 1.5 s) a phrase end may move to reach a pause. */
const TOLERANCE = 75;
const PHRASE_END = /[.,!?;:।۔]$/;

function spokenLength(word: string): number {
  const plain = word.replace(/[^\p{L}\p{N}\p{M}]/gu, '');
  const digits = plain.match(/\p{N}/gu)?.length ?? 0;
  return Math.max(1, plain.length - digits + digits * 4);
}

/** Indices of the 20 ms frames with voice: louder than −44 dBFS and the piece's noise floor. */
function voicedFrames(audio: Float32Array): number[] {
  const n = Math.floor(audio.length / FRAME);
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) sum += audio[i]! * audio[i]!;
    rms[f] = Math.sqrt(sum / FRAME);
  }
  const floor = Float32Array.from(rms).sort()[Math.floor(n * 0.1)] ?? 0;
  const threshold = Math.max(0.006, floor * 3);
  const on = new Uint8Array(n);
  let last = -1;
  for (let f = 0; f < n; f++) {
    if (rms[f]! <= threshold) continue;
    if (last >= 0 && f - last <= FILL) on.fill(1, last, f);
    on[f] = 1;
    last = f;
  }
  const out: number[] = [];
  for (let f = 0; f < n; f++) if (on[f]) out.push(f);
  return out;
}
