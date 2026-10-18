import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../edit/history';
import { renameProject, splitItem, updateItem } from '../edit/ops';
import { parseProject } from '../model/migrate';
import { mainTrack, sequentialIds } from '../model/project';
import type { Asset, Project } from '../model/schema';
import { fromSeconds as s } from '../model/time';
import { fixtureProject, videoItem } from '../test/fixtures';
import { opArb, run, startProject } from '../test/random-edits';
import { attachAutosave } from './autosave';
import { MemoryFileStore, StorageFullError, type FileStore } from './files';
import { createProjectStorageOn } from './project-storage';

/** Large timers: tests drive writes with flush() so they're deterministic. */
const MANUAL = { flushMs: 1e9, idleSnapshotMs: 1e9, debounceMs: 1e9 };

/**
 * A file store that "crashes" after `budget` bytes: the write that crosses the budget lands only
 * partly (a torn write), and every write after it fails — like a tab killed mid-write.
 */
class CrashingStore implements FileStore {
  readonly kind = 'memory' as const;
  written = 0;
  crashed = false;
  constructor(
    readonly inner: MemoryFileStore,
    private readonly budget: number,
  ) {}
  private take(text: string): string {
    if (this.crashed) throw new Error('crashed');
    const room = this.budget - this.written;
    if (text.length <= room) {
      this.written += text.length;
      return text;
    }
    this.crashed = true;
    this.written = this.budget;
    return text.slice(0, Math.max(0, room));
  }
  read(path: string) {
    return this.inner.read(path);
  }
  list(dir: string) {
    return this.inner.list(dir);
  }
  async write(path: string, data: string | ArrayBuffer) {
    if (typeof data !== 'string') return this.inner.write(path, data);
    const part = this.take(data);
    await this.inner.write(path, part);
    if (part.length < data.length) throw new Error('crashed');
  }
  async append(path: string, text: string) {
    const part = this.take(text);
    if (part) await this.inner.append(path, part);
    if (part.length < text.length) throw new Error('crashed');
  }
  async copyIn(path: string, blob: Blob) {
    if (this.crashed) throw new Error('crashed');
    return this.inner.copyIn(path, blob);
  }
  async remove(path: string) {
    if (this.crashed) throw new Error('crashed');
    return this.inner.remove(path);
  }
}

function edit(editor: Editor, n: number): void {
  for (let i = 0; i < n; i++) {
    editor.apply(`Volume ${i}`, (d) => updateItem(d, 'a', { volume: (i % 20) / 10 }));
  }
}

const reopened = (project: Project) => {
  const result = parseProject(JSON.parse(JSON.stringify(project)));
  if (!result.ok) throw new Error(result.error);
  return result.project;
};

