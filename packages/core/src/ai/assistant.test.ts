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

  it('the schema accepts what the guide documents', () => {
    expect(EditActionSchema.safeParse({ action: 'delete', itemIds: ['a', 'b'] }).success).toBe(
      true,
    );
    expect(EditActionSchema.safeParse({ action: 'canvas', ratio: '3:2' }).success).toBe(false);
  });
});
