import {
  EncodedPacketSink,
  VideoSampleSink,
  type InputVideoTrack,
  type VideoSample,
} from 'mediabunny';

/**
 * Frame sources for preview: "show the frame at time t", fast, without leaking decoders.
 *
 * Decoding goes through Mediabunny's sequential iterator (`VideoSampleSink.samples`), which carries
 * the browser- and codec-specific workarounds (HEVC RASL pictures after a seek, Chromium H.264/HEVC
 * packet fixes, WebKit output timestamps). An earlier version drove `VideoDecoder` directly and
 * produced no frames for iPhone HEVC in Safari — don't go back to that without those workarounds.
 *
 * On top of it:
 * - **Forward steps continue** the running iterator (same decoder, already pre-decoding ahead):
 *   dragging right, frame stepping and playback cost one decode per frame.
 * - **Backward or far jumps restart** from the right keyframe (a new iterator).
 * - **Latest request wins**: requests overtaken by a newer one resolve to `null` and stop early.
 * - **Keyframe-first** on far restarts: a one-shot decode of the keyframe is shown as a preview
 *   while the exact frame decodes. It's a second decoder, so it counts in the pool: it runs only
 *   while a slot is free (never evicting a playing clip's decoder) — on the low tier that's while
 *   one clip is scrubbed alone.
 * - A **pool** caps decoders per device tier (least recently used closes first); a **watchdog**
 *   replaces an iterator whose decoder stops answering.
 */

/** Caps the number of live decoders and evicts the least recently used. */
export class DecoderPool {
  private readonly live = new Map<DecoderOwner, number>();
  /** Owners that came in through {@link tryAcquire}: evicted before any other. */
  private readonly optional = new Set<DecoderOwner>();
  private clock = 0;

  /** @param budget Max decoders alive at once (e.g. low tier 2, mid 4, high 8). */
  constructor(readonly budget: number) {}

  /** Number of decoders currently open. */
  get size(): number {
    return this.live.size;
  }

  /** Registers (or refreshes) `owner` as using a decoder; evicts others if over budget. */
  acquire(owner: DecoderOwner): void {
    this.live.set(owner, ++this.clock);
    while (this.live.size > this.budget) {
      // Optional decoders (previews) go first, then the least recently used.
      let oldest: DecoderOwner | null = null;
      let oldestAt = Infinity;
      for (const [candidate, at] of this.live) {
        const rank = this.optional.has(candidate) ? at - 1e15 : at;
        if (candidate !== owner && rank < oldestAt) {
          oldest = candidate;
          oldestAt = rank;
        }
      }
      if (!oldest) break;
      this.live.delete(oldest);
      this.optional.delete(oldest);
      oldest.releaseDecoder();
    }
    this.peak = Math.max(this.peak, this.live.size);
  }

  /**
   * Registers `owner` only if a slot is free (evicts nobody): for optional decoders such as
   * keyframe previews. Returns whether it got the slot.
   */
  tryAcquire(owner: DecoderOwner): boolean {
    if (this.live.has(owner)) {
      this.live.set(owner, ++this.clock);
      return true;
    }
    if (this.live.size >= this.budget) return false;
    this.live.set(owner, ++this.clock);
    this.optional.add(owner);
    this.peak = Math.max(this.peak, this.live.size);
    return true;
  }

  /** Gives `owner`'s slot back. */
  release(owner: DecoderOwner): void {
    this.live.delete(owner);
    this.optional.delete(owner);
  }

  /** Most decoders open at once since the pool was made (tests, bench). */
  peak = 0;
}

/** Something that holds a decoder and can give it up when the pool asks. */
export interface DecoderOwner {
  releaseDecoder(): void;
}

/** Counters for tests and the bench. */
export interface FrameSourceStats {
  requests: number;
  /** Requests overtaken by a newer one (latest-wins savings). */
  skipped: number;
  previews: number;
  /** Previews left out because the pool had no free slot. */
  previewsSkipped: number;
  /** Seeks served by continuing the running iterator. */
  continued: number;
  /** Seeks that started a new iterator (new decoder, from a keyframe). */
  restarts: number;
  watchdogResets: number;
}

export interface FrameRequestOptions {
  /** Called with a nearby keyframe while the exact frame is still decoding. Caller closes it. */
  onPreview?: (sample: VideoSample) => void;
}

const WATCHDOG_MS = 3000;
/** Continue the running iterator for targets up to this far ahead (s); farther = restart. */
const CONTINUE_WINDOW_S = 2;
/** On a restart, show a keyframe preview when the target is this far (s) past it. */
const PREVIEW_MIN_GAP_S = 1;

/** Frames of one video track for preview (seeking / scrubbing / stepping). */
export class FrameSource implements DecoderOwner {
  private readonly sink: VideoSampleSink;
  private readonly previewSink: VideoSampleSink;
  private readonly packets: EncodedPacketSink;
  private iterator: AsyncIterator<VideoSample> | null = null;
  /** Last frame the iterator yielded (kept so the same position doesn't decode twice). */
  private current: VideoSample | null = null;
  private wanted: { time: number; id: number; onPreview?: (s: VideoSample) => void } | null = null;
  private latestId = 0;
  private readonly waiting = new Map<number, (sample: VideoSample | null) => void>();
  private busy = false;
  private destroyed = false;
  private decodable: Promise<boolean> | null = null;
  readonly stats: FrameSourceStats = {
    requests: 0,
    skipped: 0,
    previews: 0,
    previewsSkipped: 0,
    continued: 0,
    restarts: 0,
    watchdogResets: 0,
  };

