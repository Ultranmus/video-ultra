import type { AudioLibrary, AudioLibraryTrack } from './audio-library';

/**
 * Starter sound effects: a small, opt-in {@link AudioLibrary} whose sounds are synthesised on the
 * device (Web Audio `OfflineAudioContext`: oscillators, seeded noise, filters, envelopes) the first
 * time they are previewed or added. Nothing is downloaded and no recording ships in the package —
 * every sound is made from the recipes below, written for this project, and dedicated to the
 * public domain (CC0). Each is a few hundred milliseconds of 48 kHz mono WAV (≤ 150 KB).
 */

/** Visible text of the starter set (titles and categories); override to translate. */
export interface StarterSoundLabels {
  title: string;
  credit: string;
  transitions: string;
  interface: string;
  impacts: string;
  whoosh: string;
  swoosh: string;
  riser: string;
  click: string;
  pop: string;
  tick: string;
  ding: string;
  success: string;
  error: string;
  boom: string;
  thud: string;
}

const DEFAULT_STARTER_LABELS: StarterSoundLabels = {
  title: 'Starter sounds',
  credit: 'Made by video-ultra · CC0, free for any use',
  transitions: 'Transitions',
  interface: 'Taps & alerts',
  impacts: 'Impacts',
  whoosh: 'Whoosh',
  swoosh: 'Quick swoosh',
  riser: 'Riser',
  click: 'Click',
  pop: 'Pop',
  tick: 'Tick',
  ding: 'Ding',
  success: 'Success',
  error: 'Error buzz',
  boom: 'Boom',
  thud: 'Soft thud',
};

const RATE = 48000;

type Recipe = (ctx: OfflineAudioContext, out: AudioNode) => void;

interface StarterSound {
  id: keyof StarterSoundLabels;
  category: 'transitions' | 'interface' | 'impacts';
  seconds: number;
  recipe: Recipe;
}

/** Deterministic white noise (same sound every time, on every device). */
function noise(ctx: OfflineAudioContext, seconds: number, seed: number): AudioBufferSourceNode {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = (s / 2 ** 32) * 2 - 1;
  }
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  return node;
}

/** A gain node with an attack / decay envelope starting at `at`. */
function envelope(
  ctx: OfflineAudioContext,
  peak: number,
  attack: number,
  decay: number,
  at = 0,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

/** A sine / triangle / square tone through an envelope. */
function tone(
  ctx: OfflineAudioContext,
  out: AudioNode,
  type: OscillatorType,
  freq: number,
  at: number,
  peak: number,
  attack: number,
  decay: number,
  glideTo?: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + attack + decay);
  const env = envelope(ctx, peak, attack, decay, at);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + attack + decay + 0.02);
}

/** Filtered noise sweeping from `from` to `to` Hz with a swell. */
function sweep(
  ctx: OfflineAudioContext,
  out: AudioNode,
  seconds: number,
  from: number,
  to: number,
  peakAt: number,
  seed: number,
  peak = 0.8,
): void {
  const src = noise(ctx, seconds, seed);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.2;
  band.frequency.setValueAtTime(from, 0);
  band.frequency.exponentialRampToValueAtTime(to, seconds);
  const env = envelope(ctx, peak, peakAt, seconds - peakAt);
  src.connect(band).connect(env).connect(out);
  src.start(0);
}

