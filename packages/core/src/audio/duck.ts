/**
 * Ducking ("lower under voice"): a sidechain that listens to the voice — video clips' own sound,
 * voiceovers, anything that isn't itself ducked — and turns down the items marked `duck` while
 * someone speaks. Pure, allocation-free maths, shared by preview playback and export through the
 * mixer, so both sound the same.
 *
 * How it listens, per output sample, in the mixer's block loop:
 * 1. The key (sum of the voice items after their own volume, fades and crossfades, mono) goes
 *    through a speech-band filter (high-pass 150 Hz + low-pass 4 kHz) so rumble, wind and hiss
 *    count less than a voice.
 * 2. Its RMS level is measured over 5 ms windows aligned to absolute timeline samples (so the
 *    result doesn't depend on how the timeline is cut into blocks — preview mixes 2048-frame
 *    blocks, export one video frame's worth at a time).
 * 3. Level → "presence" 0…1 with a soft knee (0 at ≤ −40 dBFS, 1 at ≥ −30 dBFS).
 * 4. Hold: presence never drops for 300 ms after it was last that high, so the short gaps between
 *    words don't let the music swell back up (no pumping).
 * 5. Attack / release smoothing (one-pole: 40 ms down, 450 ms back up).
 * 6. The gain is ramped linearly across each window, never stepped (no clicks).
 *
 * A ducked item then plays at `1 − duck × presence` of its own volume.
 *
 * Seeking breaks continuity; the follower then primes itself from the first ~20 ms of the new
 * position (fully ducked if someone is already speaking there) instead of easing in from zero, so
 * starting playback mid-sentence sounds like the export does at that moment.
 */
import type { Project } from '../model/schema';

/** Tuning of the ducking follower (all times in seconds, levels in dBFS). */
export interface DuckTuning {
  /** Measurement window. */
  window: number;
  /** Presence is 0 at or below this level… */
  floorDb: number;
  /** …and 1 at or above this one (soft knee between). */
  fullDb: number;
  /** How long presence is held after the voice drops (bridges gaps between words). */
  hold: number;
  /** Time constant going down (voice starts). */
  attack: number;
  /** Time constant coming back up (voice stopped and the hold ran out). */
  release: number;
  /** Speech-band filter corners (Hz). */
  highPass: number;
  lowPass: number;
}

/** Default tuning: a broadcast-style voice-over duck. */
export const DUCK_TUNING: Readonly<DuckTuning> = {
  window: 0.005,
  floorDb: -40,
  fullDb: -30,
  hold: 0.3,
  attack: 0.04,
  release: 0.45,
  highPass: 150,
  lowPass: 4000,
};

/** Second-order IIR filter section (RBJ cookbook), direct form I, state kept between blocks. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: 'highpass' | 'lowpass', frequency: number, sampleRate: number) {
    const f = Math.min(frequency, sampleRate * 0.45);
    const w = (2 * Math.PI * f) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2); // Q = 1/√2 (Butterworth)
    const a0 = 1 + alpha;
    if (type === 'lowpass') {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = this.b0;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  /** Filters `count` samples of `buffer` in place. */
  process(buffer: Float32Array, count: number): void {
    let { x1, x2, y1, y2 } = this;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < count; i++) {
      const x = buffer[i]!;
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      // Flush denormals (a long silence would otherwise slow the loop down on some CPUs).
      y1 = y > -1e-20 && y < 1e-20 ? 0 : y;
      buffer[i] = y1;
    }
    this.x1 = x1;
    this.x2 = x2;
    this.y1 = y1;
    this.y2 = y2;
  }
}

/** Presence (0…1) for an RMS level, with a smooth knee between `floorDb` and `fullDb`. */
export function presenceFor(rms: number, floorDb: number, fullDb: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  const p = (db - floorDb) / (fullDb - floorDb);
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p * p * (3 - 2 * p); // smoothstep
}

/**
 * Turns the key signal into a smooth presence curve (0 = nobody speaking, 1 = voice). One per
 * mixer; feed it every block in timeline order. No allocation per block.
 */
export class DuckFollower {
  /** Window length in samples. */
  readonly windowSize: number;
  private readonly tuning: DuckTuning;
  private readonly highPass: Biquad;
  private readonly lowPass: Biquad;
  private readonly attackCoef: number;
  private readonly releaseCoef: number;
  private readonly holdWindows: number;
  /** Timeline sample the next block must start at to continue; NaN = no history (prime). */
  private next = NaN;
  private sum = 0;
  private count = 0;
  private held = 0;
  private holdLeft = 0;
  /** Smoothed presence before / after the last completed window (the ramp in progress). */
  private from = 0;
  private to = 0;

