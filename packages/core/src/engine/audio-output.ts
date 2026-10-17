import type { Mixer } from '../audio/mixer';
import type { Project } from '../model/schema';
import { FLICKS_PER_SECOND, type Time } from '../model/time';

/**
 * Sends mixed audio from the engine worker to the AudioWorklet and turns the worklet's progress
 * reports into the editor's clock: the timeline time that is *audible right now*. Video follows this
 * clock, so picture and sound stay in sync even if decoding or the display hiccups.
 */

/** Frames per mixed block (~43 ms at 48 kHz). */
const BLOCK = 2048;
/** Keep this much audio queued in the worklet. */
const TARGET_S = 0.3;
/** Queue this much before starting the sound (pre-roll). */
const PREFILL_S = 0.2;

interface Report {
  played: number;
  buffered: number;
  underruns: number;
  at: number;
}

export class AudioOutput {
  private active = false;
  private pumping = false;
  private startTimeline: Time = 0;
  /** Timeline position of the next block to mix. */
  private cursor: Time = 0;
  private sent = 0;
  private report: Report | null = null;
  private generation = 0;
  private underrunsAtStart = 0;

  constructor(
    private readonly port: MessagePort,
    readonly sampleRate: number,
    /** Output latency of the audio device (s): sound reaches the speaker this much later. */
    private readonly latencyS: number,
    private readonly mixer: Mixer,
    private readonly project: () => Project | null,
    private readonly onError: (error: unknown) => void,
  ) {
    port.onmessage = (
      event: MessageEvent<{
        type: 'progress';
        played: number;
        buffered: number;
        underruns: number;
      }>,
    ) => {
      if (event.data.type !== 'progress') return;
      this.report = { ...event.data, at: performance.now() };
      if (this.active) void this.pump();
    };
  }

  /** Underruns (the worklet ran out of audio) since the last start. */
  get underruns(): number {
    return (this.report?.underruns ?? this.underrunsAtStart) - this.underrunsAtStart;
  }

  /** Starts sound at timeline time `at` after queueing a short pre-roll. */
  async start(at: Time): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    this.mixer.dispose(); // every clip seeks to the new position
    this.startTimeline = at;
    this.cursor = at;
    this.sent = 0;
    this.underrunsAtStart = this.report?.underruns ?? 0;
    this.report = null;
    this.active = true;
    while (this.sent < PREFILL_S * this.sampleRate) {
      if (generation !== this.generation) return;
      if (!(await this.mixBlock())) break;
    }
    if (generation === this.generation) this.port.postMessage({ type: 'start' });
  }

  /** Stops and drops queued audio (pause, seek). */
  stop(): void {
    this.active = false;
    this.generation++;
    this.port.postMessage({ type: 'flush' });
  }

  /**
   * The audible timeline time now, or null before the first report. Extrapolates between reports
   * (≈ every 21 ms) but never past what's queued, so a starving worklet stops the clock.
   */
  clock(): Time | null {
    if (!this.active || !this.report) return null;
    const { played, buffered, at } = this.report;
    const elapsed =
      buffered > 0 ? Math.min((performance.now() - at) / 1000, buffered / this.sampleRate) : 0;
    const audibleS = played / this.sampleRate + elapsed - this.latencyS;
    return this.startTimeline + Math.max(0, Math.round(audibleS * FLICKS_PER_SECOND));
  }

  private async pump(): Promise<void> {
    if (this.pumping || !this.active) return;
    this.pumping = true;
    const generation = this.generation;
    try {
      while (this.active && generation === this.generation) {
        const queued = this.sent - (this.report?.played ?? 0);
        if (queued >= TARGET_S * this.sampleRate) break;
        if (!(await this.mixBlock())) break;
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.pumping = false;
    }
  }

  /** Mixes the next block and sends it (transferring the buffers). False when there's no project. */
  private async mixBlock(): Promise<boolean> {
    const project = this.project();
    if (!project) return false;
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    const generation = this.generation;
    await this.mixer.render(project, this.cursor, BLOCK, left, right);
    if (generation !== this.generation) return false; // stopped while mixing
    this.port.postMessage({ type: 'chunk', left, right }, [left.buffer, right.buffer]);
    this.cursor += Math.round((BLOCK / this.sampleRate) * FLICKS_PER_SECOND);
    this.sent += BLOCK;
    return true;
  }
}
