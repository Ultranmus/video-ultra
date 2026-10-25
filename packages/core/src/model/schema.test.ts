import { describe, expect, it } from 'vitest';
import { parseProject } from './migrate';
import { PROJECT_VERSION } from './schema';
import { checkInvariants } from './invariants';

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
  /** What a version-1 file becomes: version 3, text and stickers gain an empty look. */
  const upgraded = (data: ReturnType<typeof JSON.parse>) => {
    const out = structuredClone(data);
    out.version = 3;
    for (const track of out.tracks)
      for (const item of track.items)
        if (item.kind === 'text' || item.kind === 'sticker') {
          item.filter ??= null;
          item.adjust ??= {};
        }
    return out;
  };

  it('is file version 6 (1 → 2: text and stickers take a look; 2 → 3: lock, hide, group; 3 → 4: shape masks; 4 → 5: combined clips; 5 → 6: unsure captions)', () => {
    expect(PROJECT_VERSION).toBe(6);
  });

  it('a version-4 project opens as version 6, unchanged otherwise', () => {
    const data = upgraded(JSON.parse(V01_PROJECT));
    data.version = 4;
    const result = parseProject(JSON.stringify(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.version).toBe(6);
    expect(result.project.tracks.map((t) => t.items.length)).toEqual(
      data.tracks.map((t: { items: unknown[] }) => t.items.length),
    );
  });

  it('a version-3 project keeps locked, hidden and grouped items; main clips leave groups', () => {
    const data = upgraded(JSON.parse(V01_PROJECT));
    data.tracks[1].items[0].locked = true;
    data.tracks[1].items[0].hidden = true;
    data.tracks[1].items[0].groupId = 'g1';
    data.tracks[2].items[0].groupId = 'g1';
    const result = parseProject(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toEqual({ ...data, version: PROJECT_VERSION });
    data.tracks[0].items[0].groupId = 'g1';
    const repaired = parseProject(data);
    expect(repaired.ok && repaired.project.tracks[0]!.items[0]!.groupId).toBeUndefined();
  });

  it('a version-3 project keeps ducking and asset credits; a zero duck is dropped', () => {
    const data = upgraded(JSON.parse(V01_PROJECT));
    const sounding = data.tracks
      .flatMap((t: { items: { kind: string }[] }) => t.items)
      .find((i: { kind: string }) => i.kind === 'video' || i.kind === 'audio');
    sounding.duck = 0.75;
    const assetId = Object.keys(data.assets)[0]!;
    data.assets[assetId].credit = 'Tone — test, CC0';
    const result = parseProject(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toEqual({ ...data, version: PROJECT_VERSION });
    expect(checkInvariants(result.project)).toEqual([]);
    sounding.duck = 0;
    const repaired = parseProject(data);
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    const item = repaired.project.tracks.flatMap((t) => t.items).find((i) => i.id === sounding.id)!;
    expect('duck' in item).toBe(false);
    sounding.duck = 1.5;
    expect(parseProject(data).ok).toBe(false);
  });

  it('opens a v0.1 (version 1) project, changing nothing but the new look fields', () => {
    const result = parseProject(V01_PROJECT);
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.project).toEqual({
      ...upgraded(JSON.parse(V01_PROJECT)),
      version: PROJECT_VERSION,
    });
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
    expect(result.project).toEqual({ ...upgraded(data), version: PROJECT_VERSION });
  });

  it('a version-2 project keeps a text filter', () => {
    const data = upgraded(JSON.parse(V01_PROJECT));
    const text = data.tracks
      .flatMap((t: { items: { kind: string }[] }) => t.items)
      .find((i: { kind: string }) => i.kind === 'text');
    text.filter = { id: 'warm', intensity: 0.5 };
    data.version = 2;
    const result = parseProject(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toEqual({ ...data, version: PROJECT_VERSION });
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

  it('a version-3 project keeps green screen, LUT, blend modes and blurred areas (v0.2 C)', () => {
    const data = upgraded(JSON.parse(V01_PROJECT));
    data.assets.look = {
      id: 'look',
      kind: 'lut',
      name: 'Teal.cube',
      mimeType: 'text/plain',
      size: 400000,
      duration: 0,
      hasAudio: false,
      source: { type: 'opfs', key: 'look' },
    };
    const main = data.tracks[0].items;
    main[0].key = { color: '#00b140', tolerance: 0.4, softness: 0.3, spill: 0.5 };
    main[1].lut = { assetId: 'look', intensity: 0.8 };
    data.tracks[1].items[0].blend = 'screen';
    data.tracks[2].items[0].blend = 'soft-light';
    data.tracks[2].items.push({
      id: 'r',
      kind: 'region',
      start: 2116800000,
      duration: 2116800000,
      effect: 'pixelate',
      shape: 'ellipse',
      amount: 0.5,
      width: 0.3,
      height: 0.2,
      transform: transform(),
    });
    const result = parseProject(data);
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.project).toEqual({ ...data, version: PROJECT_VERSION });
  });

  it('drops a LUT look whose file is missing; rejects bad picture-tool values', () => {
    const data = upgraded(JSON.parse(V01_PROJECT));
    data.tracks[0].items[0].lut = { assetId: 'gone', intensity: 1 };
    const repaired = parseProject(data);
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect('lut' in repaired.project.tracks[0]!.items[0]!).toBe(false);
    expect(repaired.warnings.join(' ')).toMatch(/LUT/);
    const bad = (edit: (d: ReturnType<typeof JSON.parse>) => void) => {
      const d = upgraded(JSON.parse(V01_PROJECT));
      edit(d);
      return parseProject(d).ok;
    };
    expect(bad((d) => (d.tracks[2].items[0].blend = 'burn'))).toBe(false);
    expect(
      bad(
        (d) => (d.tracks[0].items[0].key = { color: '#0f0', tolerance: 2, softness: 0, spill: 0 }),
      ),
    ).toBe(false);
    // A lut-kind asset can't be a clip's media.
    expect(
      bad((d) => {
        d.assets.v.kind = 'lut';
      }),
    ).toBe(false);
  });
});

describe('export range (file version 3, optional)', () => {
  it('keeps saved in / out points and opens files without them', () => {
    const data = JSON.parse(V01_PROJECT);
    data.settings.exportRange = { start: 352800000, end: 2116800000 };
    const result = parseProject(JSON.stringify(data));
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (!result.ok) return;
    expect(result.project.settings.exportRange).toEqual({ start: 352800000, end: 2116800000 });
    const plain = parseProject(V01_PROJECT);
    expect(plain.ok && plain.project.settings.exportRange).toBeUndefined();
  });

  it('rejects a range with an empty end', () => {
    const data = JSON.parse(V01_PROJECT);
    data.settings.exportRange = { start: 10, end: 0 };
    expect(parseProject(JSON.stringify(data)).ok).toBe(false);
  });
});
