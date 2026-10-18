import { describe, expect, it } from 'vitest';
import { audioExtension } from './audio-library';
import { createStarterSounds } from './starter-sounds';

describe('audio library helpers', () => {
  it('names files by their audio type', () => {
    expect(audioExtension('audio/mpeg')).toBe('mp3');
    expect(audioExtension('audio/wav')).toBe('wav');
    expect(audioExtension('audio/mp4')).toBe('m4a');
    expect(audioExtension('audio/ogg; codecs=opus')).toBe('ogg');
    expect(audioExtension('')).toBe('audio');
  });

  it('starter sounds: categories, search, credits, translatable titles', async () => {
    const lib = createStarterSounds({ labels: { boom: 'Bumm' } });
    const signal = new AbortController().signal;
    const all = await lib.search({ text: '', category: null, cursor: null }, signal);
    expect(all.tracks.length).toBe(11);
    expect(all.tracks.every((t) => t.kind === 'sound' && t.credit?.includes('CC0'))).toBe(true);
    const impacts = await lib.search({ text: '', category: 'impacts', cursor: null }, signal);
    expect(impacts.tracks.map((t) => t.title)).toEqual(['Bumm', 'Soft thud']);
    const found = await lib.search({ text: 'whoo', category: null, cursor: null }, signal);
    expect(found.tracks.map((t) => t.id)).toEqual(['whoosh']);
    expect(lib.categories?.map((c) => c.id)).toEqual(['transitions', 'interface', 'impacts']);
  });
});
