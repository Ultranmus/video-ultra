/**
 * "Clean up noise" (DECISIONS #156): a spectral noise gate for steady background noise — hiss,
 * hum, fans, air conditioning, distant traffic. Short overlapping frames (1024 samples, a quarter
 * apart, Hann windows) go through an FFT; per frequency band the noise floor is the quietest
 * level of the last ~1.5 s (minimum statistics: speech always has pauses, noise doesn't), and the
 * band is turned down by how close it is to that floor (over-subtraction, never below a floor
 * that follows the amount). Gains rise at once and fall smoothly, and are averaged with their
 * neighbours, so what's left doesn't warble ("musical noise"). Stereo: both channels go through
 * one complex FFT (left real, right imaginary) with the same gain per band. Latency: one frame
 * (~21 ms at 48 kHz) — like the pitch shifter, not compensated. Allocation-free per block; state
 * carries across blocks; `reset()` after a seek forgets the sound but keeps the learnt noise.
 */

const N = 1024;
const HOP = N / 4;
/** Hann² summed over four quarter-offset frames is 1.5: undo it on the way out. */
const OLA_GAIN = 1 / 1.5;
/** Noise floor: the minimum over `SUBWINDOWS` blocks of `SUBFRAMES` frames (~1.4 s at 48 kHz). */
const SUBWINDOWS = 8;
const SUBFRAMES = 32;
/** The minimum of a noisy level sits below its mean: raise it back (minimum statistics bias). */
const NOISE_BIAS = 3;

export class Denoiser {
  private readonly window = new Float32Array(N);
  private readonly cos = new Float32Array(N / 2);
  private readonly sin = new Float32Array(N / 2);
  private readonly rev = new Uint16Array(N);
  private readonly inL = new Float32Array(N);
  private readonly inR = new Float32Array(N);
  private readonly outL = new Float32Array(N);
  private readonly outR = new Float32Array(N);
  private readonly re = new Float32Array(N);
  private readonly im = new Float32Array(N);
  private readonly bins = N / 2 + 1;
  /** Smoothed level per band, the running sub-window minimum, the sub-window minima, the floor. */
  private readonly level = new Float32Array(this.bins);
  private readonly subMin = new Float32Array(this.bins);
  private readonly minima = new Float32Array(SUBWINDOWS * this.bins);
  private readonly noise = new Float32Array(this.bins);
  private readonly gain = new Float32Array(this.bins);
  private readonly smooth = new Float32Array(this.bins);
  private pos = 0;
  private filled = 0;
  private frames = 0;
  private sub = 0;

