import { describe, expect, it } from 'vitest';
import { hevcCodec, readHeif } from './heif';

// A tiny HEIF file built box by box (the parts readHeif reads).
const u8 = (...v: number[]) => v;
const u16 = (v: number) => [v >> 8, v & 255];
const u32 = (v: number) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const str = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, ...content: number[][]) => {
  const body = content.flat();
  return [...u32(body.length + 8), ...str(type), ...body];
};
const full = (type: string, version: number, flags: number, ...content: number[][]) =>
  box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...content);

// Main profile, level 93 (3.1), progressive-source constraint flag.
const HVCC = u8(
  1,
  0x01,
  0x60,
  0,
  0,
  0,
  0x90,
  0,
  0,
  0,
  0,
  0,
  0x5d,
  0xf0,
  0,
  0xfc,
  0xfd,
  0xf8,
  0xf8,
  0,
  0,
  0x0f,
  0,
);

function heif(opts: { grid: boolean; irot?: number }): Uint8Array {
  const tiles = opts.grid ? [2, 3, 4, 5] : [1];
  const data = tiles.map((id) => [0xaa, id, 0xbb]); // stand-in coded pictures
  const gridData = u8(0, 0, 1, 1, ...u16(100), ...u16(60)); // 2 × 2, 100 × 60
  const items = [
    ...(opts.grid ? [{ id: 1, type: 'grid' }] : []),
    ...tiles.map((id) => ({ id, type: 'hvc1' })),
  ];
  const iinf = full(
    'iinf',
    0,
    0,
    u16(items.length),
    ...items.map((i) => full('infe', 2, 0, u16(i.id), u16(0), str(i.type), [0])),
  );
  // Properties: 1 hvcC, 2 ispe 64 × 32, 3 irot.
  const ipco = box(
    'ipco',
    box('hvcC', HVCC),
    full('ispe', 0, 0, u32(64), u32(32)),
    box('irot', [opts.irot ?? 0]),
  );
  const ipmaEntries = [
    ...tiles.map((id) => [...u16(id), 2, 0x81, 0x02]),
    [...u16(1), 1, 0x03], // primary: irot
  ];
  const ipma = full('ipma', 0, 0, u32(ipmaEntries.length), ...ipmaEntries);
  const iref = opts.grid ? full('iref', 0, 0, box('dimg', u16(1), u16(4), ...tiles.map(u16))) : [];
  const ftyp = box('ftyp', str('heic'), u32(0), str('mif1'), str('heic'));
  // iloc v1 (offset 4, length 4, base 0, index 0); file offsets patched after layout.
  const ilocFor = (offsets: number[]) =>
    full(
      'iloc',
      1,
      0,
      u16(0x4400),
      u16(items.length),
      ...items.map((i) =>
        i.type === 'grid'
          ? [...u16(i.id), ...u16(1), ...u16(0), ...u16(1), ...u32(0), ...u32(gridData.length)]
          : [
              ...u16(i.id),
              ...u16(0),
              ...u16(0),
              ...u16(1),
              ...u32(offsets[tiles.indexOf(i.id)]!),
              ...u32(3),
            ],
      ),
    );
  const metaOf = (offsets: number[]) =>
    full(
      'meta',
      0,
      0,
      full('hdlr', 0, 0, u32(0), str('pict'), u32(0), u32(0), u32(0), [0]),
      full('pitm', 0, 0, u16(1)),
      iinf,
      ilocFor(offsets),
      iref,
      box('iprp', ipco, ipma),
      opts.grid ? box('idat', gridData) : [],
    );
  const mdatStart = ftyp.length + metaOf(tiles.map(() => 0)).length + 8;
  const offsets = tiles.map((_, i) => mdatStart + i * 3);
  return new Uint8Array([...ftyp, ...metaOf(offsets), ...box('mdat', ...data)]);
}

describe('HEIF', () => {
  it('builds the hvc1 codec string from the decoder setup', () => {
    expect(hevcCodec(new Uint8Array(HVCC))).toBe('hvc1.1.6.L93.90');
  });

  it('reads a single-picture HEIF: its data, setup, size and turn', () => {
    const pic = readHeif(heif({ grid: false, irot: 1 }));
    expect(pic.rows * pic.columns).toBe(1);
    expect([...pic.tiles[0]!]).toEqual([0xaa, 1, 0xbb]);
    expect([...pic.description]).toEqual(HVCC);
    expect([pic.width, pic.height]).toEqual([64, 32]);
    expect(pic.rotation).toBe(1);
  });

  it('reads a grid: its tiles in order and the output size', () => {
    const pic = readHeif(heif({ grid: true }));
    expect([pic.rows, pic.columns]).toEqual([2, 2]);
    expect(pic.tiles.map((t) => t[1])).toEqual([2, 3, 4, 5]);
    expect([pic.width, pic.height, pic.tileWidth, pic.tileHeight]).toEqual([100, 60, 64, 32]);
  });

  it('refuses a file that is not HEIF', () => {
    expect(() => readHeif(new Uint8Array([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]))).toThrow();
  });
});
