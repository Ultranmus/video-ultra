/**
 * Whisper's input: an 80-band log-mel spectrogram of 30 s of 16 kHz sound (3000 frames, 10 ms
 * hop, 25 ms window). Same maths as the reference feature extractor (Hann window, centred
 * frames with reflection, Slaney mel filters, log10, 8-decade floor, (x + 4) / 4). Pure; all
 * buffers are allocated once per extractor and reused.
 */

export const SAMPLE_RATE = 16_000;
export const N_FFT = 400;
export const HOP = 160;
export const N_SAMPLES = 30 * SAMPLE_RATE;
export const N_FRAMES = N_SAMPLES / HOP; // 3000
const BINS = N_FFT / 2 + 1; // 201

/** Triangular mel filters, Slaney scale and area normalisation (as librosa). [mels × 201] */
export function melFilters(nMels: number): Float32Array {
  const hzToMel = (f: number) =>
    f < 1000 ? (3 * f) / 200 : 15 + (27 * Math.log(f / 1000)) / Math.log(6.4);
  const melToHz = (m: number) =>
    m < 15 ? (200 * m) / 3 : 1000 * Math.exp(((m - 15) * Math.log(6.4)) / 27);
  const maxMel = hzToMel(SAMPLE_RATE / 2);
  const points = Array.from({ length: nMels + 2 }, (_, i) => melToHz((i * maxMel) / (nMels + 1)));
  const out = new Float32Array(nMels * BINS);
  for (let m = 0; m < nMels; m++) {
    const [lo, mid, hi] = [points[m]!, points[m + 1]!, points[m + 2]!];
    const norm = 2 / (hi - lo);
    for (let b = 0; b < BINS; b++) {
      const f = (b * SAMPLE_RATE) / N_FFT;
      const w = Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid)));
      out[m * BINS + b] = w * norm;
    }
  }
  return out;
}

/** A mixed-radix complex FFT of one fixed size (400 = 2⁴ · 5²), no allocation per call. */
export class Fft {
  readonly n: number;
  readonly #cos: Float64Array;
  readonly #sin: Float64Array;
  readonly #tr = new Float64Array(8);
  readonly #ti = new Float64Array(8);
  constructor(n: number) {
    this.n = n;
    this.#cos = new Float64Array(n);
    this.#sin = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.#cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.#sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  /** DFT of `inRe/inIm` (length n) into `outRe/outIm`. */
  transform(
    inRe: Float64Array,
    inIm: Float64Array,
    outRe: Float64Array,
    outIm: Float64Array,
  ): void {
    this.#rec(inRe, inIm, 0, 1, this.n, outRe, outIm, 0);
  }

  #rec(
    re: Float64Array,
    im: Float64Array,
    offset: number,
    stride: number,
    n: number,
    oRe: Float64Array,
    oIm: Float64Array,
    o: number,
  ): void {
    if (n === 1) {
      oRe[o] = re[offset]!;
      oIm[o] = im[offset]!;
      return;
    }
    const p = n % 4 === 0 ? 4 : n % 2 === 0 ? 2 : n % 5 === 0 ? 5 : n % 3 === 0 ? 3 : n;
    const m = n / p;
    for (let q = 0; q < p; q++)
      this.#rec(re, im, offset + q * stride, stride * p, m, oRe, oIm, o + q * m);
    // Combine: X[k + r·m] = Σ_q W_n^{q(k + r·m)} · Y_q[k]
    const step = this.n / n;
    const tr = this.#tr;
    const ti = this.#ti;
    for (let k = 0; k < m; k++) {
      for (let q = 0; q < p; q++) {
        tr[q] = oRe[o + q * m + k]!;
        ti[q] = oIm[o + q * m + k]!;
      }
      for (let r = 0; r < p; r++) {
        let sr = 0;
        let si = 0;
        const e = k + r * m;
        for (let q = 0; q < p; q++) {
          const t = ((q * e) % n) * step;
          const c = this.#cos[t]!;
          const s = this.#sin[t]!;
          sr += tr[q]! * c - ti[q]! * s;
          si += tr[q]! * s + ti[q]! * c;
        }
        oRe[o + e] = sr;
        oIm[o + e] = si;
      }
    }
  }
}

/** Turns up to 30 s of 16 kHz mono into Whisper's [mels × 3000] input. Reuse one per worker. */
export class MelExtractor {
  readonly nMels: number;
  readonly #filters: Float32Array;
  readonly #window = new Float64Array(N_FFT);
  readonly #fft = new Fft(N_FFT);
  readonly #fr = new Float64Array(N_FFT);
  readonly #fi = new Float64Array(N_FFT);
  readonly #or = new Float64Array(N_FFT);
  readonly #oi = new Float64Array(N_FFT);
  readonly #power = new Float64Array(BINS);
  readonly #padded = new Float32Array(N_SAMPLES + N_FFT);
  readonly out: Float32Array;

  constructor(nMels = 80) {
    this.nMels = nMels;
    this.#filters = melFilters(nMels);
    for (let i = 0; i < N_FFT; i++)
      this.#window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
    this.out = new Float32Array(nMels * N_FRAMES);
  }

  /** Fills and returns `out` (row-major [mel][frame]). */
  extract(audio: Float32Array): Float32Array {
    const half = N_FFT / 2;
    const padded = this.#padded;
    const len = Math.min(audio.length, N_SAMPLES);
    // 30 s of sound (zeros after it), centred with reflection at both ends.
    padded.fill(0);
    padded.set(audio.subarray(0, len), half);
    for (let i = 1; i <= half; i++) {
      padded[half - i] = padded[half + i]!;
      padded[half + N_SAMPLES - 1 + i] = padded[half + N_SAMPLES - 1 - i]!;
    }
    const out = this.out;
    let max = -Infinity;
    for (let f = 0; f < N_FRAMES; f++) {
      const start = f * HOP;
      for (let i = 0; i < N_FFT; i++) {
        this.#fr[i] = padded[start + i]! * this.#window[i]!;
        this.#fi[i] = 0;
      }
      this.#fft.transform(this.#fr, this.#fi, this.#or, this.#oi);
      for (let b = 0; b < BINS; b++) this.#power[b] = this.#or[b]! ** 2 + this.#oi[b]! ** 2;
      for (let m = 0; m < this.nMels; m++) {
        let sum = 0;
        const row = m * BINS;
        for (let b = 0; b < BINS; b++) sum += this.#filters[row + b]! * this.#power[b]!;
        const v = Math.log10(Math.max(sum, 1e-10));
        out[m * N_FRAMES + f] = v;
        if (v > max) max = v;
      }
    }
    const floor = max - 8;
    for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i]!, floor) + 4) / 4;
    return out;
  }
}
