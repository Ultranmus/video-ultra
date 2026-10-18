import type { TranscriptWord } from '@video-ultra/core';
import type { WhisperTokenizer } from './tokenizer';

/**
 * Word times from the decoder's cross-attention (the standard Whisper method): the alignment
 * heads' attention over audio frames is normalised per token, median-filtered over time,
 * averaged, and a dynamic-time-warping path through it says where each token starts. Pure.
 */

/** Seconds per encoder frame (1500 frames for 30 s). */
const FRAME_SECONDS = 0.02;

/**
 * `attention[h][t * frames + f]`: alignment head h, token row t (prompt rows, text, end), frame f.
 * Returns one jump time per row: when that row's token starts (s).
 */
export function tokenStartTimes(
  attention: readonly Float32Array[],
  rows: number,
  frames: number,
  medianWidth = 7,
): Float32Array {
  const matrix = new Float32Array(rows * frames);
  const col = new Float32Array(rows);
  const filtered = new Float32Array(frames);
  const window = new Float32Array(medianWidth);
  for (const head of attention) {
    // Normalise each frame over tokens (mean 0, std 1).
    const z = new Float32Array(rows * frames);
    for (let f = 0; f < frames; f++) {
      let mean = 0;
      for (let t = 0; t < rows; t++) mean += col[t] = head[t * frames + f]!;
      mean /= rows;
      let v = 0;
      for (let t = 0; t < rows; t++) v += (col[t]! - mean) ** 2;
      const std = Math.sqrt(v / Math.max(1, rows - 1)) || 1;
      for (let t = 0; t < rows; t++) z[t * frames + f] = (col[t]! - mean) / std;
    }
    // Median filter along time, then add into the average.
    const half = medianWidth >> 1;
    for (let t = 0; t < rows; t++) {
      const row = t * frames;
      for (let f = 0; f < frames; f++) {
        let n = 0;
        for (let k = -half; k <= half; k++) {
          // Reflect at the edges.
          let i = f + k;
          if (i < 0) i = -i;
          if (i >= frames) i = 2 * frames - i - 2;
          window[n++] = z[row + Math.max(0, Math.min(frames - 1, i))]!;
        }
        filtered[f] = median(window, n);
      }
      for (let f = 0; f < frames; f++) matrix[row + f]! += filtered[f]! / attention.length;
    }
  }
  return dtwJumps(matrix, rows, frames);
}

function median(values: Float32Array, n: number): number {
  const a = Array.from(values.subarray(0, n)).sort((x, y) => x - y);
  return a[n >> 1]!;
}

/** DTW over cost = −matrix; the frame where the path first reaches each row, in seconds. */
function dtwJumps(matrix: Float32Array, rows: number, frames: number): Float32Array {
  const W = frames + 1;
  const cost = new Float64Array((rows + 1) * W).fill(Infinity);
  const trace = new Uint8Array((rows + 1) * W);
  cost[0] = 0;
  for (let j = 1; j <= frames; j++) {
    for (let i = 1; i <= rows; i++) {
      const c0 = cost[(i - 1) * W + (j - 1)]!;
      const c1 = cost[(i - 1) * W + j]!;
      const c2 = cost[i * W + (j - 1)]!;
      let best = c0;
      let t = 0;
      if (c1 < best) {
        best = c1;
        t = 1;
      }
      if (c2 < best) {
        best = c2;
        t = 2;
      }
      cost[i * W + j] = -matrix[(i - 1) * frames + (j - 1)]! + best;
      trace[i * W + j] = t;
    }
  }
  // Backtrack from the end; record (row, frame) pairs.
  let i = rows;
  let j = frames;
  const pathRow: number[] = [];
  const pathFrame: number[] = [];
  for (let j0 = 0; j0 <= frames; j0++) trace[j0] = 2;
  for (let i0 = 0; i0 <= rows; i0++) trace[i0 * W] = 1;
  while (i > 0 || j > 0) {
    pathRow.push(i - 1);
    pathFrame.push(j - 1);
    const t = trace[i * W + j];
    if (t === 0) {
      i--;
      j--;
    } else if (t === 1) i--;
    else j--;
  }
  pathRow.reverse();
  pathFrame.reverse();
  const jumps = new Float32Array(rows + 1);
  let last = -1;
  for (let k = 0; k < pathRow.length; k++) {
    const r = pathRow[k]!;
    if (r >= 0 && r !== last) {
      jumps[r] = Math.max(0, pathFrame[k]!) * FRAME_SECONDS;
      last = r;
    }
  }
  jumps[rows] = frames * FRAME_SECONDS;
  return jumps;
}

const PUNCTUATION = /^[\s"'“”‘’¿([{\-.,!?:;。，、！？：；)\]}…।॥]+$/u;

/**
 * Text tokens + their start times → words. A word starts at a token whose text begins with a
 * space; punctuation joins the word before it. `starts[k]` / `starts[k + 1]` bound token k.
 */
export function wordsFromTokens(
  tokenizer: WhisperTokenizer,
  tokens: readonly number[],
  starts: ArrayLike<number>,
  ends: ArrayLike<number>,
): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let ids: number[] = [];
  let start = 0;
  let end = 0;
  const flush = () => {
    if (!ids.length) return;
    const text = tokenizer.decode(ids);
    const trimmed = text.trim();
    if (trimmed) {
      const prev = words[words.length - 1];
      if (prev && PUNCTUATION.test(trimmed)) {
        prev.text += trimmed;
        prev.end = Math.max(prev.end, end);
      } else words.push({ text: trimmed, start, end: Math.max(end, start + 0.02) });
    }
    ids = [];
  };
  // Whole characters first: a multi-byte character can span tokens.
  let pending: number[] = [];
  let pendingStart = 0;
  for (let k = 0; k < tokens.length; k++) {
    if (!pending.length) pendingStart = starts[k]!;
    pending.push(tokens[k]!);
    const text = tokenizer.decode(pending);
    if (text.includes('�') && k < tokens.length - 1) continue;
    if ((/^\s/.test(text) || PUNCTUATION.test(text.trim())) && ids.length) flush();
    if (!ids.length) start = pendingStart;
    for (const id of pending) ids.push(id);
    end = ends[k]!;
    pending = [];
  }
  flush();
  return words;
}
