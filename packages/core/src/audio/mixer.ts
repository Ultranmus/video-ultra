import { AudioSampleSink, type AudioSample, type InputAudioTrack } from 'mediabunny';
import { compoundProject } from '../model/project';
import type { Asset, Item, Project } from '../model/schema';
import { FLICKS_PER_SECOND, type Time } from '../model/time';
import { gainAt, limit, mixInto, Resampler } from './dsp';
import { applyDuck, DuckFollower, hasDucking } from './duck';
import { ClipFx, hasAudioFx } from './fx';
import { audioSpan, spanGain, type AudioSpan } from './spans';

const EMPTY_SPAN: AudioSpan = {
  start: 0,
  end: 0,
  fadeInFrom: 0,
  fadeInTo: 0,
  fadeOutFrom: 0,
  fadeOutTo: 0,
};

/**
 * The mixer: renders the project's sound for a time range into stereo buffers at the output rate.
 * Runs in the engine worker. Preview playback and export use the same code, so they sound alike.
 */

type AudibleItem = Extract<Item, { kind: 'video' | 'audio' }>;

/** Growable FIFO of float samples (one channel) — no allocation per block once warmed up. */
class Fifo {
  private data = new Float32Array(16384);
  private start = 0;
  private end = 0;

  get length(): number {
    return this.end - this.start;
  }

  view(): Float32Array {
    return this.data.subarray(this.start, this.end);
  }

  /** Room for `count` more samples; returns where to write them. */
  reserve(count: number): Float32Array {
    if (this.end + count > this.data.length) {
      const live = this.length;
      if (live + count > this.data.length) {
        const bigger = new Float32Array(Math.max(this.data.length * 2, live + count));
        bigger.set(this.view());
        this.data = bigger;
      } else {
        this.data.copyWithin(0, this.start, this.end);
      }
      this.start = 0;
      this.end = live;
    }
    const slot = this.data.subarray(this.end, this.end + count);
    this.end += count;
    return slot;
  }

  drop(count: number): void {
    this.start += Math.min(count, this.length);
    if (this.start === this.end) this.start = this.end = 0;
  }

  clear(): void {
    this.start = this.end = 0;
  }
}

/** Reads one clip's audio, resampled to the output rate, keeping its place between blocks. */
class ClipReader {
  private readonly sink: AudioSampleSink;
  private iterator: AsyncIterator<AudioSample> | null = null;
  private readonly left = new Fifo();
  private readonly right = new Fifo();
  private readonly resampleL = new Resampler(1);
  private readonly resampleR = new Resampler(1);
  /** Source time (s) the next output sample corresponds to; NaN = no position yet. */
  private expected = NaN;
  private ended = false;
  private scratch = new Float32Array(4096);
  /** The clip's sound effects and their state (made on first use; reset when the clip seeks). */
  fx: ClipFx | null = null;

  constructor(
    private readonly track: InputAudioTrack,
    private readonly sourceRate: number,
    private readonly outRate: number,
  ) {
    this.sink = new AudioSampleSink(track);
  }

  /**
   * Writes `count` stereo samples for source time `sourceS` at `speed` into outL/outR at `offset`.
   * Seeks only when the requested time isn't where the previous read left off.
   */
  async read(
    sourceS: number,
    speed: number,
    count: number,
    outL: Float32Array,
    outR: Float32Array,
    offset: number,
  ): Promise<void> {
    const ratio = (this.sourceRate * speed) / this.outRate;
    this.resampleL.ratio = ratio;
    this.resampleR.ratio = ratio;
    const tolerance = 2 / this.outRate; // two output samples
    if (!(Math.abs(sourceS - this.expected) <= tolerance)) await this.seek(sourceS);
    let written = 0;
    while (written < count) {
      if (this.left.length < 2 && !(await this.pull())) {
        outL.fill(0, offset + written, offset + count);
        outR.fill(0, offset + written, offset + count);
        break;
      }
      const l = this.resampleL.process(this.left.view(), outL, offset + written, count - written);
      this.resampleR.process(this.right.view(), outR, offset + written, count - written);
      this.left.drop(l.consumed);
      this.right.drop(l.consumed);
      written += l.written;
      if (l.written === 0 && this.left.length >= 2) break; // can't make progress (shouldn't happen)
    }
    this.expected = sourceS + (count / this.outRate) * speed;
  }

