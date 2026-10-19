/**
 * The image maths around a segmentation model, kept pure so it's tested without a browser: the
 * size the model sees, RGBA pixels → its normalised CHW input, its alpha matte → RGBA.
 */

/** How a model wants its picture. */
export interface ModelInput {
  /** `short`: the shorter side becomes `size` (keeping the aspect), both sides multiples of 32.
   * `square`: stretched to `size` × `size`. */
  resize: 'short' | 'square';
  size: number;
  /** Per-channel mean and std after scaling to 0…1 (std 1, mean 0 = no normalisation). */
  mean: number;
  std: number;
}

/** The model's input size for a `width × height` picture. */
export function inputSize(
  width: number,
  height: number,
  model: Pick<ModelInput, 'resize' | 'size'>,
): { width: number; height: number } {
  if (model.resize === 'square') return { width: model.size, height: model.size };
  const k = model.size / Math.min(width, height);
  const round = (v: number) => Math.max(32, Math.round((v * k) / 32) * 32);
  return { width: round(width), height: round(height) };
}

/** RGBA bytes (`width × height`) → planar float RGB, scaled and normalised, into `out`. */
export function toTensor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  model: Pick<ModelInput, 'mean' | 'std'>,
  out: Float32Array = new Float32Array(3 * width * height),
): Float32Array {
  const plane = width * height;
  const k = 1 / (255 * model.std);
  const m = model.mean / model.std;
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    out[i] = rgba[p]! * k - m;
    out[plane + i] = rgba[p + 1]! * k - m;
    out[2 * plane + i] = rgba[p + 2]! * k - m;
  }
  return out;
}

/** A 0…1 matte → RGBA bytes whose alpha is the matte (colour white). */
export function matteToRgba(
  matte: Float32Array,
  out?: Uint8ClampedArray<ArrayBuffer>,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = out ?? new Uint8ClampedArray(matte.length * 4);
  for (let i = 0, p = 0; i < matte.length; i++, p += 4) {
    rgba[p] = rgba[p + 1] = rgba[p + 2] = 255;
    const a = matte[i]!;
    rgba[p + 3] = a <= 0 ? 0 : a >= 1 ? 255 : Math.round(a * 255);
  }
  return rgba;
}