const SOUNDS: readonly StarterSound[] = [
  {
    id: 'whoosh',
    category: 'transitions',
    seconds: 0.8,
    recipe: (ctx, out) => sweep(ctx, out, 0.8, 300, 3000, 0.45, 7),
  },
  {
    id: 'swoosh',
    category: 'transitions',
    seconds: 0.35,
    recipe: (ctx, out) => sweep(ctx, out, 0.35, 1800, 6000, 0.12, 11, 0.7),
  },
  {
    id: 'riser',
    category: 'transitions',
    seconds: 1.6,
    recipe: (ctx, out) => {
      sweep(ctx, out, 1.6, 200, 5000, 1.45, 23, 0.5);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, 0);
      osc.frequency.exponentialRampToValueAtTime(880, 1.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2500;
      const env = envelope(ctx, 0.18, 1.45, 0.12);
      osc.connect(lp).connect(env).connect(out);
      osc.start(0);
      osc.stop(1.6);
    },
  },
  {
    id: 'click',
    category: 'interface',
    seconds: 0.08,
    recipe: (ctx, out) => {
      const src = noise(ctx, 0.02, 3);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2000;
      src
        .connect(hp)
        .connect(envelope(ctx, 0.9, 0.001, 0.015))
        .connect(out);
      src.start(0);
      tone(ctx, out, 'sine', 2400, 0, 0.35, 0.001, 0.03);
    },
  },
  {
    id: 'pop',
    category: 'interface',
    seconds: 0.18,
    recipe: (ctx, out) => tone(ctx, out, 'sine', 900, 0, 0.9, 0.004, 0.12, 180),
  },
  {
    id: 'tick',
    category: 'interface',
    seconds: 0.1,
    recipe: (ctx, out) => {
      tone(ctx, out, 'triangle', 1500, 0, 0.6, 0.001, 0.05, 1200);
      tone(ctx, out, 'sine', 3100, 0, 0.2, 0.001, 0.025);
    },
  },
  {
    id: 'ding',
    category: 'interface',
    seconds: 1.6,
    recipe: (ctx, out) => {
      // A small bell: inharmonic partials decaying at different rates.
      tone(ctx, out, 'sine', 1320, 0, 0.5, 0.003, 1.5);
      tone(ctx, out, 'sine', 1320 * 2.76, 0, 0.18, 0.003, 0.7);
      tone(ctx, out, 'sine', 1320 * 5.4, 0, 0.08, 0.002, 0.3);
    },
  },
  {
    id: 'success',
    category: 'interface',
    seconds: 0.9,
    recipe: (ctx, out) => {
      [1047, 1319, 1568].forEach((f, i) =>
        tone(ctx, out, 'triangle', f, i * 0.11, 0.45, 0.005, 0.5),
      );
    },
  },
  {
    id: 'error',
    category: 'interface',
    seconds: 0.45,
    recipe: (ctx, out) => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      lp.connect(out);
      tone(ctx, lp, 'square', 155, 0, 0.3, 0.005, 0.14);
      tone(ctx, lp, 'square', 155, 0.2, 0.3, 0.005, 0.2);
    },
  },
  {
    id: 'boom',
    category: 'impacts',
    seconds: 1.4,
    recipe: (ctx, out) => {
      tone(ctx, out, 'sine', 70, 0, 0.95, 0.005, 1.3, 32);
      const src = noise(ctx, 0.5, 41);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1800, 0);
      lp.frequency.exponentialRampToValueAtTime(120, 0.45);
      src
        .connect(lp)
        .connect(envelope(ctx, 0.6, 0.003, 0.45))
        .connect(out);
      src.start(0);
    },
  },
  {
    id: 'thud',
    category: 'impacts',
    seconds: 0.4,
    recipe: (ctx, out) => {
      tone(ctx, out, 'sine', 120, 0, 0.9, 0.003, 0.3, 55);
      const src = noise(ctx, 0.08, 5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      src
        .connect(lp)
        .connect(envelope(ctx, 0.4, 0.002, 0.06))
        .connect(out);
      src.start(0);
    },
  },
];

/** 16-bit PCM WAV of one channel. */
function wav(samples: Float32Array, rate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

/** Renders one recipe (off the main thread: the browser's offline audio renderer). */
async function render(sound: StarterSound): Promise<Blob> {
  const ctx = new OfflineAudioContext(1, Math.ceil(sound.seconds * RATE), RATE);
  // A gentle limiter so overlapping partials never clip.
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -3;
  master.ratio.value = 12;
  master.connect(ctx.destination);
  sound.recipe(ctx, master);
  const buffer = await ctx.startRendering();
  return wav(buffer.getChannelData(0), RATE);
}

/**
 * The starter sound effects as an {@link AudioLibrary} (opt-in: pass it, or merge its tracks into
 * your own source). Sounds are made on first use and kept in memory while the page is open.
 *
 * ```tsx
 * import { VideoEditor, createStarterSounds } from '@video-ultra/react';
 * <VideoEditor audioLibrary={createStarterSounds()} />
 * ```
 */
export function createStarterSounds(
  options: { labels?: Partial<StarterSoundLabels> } = {},
): AudioLibrary {
  const l = { ...DEFAULT_STARTER_LABELS, ...options.labels };
  const made = new Map<string, Promise<Blob>>();
  const tracks: AudioLibraryTrack[] = SOUNDS.map((s) => ({
    id: s.id,
    title: l[s.id],
    duration: s.seconds,
    kind: 'sound',
    credit: l.credit,
  }));
  const blobFor = (id: string): Promise<Blob> => {
    let blob = made.get(id);
    if (!blob) {
      const sound = SOUNDS.find((s) => s.id === id);
      if (!sound) return Promise.reject(new Error(`No starter sound ${id}`));
      blob = render(sound);
      blob.catch(() => made.delete(id));
      made.set(id, blob);
    }
    return blob;
  };
  return {
    title: l.title,
    categories: (['transitions', 'interface', 'impacts'] as const).map((id) => ({
      id,
      label: l[id],
    })),
    notice: l.credit,
    search: ({ text, category }) => {
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      return Promise.resolve({
        tracks: tracks.filter((t, i) => {
          if (category && SOUNDS[i]!.category !== category) return false;
          const title = t.title.toLowerCase();
          return words.every((w) => title.includes(w));
        }),
        next: null,
      });
    },
    load: (track) => blobFor(track.id),
  };
}