  private async seek(sourceS: number): Promise<void> {
    this.fx?.reset();
    void this.iterator?.return?.(undefined).catch(() => undefined);
    this.iterator = this.sink.samples(Math.max(0, sourceS))[Symbol.asyncIterator]();
    this.left.clear();
    this.right.clear();
    this.resampleL.reset();
    this.resampleR.reset();
    this.ended = false;
    // Drop the part of the first block before the requested time.
    if (await this.pull()) {
      const skip = Math.round((sourceS - this.firstTimestamp) * this.sourceRate);
      if (skip > 0) {
        this.left.drop(skip);
        this.right.drop(skip);
      }
    }
  }

  private firstTimestamp = 0;

  /** Appends the next decoded block to the FIFOs. False at the end of the track. */
  private async pull(): Promise<boolean> {
    if (this.ended || !this.iterator) return false;
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return false;
    }
    const sample = next.value;
    try {
      const frames = sample.numberOfFrames;
      if (this.left.length === 0) this.firstTimestamp = sample.timestamp;
      if (this.scratch.length < frames) this.scratch = new Float32Array(frames);
      const scratch = this.scratch.subarray(0, frames);
      sample.copyTo(scratch, { planeIndex: 0, format: 'f32-planar' });
      this.left.reserve(frames).set(scratch);
      // Mono → both sides; more than two channels → the second one is the right side.
      if (sample.numberOfChannels > 1)
        sample.copyTo(scratch, { planeIndex: 1, format: 'f32-planar' });
      this.right.reserve(frames).set(scratch);
    } finally {
      sample.close();
    }
    return true;
  }

  dispose(): void {
    void this.iterator?.return?.(undefined).catch(() => undefined);
    this.iterator = null;
  }
}

/** Where a clip's audio comes from: the asset's chosen audio track and its sample rate. */
export interface AudioTrackSource {
  track: InputAudioTrack;
  sampleRate: number;
}

/** Combined clips inside combined clips: this deep, no deeper (a guard). */
const MAX_NESTING = 4;

/**
 * Reads a combined clip's sound: its inside mixed by a mixer of its own at the
 * clip's source time, resampled (linear) for the clip's speed — like a video's sound, so the
 * outer mixer adds volume, fades, crossfades, effects and ducking the same way.
 */
class CompoundReader {
  private readonly mixer: Mixer;
  private l = new Float32Array(0);
  private r = new Float32Array(0);
  fx: ClipFx | null = null;
  /** The inside to mix (set before each read; the project may have changed). */
  view: Project | null = null;

  constructor(
    private readonly rate: number,
    audioOf: (assetId: string) => AudioTrackSource | null,
    depth: number,
  ) {
    this.mixer = new Mixer(rate, audioOf);
    this.mixer.depth = depth;
  }

  async read(
    sourceS: number,
    speed: number,
    count: number,
    outL: Float32Array,
    outR: Float32Array,
    offset: number,
  ): Promise<void> {
    if (!this.view) {
      outL.fill(0, offset, offset + count);
      outR.fill(0, offset, offset + count);
      return;
    }
    const need = speed === 1 ? count : Math.ceil(count * speed) + 2;
    if (this.l.length < need) {
      this.l = new Float32Array(need);
      this.r = new Float32Array(need);
    }
    const start = Math.round(sourceS * FLICKS_PER_SECOND);
    await this.mixer.render(this.view, start, need, this.l, this.r);
    if (speed === 1) {
      outL.set(this.l.subarray(0, count), offset);
      outR.set(this.r.subarray(0, count), offset);
      return;
    }
    for (let i = 0; i < count; i++) {
      const x = i * speed;
      const i0 = Math.floor(x);
      const f = x - i0;
      outL[offset + i] = this.l[i0]! * (1 - f) + this.l[i0 + 1]! * f;
      outR[offset + i] = this.r[i0]! * (1 - f) + this.r[i0 + 1]! * f;
    }
  }

