import type { AudioFx } from '../model/schema';
import { Denoiser } from './denoise';

/**
 * A clip's sound effects (v0.4): pitch shift (or keeping the pitch when the speed changes), a
 * three-band equaliser and a compressor. Runs in the mixer on each clip's own sound before its
 * volume and fades, so preview and export sound the same. Allocation-free per block; every stage
 * that is off costs nothing. State carries across blocks (call `reset()` after a seek).
 */

/** Effects that change nothing: none, or every value neutral. */
export function hasAudioFx(fx: AudioFx | undefined, speed: number): boolean {
  if (!fx) return false;
  return (
    (!!fx.eq && (fx.eq.low !== 0 || fx.eq.mid !== 0 || fx.eq.high !== 0)) ||
    (fx.compress ?? 0) > 0 ||
    (fx.denoise ?? 0) > 0 ||
    pitchRatio(fx, speed) !== 1
  );
}

/**
 * How much the pitch-shifter raises the pitch: the semitones asked for and, with `keepPitch`,
 * the inverse of the speed (clamped to 0.5×…2×, where a shifter still sounds natural).
 */
export function pitchRatio(fx: AudioFx | undefined, speed: number): number {
  if (!fx) return 1;
  let ratio = fx.pitch ? 2 ** (fx.pitch / 12) : 1;
  if (fx.keepPitch && speed !== 1) ratio /= Math.min(2, Math.max(0.5, speed));
  return Math.abs(ratio - 1) < 1e-4 ? 1 : ratio;
}

