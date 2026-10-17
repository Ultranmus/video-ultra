import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../model/invariants';
import { parseProject } from '../model/migrate';
import { mainTrack, sequentialIds } from '../model/project';
import type { Project } from '../model/schema';
import { fromSeconds as s } from '../model/time';
import {
  audioItem,
  fixtureProject,
  imageItem,
  stickerItem,
  textItem,
  videoItem,
} from '../test/fixtures';
import { createEditor, replayLog, type LogEntry } from './history';
import {
  EditError,
  addToLane,
  deleteItem,
  duplicateItem,
  freezeFrame,
  insertMain,
  moveItem,
  reorderMain,
  setSpeed,
  setTransition,
  splitItem,
  trimItem,
  updateItem,
} from './ops';

function startProject(): Project {
  const project = fixtureProject();
  insertMain(project, videoItem('a', 'vidA', 5));
  insertMain(project, imageItem('b', 3));
  return project;
}

describe('editor history', () => {
  it('undoes and redoes', () => {
    const editor = createEditor(startProject(), { ids: sequentialIds('h') });
    const before = editor.getProject();
    editor.apply('Split', (draft, ctx) => splitItem(draft, 'a', s(2), ctx.ids));
    const after = editor.getProject();
    expect(mainTrack(after).items).toHaveLength(3);
    expect(editor.store.getState().undoLabel).toBe('Split');
    editor.undo();
    expect(editor.getProject()).toEqual(before);
    editor.redo();
    expect(editor.getProject()).toEqual(after);
  });

  it('leaves the project untouched when an edit fails', () => {
    const editor = createEditor(startProject());
    const before = editor.getProject();
    expect(() => editor.apply('Split', (draft, ctx) => splitItem(draft, 'a', 0, ctx.ids))).toThrow(
      EditError,
    );
    expect(editor.getProject()).toBe(before);
    expect(editor.store.getState().canUndo).toBe(false);
  });

  it('merges a slider drag into one undo step', () => {
    let clock = 0;
    const editor = createEditor(startProject(), { now: () => clock });
    for (let v = 0.1; v <= 1; v += 0.1) {
      clock += 100;
      editor.apply('Volume', (draft) => updateItem(draft, 'a', { volume: v }), {
        coalesceKey: 'vol:a',
      });
    }
    editor.undo();
    expect(editor.store.getState().canUndo).toBe(false);
    const a = mainTrack(editor.getProject()).items[0]!;
    expect(a.kind === 'video' && a.volume).toBe(1);
  });

  it('rebuilds the project from the operation log', () => {
    const initial = startProject();
    const editor = createEditor(initial, { ids: sequentialIds('h') });
    const log: LogEntry[] = [];
    editor.onCommit((entry) => log.push(entry));
    editor.apply('Split', (draft, ctx) => splitItem(draft, 'a', s(2), ctx.ids));
    editor.apply('Speed', (draft, ctx) => setSpeed(draft, 'a', 2, ctx.ids));
    editor.undo();
    editor.apply('Text', (draft, ctx) => addToLane(draft, textItem('t', 1), ctx.ids));
    expect(replayLog(initial, 0, log)).toEqual(editor.getProject());
  });
});