  dispose(): void {
    this.mixer.dispose();
  }
}

/** One audible item to mix in the current block. */
interface MixJob {
  item: AudibleItem;
  span: AudioSpan;
  /** A file's audio track, or a combined clip (its inside is mixed). */
  source: AudioTrackSource | Asset;
}

/** Mixes a project's audible items for any time range. */
export class Mixer {
  private readonly readers = new Map<string, ClipReader | CompoundReader>();
  /** How deep inside combined clips this mixer is (0: the timeline). */
  depth = 0;
  /** The project of the block being mixed (combined clips read their inside from it). */
  private project: Project | null = null;
  private tempL = new Float32Array(0);
  private tempR = new Float32Array(0);
  private readonly spans = new Map<string, AudioSpan>();
  private readonly used = new Set<string>();
  /** This block's items: the voice (everything not ducked) and the ducked ones. Reused. */
  private readonly keyJobs: MixJob[] = [];
  private readonly duckJobs: MixJob[] = [];
  private readonly jobPool: MixJob[] = [];
  /** Ducking: the block's voice signal (mono), its presence curve, and the follower. */
  private key = new Float32Array(0);
  private presence = new Float32Array(0);
  private readonly follower: DuckFollower;

  constructor(
    readonly sampleRate: number,
    /** Resolves an asset id to its audio track (null: no audio / not loaded yet). */
    private readonly audioOf: (assetId: string) => AudioTrackSource | null,
  ) {
    this.follower = new DuckFollower(sampleRate);
  }

  /**
   * Renders `frames` stereo samples starting at timeline time `start` into outL/outR (overwritten).
   *
   * Items marked `duck` are mixed last, lowered while the rest — the voice they listen to — is
   * speaking (`audio/duck.ts`). A project with nothing ducked skips all of that.
   */
  async render(
    project: Project,
    start: Time,
    frames: number,
    outL: Float32Array,
    outR: Float32Array,
  ): Promise<void> {
    outL.fill(0, 0, frames);
    outR.fill(0, 0, frames);
    if (this.tempL.length < frames) {
      this.tempL = new Float32Array(frames);
      this.tempR = new Float32Array(frames);
    }
    const blockEnd = start + Math.round((frames / this.sampleRate) * FLICKS_PER_SECOND);
    const ducking = hasDucking(project);
    this.project = project;
    const { used, keyJobs, duckJobs, jobPool } = this;
    used.clear();
    let pooled = 0;
    for (const track of project.tracks) {
      if (track.muted) continue;
      for (let index = 0; index < track.items.length; index++) {
        const item = track.items[index]!;
        if (item.kind !== 'video' && item.kind !== 'audio') continue;
        if (item.muted || item.volume === 0) continue;
        // A transition crossfades the sound too: the span may reach past the item's own edges.
        // Spans come from a per-item pool (no allocation per block once warm).
        let span = this.spans.get(item.id);
        if (!span) this.spans.set(item.id, (span = { ...EMPTY_SPAN }));
        audioSpan(track, index, project.assets[item.assetId]?.duration ?? 0, span);
        if (span.start >= blockEnd || span.end <= start) continue;
        const asset = project.assets[item.assetId];
        const source =
          asset?.kind === 'compound'
            ? asset.hasAudio && this.depth < MAX_NESTING
              ? asset
              : null
            : this.audioOf(item.assetId);
        if (!source) continue;
        used.add(item.id);
        const job = jobPool[pooled] ?? (jobPool[pooled] = { item, span, source });
        pooled++;
        job.item = item;
        job.span = span;
        job.source = source;
        (ducking && item.duck ? duckJobs : keyJobs).push(job);
      }
    }
    if (ducking && this.key.length < frames) {
      this.key = new Float32Array(frames);
      this.presence = new Float32Array(frames);
    }
    if (ducking) this.key.fill(0, 0, frames);
    // Clips render one after another into shared temp buffers (they're short and mostly I/O-bound).
    try {
      for (const job of keyJobs) await this.renderItem(job, start, frames, outL, outR, ducking);
      if (ducking) {
        // The block's first timeline sample (exact: a sample is a whole number of flicks at 44.1
        // and 48 kHz), so the follower's windows fall at the same places for any block size.
        const position = Math.round((start / FLICKS_PER_SECOND) * this.sampleRate);
        this.follower.process(this.key, frames, position, this.presence);
        for (const job of duckJobs) await this.renderItem(job, start, frames, outL, outR, false);
      } else {
        this.follower.reset();
      }
    } finally {
      keyJobs.length = 0;
      duckJobs.length = 0;
    }
    limit(outL, frames);
    limit(outR, frames);
    for (const id of this.spans.keys()) if (!used.has(id)) this.spans.delete(id);
    for (const [id, reader] of this.readers) {
      if (used.has(id)) continue;
      reader.dispose();
      this.readers.delete(id);
    }
  }

