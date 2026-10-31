import { describe, expect, it } from 'vitest';
import { sniffImage, unsupportedVideoMessage } from './probe';

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])),
  );

describe('sniffImage', () => {
  it('recognises common photo formats from their first bytes', () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImage(bytes(0x89, 'PNG', 0x0d, 0x0a))).toBe('image/png');
    expect(sniffImage(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(bytes('GIF89a'))).toBe('image/gif');
    expect(sniffImage(bytes(0, 0, 0, 0x18, 'ftypheic', 0, 0, 0, 0))).toBe('image/heic');
    expect(sniffImage(bytes(0, 0, 0, 0x18, 'ftypavif'))).toBe('image/avif');
    // Generic image-file brand: the compatible brands tell what's inside.
    expect(sniffImage(bytes(0, 0, 0, 0x18, 'ftypmif1', 0, 0, 0, 0, 'mif1avif'))).toBe('image/avif');
    expect(sniffImage(bytes(0, 0, 0, 0x18, 'ftypmif1', 0, 0, 0, 0, 'mif1heic'))).toBe('image/heic');
    expect(sniffImage(bytes(0, 0, 0, 0x14, 'ftypmif1', 0, 0, 0, 0, 'mif1'))).toBe('image/heif');
  });

  it('does not mistake videos for images', () => {
    expect(sniffImage(bytes(0, 0, 0, 0x18, 'ftypisom'))).toBeNull(); // MP4
    expect(sniffImage(bytes(0, 0, 0, 0x14, 'ftypqt  '))).toBeNull(); // MOV
    expect(sniffImage(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBeNull(); // WebM
  });
});

describe('unsupportedVideoMessage', () => {
  it('explains HEVC in plain words and suggests a fix', () => {
    const message = unsupportedVideoMessage('hevc');
    expect(message).toMatch(/iPhone/);
    expect(message).toMatch(/Chrome|Safari/);
  });
});