  /** The keyframe preview's decoder, as the pool sees it (evicted: its picture is dropped). */
  private readonly previewSlot: DecoderOwner & { evicted: boolean } = {
    evicted: false,
    releaseDecoder() {
      this.evicted = true;
    },
  };

  constructor(
    private readonly track: InputVideoTrack,
    private readonly pool: DecoderPool,
    /** Keyframe previews (exports and captures leave them out); they also need a free pool slot. */
    private readonly allowPreviews = true,
  ) {
    this.sink = new VideoSampleSink(track);
    this.previewSink = new VideoSampleSink(track);
    this.packets = new EncodedPacketSink(track);
  }

  /**
   * The frame shown at `time` (seconds). Resolves `null` if a newer request overtook this one, the
   * track can't be decoded here, or there's no frame there. The caller owns (and must close) the
   * returned sample.
   */
  frameAt(time: number, options: FrameRequestOptions = {}): Promise<VideoSample | null> {
    if (this.destroyed) return Promise.resolve(null);
    this.stats.requests++;
    const id = ++this.latestId;
    if (this.wanted) this.settle(this.wanted.id, null, true);
    this.wanted = { time, id, ...(options.onPreview ? { onPreview: options.onPreview } : {}) };
    const result = new Promise<VideoSample | null>((resolve) => this.waiting.set(id, resolve));
    void this.run();
    return result;
  }

  /** Called by the pool: give the decoder back (it reopens on the next request). */
  releaseDecoder(): void {
    this.stopIterator();
  }

  /** Frees everything. Pending requests resolve to `null`. */
  destroy(): void {
    this.destroyed = true;
    this.stopIterator();
    for (const resolve of this.waiting.values()) resolve(null);
    this.waiting.clear();
  }

  private async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.wanted && !this.destroyed) {
        const request = this.wanted;
        this.wanted = null;
        let sample: VideoSample | null = null;
        try {
          sample = await this.decodeAt(request.time, request.id, request.onPreview);
        } catch {
          // Decoder error or watchdog: start clean next time; this request gets nothing.
          this.stopIterator();
        }
        if (request.id !== this.latestId) {
          sample?.close();
          this.settle(request.id, null, true);
        } else {
          this.settle(request.id, sample, false);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private settle(id: number, sample: VideoSample | null, skipped: boolean): void {
    const resolve = this.waiting.get(id);
    if (!resolve) {
      sample?.close();
      return;
    }
    this.waiting.delete(id);
    if (skipped) this.stats.skipped++;
    resolve(sample);
  }

  private async decodeAt(
    time: number,
    id: number,
    onPreview?: (sample: VideoSample) => void,
  ): Promise<VideoSample | null> {
    this.decodable ??= this.track.canDecode();
    if (!(await this.decodable)) return null;

    const current = this.current;
    if (current && current.timestamp <= time && time < current.timestamp + current.duration) {
      return current.clone();
    }

    const canContinue =
      this.iterator !== null &&
      current !== null &&
      time > current.timestamp &&
      time - current.timestamp <= CONTINUE_WINDOW_S;
    if (canContinue) {
      this.stats.continued++;
    } else {
      this.stats.restarts++;
      this.stopIterator();
      this.iterator = this.sink.samples(time)[Symbol.asyncIterator]();
      if (onPreview && this.allowPreviews) void this.preview(time, id, onPreview);
    }
    this.pool.acquire(this);

    for (;;) {
      if (id !== this.latestId) return null; // overtaken: leave the iterator where it is
      const next = await this.nextSample();
      if (!next) {
        // End of the track: the last frame stays on screen.
        this.stopIterator(false);
        return this.current?.clone() ?? null;
      }
      this.current?.close();
      this.current = next;
      if (next.timestamp + next.duration > time) return next.clone();
    }
  }

  private async nextSample(): Promise<VideoSample | null> {
    const iterator = this.iterator!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), WATCHDOG_MS);
    });
    const result = await Promise.race([iterator.next(), timeout]).finally(() =>
      clearTimeout(timer),
    );
    if (result === 'timeout') {
      this.stats.watchdogResets++;
      throw new Error('Decoder stopped answering');
    }
    return result.done ? null : result.value;
  }

  private async preview(
    time: number,
    id: number,
    onPreview: (sample: VideoSample) => void,
  ): Promise<void> {
    let slot = false;
    try {
      const key = await this.packets.getKeyPacket(time, { verifyKeyPackets: true });
      if (!key || time - key.timestamp < PREVIEW_MIN_GAP_S) return;
      if (id !== this.latestId || this.destroyed) return;
      // A second decoder: only with a free slot (the exact frame's decoder has taken its own).
      slot = this.pool.tryAcquire(this.previewSlot);
      if (!slot) {
        this.stats.previewsSkipped++;
        return;
      }
      this.previewSlot.evicted = false;
      const sample = await this.previewSink.getSample(key.timestamp);
      if (sample && id === this.latestId && this.waiting.has(id) && !this.previewSlot.evicted) {
        this.stats.previews++;
        onPreview(sample);
      } else {
        sample?.close();
      }
    } catch {
      // A preview is a nicety; the exact frame still comes.
    } finally {
      if (slot) this.pool.release(this.previewSlot);
    }
  }

  private stopIterator(dropCurrent = true): void {
    const iterator = this.iterator;
    this.iterator = null;
    void iterator?.return?.(undefined).catch(() => undefined);
    if (dropCurrent) {
      this.current?.close();
      this.current = null;
    }
    this.pool.release(this);
  }
}