  /**
   * Reads one item's sound for the block and adds it to the output with its volume, fades and
   * crossfade. `toKey`: also add it (mono) to the voice signal ducked items listen to. A ducked
   * item is lowered by the block's presence curve first.
   */
  private async renderItem(
    { item, span, source }: MixJob,
    start: Time,
    frames: number,
    outL: Float32Array,
    outR: Float32Array,
    toKey: boolean,
  ): Promise<void> {
    const rate = this.sampleRate;
    const toFrames = (t: Time) => Math.round((t / FLICKS_PER_SECOND) * rate);
    const first = Math.max(0, toFrames(span.start - start));
    const last = Math.min(frames, toFrames(span.end - start));
    const count = last - first;
    if (count <= 0) return;
    const timeAtFirst = start + Math.round((first / rate) * FLICKS_PER_SECOND);
    const local = (timeAtFirst - item.start) / FLICKS_PER_SECOND;
    const sourceS = item.sourceIn / FLICKS_PER_SECOND + local * item.speed;
    let reader = this.readers.get(item.id);
    if (!reader) {
      reader =
        'track' in source
          ? new ClipReader(source.track, source.sampleRate, rate)
          : new CompoundReader(rate, this.audioOf, this.depth + 1);
      this.readers.set(item.id, reader);
    }
    if (reader instanceof CompoundReader && !('track' in source) && this.project)
      reader.view = compoundProject(this.project, source);
    await reader.read(sourceS, item.speed, count, this.tempL, this.tempR, 0);
    if (hasAudioFx(item.audioFx, item.speed))
      (reader.fx ??= new ClipFx(rate)).process(
        item.audioFx!,
        item.speed,
        this.tempL,
        this.tempR,
        count,
      );
    const duration = item.duration / FLICKS_PER_SECOND;
    const fadeIn = item.fadeIn / FLICKS_PER_SECOND;
    const fadeOut = item.fadeOut / FLICKS_PER_SECOND;
    // The clip's own volume and fades (inside its edges) × the transition crossfade.
    const clamp = (x: number) => Math.min(duration, Math.max(0, x));
    const timeAtLast = timeAtFirst + Math.round((count / rate) * FLICKS_PER_SECOND);
    const g0 =
      gainAt(clamp(local), duration, item.volume, fadeIn, fadeOut) * spanGain(span, timeAtFirst);
    const g1 =
      gainAt(clamp(local + count / rate), duration, item.volume, fadeIn, fadeOut) *
      spanGain(span, timeAtLast);
    if (!toKey && item.duck) {
      applyDuck(this.tempL, count, this.presence, first, item.duck);
      applyDuck(this.tempR, count, this.presence, first, item.duck);
    }
    mixInto(outL, first, this.tempL, 0, count, g0, g1);
    mixInto(outR, first, this.tempR, 0, count, g0, g1);
    if (toKey) {
      mixInto(this.key, first, this.tempL, 0, count, g0 * 0.5, g1 * 0.5);
      mixInto(this.key, first, this.tempR, 0, count, g0 * 0.5, g1 * 0.5);
    }
  }

  /** Forget reading positions (after a seek the next render seeks every clip). */
  dispose(): void {
    for (const reader of this.readers.values()) reader.dispose();
    this.readers.clear();
    this.follower.reset();
  }
}
