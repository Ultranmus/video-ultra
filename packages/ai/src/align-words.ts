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

/**
 * Moves word times that a recogniser put in silence onto the voice (DECISIONS #165). Whisper
 * stretches the first word after a silence back over it ("Welcome" 0–12 s when the speech starts
 * at 15 s), so captions showed before anyone spoke. A word that starts where there's no voice
 * starts where the voice does — only when a later word's own time holds voice (quiet or music-
 * heavy sound is left alone) — and words moved together share the time up to the next word that
 * wasn't moved, by length. Order is kept; times are seconds within `audio`.
 */
export function snapToVoice(
  words: readonly TranscriptWord[],
  audio: Float32Array,
): TranscriptWord[] {
  const voiced = voicedFrames(audio);
  if (voiced.length === 0 || words.length === 0) return words.map((w) => ({ ...w }));
  const on = new Uint8Array(Math.floor(audio.length / FRAME));
  for (const f of voiced) on[f] = 1;
  const frame = (t: number) => Math.max(0, Math.min(on.length, Math.round(t / FRAME_SECONDS)));
  const hasVoice = (a: number, b: number) => {
    for (let f = frame(a); f < frame(b); f++) if (on[f]) return true;
    return false;
  };
  const firstVoice = (from: number, limit: number) => {
    for (let f = frame(from); f < frame(limit); f++) if (on[f]) return f * FRAME_SECONDS;
    return null;
  };
  // Where each word starts on the voice (null: it already does, or no voice to move it to).
  const moved: (number | null)[] = words.map((w, i) => {
    if (on[frame(w.start)]) return null;
    // The voice it belongs to: up to the end of the first word (from this one) that holds voice.
    let limit: number | null = null;
    for (let j = i; j < words.length; j++)
      if (hasVoice(words[j]!.start, words[j]!.end)) {
        limit = words[j]!.end;
        break;
      }
    if (limit === null) return null;
    const at = firstVoice(w.start, limit);
    return at !== null && at > w.start + FRAME_SECONDS ? at : null;
  });
  const out = words.map((w) => ({ ...w }));
  for (let i = 0; i < out.length;) {
    if (moved[i] === null) {
      i++;
      continue;
    }
    // A run of moved words that land on the same voice: share it up to the next word's start.
    let j = i;
    while (j + 1 < out.length && moved[j + 1] !== null && moved[j + 1]! <= moved[i]! + 0.05) j++;
    const from = moved[i]!;
    const next = j + 1 < out.length ? out[j + 1]!.start : Math.max(from, words[j]!.end);
    const to = Math.max(
      from + FRAME_SECONDS * (j - i + 1),
      Math.min(next, Math.max(from, words[j]!.end)),
    );
    const weights = out.slice(i, j + 1).map((w) => spokenLength(w.text));
    const total = weights.reduce((a, b) => a + b, 0);
    let at = 0;
    for (let k = i; k <= j; k++) {
      out[k]!.start = from + ((to - from) * at) / total;
      at += weights[k - i]!;
      out[k]!.end = Math.max(out[k]!.start, from + ((to - from) * at) / total);
    }
    i = j + 1;
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
