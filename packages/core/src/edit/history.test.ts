import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../model/invariants';
import { parseProject } from '../model/migrate';
import { mainTrack, sequentialIds } from '../model/project';
import { fromSeconds as s } from '../model/time';
import { opArb, run, startProject } from '../test/random-edits';
import { createEditor, replayLog, type LogEntry } from './history';
import { EditError, addToLane, setSpeed, splitItem, updateItem } from './ops';
import { textItem } from '../test/fixtures';

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

  it('lists the steps and jumps to any of them (the History panel)', () => {
    const editor = createEditor(startProject(), { ids: sequentialIds('h') });
    const original = editor.getProject();
    editor.apply('Split', (d, ctx) => splitItem(d, 'a', s(2), ctx.ids));
    const split = editor.getProject();
    editor.apply('Add text', (d, ctx) => addToLane(d, textItem('t', 0, 2), ctx.ids));
    editor.apply('Speed', (d, ctx) => setSpeed(d, 'a', 2, ctx.ids));
    const latest = editor.getProject();
    expect(editor.history()).toEqual({ labels: ['Split', 'Add text', 'Speed'], position: 3 });
    expect(editor.goTo(1)).toBe(true);
    expect(editor.getProject()).toEqual(split);
    expect(editor.history()).toEqual({ labels: ['Split', 'Add text', 'Speed'], position: 1 });
    expect(editor.goTo(0)).toBe(true);
    expect(editor.getProject()).toEqual(original);
    expect(editor.goTo(3)).toBe(true);
    expect(editor.getProject()).toEqual(latest);
    expect(editor.goTo(4)).toBe(false);
    expect(editor.goTo(-1)).toBe(false);
    // A new edit after jumping back drops the steps after it.
    editor.goTo(1);
    editor.apply('Speed', (d, ctx) => setSpeed(d, 'a', 0.5, ctx.ids));
    expect(editor.history()).toEqual({ labels: ['Split', 'Speed'], position: 2 });
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
      error: expect.stringContaining('not a VideoUltra project'),
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
