/**
 * Video scopes (v0.4): how bright and how colourful the picture is, measured on a small copy of
 * the frame (the engine renders it at most {@link SCOPE_MAX_SIDE} px on its long side). Pure maths over RGBA
 * bytes; the engine worker runs it and sends the counts, the UI draws them.
 *
 * - **Histogram:** pixels per level (0…255) for red, green, blue and brightness (BT.709 luma).
 * - **Waveform:** per picture column, how many pixels sit at each brightness (0 bottom … top).
 * - **Parade:** the same per colour channel (red, green, blue side by side).
 * - **Vectorscope:** pixels per hue / saturation point (Cb right, Cr up; the centre is grey).
 */

/** Longest side of the frame the scopes read (the waveform has one column per pixel). */
export const SCOPE_MAX_SIDE = 256;
/** Brightness levels in the waveform / parade (rows). */
export const SCOPE_ROWS = 128;
/** Vectorscope size (square). */
export const VECTOR_SIZE = 128;

/** Scope counts of one frame. */
export interface ScopeData {
  /** Columns of `waveform` / each third of `parade` (= the frame's width). */
  width: number;
  /** 4 × 256 counts: red, green, blue, luma. */
  histogram: Uint32Array;
  /** `width × SCOPE_ROWS` counts, row-major, row 0 = brightest. */
  waveform: Uint32Array;
  /** `3 × width × SCOPE_ROWS`: the red, green and blue waveforms, one after another. */
  parade: Uint32Array;
  /** `VECTOR_SIZE²` counts, row 0 = top (most Cr). */
  vector: Uint32Array;
  /** Pixels counted (width × height). */
  pixels: number;
}

/** Counts the scopes of an RGBA frame `width × height`. */
export function computeScopes(rgba: ArrayLike<number>, width: number, height: number): ScopeData {
  const rows = SCOPE_ROWS;
  const histogram = new Uint32Array(1024);
  const waveform = new Uint32Array(width * rows);
  const parade = new Uint32Array(3 * width * rows);
  const vector = new Uint32Array(VECTOR_SIZE * VECTOR_SIZE);
  const plane = width * rows;
  const top = rows - 1;
  const v = VECTOR_SIZE - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const l8 = Math.min(255, Math.round(luma));
      histogram[r]!++;
      histogram[256 + g]!++;
      histogram[512 + b]!++;
      histogram[768 + l8]!++;
      // Row 0 is the top (255): brighter = higher, as on a monitor scope.
      waveform[(top - (l8 >> 1)) * width + x]!++;
      parade[(top - (r >> 1)) * width + x]!++;
      parade[plane + (top - (g >> 1)) * width + x]!++;
      parade[2 * plane + (top - (b >> 1)) * width + x]!++;
      // BT.709 colour difference, −0.5…0.5 each → 0…VECTOR_SIZE−1.
      const cb = (b - luma) / 1.8556 / 255;
      const cr = (r - luma) / 1.5748 / 255;
      // (+1e-7: a grey's colour difference is ±1e-17, not 0 — keep greys in one centre cell.)
      const vx = Math.round((cb + 0.5) * v + 1e-7);
      const vy = Math.round((0.5 - cr) * v + 1e-7);
      vector[vy * VECTOR_SIZE + vx]!++;
    }
  }
  return { width, histogram, waveform, parade, vector, pixels: width * height };
}

/** Where a pure colour lands on the vectorscope (fractions 0…1 of its size; for the targets). */
export function vectorPoint(r: number, g: number, b: number): { x: number; y: number } {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const cb = (b - luma) / 1.8556 / 255;
  const cr = (r - luma) / 1.5748 / 255;
  return { x: cb + 0.5, y: 0.5 - cr };
}