/** One second-order filter (RBJ cookbook), transposed direct form II, two channels. */
class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  private l1 = 0;
  private l2 = 0;
  private r1 = 0;
  private r2 = 0;
  /** The settings the coefficients were made for (recomputed only when they change). */
  private made = NaN;

  reset(): void {
    this.l1 = this.l2 = this.r1 = this.r2 = 0;
  }

  /** `kind`: 0 low shelf, 1 peak, 2 high shelf. */
  set(kind: 0 | 1 | 2, frequency: number, gainDb: number, rate: number): void {
    const key = gainDb * 1e6 + rate;
    if (key === this.made) return;
    this.made = key;
    const A = 10 ** (gainDb / 40);
    const w0 = (2 * Math.PI * frequency) / rate;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (kind === 1) {
      const alpha = sin / (2 * 0.9);
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
    } else {
      // Shelf slope 1.
      const alpha = (sin / 2) * Math.SQRT2;
      const s = 2 * Math.sqrt(A) * alpha;
      if (kind === 0) {
        b0 = A * (A + 1 - (A - 1) * cos + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cos);
        b2 = A * (A + 1 - (A - 1) * cos - s);
        a0 = A + 1 + (A - 1) * cos + s;
        a1 = -2 * (A - 1 + (A + 1) * cos);
        a2 = A + 1 + (A - 1) * cos - s;
      } else {
        b0 = A * (A + 1 + (A - 1) * cos + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cos);
        b2 = A * (A + 1 + (A - 1) * cos - s);
        a0 = A + 1 - (A - 1) * cos + s;
        a1 = 2 * (A - 1 - (A + 1) * cos);
        a2 = A + 1 - (A - 1) * cos - s;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(left: Float32Array, right: Float32Array, count: number): void {
    const { b0, b1, b2, a1, a2 } = this;
    let l1 = this.l1;
    let l2 = this.l2;
    let r1 = this.r1;
    let r2 = this.r2;
    for (let i = 0; i < count; i++) {
      const x = left[i]!;
      const y = b0 * x + l1;
      l1 = b1 * x - a1 * y + l2;
      l2 = b2 * x - a2 * y;
      left[i] = y;
      const xr = right[i]!;
      const yr = b0 * xr + r1;
      r1 = b1 * xr - a1 * yr + r2;
      r2 = b2 * xr - a2 * yr;
      right[i] = yr;
    }
    // Denormals and silence: settle to exact zeros.
    this.l1 = Math.abs(l1) < 1e-20 ? 0 : l1;
    this.l2 = Math.abs(l2) < 1e-20 ? 0 : l2;
    this.r1 = Math.abs(r1) < 1e-20 ? 0 : r1;
    this.r2 = Math.abs(r2) < 1e-20 ? 0 : r2;
  }
}

/** The equaliser's band frequencies (Hz). */
export const EQ_BANDS = { low: 120, mid: 1000, high: 8000 } as const;

/** Stereo-linked feed-forward compressor with a soft knee and automatic make-up gain. */
class Compressor {
  private envelope = 0;
  private gainDb = 0;

  reset(): void {
    this.envelope = 0;
    this.gainDb = 0;
  }

  process(left: Float32Array, right: Float32Array, count: number, amount: number, rate: number) {
    const threshold = -12 - 18 * amount;
    const ratio = 1.5 + 4.5 * amount;
    const knee = 6;
    const makeup = -threshold * (1 - 1 / ratio) * 0.5;
    const attack = Math.exp(-1 / (0.001 * rate));
    const release = Math.exp(-1 / (0.15 * rate));
    const slope = 1 - 1 / ratio;
    let envelope = this.envelope;
    let gainDb = this.gainDb;
    let g = 10 ** (gainDb / 20);
    for (let i = 0; i < count; i++) {
      const level = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
      const rising = level > envelope;
      envelope = rising
        ? level + attack * (envelope - level)
        : level + release * (envelope - level);
      // While the sound gets louder the gain follows every sample (no overshoot); while it falls,
      // every 16 samples is plenty (log / pow per sample would be wasted work).
      if (rising || (i & 15) === 0) {
        const db = envelope > 1e-6 ? 20 * Math.log10(envelope) : -120;
        const over = db - threshold;
        let reduce = 0;
        if (over >= knee / 2) reduce = over * slope;
        else if (over > -knee / 2) reduce = ((over + knee / 2) ** 2 / (2 * knee)) * slope;
        gainDb = makeup - reduce;
        g = 10 ** (gainDb / 20);
      }
      left[i] = left[i]! * g;
      right[i] = right[i]! * g;
    }
    this.envelope = envelope;
    this.gainDb = gainDb;
  }
}

/**
 * Pitch shifter: two read taps sweep through a short delay line at the new rate, crossfaded with
 * sin² windows that always add up to 1, so each tap's jump back happens in silence. When a tap
 * jumps, its new place is chosen (within one voice period) where the sound best matches what the
 * other tap is playing, so the crossfade doesn't cancel itself out (no warble). Speed and length
 * stay; ~25 ms latency on average. Good for voices and music within an octave.
 */
class PitchShifter {
  private readonly mask: number;
  private readonly bufL: Float32Array;
  private readonly bufR: Float32Array;
  /** Delay sweep per tap, samples. */
  private readonly window: number;
  /** How far a jump may be moved to line up with the other tap (≈ 12 ms: a low voice's period). */
  private readonly search: number;
  /** Samples compared when lining up. */
  private readonly match: number;
  private write = 0;
  private readonly phase = new Float64Array(2);
  private readonly offset = new Float64Array(2);

  constructor(rate: number) {
    this.window = Math.round(0.03 * rate);
    this.search = Math.round(0.012 * rate);
    this.match = Math.round(0.006 * rate);
    let size = 1;
    while (size < this.window + 2 * this.search + this.match + 8) size *= 2;
    this.mask = size - 1;
    this.bufL = new Float32Array(size);
    this.bufR = new Float32Array(size);
    this.reset();
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.write = 0;
    this.phase[0] = 0;
    this.phase[1] = 0.5;
    this.offset[0] = 0;
    this.offset[1] = 0;
  }

  private delayOf(tap: number): number {
    return 1 + this.phase[tap]! * this.window + this.offset[tap]!;
  }

  /** New offset for `tap` (just jumped): the one whose recent sound best matches the other tap. */
  private align(tap: number): void {
    const { bufL, bufR, mask, match, search } = this;
    const other = this.write - this.delayOf(1 - tap);
    const base = this.write - (1 + this.phase[tap]! * this.window);
    const o = Math.floor(other);
    let best = 0;
    let bestScore = -Infinity;
    for (let delta = 0; delta <= 2 * search; delta += 2) {
      const t = Math.floor(base - delta);
      let dot = 0;
      let energy = 1e-9;
      for (let j = 0; j < match; j += 2) {
        const a = bufL[(o - j) & mask]! + bufR[(o - j) & mask]!;
        const b = bufL[(t - j) & mask]! + bufR[(t - j) & mask]!;
        dot += a * b;
        energy += b * b;
      }
      const score = dot / Math.sqrt(energy);
      if (score > bestScore) {
        bestScore = score;
        best = delta;
      }
    }
    this.offset[tap] = best;
  }

  process(left: Float32Array, right: Float32Array, count: number, ratio: number): void {
    const { bufL, bufR, mask, window, phase } = this;
    const step = (1 - ratio) / window;
    let write = this.write;
    for (let i = 0; i < count; i++) {
      bufL[write] = left[i]!;
      bufR[write] = right[i]!;
      let outL = 0;
      let outR = 0;
      for (let tap = 0; tap < 2; tap++) {
        const p = phase[tap]!;
        const s = Math.sin(Math.PI * p);
        const gain = s * s;
        const pos = write - (1 + p * window + this.offset[tap]!);
        const base = Math.floor(pos);
        const frac = pos - base;
        const i0 = base & mask;
        const i1 = (base + 1) & mask;
        outL += gain * (bufL[i0]! + (bufL[i1]! - bufL[i0]!) * frac);
        outR += gain * (bufR[i0]! + (bufR[i1]! - bufR[i0]!) * frac);
      }
      left[i] = outL;
      right[i] = outR;
      write = (write + 1) & mask;
      this.write = write;
      for (let tap = 0; tap < 2; tap++) {
        let p = phase[tap]! + step;
        let jumped = false;
        if (p >= 1) {
          p -= 1;
          jumped = true;
        } else if (p < 0) {
          p += 1;
          jumped = true;
        }
        phase[tap] = p;
        if (jumped) this.align(tap);
      }
    }
  }
}

/** One clip's effect chain and its state between blocks. */
export class ClipFx {
  private readonly low = new Biquad();
  private readonly mid = new Biquad();
  private readonly high = new Biquad();
  private readonly compressor = new Compressor();
  private shifter: PitchShifter | null = null;
  private denoiser: Denoiser | null = null;

  constructor(private readonly rate: number) {}

  /** Forgets the sound so far (after a seek: no tail of the old place). */
  reset(): void {
    this.low.reset();
    this.mid.reset();
    this.high.reset();
    this.compressor.reset();
    this.shifter?.reset();
    this.denoiser?.reset();
  }

  /** Applies `fx` in place to `count` stereo samples of a clip playing at `speed`. */
  process(
    fx: AudioFx,
    speed: number,
    left: Float32Array,
    right: Float32Array,
    count: number,
  ): void {
    // Noise first: the compressor after it would bring the noise back up.
    const clean = fx.denoise ?? 0;
    if (clean > 0) (this.denoiser ??= new Denoiser()).process(left, right, count, clean);
    const ratio = pitchRatio(fx, speed);
    if (ratio !== 1)
      (this.shifter ??= new PitchShifter(this.rate)).process(left, right, count, ratio);
    const eq = fx.eq;
    if (eq) {
      if (eq.low !== 0) {
        this.low.set(0, EQ_BANDS.low, eq.low, this.rate);
        this.low.process(left, right, count);
      }
      if (eq.mid !== 0) {
        this.mid.set(1, EQ_BANDS.mid, eq.mid, this.rate);
        this.mid.process(left, right, count);
      }
      if (eq.high !== 0) {
        this.high.set(2, EQ_BANDS.high, eq.high, this.rate);
        this.high.process(left, right, count);
      }
    }
    const amount = fx.compress ?? 0;
    if (amount > 0) this.compressor.process(left, right, count, amount, this.rate);
  }
}

/** Ready-made sound looks (each sets the whole effect; sliders fine-tune it). */
export const AUDIO_FX_PRESETS: readonly { id: string; fx: AudioFx }[] = [
  { id: 'none', fx: {} },
  { id: 'voice', fx: { eq: { low: -4, mid: 2, high: 3 }, compress: 0.5 } },
  { id: 'clean', fx: { denoise: 0.6, eq: { low: -3, mid: 2, high: 2 }, compress: 0.4 } },
  { id: 'podcast', fx: { eq: { low: 2, mid: 1, high: 2 }, compress: 0.75 } },
  { id: 'bass', fx: { eq: { low: 8, mid: 0, high: 0 } } },
  { id: 'bright', fx: { eq: { low: 0, mid: 0, high: 6 } } },
  { id: 'warm', fx: { eq: { low: 3, mid: -1, high: -4 } } },
  { id: 'telephone', fx: { eq: { low: -12, mid: 6, high: -12 }, compress: 0.4 } },
  { id: 'radio', fx: { eq: { low: -8, mid: 5, high: -4 }, compress: 0.9 } },
  { id: 'loud', fx: { compress: 1 } },
  { id: 'deep', fx: { pitch: -4 } },
  { id: 'high', fx: { pitch: 5 } },
  { id: 'chipmunk', fx: { pitch: 10 } },
  { id: 'monster', fx: { pitch: -10, eq: { low: 4, mid: 0, high: -3 } } },
];