describe('project storage', () => {
  it('saves edits through the log and loads them back', async () => {
    const files = new MemoryFileStore();
    const storage = createProjectStorageOn(files);
    const editor = createEditor(startProject(), { ids: sequentialIds('e') });
    const autosave = attachAutosave(editor, storage, MANUAL);
    editor.apply('Split', (d, ctx) => splitItem(d, 'a', s(2), ctx.ids));
    editor.apply('Rename', (d) => renameProject(d, 'Holiday'));
    edit(editor, 5);
    await autosave.flush();
    autosave.detach();

    const loaded = await createProjectStorageOn(files).loadProject(editor.getProject().id);
    expect(loaded?.warnings).toEqual([]);
    expect(loaded?.project).toEqual(reopened(editor.getProject()));
    const id = editor.getProject().id;
    expect(await storage.listProjects()).toEqual([
      { id, name: expect.any(String), updatedAt: expect.any(String) },
    ]);
  });

  it('sweeps media no saved project uses, but only when it is old enough', async () => {
    const files = new MemoryFileStore();
    const storage = createProjectStorageOn(files);
    const editor = createEditor(startProject());
    const autosave = attachAutosave(editor, storage, MANUAL);
    edit(editor, 1);
    await autosave.flush();
    const used = Object.keys(editor.getProject().assets)[0]!;
    await storage.putMedia(used, new Blob(['in use']));
    await storage.putMedia('orphan', new Blob(['left by a crash']));
    // Fresh files are never touched (an import may be in progress).
    expect(await storage.sweepMedia()).toBe(0);
    expect(await storage.sweepMedia(0)).toBe(1);
    const left = (await files.list('media')).map((n) => decodeURIComponent(n));
    expect(left).toContain(used);
    expect(left).not.toContain('orphan');
    autosave.detach();
  });

  it('compacts: a snapshot every N entries replaces the older snapshot and log', async () => {
    const files = new MemoryFileStore();
    const storage = createProjectStorageOn(files);
    const editor = createEditor(startProject());
    const autosave = attachAutosave(editor, storage, { ...MANUAL, snapshotEvery: 10 });
    edit(editor, 25);
    await autosave.flush();
    // Snapshots run in idle time; let them finish.
    await new Promise((r) => setTimeout(r, 20));
    await autosave.flush();
    const dir = `projects/${editor.getProject().id}`;
    const names = (await files.list(dir)).sort();
    expect(names.filter((n) => n.startsWith('snapshot-'))).toHaveLength(1);
    // The log after the newest snapshot holds fewer than N entries (none yet, here).
    const logs = names.filter((n) => n.startsWith('log-'));
    expect(logs.length).toBeLessThanOrEqual(1);
    for (const log of logs) {
      const text = await (await files.read(`${dir}/${log}`))!.text();
      expect(text.trim().split('\n').length).toBeLessThan(10);
    }
    const loaded = await storage.loadProject(editor.getProject().id);
    expect(loaded?.project).toEqual(reopened(editor.getProject()));
    autosave.detach();
  });

  it('ignores a torn last log line (crash mid-append)', async () => {
    const files = new MemoryFileStore();
    const storage = createProjectStorageOn(files);
    const editor = createEditor(startProject());
    const autosave = attachAutosave(editor, storage, MANUAL);
    edit(editor, 3);
    await autosave.flush();
    const good = editor.getProject();
    edit(editor, 1);
    await autosave.flush();
    autosave.detach();
    // Cut the last line in half.
    const dir = `projects/${good.id}`;
    const logName = (await files.list(dir)).find((n) => n.startsWith('log-'))!;
    const text = await (await files.read(`${dir}/${logName}`))!.text();
    await files.write(`${dir}/${logName}`, text.slice(0, text.length - 20));

    const loaded = await storage.loadProject(good.id);
    expect(loaded?.warnings).toEqual([]);
    expect(loaded?.project).toEqual(reopened(good));
  });

  it('falls back to the previous snapshot + log when the newest snapshot is torn', async () => {
    const files = new MemoryFileStore();
    const storage = createProjectStorageOn(files);
    const editor = createEditor(startProject());
    const autosave = attachAutosave(editor, storage, MANUAL);
    edit(editor, 4);
    await autosave.flush();
    autosave.detach();
    const dir = `projects/${editor.getProject().id}`;
    // A crash while writing a newer snapshot: it exists but is cut short.
    const names = await files.list(dir);
    const newest = Math.max(
      ...names.filter((n) => n.startsWith('snapshot-')).map((n) => Number(/\d+/.exec(n)![0])),
    );
    await files.write(`${dir}/snapshot-${newest + 100}.json`, '{"format":1,"seq":');
    const loaded = await storage.loadProject(editor.getProject().id);
    expect(loaded?.project).toEqual(reopened(editor.getProject()));
    expect(loaded?.warnings).toEqual(['The latest save was damaged; opened the one before it.']);
  });

  it('warns when a line in the middle of the log is damaged', async () => {
    const files = new MemoryFileStore();
    const storage = createProjectStorageOn(files);
    const editor = createEditor(startProject());
    const autosave = attachAutosave(editor, storage, MANUAL);
    edit(editor, 4);
    await autosave.flush();
    autosave.detach();
    const dir = `projects/${editor.getProject().id}`;
    const logName = (await files.list(dir)).find((n) => n.startsWith('log-'))!;
    const lines = (await (await files.read(`${dir}/${logName}`))!.text()).split('\n');
    lines[1] = 'garbage';
    await files.write(`${dir}/${logName}`, lines.join('\n'));
    const loaded = await storage.loadProject(editor.getProject().id);
    expect(loaded?.warnings).toEqual(["Some of the latest changes couldn't be recovered."]);
    expect(loaded?.seq).toBeGreaterThan(0);
  });

  it('starts saving the new project after editor.load()', async () => {
    const files = new MemoryFileStore();
    const storage = createProjectStorageOn(files);
    const editor = createEditor(startProject());
    const autosave = attachAutosave(editor, storage, MANUAL);
    edit(editor, 2);
    const other = fixtureProject(sequentialIds('o'));
    other.id = 'other';
    editor.load(other);
    await Promise.resolve();
    editor.apply('Rename', (d) => renameProject(d, 'Second'));
    await autosave.flush();
    autosave.detach();
    expect((await storage.listProjects()).map((p) => p.name).sort()).toEqual([
      'Second',
      'Untitled video',
    ]);
    expect((await storage.loadProject('other'))?.project.name).toBe('Second');
  });

  it('calls onSave once, debounced, with the latest project', async () => {
    const saved: Project[] = [];
    const editor = createEditor(startProject());
    const autosave = attachAutosave(editor, createProjectStorageOn(new MemoryFileStore()), {
      ...MANUAL,
      debounceMs: 30,
      onSave: (p) => void saved.push(p),
    });
    edit(editor, 5);
    await new Promise((r) => setTimeout(r, 80));
    expect(saved).toEqual([editor.getProject()]);
    autosave.detach();
  });

  it('reports a full disk and recovers with the next snapshot', async () => {
    const inner = new MemoryFileStore();
    let full = false;
    const files: FileStore = Object.assign(Object.create(inner) as MemoryFileStore, {
      append: (path: string, text: string) => {
        if (full) {
          const error = new Error('quota');
          error.name = 'QuotaExceededError';
          return Promise.reject(error);
        }
        return inner.append(path, text);
      },
    });
    const errors: Error[] = [];
    const storage = createProjectStorageOn(files);
    const editor = createEditor(startProject());
    const autosave = attachAutosave(editor, storage, {
      ...MANUAL,
      onError: (e) => errors.push(e),
    });
    edit(editor, 2);
    await autosave.flush();
    full = true;
    edit(editor, 2);
    await autosave.flush();
    expect(errors[0]).toBeInstanceOf(StorageFullError);
    full = false;
    // The hole in the log is closed by a snapshot (scheduled ~1 s after the failure).
    await new Promise((r) => setTimeout(r, 1100));
    await autosave.flush();
    edit(editor, 1);
    await autosave.flush();
    autosave.detach();
    const loaded = await storage.loadProject(editor.getProject().id);
    expect(loaded?.project).toEqual(reopened(editor.getProject()));
  });

  it('stores media, rejects a short (crashed) copy, and deletes unused media with the project', async () => {
    const files = new MemoryFileStore();
    const storage = createProjectStorageOn(files);
    const bytes = new Blob([new Uint8Array(1000)]);
    const source = await storage.putMedia('vidA', bytes);
    expect(source).toEqual({ type: 'opfs', key: 'vidA' });
    const project = startProject();
    const asset: Asset = { ...project.assets.vidA!, size: 1000, source };
    expect((await storage.getMedia(asset))?.size).toBe(1000);
    expect(await storage.getMedia({ ...asset, size: 2000 })).toBeNull();

    await storage.putWaveform('vidA', {
      peaksPerSecond: 100,
      duration: 0.03,
      peaks: new Float32Array([0.1, 0.5, 1]),
    });
    const wave = await storage.getWaveform('vidA');
    expect([...wave!.peaks]).toEqual([...new Float32Array([0.1, 0.5, 1])]);

    const editor = createEditor(project);
    const autosave = attachAutosave(editor, storage, MANUAL);
    await autosave.flush();
    autosave.detach();
    await storage.deleteProject(project.id);
    expect(await storage.listProjects()).toEqual([]);
    expect(await files.read('media/vidA')).toBeNull();
    expect(await storage.getWaveform('vidA')).toBeNull();
  });

  it('handles a 500-item project', async () => {
    const project = startProject();
    const main = mainTrack(project);
    main.items = [];
    let start = 0;
    for (let i = 0; i < 500; i++) {
      const item = videoItem(`v${i}`, 'vidA', 1, 0);
      item.start = start;
      start += item.duration;
      main.items.push(item);
    }
    const files = new MemoryFileStore();
    const storage = createProjectStorageOn(files);
    const editor = createEditor(project);
    const t0 = performance.now();
    const text = JSON.stringify(editor.getProject());
    const stringifyMs = performance.now() - t0;
    const autosave = attachAutosave(editor, storage, MANUAL);
    editor.apply('Volume', (d) => updateItem(d, 'v250', { volume: 0.5 }));
    await autosave.flush();
    autosave.detach();
    const t1 = performance.now();
    const loaded = await storage.loadProject(project.id);
    const loadMs = performance.now() - t1;
    expect(loaded?.project).toEqual(reopened(editor.getProject()));
    // Recorded in the pending PERF notes; generous bounds so CI machines pass.
    expect(stringifyMs).toBeLessThan(50);
    expect(loadMs).toBeLessThan(500);
    console.log(
      `500-item project: ${(text.length / 1024).toFixed(0)} KB JSON, stringify ${stringifyMs.toFixed(1)} ms, load ${loadMs.toFixed(1)} ms`,
    );
  });
});

