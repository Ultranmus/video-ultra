import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { randomId, type IdFactory } from '../model/project';
import type { Project } from '../model/schema';

enablePatches();

/** One committed edit, as stored in the operation log. */
export interface LogEntry {
  /** Increases by one per commit, across undo/redo too. */
  seq: number;
  /** What the user did, e.g. "Split clip". Shown in history UI. */
  label: string;
  /** Applying these to the previous project gives the next one. */
  patches: Patch[];
  /** Applying these undoes the entry. */
  inverse: Patch[];
  /** `edit`, or `undo` / `redo` of an earlier entry. */
  kind: 'edit' | 'undo' | 'redo';
}

/** State of the editor store. Subscribe with selectors to re-render only what changed. */
export interface EditorState {
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
  /** Label of the edit that undo would revert. */
  undoLabel: string | null;
  redoLabel: string | null;
}

/** Context passed to every edit recipe. */
export interface EditContext {
  ids: IdFactory;
}

export interface ApplyOptions {
  /**
   * Consecutive edits with the same key within `coalesceMs` merge into one undo step
   * (a slider dragged for two seconds = one undo).
   */
  coalesceKey?: string;
  coalesceMs?: number;
}

/** The undo history as a list (the History panel). */
export interface HistoryView {
  /** Step labels, oldest first: the undoable steps, then the redoable ones. */
  labels: readonly string[];
  /**
   * How many steps are applied: 0 = the project as opened ("Original"), `labels.length` = latest.
   * Steps after it are the ones redo would bring back.
   */
  position: number;
}

/** The editor's state container: project + undo/redo + operation log. */
export interface Editor {
  readonly store: StoreApi<EditorState>;
  getProject(): Project;
  /**
   * Runs an edit. `recipe` mutates a draft (use the functions from `ops.ts`). If it throws, the
   * project is unchanged and the error is re-thrown. Returns the recipe's return value.
   */
  apply<R>(
    label: string,
    recipe: (draft: Project, ctx: EditContext) => R,
    options?: ApplyOptions,
  ): R;
  undo(): boolean;
  redo(): boolean;
  /** The history as a list, for showing it. */
  history(): HistoryView;
  /**
   * Undoes or redoes until `position` steps are applied (see {@link HistoryView}). Each step is
   * logged as its own undo / redo. Returns false if `position` is out of range.
   */
  goTo(position: number): boolean;
  /** Replaces the project (e.g. opening another one); clears history. */
  load(project: Project): void;
  /** Called after every commit, undo and redo — persist the entry for autosave/crash recovery. */
  onCommit(listener: (entry: LogEntry, project: Project) => void): () => void;
}

export interface EditorOptions {
  ids?: IdFactory;
  /** Max undo steps kept in memory. Default 300. */
  historyLimit?: number;
  /** Clock for coalescing (tests). */
  now?: () => number;
}

interface HistoryStep {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  coalesceKey?: string;
  at: number;
}

/** Creates an editor around `project`. */
export function createEditor(project: Project, options: EditorOptions = {}): Editor {
  const ctx: EditContext = { ids: options.ids ?? randomId };
  const limit = options.historyLimit ?? 300;
  const now = options.now ?? (() => Date.now());
  let past: HistoryStep[] = [];
  let future: HistoryStep[] = [];
  let seq = 0;
  const listeners = new Set<(entry: LogEntry, project: Project) => void>();

  const snapshot = (next: Project): EditorState => ({
    project: next,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undoLabel: past[past.length - 1]?.label ?? null,
    redoLabel: future[future.length - 1]?.label ?? null,
  });
  const store = createStore<EditorState>(() => snapshot(project));

  const emit = (entry: Omit<LogEntry, 'seq'>, next: Project) => {
    const full: LogEntry = { ...entry, seq: ++seq };
    for (const listener of listeners) listener(full, next);
  };

  const editor: Editor = {
    store,
    getProject: () => store.getState().project,

    apply(label, recipe, applyOptions = {}) {
      let result!: ReturnType<typeof recipe>;
      const current = store.getState().project;
      const [next, patches, inverse] = produceWithPatches(current, (draft: Project) => {
        result = recipe(draft, ctx);
      });
      if (patches.length === 0) return result;

      const last = past[past.length - 1];
      const at = now();
      const key = applyOptions.coalesceKey;
      if (
        key &&
        last &&
        last.coalesceKey === key &&
        at - last.at <= (applyOptions.coalesceMs ?? 1000)
      ) {
        last.patches = [...last.patches, ...patches];
        last.inverse = [...inverse, ...last.inverse];
        last.at = at;
      } else {
        past.push({ label, patches, inverse, at, ...(key ? { coalesceKey: key } : {}) });
        if (past.length > limit) past = past.slice(past.length - limit);
      }
      future = [];
      store.setState(snapshot(next), true);
      emit({ label, patches, inverse, kind: 'edit' }, next);
      return result;
    },

    undo() {
      const step = past.pop();
      if (!step) return false;
      const next = applyPatches(store.getState().project, step.inverse);
      // An undone step never merges with later edits, so it goes back without its coalesce key.
      future.push({ label: step.label, patches: step.patches, inverse: step.inverse, at: step.at });
      store.setState(snapshot(next), true);
      emit({ label: step.label, patches: step.inverse, inverse: step.patches, kind: 'undo' }, next);
      return true;
    },

    redo() {
      const step = future.pop();
      if (!step) return false;
      const next = applyPatches(store.getState().project, step.patches);
      past.push(step);
      store.setState(snapshot(next), true);
      emit({ label: step.label, patches: step.patches, inverse: step.inverse, kind: 'redo' }, next);
      return true;
    },

    history() {
      const labels = past.map((step) => step.label);
      for (let i = future.length - 1; i >= 0; i--) labels.push(future[i]!.label);
      return { labels, position: past.length };
    },

    goTo(position) {
      if (!Number.isInteger(position) || position < 0 || position > past.length + future.length)
        return false;
      while (past.length > position) editor.undo();
      while (past.length < position) editor.redo();
      return true;
    },

    load(next) {
      past = [];
      future = [];
      store.setState(snapshot(next), true);
    },

    onCommit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return editor;
}

/**
 * Rebuilds a project from a snapshot plus the log entries written after it (crash recovery).
 * Entries with `seq` ≤ `snapshotSeq` are skipped.
 */
export function replayLog(
  snapshot: Project,
  snapshotSeq: number,
  entries: readonly LogEntry[],
): Project {
  let project = snapshot;
  for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (entry.seq <= snapshotSeq) continue;
    project = applyPatches(project, entry.patches);
  }
  return project;
}