  constructor() {
    for (let i = 0; i < N; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    for (let i = 0; i < N / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / N);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / N);
    }
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.minima.fill(Infinity);
    this.subMin.fill(Infinity);
    this.noise.fill(0);
    this.smooth.fill(1);
  }

  /** Samples of delay between the sound in and the cleaned sound out. */
  static readonly latency = N;

  /** Forgets the sound so far (a seek); the learnt noise floor stays. */
  reset(): void {
    this.inL.fill(0);
    this.inR.fill(0);
    this.outL.fill(0);
    this.outR.fill(0);
    this.pos = 0;
    this.filled = 0;
  }

  /** Cleans `count` stereo samples in place; `amount` 0…1 (0 passes the sound through, delayed). */
  process(left: Float32Array, right: Float32Array, count: number, amount: number): void {
    const { inL, inR, outL, outR } = this;
    for (let i = 0; i < count; i++) {
      const p = this.pos;
      inL[p] = left[i]!;
      inR[p] = right[i]!;
      left[i] = outL[p]!;
      right[i] = outR[p]!;
      outL[p] = 0;
      outR[p] = 0;
      this.pos = (p + 1) & (N - 1);
      if (++this.filled === HOP) {
        this.filled = 0;
        this.frame(amount);
      }
    }
  }

  /** One frame: the last N samples (oldest at `pos`), cleaned, added back where they came from. */
  private frame(amount: number): void {
    const { re, im, window, inL, inR, bins } = this;
    const start = this.pos;
    for (let i = 0; i < N; i++) {
      const j = (start + i) & (N - 1);
      re[i] = inL[j]! * window[i]!;
      im[i] = inR[j]! * window[i]!;
    }
    this.fft(false);
    this.estimate(amount);
    const g = this.smooth;
    for (let k = 0; k < bins; k++) {
      const gain = g[k]!;
      re[k] = re[k]! * gain;
      im[k] = im[k]! * gain;
      if (k > 0 && k < N / 2) {
        re[N - k] = re[N - k]! * gain;
        im[N - k] = im[N - k]! * gain;
      }
    }
    this.fft(true);
    const { outL, outR } = this;
    for (let i = 0; i < N; i++) {
      const j = (start + i) & (N - 1);
      const w = window[i]! * OLA_GAIN;
      outL[j] = outL[j]! + re[i]! * w;
      outR[j] = outR[j]! + im[i]! * w;
    }
  }

  /** Levels per band → noise floor → gains (smoothed in time and across bands). */
  private estimate(amount: number): void {
    const { re, im, level, subMin, minima, noise, gain, smooth, bins } = this;
    for (let k = 0; k < bins; k++) {
      // Both channels' power from the packed spectrum: Z[k] and conj(Z[N − k]).
      const m = (N - k) & (N - 1);
      const ar = re[k]!;
      const ai = im[k]!;
      const br = re[m]!;
      const bi = im[m]!;
      const lr = (ar + br) / 2;
      const li = (ai - bi) / 2;
      const rr = (ai + bi) / 2;
      const ri = (br - ar) / 2;
      const power = (lr * lr + li * li + rr * rr + ri * ri) / 2;
      const was = level[k]!;
      level[k] = this.frames === 0 ? power : was * 0.8 + power * 0.2;
      if (level[k]! < subMin[k]!) subMin[k] = level[k]!;
    }
    this.frames++;
    if (this.frames % SUBFRAMES === 0) {
      // A sub-window ends: keep its minimum, the floor is the smallest kept.
      minima.set(subMin, this.sub * bins);
      this.sub = (this.sub + 1) % SUBWINDOWS;
      subMin.fill(Infinity);
    }
    const over = 1 + 3 * amount;
    // How far a band may go down: −24 dB at full strength (−12 dB at half).
    const floor = 10 ** ((-24 * amount) / 20);
    for (let k = 0; k < bins; k++) {
      let low = subMin[k]!;
      for (let w = 0; w < SUBWINDOWS; w++) low = Math.min(low, minima[w * bins + k]!);
      noise[k] = low * NOISE_BIAS;
      const p = level[k]! + 1e-12;
      gain[k] = Math.max(floor, 1 - (over * noise[k]!) / p);
    }
    for (let k = 0; k < bins; k++) {
      const a = gain[Math.max(0, k - 1)]!;
      const b = gain[k]!;
      const c = gain[Math.min(bins - 1, k + 1)]!;
      const g = (a + 2 * b + c) / 4;
      const was = smooth[k]!;
      // Up at once (a word starts), down gently (no choppy tails).
      smooth[k] = g > was ? g : was * 0.6 + g * 0.4;
    }
  }

  /** In-place radix-2 FFT of re + i·im (inverse: conjugate twiddles, divide by N). */
  private fft(inverse: boolean): void {
    const { re, im, rev, cos, sin } = this;
    for (let i = 0; i < N; i++) {
      const j = rev[i]!;
      if (j > i) {
        let t = re[i]!;
        re[i] = re[j]!;
        re[j] = t;
        t = im[i]!;
        im[i] = im[j]!;
        im[j] = t;
      }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step]!;
          const wi = inverse ? -sin[k * step]! : sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const tr = re[b]! * wr - im[b]! * wi;
          const ti = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - tr;
          im[b] = im[a]! - ti;
          re[a] = re[a]! + tr;
          im[a] = im[a]! + ti;
        }
      }
    }
    if (inverse)
      for (let i = 0; i < N; i++) {
        re[i] = re[i]! / N;
        im[i] = im[i]! / N;
      }
  }
}
