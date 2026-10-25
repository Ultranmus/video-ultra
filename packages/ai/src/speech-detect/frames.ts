/**
 * The detector's chances (one per 32 ms window) as 20 ms frames of speech: a frame is speech
 * when its window's chance is at least one half; gaps under 200 ms are filled (the pauses
 * inside a phrase, as for the loudness method). Pure; tested.
 */
export function speechFrames(chance: Float32Array, samples: number): Uint8Array {
  const frames = Math.floor(samples / FRAME);
  const voice = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) {
    const w = Math.min(chance.length - 1, Math.floor((f * FRAME + FRAME / 2) / WINDOW));
    if (chance[w]! >= 0.5) voice[f] = 1;
  }
  let last = -1;
  for (let f = 0; f < frames; f++) {
    if (!voice[f]) continue;
    if (last >= 0 && f - last <= FILL) voice.fill(1, last, f);
    last = f;
  }
  return voice;
}

const FRAME = 320;
const WINDOW = 512;
const FILL = 10;
