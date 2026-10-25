import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { EditError, insertMain, addToLane } from '../edit/ops';
import { checkInvariants } from '../model/invariants';
import { findItem, sequentialIds } from '../model/project';
import { ProjectSchema } from '../model/schema';
import { FLICKS_PER_SECOND } from '../model/time';
import { fixtureProject, textItem, videoItem } from '../test/fixtures';
import {
  applyEditActions,
  describeProject,
  EDIT_ACTIONS_GUIDE,
  EditActionSchema,
} from './assistant';

const s = (x: number) => Math.round(x * FLICKS_PER_SECOND);

function setup() {
  const ids = sequentialIds('n');
  const project = fixtureProject();
  insertMain(project, videoItem('a', 'vidA', 5));
  insertMain(project, videoItem('b', 'vidA', 4, 5));
  addToLane(project, textItem('t', 1, 2), ids);
  return { project, ids };
}

describe('AI edit actions', () => {
  it('describes the project compactly, with ids, seconds and the catalogues', () => {
    const { project } = setup();
    const d = describeProject(project);
    expect(d.duration).toBe(9);
    const main = d.tracks.find((t) => t.kind === 'main video')!;
    expect(main.items.map((i) => [i.id, i.start, i.duration])).toEqual([
      ['a', 0, 5],
      ['b', 5, 4],
    ]);
    expect(d.tracks.some((t) => t.items.some((i) => i.text === textItem('t', 1).text))).toBe(true);
    expect(d.catalog.filters.length).toBeGreaterThan(100);
    expect(d.catalog.transitions).toContain('fade');
    // Small enough for any model's context.
    expect(JSON.stringify(d).length).toBeLessThan(8000);
    expect(EDIT_ACTIONS_GUIDE).toContain('"action":"split"');
  });

  it('applies a realistic plan as one edit', () => {
    const { project, ids } = setup();
    const n = applyEditActions(
      project,
      [
        { action: 'split', itemId: 'a', at: 2.5 },
        { action: 'filter', itemId: 'b', filter: 'warm', intensity: 0.6 },
        { action: 'transition', itemId: 'b', transition: 'fade' },
        { action: 'speed', itemId: 'b', speed: 2 },
        { action: 'sound', itemId: 'a', volume: 0.5, fadeIn: 0.5, preset: 'voice' },
        { action: 'adjust', itemId: 'a', brightness: 0.2, warmth: -0.1 },
        {
          action: 'addText',
          text: 'Day one',
          start: 0,
          duration: 2,
          position: 'top',
          color: '#FFCC00',
          size: 'large',
        },
        { action: 'editText', itemId: 't', text: 'Hello', size: 'small' },
        { action: 'animate', itemId: 't', in: 'fade-in', out: null },
        { action: 'move', itemId: 't', start: 4 },
        { action: 'trim', itemId: 'b', to: 1.5 },
        { action: 'canvas', ratio: '1:1' },
        { action: 'marker', time: 3, label: 'beat' },
      ],
      ids,
    );
    expect(n).toBe(13);
    expect(project.tracks[0]!.items).toHaveLength(3);
    const b = findItem(project, 'b')!.item;
    expect(b.kind === 'video' && [b.speed, b.filter?.id, b.transitionIn?.type]).toEqual([
      2,
      'warm',
      'fade',
    ]);
    expect(b.duration).toBe(s(1.5));
    const a = findItem(project, 'a')!.item;
    expect(a.kind === 'video' && [a.volume, a.audioFx?.compress, a.adjust.brightness]).toEqual([
      0.5, 0.5, 0.2,
    ]);
    const t = findItem(project, 't')!.item;
    expect(t.kind === 'text' && [t.text, t.start, t.animation?.in?.type]).toEqual([
      'Hello',
      s(4),
      'fade-in',
    ]);
    const added = project.tracks
      .flatMap((x) => x.items)
      .find((i) => i.kind === 'text' && i.text === 'Day one');
    expect(added && added.kind === 'text' && [added.style.color, added.transform.y]).toEqual([
      '#ffcc00',
      0.15,
    ]);
    expect(project.settings.width).toBe(project.settings.height);
    expect(project.markers?.[0]?.label).toBe('beat');
    expect(checkInvariants(project)).toEqual([]);
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });

  it('rejects made-up ids, unknown presets, bad values and unknown actions, saying which', () => {
    const bad: [unknown, RegExp][] = [
      [{ action: 'split', itemId: 'zzz', at: 1 }, /Action 1 \(split\)/],
      [{ action: 'filter', itemId: 'a', filter: 'sparkly' }, /No filter sparkly/],
      [{ action: 'speed', itemId: 'a', speed: 50 }, /isn't valid/],
      [{ action: 'explode', itemId: 'a' }, /isn't valid/],
      [{ action: 'addText', text: 'x', start: 1, color: 'red' }, /#rrggbb/],
      [{ action: 'animate', itemId: 't', in: 'fade-out' }, /No entrance/],
      [{ action: 'sound', itemId: 't', volume: 1 }, /Only video and sound/],
      ['split everything', /isn't valid/],
    ];
    for (const [action, message] of bad) {
      const { project, ids } = setup();
      expect(() => applyEditActions(project, [action], ids)).toThrow(EditError);
      expect(() => applyEditActions(project, [action], ids)).toThrow(message);
    }
    const { project, ids } = setup();
    expect(() => applyEditActions(project, 'nope' as never, ids)).toThrow(/list/);
    expect(() => applyEditActions(project, new Array(201).fill({}), ids)).toThrow(/200/);
  });

  it('lists the media library and the name, so files can be named and listed', () => {
    const { project } = setup();
    const d = describeProject(project);
    expect(d.name).toBe(project.name);
    // The LUT isn't media; the photo has no length.
    expect(d.media).toEqual([
      { id: 'vidA', name: 'vidA.bin', kind: 'video', duration: 10, onTimeline: true },
      { id: 'vidB', name: 'vidB.bin', kind: 'video', duration: 4, onTimeline: false },
      { id: 'img', name: 'img.bin', kind: 'photo', onTimeline: false },
      { id: 'music', name: 'music.bin', kind: 'sound', duration: 30, onTimeline: false },
    ]);
  });

  it('renames the video and puts media-library files on the timeline', () => {
    const { project, ids } = setup();
    applyEditActions(
      project,
      [
        { action: 'rename', name: '  Holiday  ' },
        { action: 'addMedia', mediaId: 'vidB' },
        { action: 'addMedia', mediaId: 'img', start: 5 },
        { action: 'addMedia', mediaId: 'music', start: 1 },
        { action: 'addMedia', mediaId: 'vidB', start: 2, asLayer: true },
      ],
      ids,
    );
    expect(project.name).toBe('Holiday');
    const main = project.tracks[0]!.items;
    // The photo went before the clip at 5 s, the video at the end.
    expect(main.map((i) => (i.kind === 'video' || i.kind === 'image' ? i.assetId : ''))).toEqual([
      'vidA',
      'img',
      'vidA',
      'vidB',
    ]);
    const lanes = project.tracks.slice(1).flatMap((t) => t.items);
    const music = lanes.find((i) => i.kind === 'audio');
    expect(music && [music.start, music.duration]).toEqual([s(1), s(30)]);
    const layer = lanes.find((i) => i.kind === 'video');
    expect(layer && [layer.assetId, layer.start]).toEqual(['vidB', s(2)]);
    expect(describeProject(project).media.every((m) => m.onTimeline)).toBe(true);
    expect(checkInvariants(project)).toEqual([]);
    expect(ProjectSchema.safeParse(project).success).toBe(true);

    expect(() => applyEditActions(project, [{ action: 'addMedia', mediaId: 'look' }], ids)).toThrow(
      /No media look/,
    );
    expect(() => applyEditActions(project, [{ action: 'rename', name: '' }], ids)).toThrow(
      /isn't valid/,
    );
  });

  it('edits what it adds in the same answer, by the name it gave it', () => {
    const { project, ids } = setup();
    applyEditActions(
      project,
      [
        { action: 'addMedia', mediaId: 'img', ref: 'new1' },
        { action: 'filter', itemId: 'new1', filter: 'mono' },
        { action: 'addText', ref: 'title', text: 'Goa', start: 0 },
        { action: 'animate', itemId: 'title', in: 'fade-in' },
        { action: 'delete', itemIds: ['title'] },
      ],
      ids,
    );
    const photo = project.tracks[0]!.items.at(-1)!;
    expect(photo.kind === 'image' && photo.filter?.id).toBe('mono');
    expect(
      project.tracks.some((t) => t.items.some((i) => i.kind === 'text' && i.text === 'Goa')),
    ).toBe(false);
  });

  it('edits a styled text and places it, inside the editor’s draft (as the editor runs it)', () => {
    const { project, ids } = setup();
    const styled = produce(project, (d) => {
      const t = findItem(d, 't')!.item;
      if (t.kind === 'text') t.style.outline = { color: '#000000', width: 0.1 };
    });
    const next = produce(styled, (d) => {
      applyEditActions(
        d,
        [
          { action: 'editText', itemId: 't', color: '#ff3366' },
          { action: 'place', itemId: 't', x: 0.5, y: 0.5, scale: 2, rotation: -45, opacity: 0.4 },
        ],
        ids,
      );
    });
    const t = findItem(next, 't')!.item;
    expect(t.kind === 'text' && [t.style.color, t.style.outline?.width]).toEqual(['#ff3366', 0.1]);
    expect(t.kind === 'text' && t.transform).toMatchObject({
      scale: 2,
      rotation: -45,
      opacity: 0.4,
    });
    expect(
      describeProject(next)
        .tracks.flatMap((x) => x.items)
        .find((i) => i.id === 't'),
    ).toMatchObject({ rotation: -45, opacity: 0.4, color: '#ff3366' });
    expect(() =>
      applyEditActions(next, [{ action: 'place', itemId: 't', opacity: 2 }], ids),
    ).toThrow(/isn't valid/);
  });

  it('the schema accepts what the guide documents', () => {
    expect(EditActionSchema.safeParse({ action: 'delete', itemIds: ['a', 'b'] }).success).toBe(
      true,
    );
    expect(EditActionSchema.safeParse({ action: 'canvas', ratio: '3:2' }).success).toBe(false);
  });
});
