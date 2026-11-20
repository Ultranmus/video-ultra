/**
 * AudioWorklet processor: plays stereo PCM chunks that the engine worker sends over a MessagePort
 * (straight from worker to audio thread — the main thread never touches audio data). Reports how
 * many frames it has played, which drives the editor's clock.
 *
 * This file is loaded with `audioWorklet.addModule()`, which bundlers copy as-is, so it must stay
 * self-contained: no imports.
 */

// Minimal AudioWorklet typings (not in the DOM lib).
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

/** Messages on the data port (engine worker ↔ processor). */
type DataMessage =
  | { type: 'chunk'; left: Float32Array; right: Float32Array }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'flush' };

/** Report every this many render quanta (8 × 128 frames ≈ 21 ms at 48 kHz). */
const REPORT_EVERY = 8;

class VideoUltraPlayer extends AudioWorkletProcessor {
  private data: MessagePort | null = null;
  private readonly queue: { left: Float32Array; right: Float32Array }[] = [];
  /** Read position inside the first queued chunk. */
  private offset = 0;
  private buffered = 0;
  private started = false;
  /** Frames of real audio played since the last start/flush (silence during underruns doesn't count). */
  private played = 0;
  private underruns = 0;
  private quanta = 0;
  /** Loudest sample per side since the last report (level meters). */
  private peakL = 0;
  private peakR = 0;

  constructor() {
    super();
    this.port.onmessage = (
      event: MessageEvent<{ type: 'port'; port: MessagePort } | { type: 'flush' }>,
    ) => {
      // Pause / seek straight from the page: silent at once, even while the engine worker is busy
      // (its own flush came late on phones — the sound ran on after the picture stopped).
      if (event.data.type === 'flush') return this.onData({ type: 'flush' });
      if (event.data.type !== 'port') return;
      this.data = event.data.port;
      this.data.onmessage = (e: MessageEvent<DataMessage>) => this.onData(e.data);
    };
  }

  private onData(message: DataMessage): void {
    switch (message.type) {
      case 'chunk':
        this.queue.push({ left: message.left, right: message.right });
        this.buffered += message.left.length;
        break;
      case 'start':
        this.started = true;
        break;
      case 'stop':
        this.started = false;
        break;
      case 'flush':
        this.queue.length = 0;
        this.offset = 0;
        this.buffered = 0;
        this.played = 0;
        this.started = false;
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0]!;
    const outR = out[1] ?? out[0]!;
    const frames = outL.length;
    let written = 0;
    if (this.started) {
      while (written < frames && this.queue.length > 0) {
        const chunk = this.queue[0]!;
        const n = Math.min(frames - written, chunk.left.length - this.offset);
        outL.set(chunk.left.subarray(this.offset, this.offset + n), written);
        outR.set(chunk.right.subarray(this.offset, this.offset + n), written);
        written += n;
        this.offset += n;
        if (this.offset >= chunk.left.length) {
          this.queue.shift();
          this.offset = 0;
        }
      }
      if (written < frames) this.underruns++;
    }
    let peakL = this.peakL;
    let peakR = this.peakR;
    for (let i = 0; i < written; i++) {
      const l = Math.abs(outL[i]!);
      const r = Math.abs(outR[i]!);
      if (l > peakL) peakL = l;
      if (r > peakR) peakR = r;
    }
    this.peakL = peakL;
    this.peakR = peakR;
    if (written < frames) {
      outL.fill(0, written);
      if (outR !== outL) outR.fill(0, written);
    }
    this.played += written;
    this.buffered -= written;
    if (++this.quanta % REPORT_EVERY === 0 && this.data) {
      this.data.postMessage({
        type: 'progress',
        played: this.played,
        buffered: this.buffered,
        underruns: this.underruns,
        sampleRate,
        peakL: this.peakL,
        peakR: this.peakR,
      });
      this.peakL = 0;
      this.peakR = 0;
    }
    return true;
  }
}

registerProcessor('video-ultra-player', VideoUltraPlayer);

export {};
