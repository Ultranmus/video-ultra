import { describe, expect, it } from 'vitest';
import { LutError, parseCubeLut, sampleLut } from './lut';
import { chromaOf, EFFECT_FLOATS, keyParams, noFx, noPictureFx, writeEffects } from './colour';
import { identityColour } from './colour';

/** A `size`-point .cube file of `f(r, g, b)`, red fastest. */
function cube(size: number, f: (r: number, g: number, b: number) => number[], header = ''): string {
  const rows: string[] = [];
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const v = f(r / (size - 1), g / (size - 1), b / (size - 1));
        rows.push(v.map((x) => x.toFixed(6)).join(' '));
      }
  return `# made for a test\nTITLE "Test look"\n${header}LUT_3D_SIZE ${size}\n\n${rows.join('\n')}\n`;
}

describe('.cube LUTs', () => {
  it('reads 17, 33 and 65-point files (title, size, red-fastest order)', () => {
    for (const size of [17, 33, 65]) {
      const lut = parseCubeLut(cube(size, (r, g, b) => [r, g, b]));
      expect(lut.size).toBe(size);
      expect(lut.title).toBe('Test look');
      expect(lut.data.length).toBe(size ** 3 * 4);
      // Second row = red 1 step up, green/blue 0.
      expect(lut.data[4]).toBe(Math.round(255 / (size - 1)));
      expect(lut.data[5]).toBe(0);
    }
  });

  it('identity samples back to the input; an inverting LUT inverts', () => {
    const id = parseCubeLut(cube(17, (r, g, b) => [r, g, b]));
    const inv = parseCubeLut(cube(17, (r, g, b) => [1 - r, 1 - g, 1 - b]));
    for (const c of [
      [0.2, 0.5, 0.9],
      [0, 1, 0.33],
    ] as [number, number, number][]) {
      sampleLut(id, c).forEach((v, k) => expect(v).toBeCloseTo(c[k]!, 2));
      sampleLut(inv, c).forEach((v, k) => expect(v).toBeCloseTo(1 - c[k]!, 2));
    }
  });

  it('accepts CRLF, comments, default domains; clamps values outside 0…1', () => {
    const text = cube(2, () => [1.5, -0.2, 0.5], 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n').replace(
      /\n/g,
      '\r\n',
    );
    const lut = parseCubeLut(text);
    expect([...lut.data.subarray(0, 4)]).toEqual([255, 0, 128, 255]);
  });

  it('explains what is wrong with a bad file', () => {
    const bad = (text: string) => {
      try {
        parseCubeLut(text);
        return 'parsed';
      } catch (error) {
        expect(error).toBeInstanceOf(LutError);
        return (error as Error).message;
      }
    };
    expect(bad('hello')).toMatch(/LUT_3D_SIZE/);
    expect(bad('LUT_1D_SIZE 1024\n0 0 0')).toMatch(/1D LUT/);
    expect(bad('LUT_3D_SIZE 200\n')).toMatch(/size/);
    expect(
      bad(
        cube(17, (r, g, b) => [r, g, b])
          .split('\n')
          .slice(0, 100)
          .join('\n'),
      ),
    ).toMatch(/incomplete/);
    expect(
      bad(cube(2, (r, g, b) => [r, g, b]).replace('1.000000 0.000000 0.000000', '1 x 0')),
    ).toMatch(/Line \d+/);
    expect(bad(cube(2, (r, g, b) => [r, g, b], 'DOMAIN_MAX 4 4 4\n'))).toMatch(/input range/);
  });
});

describe('picture tool uniforms', () => {
  it('green screen: the key colour has zero distance to itself; grey has no chroma', () => {
    expect(chromaOf(0.5, 0.5, 0.5).map((v) => Math.abs(v) < 1e-3)).toEqual([true, true]);
    const pic = keyParams([0, 0.69, 0.25], 0.5, 0.5, 0.5, noPictureFx());
    expect(pic.key).toBe(true);
    expect(pic.keyTolerance).toBeCloseTo(0.22);
    expect(pic.keySoftness).toBeCloseTo(0.105);
    const [cb, cr] = chromaOf(0, 0.69, 0.25);
    expect([pic.keyCb, pic.keyCr]).toEqual([cb, cr]);
  });

  it('packs the picture tools after the transition extras', () => {
    const out = new Float32Array(EFFECT_FLOATS).fill(9);
    const pic = noPictureFx();
    pic.lutAmount = 0.5;
    pic.lutSize = 33;
    pic.region = 2;
    pic.blend = 4;
    writeEffects(out, 0, identityColour(), noFx(), pic);
    expect([out[82], out[83], out[84], out[92]]).toEqual([0.5, 33, 2, 4]);
    // The renderer's slots start cleared.
    expect([...out.subarray(88, 92)]).toEqual([0, 0, 0, 0]);
    expect([...out.subarray(93, 96)]).toEqual([0, 0, 0]);
  });
});
