import { describe, expect, it } from 'vitest';
import { parseProject } from './migrate';
import { PROJECT_VERSION } from './schema';

/**
 * A project saved by v0.1 (before transition options and animations): a main track with a filter
 * and the old transition ids, a title and an emoji sticker. It must open unchanged.
 */
const V01_PROJECT = JSON.stringify({
  version: 1,
  id: 'p1',
  name: 'Saved by v0.1',
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
  settings: {
    width: 1080,
    height: 1920,
    frameRate: { num: 30, den: 1 },
    background: { type: 'blur', amount: 0.5 },
  },
  assets: {
    v: {
      id: 'v',
      kind: 'video',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      size: 1000,
      duration: 7056000000,
      width: 1920,
      height: 1080,
      hasAudio: true,
      source: { type: 'opfs', key: 'v' },
    },
  },
  tracks: [
    {
      id: 'main',
      kind: 'main',
      muted: false,
      hidden: false,
      locked: false,
      items: [
        clip('a', 0, null, { id: 'vivid', intensity: 0.8 }),
        clip('b', 2116800000, { type: 'slide-left', duration: 352800000 }, null),
        clip('c', 4233600000, { type: 'wipe', duration: 352800000 }, { id: 'sepia', intensity: 1 }),
      ],
    },
    {
      id: 'lane1',
      kind: 'text',
      muted: false,
      hidden: false,
      locked: false,
      items: [
        {
          id: 't',
          kind: 'text',
          text: 'Hello',
          start: 0,
          duration: 2116800000,
          style: {
            fontFamily: 'system-ui',
            fontWeight: 700,
            italic: false,
            size: 0.06,
            color: '#fff',
            align: 'center',
            lineHeight: 1.2,
            letterSpacing: 0,
            outline: null,
            shadow: null,
            background: null,
          },
          transform: transform(),
        },
      ],
    },
    {
      id: 'lane2',
      kind: 'overlay',
      muted: false,
      hidden: false,
      locked: false,
      items: [
        {
          id: 's',
          kind: 'sticker',
          assetId: null,
          emoji: '🎉',
          start: 0,
          duration: 2116800000,
          transform: transform(),
        },
      ],
    },
  ],
});

function transform() {
  return { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false };
}

function clip(id: string, start: number, transitionIn: unknown, filter: unknown) {
  return {
    id,
    kind: 'video',
    assetId: 'v',
    start,
    duration: 2116800000,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: transform(),
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    fit: 'fit',
    filter,
    adjust: {},
    transitionIn,
  };
}

describe('project file back-compat', () => {
  /** What a version-1 file becomes: version 2, text and stickers gain an empty look. */
  const upgraded = (data: ReturnType<typeof JSON.parse>) => {
    const out = structuredClone(data);
    out.version = 2;
    for (const track of out.tracks)
      for (const item of track.items)
        if (item.kind === 'text' || item.kind === 'sticker') {
          item.filter ??= null;
          item.adjust ??= {};
        }
    return out;
  };

  it('is file version 2 (1 → 2: text and stickers take a look)', () => {
    expect(PROJECT_VERSION).toBe(2);
  });

  it('opens a v0.1 (version 1) project, changing nothing but the new look fields', () => {
    const result = parseProject(V01_PROJECT);
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.project).toEqual(upgraded(JSON.parse(V01_PROJECT)));
    const b = result.project.tracks[0]!.items[1]!;
    expect('transitionIn' in b && b.transitionIn).toEqual({
      type: 'slide-left',
      duration: 352800000,
    });
  });

  it('keeps transition options and animations', () => {
    const data = JSON.parse(V01_PROJECT);
    data.tracks[0].items[2].transitionIn = {
      type: 'cube',
      duration: 352800000,
      direction: 'up',
      ease: 'bounce',
    };
    data.tracks[1].items[0].animation = {
      in: { type: 'typewriter-in', duration: 705600000 },
      out: { type: 'fade-out', duration: 352800000 },
      loop: { type: 'pulse', speed: 2 },
    };
    data.tracks[2].items[0].animation = { loop: { type: 'spin' } };
    const result = parseProject(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toEqual(upgraded(data));
  });

  it('a version-2 project keeps a text filter', () => {
    const data = upgraded(JSON.parse(V01_PROJECT));
    const text = data.tracks
      .flatMap((t: { items: { kind: string }[] }) => t.items)
      .find((i: { kind: string }) => i.kind === 'text');
    text.filter = { id: 'warm', intensity: 0.5 };
    const result = parseProject(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toEqual(data);
  });

  it('rejects bad transition options and animations', () => {
    const bad = (edit: (d: ReturnType<typeof JSON.parse>) => void) => {
      const data = JSON.parse(V01_PROJECT);
      edit(data);
      return parseProject(data).ok;
    };
    expect(bad((d) => (d.tracks[0].items[2].transitionIn.direction = 'sideways'))).toBe(false);
    expect(bad((d) => (d.tracks[0].items[2].transitionIn.ease = 'wobbly'))).toBe(false);
    expect(
      bad((d) => (d.tracks[1].items[0].animation = { loop: { type: 'pulse', speed: 9 } })),
    ).toBe(false);
    expect(
      bad((d) => (d.tracks[1].items[0].animation = { in: { type: 'fade-in', duration: -1 } })),
    ).toBe(false);
    expect(bad((d) => (d.tracks[1].items[0].animation = { in: { type: '', duration: 1 } }))).toBe(
      false,
    );
  });
});