/** `FC_RUNS=2000 pnpm test` for a deep run. */
function runs(): number {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
    ?.env;
  return Number(env?.FC_RUNS ?? 150);
}

describe('crash recovery (property test)', () => {
  it('random edits + a crash at any byte → recovery gives exactly a saved state, never less than what was flushed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(opArb, fc.boolean()), { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 2, max: 12 }),
        fc.option(fc.integer({ min: 0, max: 60_000 }), { nil: null }),
        async (steps, snapshotEvery, crashAt) => {
          const inner = new MemoryFileStore();
          const files = new CrashingStore(inner, crashAt ?? Infinity);
          const storage = createProjectStorageOn(files);
          const editor = createEditor(startProject(), { ids: sequentialIds('x') });
          const states: Project[] = [editor.getProject()];
          editor.onCommit((_, p) => states.push(p));
          const autosave = attachAutosave(editor, storage, { ...MANUAL, snapshotEvery });
          let n = 0;
          const newId = () => `new${++n}`;
          /** Index into `states` known to be on disk (a flush finished before any crash). */
          let durable = 0;
          await autosave.flush();
          for (const [step, flush] of steps) {
            run(editor, step, newId);
            if (flush) {
              await autosave.flush();
              if (!files.crashed) durable = states.length - 1;
            }
          }
          await autosave.flush();
          await new Promise((r) => setTimeout(r, 0)); // idle snapshots
          await autosave.flush();
          if (!files.crashed) durable = states.length - 1;
          autosave.detach();

          // "Reload": a new storage over whatever reached the disk.
          const loaded = await createProjectStorageOn(inner).loadProject(states[0]!.id);
          if (!loaded) {
            // Only possible if the crash hit before the first snapshot was complete.
            expect(durable).toBe(0);
            expect(files.crashed).toBe(true);
            return;
          }
          const index = states.findLastIndex(
            (p) => JSON.stringify(reopened(p)) === JSON.stringify(loaded.project),
          );
          expect(index).toBeGreaterThanOrEqual(durable);
          if (crashAt === null) expect(index).toBe(states.length - 1);
          // A crash during a snapshot write may make recovery use the one before it.
          const allowed =
            crashAt === null ? [] : ['The latest save was damaged; opened the one before it.'];
          for (const w of loaded.warnings) expect(allowed).toContain(w);
        },
      ),
      { numRuns: runs() },
    );
  }, 300_000);
});
