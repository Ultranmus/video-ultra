/**
 * Adaptive preview quality: when frames keep arriving late while playing, the preview drops to a
 * lower resolution (smoothness before sharpness — PERF rule 8), and climbs back after a calm
 * stretch. Export always renders at full size.
 */
export class QualityGovernor {
  static readonly STEPS = [1, 0.75, 0.5] as const;
  private step = 0;
  private late: number[] = [];
  private calmSince = 0;
  /** How many times the quality changed. */
  changes = 0;

  constructor(
    /** Late frames within one second that trigger a step down. */
    private readonly lateLimit = 4,
    /** Calm time (ms) before stepping back up. */
    private readonly recoverMs = 5000,
  ) {}

  /** Current resolution factor (1, 0.75 or 0.5). */
  get factor(): number {
    return QualityGovernor.STEPS[this.step]!;
  }

  /** Records one drawn frame; returns true if the quality changed. */
  frame(late: boolean, now: number): boolean {
    if (late) this.late.push(now);
    this.late = this.late.filter((at) => now - at < 1000);
    if (this.late.length >= this.lateLimit && this.step < QualityGovernor.STEPS.length - 1) {
      this.step++;
      this.late = [];
      this.calmSince = now;
      this.changes++;
      return true;
    }
    if (late) {
      this.calmSince = now;
    } else if (this.step > 0 && now - this.calmSince > this.recoverMs) {
      this.step--;
      this.calmSince = now;
      this.changes++;
      return true;
    }
    return false;
  }
}
