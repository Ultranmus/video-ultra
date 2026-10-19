/**
 * Scene-cut detection on tiny frames (v0.4). Pure maths, no browser APIs: the analyzer worker
 * draws each decoded frame into a {@link SCENE_FRAME_WIDTH}×{@link SCENE_FRAME_HEIGHT} RGBA buffer
 * and feeds it here. Two signals are mixed:
 *
 * - **Colour histogram change** (4×4×4 RGB bins): big when the picture's colours change, small
 *   under camera motion (the same things stay in view).
 * - **Picture change** (mean brightness difference per pixel): catches cuts between shots with
 *   similar colours.
 *
 * A frame is a cut when its score passes the sensitivity's threshold **and** stands well above the
 * scores of the frames just before it (fast motion raises every score, a cut is a single spike),
 * and the previous cut is at least {@link SceneOptions.minScene} away (a flash doesn't make two
 * scenes). Slow cross-fades are not cuts.
 */

/** Width of the frames {@link SceneDetector} reads. */
export const SCENE_FRAME_WIDTH = 64;
/** Height of the frames {@link SceneDetector} reads. */
export const SCENE_FRAME_HEIGHT = 36;

const PIXELS = SCENE_FRAME_WIDTH * SCENE_FRAME_HEIGHT;
const BINS = 64;
/** Frames whose scores make the local average a cut must stand out from. */
const WINDOW = 12;

/** How eager scene detection is. */
export type SceneSensitivity = 'low' | 'normal' | 'high';

const THRESHOLD: Record<SceneSensitivity, number> = { low: 0.42, normal: 0.3, high: 0.2 };
/** A cut's score is at least this many times the recent average. */
const SPIKE: Record<SceneSensitivity, number> = { low: 3, normal: 2.5, high: 2 };

/** Options for scene detection. */
export interface SceneOptions {
  /** Default `normal`. */
  sensitivity?: SceneSensitivity;
  /** Shortest scene, seconds (default 0.4). */
  minScene?: number;
}

/** Streams frames in time order; reports the times where a new scene starts. */
export class SceneDetector {
  private readonly threshold: number;
  private readonly spike: number;
  private readonly minScene: number;
  private prevLuma = new Uint8Array(PIXELS);
  private luma = new Uint8Array(PIXELS);
  private prevHist = new Float32Array(BINS);
  private hist = new Float32Array(BINS);
  private readonly recent = new Float32Array(WINDOW);
  private recentCount = 0;
  private recentAt = 0;
  private hasPrev = false;
  private lastCut = -Infinity;
  /** The last frame's change score, 0…1 (for tuning and tests). */
  lastScore = 0;
  /** Scene starts found so far (seconds), not counting the first frame. */
  readonly cuts: number[] = [];

  constructor(options: SceneOptions = {}) {
    const sensitivity = options.sensitivity ?? 'normal';
    this.threshold = THRESHOLD[sensitivity];
    this.spike = SPIKE[sensitivity];
    this.minScene = options.minScene ?? 0.4;
  }

  /**
   * Reads one frame (`rgba` = {@link SCENE_FRAME_WIDTH}×{@link SCENE_FRAME_HEIGHT}×4 bytes) shown
   * from `time` seconds. Returns `true` when the frame starts a new scene (also pushed to `cuts`).
   */
  push(rgba: ArrayLike<number>, time: number): boolean {
    const luma = this.luma;
    const hist = this.hist;
    hist.fill(0);
    for (let p = 0, i = 0; p < PIXELS; p++, i += 4) {
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      luma[p] = (r * 77 + g * 150 + b * 29) >> 8;
      hist[((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)]!++;
    }
    let cut = false;
    if (this.hasPrev) {
      const score = this.score();
      this.lastScore = score;
      let average = 0;
      for (let i = 0; i < this.recentCount; i++) average += this.recent[i]!;
      average = this.recentCount > 0 ? average / this.recentCount : 0;
      // Right after a cut the window holds the cut's own spike; it is reset below, so the
      // comparison is with the new shot only.
      cut =
        score >= this.threshold &&
        score >= average * this.spike &&
        time - this.lastCut >= this.minScene &&
        time >= this.minScene * 0.5;
      if (cut) {
        this.cuts.push(time);
        this.lastCut = time;
        this.recentCount = 0;
        this.recentAt = 0;
      } else {
        this.recent[this.recentAt] = score;
        this.recentAt = (this.recentAt + 1) % WINDOW;
        this.recentCount = Math.min(WINDOW, this.recentCount + 1);
      }
    }
    // Swap buffers: this frame becomes the previous one (no allocation per frame).
    this.luma = this.prevLuma;
    this.prevLuma = luma;
    this.hist = this.prevHist;
    this.prevHist = hist;
    this.hasPrev = true;
    return cut;
  }

  /** The current frame's change against the previous one, 0…1. */
  private score(): number {
    let histDiff = 0;
    for (let i = 0; i < BINS; i++) histDiff += Math.abs(this.hist[i]! - this.prevHist[i]!);
    histDiff /= 2 * PIXELS;
    let pixelDiff = 0;
    for (let p = 0; p < PIXELS; p++) pixelDiff += Math.abs(this.luma[p]! - this.prevLuma[p]!);
    pixelDiff /= PIXELS * 255;
    return 0.5 * histDiff + 0.5 * Math.min(1, pixelDiff * 3);
  }
}

/**
 * Timeline times (flicks) where a clip shows the scene starts `cuts` (seconds of its media), for
 * a clip that shows its media from `sourceIn` at `speed` from `start` for `duration`. Cuts outside
 * the clip, or closer than `minGap` flicks to its ends, are left out.
 */
export function sceneCutTimes(
  cuts: readonly number[],
  clip: { start: number; duration: number; sourceIn: number; speed: number },
  flicksPerSecond: number,
  minGap: number,
): number[] {
  const out: number[] = [];
  for (const c of cuts) {
    const t = clip.start + Math.round((c * flicksPerSecond - clip.sourceIn) / clip.speed);
    if (t < clip.start + minGap || t > clip.start + clip.duration - minGap) continue;
    if (out.length && t - out[out.length - 1]! < minGap) continue;
    out.push(t);
  }
  return out;
}