describe('opening projects', () => {
  it('round-trips through JSON', () => {
    const project = startProject();
    const result = parseProject(JSON.stringify(project));
    expect(result).toEqual({ ok: true, project, warnings: [] });
  });

  it('refuses garbage and newer versions with a clear message', () => {
    expect(parseProject('{nope')).toMatchObject({
      ok: false,
      error: expect.stringContaining('not valid JSON'),
    });
    expect(parseProject({ ...startProject(), version: 99 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('newer version'),
    });
    expect(parseProject({ hello: 1 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('not a video-ultra project'),
    });
    expect(parseProject({ ...startProject(), tracks: 'x' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('damaged'),
    });
  });

  it('repairs broken timing instead of failing', () => {
    const project = startProject();
    mainTrack(project).items[1]!.start = s(9); // gap
    project.tracks.push({
      id: 'lane',
      kind: 'text',
      muted: false,
      hidden: false,
      locked: false,
      items: [textItem('t1', 0, 3), textItem('t2', 1, 3)], // overlap
    });
    delete project.assets.img; // the photo is gone
    const result = parseProject(project, sequentialIds('r'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkInvariants(result.project)).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/media file is missing/);
    expect(result.warnings.join(' ')).toMatch(/doesn't overlap/);
  });
});

// ── Property test: random edit sequences ──────────────────────────────────

type Op =
  | { op: 'split'; pick: number; at: number }
  | { op: 'trim'; pick: number; edge: 'start' | 'end'; delta: number }
  | { op: 'speed'; pick: number; speed: number }
  | { op: 'delete'; pick: number }
  | { op: 'duplicate'; pick: number }
  | { op: 'reorder'; pick: number; to: number }
  | { op: 'move'; pick: number; start: number }
  | { op: 'freeze'; pick: number; at: number }
  | { op: 'transition'; pick: number; duration: number }
  | { op: 'addMain'; kind: 'video' | 'image'; seconds: number; sourceIn: number }
  | { op: 'addLane'; kind: 'text' | 'audio' | 'sticker'; start: number; seconds: number }
  | { op: 'undo' }
  | { op: 'redo' };

const fraction = fc.double({ min: 0, max: 1, noNaN: true });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant('split' as const), pick: fc.nat(), at: fraction }),
  fc.record({
    op: fc.constant('trim' as const),
    pick: fc.nat(),
    edge: fc.constantFrom('start' as const, 'end' as const),
    delta: fc.double({ min: -8, max: 8, noNaN: true }),
  }),
  fc.record({
    op: fc.constant('speed' as const),
    pick: fc.nat(),
    speed: fc.constantFrom(0.1, 0.25, 0.5, 1, 1.5, 2, 4, 10),
  }),
  fc.record({ op: fc.constant('delete' as const), pick: fc.nat() }),
  fc.record({ op: fc.constant('duplicate' as const), pick: fc.nat() }),
  fc.record({ op: fc.constant('reorder' as const), pick: fc.nat(), to: fc.nat({ max: 8 }) }),
  fc.record({
    op: fc.constant('move' as const),
    pick: fc.nat(),
    start: fc.double({ min: 0, max: 30, noNaN: true }),
  }),
  fc.record({ op: fc.constant('freeze' as const), pick: fc.nat(), at: fraction }),
  fc.record({
    op: fc.constant('transition' as const),
    pick: fc.nat(),
    duration: fc.double({ min: 0, max: 5, noNaN: true }),
  }),
  fc.record({
    op: fc.constant('addMain' as const),
    kind: fc.constantFrom('video' as const, 'image' as const),
    seconds: fc.double({ min: 0.05, max: 12, noNaN: true }),
    sourceIn: fc.double({ min: 0, max: 9, noNaN: true }),
  }),
  fc.record({
    op: fc.constant('addLane' as const),
    kind: fc.constantFrom('text' as const, 'audio' as const, 'sticker' as const),
    start: fc.double({ min: 0, max: 20, noNaN: true }),
    seconds: fc.double({ min: 0.05, max: 8, noNaN: true }),
  }),
  fc.constant({ op: 'undo' as const }),
  fc.constant({ op: 'redo' as const }),
);

function allItems(project: Project) {
  return project.tracks.flatMap((t) => t.items);
}

function run(editor: ReturnType<typeof createEditor>, step: Op, newId: () => string): void {
  const items = allItems(editor.getProject());
  const pickItem = (n: number) => (items.length ? items[n % items.length]! : null);
  try {
    switch (step.op) {
      case 'undo':
        editor.undo();
        return;
      case 'redo':
        editor.redo();
        return;
      case 'addMain': {
        const item =
          step.kind === 'video'
            ? videoItem(newId(), 'vidA', step.seconds, step.sourceIn)
            : imageItem(newId(), step.seconds);
        editor.apply('Add', (d) => insertMain(d, item));
        return;
      }
      case 'addLane': {
        const id = newId();
        const item =
          step.kind === 'text'
            ? textItem(id, step.start, step.seconds)
            : step.kind === 'audio'
              ? audioItem(id, step.start, step.seconds)
              : stickerItem(id, step.start, step.seconds);
        editor.apply('Add', (d, ctx) => addToLane(d, item, ctx.ids));
        return;
      }
    }
    const item = pickItem(step.pick);
    if (!item) return;
    switch (step.op) {
      case 'split':
        editor.apply('Split', (d, ctx) =>
          splitItem(d, item.id, item.start + Math.round(item.duration * step.at), ctx.ids),
        );
        break;
      case 'trim':
        editor.apply('Trim', (d) => trimItem(d, item.id, step.edge, s(step.delta)));
        break;
      case 'speed':
        editor.apply('Speed', (d, ctx) => setSpeed(d, item.id, step.speed, ctx.ids));
        break;
      case 'delete':
        editor.apply('Delete', (d) => deleteItem(d, item.id));
        break;
      case 'duplicate':
        editor.apply('Duplicate', (d, ctx) => duplicateItem(d, item.id, ctx.ids));
        break;
      case 'reorder':
        editor.apply('Reorder', (d) => reorderMain(d, item.id, step.to));
        break;
      case 'move':
        editor.apply('Move', (d, ctx) => moveItem(d, item.id, s(step.start), ctx.ids));
        break;
      case 'freeze':
        editor.apply('Freeze', (d, ctx) =>
          freezeFrame(d, item.id, item.start + Math.round(item.duration * step.at), ctx.ids, s(1)),
        );
        break;
      case 'transition':
        editor.apply('Transition', (d) =>
          setTransition(d, item.id, { type: 'fade', duration: Math.max(1, s(step.duration)) }),
        );
        break;
    }
  } catch (error) {
    // Refused edits are fine (and leave the project unchanged); anything else is a bug.
    if (!(error instanceof EditError)) throw error;
  }
}

/** `FC_RUNS=30000 pnpm test` for a deep run (e.g. before a release). */
function deepRuns(): number {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
    ?.env;
  return Number(env?.FC_RUNS ?? 400);
}

describe('random edit sequences (property test)', () => {
  it('always keep the invariants, undo fully, replay from the log and re-open cleanly', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 60 }), (steps) => {
        const initial = startProject();
        const editor = createEditor(initial, { ids: sequentialIds('x') });
        const log: LogEntry[] = [];
        editor.onCommit((entry) => log.push(entry));
        let n = 0;
        const newId = () => `new${++n}`;

        for (const step of steps) {
          run(editor, step, newId);
          const problems = checkInvariants(editor.getProject());
          if (problems.length)
            throw new Error(`After ${JSON.stringify(step)}: ${problems.join('; ')}`);
        }

        const final = editor.getProject();
        expect(replayLog(initial, 0, log)).toEqual(final);
        const reopened = parseProject(JSON.parse(JSON.stringify(final)));
        expect(reopened).toEqual({ ok: true, project: final, warnings: [] });

        while (editor.undo());
        expect(editor.getProject()).toEqual(initial);
        // Redo restores the latest branch exactly.
        while (editor.redo());
        const redone = editor.getProject();
        expect(checkInvariants(redone)).toEqual([]);
      }),
      { numRuns: deepRuns() },
    );
  }, 300_000);
});
