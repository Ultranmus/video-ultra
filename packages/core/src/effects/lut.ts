/**
 * `.cube` 3D LUT files (the common colour-look format): parsed into RGBA8 texels for a 3D
 * texture. Runs in the engine worker (a 65-point file has ~275,000 rows), never on the main
 * thread. The renderer samples the texture with trilinear filtering on both backends.
 */

/** A parsed 3D LUT, ready to upload as a `size³` RGBA8 3D texture (red fastest, then green). */
export interface CubeLut {
  size: number;
  /** The file's `TITLE`, if any. */
  title: string | null;
  /** `size³ × 4` bytes. */
  data: Uint8Array<ArrayBuffer>;
}

/** Smallest and largest grid accepted (17, 33 and 65 are the usual sizes). */
export const LUT_MIN_SIZE = 2;
export const LUT_MAX_SIZE = 65;

/** A `.cube` file that can't be used, with a message the user can act on. */
export class LutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LutError';
  }
}

const SPACE = /\s+/;

/**
 * Parses a `.cube` file. Throws a {@link LutError} for a file that isn't a usable 3D LUT (1D LUTs,
 * missing size, wrong row count, bad numbers, input ranges other than 0–1). Output values are
 * clamped to 0…1.
 */
export function parseCubeLut(text: string): CubeLut {
  let size = 0;
  let title: string | null = null;
  let data: Uint8Array<ArrayBuffer> | null = null;
  let rows = 0;
  let lineNo = 0;
  let pos = 0;
  const length = text.length;
  while (pos < length) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = length;
    const line = text.slice(pos, end).trim();
    pos = end + 1;
    lineNo++;
    if (line === '' || line.charCodeAt(0) === 35 /* # */) continue;
    const first = line.charCodeAt(0);
    // Data rows start with a digit, a sign or a dot.
    const numeric = (first >= 48 && first <= 57) || first === 45 || first === 43 || first === 46;
    if (!numeric) {
      const [keyword, ...rest] = line.split(SPACE);
      switch (keyword) {
        case 'TITLE':
          title = rest.join(' ').replace(/^"|"$/g, '') || null;
          break;
        case 'LUT_3D_SIZE': {
          const n = Number(rest[0]);
          if (!Number.isInteger(n) || n < LUT_MIN_SIZE || n > LUT_MAX_SIZE)
            throw new LutError(
              `This LUT's size (${rest[0] ?? '?'}) isn't supported — use one from ${LUT_MIN_SIZE} to ${LUT_MAX_SIZE} points (17, 33 or 65 are usual).`,
            );
          if (rows > 0) throw new LutError('LUT_3D_SIZE must come before the colour rows.');
          size = n;
          data = new Uint8Array(n * n * n * 4);
          break;
        }
        case 'LUT_1D_SIZE':
          throw new LutError('This is a 1D LUT. Only 3D LUTs (LUT_3D_SIZE) can be used as a look.');
        case 'DOMAIN_MIN':
        case 'DOMAIN_MAX': {
          const want = keyword === 'DOMAIN_MIN' ? 0 : 1;
          if (rest.slice(0, 3).some((v) => Math.abs(Number(v) - want) > 1e-6))
            throw new LutError(
              "This LUT expects an input range other than 0–1 (DOMAIN_MIN / DOMAIN_MAX), which isn't supported.",
            );
          break;
        }
        case 'LUT_3D_INPUT_RANGE':
          if (Math.abs(Number(rest[0])) > 1e-6 || Math.abs(Number(rest[1]) - 1) > 1e-6)
            throw new LutError(
              "This LUT expects an input range other than 0–1 (LUT_3D_INPUT_RANGE), which isn't supported.",
            );
          break;
        default:
          // Unknown keywords (vendor extensions) are ignored, as other readers do.
          break;
      }
      continue;
    }
    if (!data) throw new LutError('Not a 3D .cube LUT: the LUT_3D_SIZE line is missing.');
    if (rows >= size * size * size)
      throw new LutError(
        `This LUT has more colour rows than its size allows (${size}³ = ${size ** 3}).`,
      );
    const parts = line.split(SPACE);
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (parts.length < 3 || !Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b))
      throw new LutError(`Line ${lineNo} of the LUT isn't three numbers.`);
    const o = rows * 4;
    data[o] = toByte(r);
    data[o + 1] = toByte(g);
    data[o + 2] = toByte(b);
    data[o + 3] = 255;
    rows++;
  }
  if (!data) throw new LutError('Not a 3D .cube LUT: the LUT_3D_SIZE line is missing.');
  if (rows !== size * size * size)
    throw new LutError(
      `This LUT is incomplete: it should have ${size ** 3} colour rows (${size}³) but has ${rows}.`,
    );
  return { size, title, data };
}

function toByte(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

/** What the CPU reference of the shader's LUT lookup gives for `rgb` (0…1): trilinear. Tests. */
export function sampleLut(lut: CubeLut, rgb: readonly [number, number, number]): number[] {
  const n = lut.size;
  const at = (x: number, y: number, z: number, c: number) =>
    lut.data[(x + y * n + z * n * n) * 4 + c]! / 255;
  const p = rgb.map((v) => Math.min(1, Math.max(0, v)) * (n - 1));
  const i = p.map((v) => Math.min(n - 2, Math.floor(v)));
  const f = p.map((v, k) => v - i[k]!);
  const out: number[] = [];
  for (let c = 0; c < 3; c++) {
    let v = 0;
    for (let dz = 0; dz < 2; dz++)
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const w = (dx ? f[0]! : 1 - f[0]!) * (dy ? f[1]! : 1 - f[1]!) * (dz ? f[2]! : 1 - f[2]!);
          v += w * at(i[0]! + dx, i[1]! + dy, i[2]! + dz, c);
        }
    out.push(v);
  }
  return out;
}