  constructor(
    readonly sampleRate: number,
    tuning: Partial<DuckTuning> = {},
  ) {
    this.tuning = { ...DUCK_TUNING, ...tuning };
    const t = this.tuning;
    this.windowSize = Math.max(16, Math.round(sampleRate * t.window));
    const windowS = this.windowSize / sampleRate;
    this.attackCoef = 1 - Math.exp(-windowS / t.attack);
    this.releaseCoef = 1 - Math.exp(-windowS / t.release);
    this.holdWindows = Math.round(t.hold / windowS);
    this.highPass = new Biquad('highpass', t.highPass, sampleRate);
    this.lowPass = new Biquad('lowpass', t.lowPass, sampleRate);
  }

  /** Forget the history: the next block primes from its own start (after a seek). */
  reset(): void {
    this.next = NaN;
  }

  /**
   * Reads `frames` key samples (`key` is filtered in place — it's scratch) whose first sample is
   * timeline sample `position`, and writes the presence for each into `out`.
   */
  process(key: Float32Array, frames: number, position: number, out: Float32Array): void {
    const w = this.windowSize;
    if (position !== this.next) this.prime(key, frames, position);
    this.highPass.process(key, frames);
    this.lowPass.process(key, frames);
    let phase = ((position % w) + w) % w;
    let { from, to, sum, count } = this;
    const step = 1 / w;
    for (let i = 0; i < frames; i++) {
      out[i] = from + (to - from) * phase * step;
      const x = key[i]!;
      sum += x * x;
      count++;
      if (++phase === w) {
        phase = 0;
        from = to;
        to = this.advance(sum, count, to);
        sum = 0;
        count = 0;
      }
    }
    this.from = from;
    this.to = to;
    this.sum = sum;
    this.count = count;
    this.next = position + frames;
  }

  /** One window done: level → presence → hold → attack / release. Returns the new smoothed value. */
  private advance(sum: number, count: number, current: number): number {
    const target = presenceFor(Math.sqrt(sum / count), this.tuning.floorDb, this.tuning.fullDb);
    if (target >= this.held) {
      this.held = target;
      this.holdLeft = this.holdWindows;
    } else if (this.holdLeft > 0) {
      this.holdLeft--;
    } else {
      this.held = target;
    }
    const coef = this.held > current ? this.attackCoef : this.releaseCoef;
    const next = current + (this.held - current) * coef;
    return next < 1e-6 ? 0 : next;
  }

  /**
   * No history (start or seek): measure the first ~20 ms here (through fresh filters, without
   * touching `key`) and start settled at that presence, so playback started mid-sentence is
   * already ducked rather than easing down audibly.
   */
  private prime(key: Float32Array, frames: number, position: number): void {
    this.highPass.reset();
    this.lowPass.reset();
    const n = Math.min(frames, this.windowSize * 4);
    // Run the filters over a prefix, measuring as we go, then reset them again so the real pass
    // starts from the same state every time (deterministic for any block size ≥ n).
    let sum = 0;
    const scratch = this.primeScratch(n);
    scratch.set(key.subarray(0, n));
    this.highPass.process(scratch, n);
    this.lowPass.process(scratch, n);
    for (let i = 0; i < n; i++) sum += scratch[i]! * scratch[i]!;
    this.highPass.reset();
    this.lowPass.reset();
    const p = n > 0 ? presenceFor(Math.sqrt(sum / n), this.tuning.floorDb, this.tuning.fullDb) : 0;
    this.held = p;
    this.holdLeft = p > 0 ? this.holdWindows : 0;
    this.from = this.to = p;
    this.sum = 0;
    this.count = 0;
    this.next = position;
  }

  private scratch = new Float32Array(0);
  private primeScratch(n: number): Float32Array {
    if (this.scratch.length < n) this.scratch = new Float32Array(n);
    return this.scratch;
  }
}

/**
 * Whether any sounding item in the project is set to lower under voice (if not, the mixer skips
 * the sidechain entirely). Depends only on the project, so preview and export agree.
 */
export function hasDucking(project: Project): boolean {
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const item of track.items)
      if ((item.kind === 'video' || item.kind === 'audio') && item.duck && !item.muted) return true;
  }
  return false;
}

/**
 * Applies the duck to one item's samples in place: `buffer[i] *= 1 − amount × presence[i]`.
 * `presenceOffset` is where the item's samples start within the block.
 */
export function applyDuck(
  buffer: Float32Array,
  count: number,
  presence: Float32Array,
  presenceOffset: number,
  amount: number,
): void {
  if (!(amount > 0)) return;
  for (let i = 0; i < count; i++) buffer[i]! *= 1 - amount * presence[presenceOffset + i]!;
}
