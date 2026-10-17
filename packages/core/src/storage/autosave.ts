import type { Editor } from '../edit/history';
import type { Project } from '../model/schema';
import type { ProjectStorage, ProjectWriter, StoredLogEntry } from './project-storage';

/** Options for {@link attachAutosave}. */
export interface AutosaveOptions {
  /** Write a full snapshot (and compact the log) after this many edits. Default 200. */
  snapshotEvery?: number;
  /** The host's durable save, called with the current project `debounceMs` after the last edit. */
  onSave?: (project: Project) => void | Promise<void>;
  /** Storage problems (e.g. {@link StorageFullError}); editing carries on. */
  onError?: (error: Error) => void;
  /** Delay before `onSave` after the last edit (ms). Default 1000. */
  debounceMs?: number;
  /** Delay before buffered log entries are written (ms). Default 250. */
  flushMs?: number;
  /** Quiet time after which a snapshot is written in idle time (ms). Default 5000. */
  idleSnapshotMs?: number;
}

/** What {@link attachAutosave} returns. */
export interface Autosave {
  /** Writes everything buffered (log entries, a due snapshot, a pending `onSave`) and waits for it. */
  flush(): Promise<void>;
  /** Stops saving (after a best-effort flush). */
  detach(): void;
}

/**
 * Writes every editor commit to the op log (append-only, batched per ~250 ms), snapshots every N
 * entries or on idle/visibilitychange/pagehide, and calls onSave (debounced, e.g. 1 s after the
 * last edit) with the current project. Returns a detach function (and `flush`).
 *
 * The editor's current project becomes the saved state for its id right away (a fresh snapshot),
 * so load the stored copy first (`storage.loadProject`) if it might be newer than what the editor
 * holds. `editor.load()` of another project starts saving that one instead.
 */
export function attachAutosave(
  editor: Editor,
  storage: ProjectStorage,
  options: AutosaveOptions = {},
): Autosave {
  const snapshotEvery = options.snapshotEvery ?? 200;
  const debounceMs = options.debounceMs ?? 1000;
  const flushMs = options.flushMs ?? 250;
  const idleSnapshotMs = options.idleSnapshotMs ?? 5000;
  const report = (error: unknown) =>
    options.onError?.(error instanceof Error ? error : new Error(String(error)));

  let project = editor.getProject();
  let committed = project;
  /** Set when opening the writer failed: the next commit tries again from the current project. */
  let writerFailed = false;
  const openWriter = (base: Project, after: Promise<unknown> = Promise.resolve()) => {
    const opened = after.then(() => storage.openWriter(base));
    opened.catch((error: unknown) => {
      writerFailed = true;
      report(error);
    });
    return opened;
  };
  let writer: Promise<ProjectWriter> = openWriter(project);
  let queue: StoredLogEntry[] = [];
  let sinceSnapshot = 0;
  /** Project name in the last snapshot (the project list reads names from snapshots). */
  let snapshotName = project.name;
  /** Every write, in order; never rejects (errors go to onError). */
  let chain: Promise<void> = Promise.resolve();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let savePending = false;
  let saving: Promise<void> = Promise.resolve();
  let detached = false;

  const enqueue = (task: (w: ProjectWriter) => Promise<void>) => {
    const w = writer;
    chain = chain
      .then(() => w.then(task, () => undefined)) // a failed open was reported already
      .catch(report);
    return chain;
  };

  const writeLog = (): Promise<void> => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (queue.length === 0) return chain;
    const batch = queue;
    queue = [];
    return enqueue(async (w) => {
      try {
        await w.append(batch);
      } finally {
        // A failed append left a hole in the log: write a snapshot soon to close it.
        if (w.needsSnapshot) scheduleIdleSnapshot(true);
      }
    });
  };

  const writeSnapshot = (): Promise<void> => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    void writeLog();
    sinceSnapshot = 0;
    const current = project;
    snapshotName = current.name;
    return enqueue((w) => w.snapshot(current));
  };

  const scheduleFlush = () => {
    flushTimer ??= setTimeout(() => void writeLog(), flushMs);
  };

  const scheduleIdleSnapshot = (soon = false) => {
    if (detached) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => runIdle(() => void writeSnapshot()), soon ? 1000 : idleSnapshotMs);
  };

  const runSave = (): Promise<void> => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (!savePending || !options.onSave) return saving;
    savePending = false;
    const current = editor.getProject();
    const onSave = options.onSave;
    saving = saving.then(async () => {
      try {
        await onSave(current);
      } catch (error) {
        report(error);
      }
    });
    return saving;
  };

  const scheduleSave = () => {
    if (!options.onSave) return;
    savePending = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void runSave(), debounceMs);
  };

  const unsubscribeCommit = editor.onCommit((entry, next) => {
    if (detached) return;
    project = next;
    committed = next;
    if (writerFailed) {
      // Start over from the current project (it already contains everything queued).
      writerFailed = false;
      queue = [];
      sinceSnapshot = 0;
      snapshotName = next.name;
      writer = openWriter(next, chain);
      scheduleSave();
      return;
    }
    queue.push({ label: entry.label, kind: entry.kind, patches: entry.patches });
    sinceSnapshot++;
    scheduleFlush();
    scheduleSave();
    if (sinceSnapshot >= snapshotEvery || next.name !== snapshotName)
      runIdle(() => void writeSnapshot());
    else scheduleIdleSnapshot();
  });

  // `editor.load()` replaces the project without a commit: save the new one from a fresh base.
  // (A commit also changes the store — first — so wait a microtask to see whether one followed.)
  const unsubscribeStore = editor.store.subscribe((state) => {
    const next = state.project;
    if (next === project) return;
    queueMicrotask(() => {
      if (detached || next !== editor.getProject() || next === committed) return;
      void writeLog();
      project = next;
      committed = next;
      sinceSnapshot = 0;
      snapshotName = next.name;
      writerFailed = false;
      writer = openWriter(next, chain);
      scheduleSave();
    });
  });

  const onHide = () => {
    // The tab may be killed now (phones do it all the time): write the log first, then the rest.
    void writeLog();
    void runSave();
    if (sinceSnapshot > 0) void writeSnapshot();
  };
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') onHide();
  };
  const target =
    typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
  target?.addEventListener('pagehide', onHide);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  const flush = async () => {
    await writeLog();
    if (sinceSnapshot >= snapshotEvery || project.name !== snapshotName) await writeSnapshot();
    await Promise.all([chain, runSave()]);
  };

  return {
    flush,
    detach() {
      if (detached) return;
      void flush().finally(() => {
        if (idleTimer) clearTimeout(idleTimer);
      });
      detached = true;
      unsubscribeCommit();
      unsubscribeStore();
      target?.removeEventListener('pagehide', onHide);
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', onVisibility);
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    },
  };
}

/** Runs `task` when the main thread is idle (or soon, where there's no idle callback). */
function runIdle(task: () => void): void {
  const idle = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (idle) idle(task, { timeout: 2000 });
  else setTimeout(task, 0);
}
