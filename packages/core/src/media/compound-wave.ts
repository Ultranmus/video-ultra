import type { Project } from '../model/schema';
import { FLICKS_PER_SECOND } from '../model/time';
import { peaksPerSecondFor, type Waveform } from './peaks';

/**
 * The waveform of a combined clip (DECISIONS #155, #207): its inside has no file, so its peaks are
 * mixed from the waveforms of the sounds playing inside it (each file's own, already cached), at
 * their places, trims, speeds and volumes — through combined clips inside it too. Pure maths, no
 * browser APIs. The mix adds peaks (an upper bound of the real mix's peak), clamped to 1: enough
 * to show where the sound is loud or quiet.
 */

/** One sound playing inside a combined clip, in the clip's own time (seconds). */
export interface SoundPart {
  /** The file asset whose waveform this reads. */
  assetId: string;
  /** Where it plays inside the clip: `at` ≤ t < `end`. */
  at: number;
  end: number;
  /** The file's second playing at `at`. */
  from: number;
  /** File seconds per clip second. */
  speed: number;
  /** Volume (0…2 × the volumes of the clips around it). */
  gain: number;
}

const MAX_DEPTH = 4;

/**
 * The sounds inside combined clip `assetId`, flattened (nested combined clips resolved), plus the
 * ids of the combined clips it reads (to know when a cached mix is stale). Muted clips and
 * tracks, silent files and captions are left out.
 */
export function compoundSoundParts(
  project: Project,
  assetId: string,
): { parts: SoundPart[]; compounds: string[] } {
  const parts: SoundPart[] = [];
  const compounds: string[] = [];
  const walk = (
    id: string,
    depth: number,
    /** Window of this clip's time that is heard, and how it maps to the top clip's time. */
    lo: number,
    hi: number,
    toTop: (t: number) => number,
    /** This clip's seconds per top clip second. */
    rate: number,
    gain: number,
  ) => {
    const asset = project.assets[id];
    if (!asset || asset.kind !== 'compound' || !asset.tracks || depth >= MAX_DEPTH) return;
    compounds.push(id);
    for (const track of asset.tracks) {
      if (track.muted || track.kind === 'caption') continue;
      for (const item of track.items) {
        if (item.kind !== 'audio' && item.kind !== 'video') continue;
        if (item.muted || item.volume <= 0) continue;
        const source = project.assets[item.assetId];
        if (!source) continue;
        const start = item.start / FLICKS_PER_SECOND;
        const a = Math.max(lo, start);
        const b = Math.min(hi, start + item.duration / FLICKS_PER_SECOND);
        if (b <= a) continue;
        const sourceIn = item.sourceIn / FLICKS_PER_SECOND;
        const fromA = sourceIn + (a - start) * item.speed;
        if (source.kind === 'compound') {
          // The inner clip's time t ↔ this clip's time start + (t − sourceIn) / speed.
          const speed = item.speed;
          walk(
            source.id,
            depth + 1,
            fromA,
            sourceIn + (b - start) * speed,
            (t) => toTop(start + (t - sourceIn) / speed),
            rate * speed,
            gain * item.volume,
          );
          continue;
        }
        if (!source.hasAudio) continue;
        parts.push({
          assetId: source.id,
          at: toTop(a),
          end: toTop(b),
          from: fromA,
          speed: item.speed * rate,
          gain: gain * item.volume,
        });
      }
    }
  };
  const top = project.assets[assetId];
  if (top?.kind === 'compound') walk(assetId, 0, 0, Infinity, (t) => t, 1, 1);
  return { parts, compounds };
}

/**
 * Mixes the parts' waveforms into one for a clip `duration` seconds long. `waveOf` gives each
 * file's waveform (null: not known — that part is left out).
 */
export function mixPeaks(
  duration: number,
  parts: readonly SoundPart[],
  waveOf: (assetId: string) => Waveform | null,
): Waveform {
  const peaksPerSecond = peaksPerSecondFor(duration);
  const peaks = new Float32Array(Math.max(1, Math.ceil(duration * peaksPerSecond) + 1));
  for (const part of parts) {
    const wave = waveOf(part.assetId);
    if (!wave || wave.peaks.length === 0) continue;
    const src = wave.peaks;
    const sps = wave.peaksPerSecond;
    const j0 = Math.max(0, Math.floor(part.at * peaksPerSecond));
    const j1 = Math.min(peaks.length, Math.ceil(part.end * peaksPerSecond));
    for (let j = j0; j < j1; j++) {
      // This bucket's span of the clip, clipped to the part, in the file's time.
      const t0 = Math.max(part.at, j / peaksPerSecond);
      const t1 = Math.min(part.end, (j + 1) / peaksPerSecond);
      if (t1 <= t0) continue;
      const s0 = part.from + (t0 - part.at) * part.speed;
      const s1 = part.from + (t1 - part.at) * part.speed;
      const i0 = Math.max(0, Math.floor(s0 * sps));
      const i1 = Math.min(src.length, Math.max(i0 + 1, Math.ceil(s1 * sps)));
      let peak = 0;
      for (let i = i0; i < i1; i++) if (src[i]! > peak) peak = src[i]!;
      const v = peaks[j]! + peak * part.gain;
      peaks[j] = v > 1 ? 1 : v;
    }
  }
  return { peaksPerSecond, peaks, duration };
}
