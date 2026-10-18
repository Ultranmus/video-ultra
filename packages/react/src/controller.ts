import {
  addAsset,
  addToLane,
  arrangeItem,
  createEditor,
  createProject,
  deleteItem,
  duplicateItem,
  EditError,
  findItem,
  freezeFrame,
  groupItems,
  groupOf,
  insertMain,
  mainTrack,
  parseProject,
  projectDuration,
  projectFrame,
  randomId,
  setItemFlags,
  setExportRange,
  setTrackFlags,
  setTransition,
  LAYER_SCALE,
  splitItem,
  ungroupItems,
  updateItem,
  type ArrangeTo,
  type Asset,
  type Capabilities,
  type Editor,
  type EditContext,
  type Item,
  type Project,
  type Time,
  type ExportOptions,
  type ExportProgress,
  type ExportResult,
  type AudioExportOptions,
  type AudioExportResult,
  type FrameImage,
  type FrameImageOptions,
} from '@video-ultra/core';
import {
  assetFromProbe,
  attachAutosave,
  lockProject,
  type ProjectLock,
  createEngine,
  createMediaAnalyzer,
  createProjectStorage,
  itemIndexAt,
  StorageFullError,
  type Engine,
  type MediaAnalyzer,
  type ProjectStorage,
} from '@video-ultra/core/internal';
import { produce } from 'immer';
import { audioItem, DEFAULT_DUCK, isSounding, itemTitle, stickerItem, visualItem } from './items';
import { audioExtension, type AudioLibrary, type AudioLibraryTrack } from './library/audio-library';
import { formatClock } from './format';
import { computeTargets, type Targets } from './targets';
import type { Labels } from './labels';
import { createUiStore, Playhead, type LayoutMode, type PanelId, type ToolId } from './state';
import { alignOffsets, distributeOffsets, type AlignEdge } from './stage/arrange';
import { itemBox, visibleItemsAt, type Box } from './stage/geometry';
import { measureText } from './stage/measure';

/** Options the `<VideoEditor />` passes to its controller. */
export interface ControllerOptions {
  labels: Labels;
  backend?: 'auto' | 'webgpu' | 'webgl2';
  /** Called (debounced) after edits with the current project — the host's durable save. */
  onSave?: (project: Project) => void | Promise<void>;
  /** Called when an export finishes. */
  onExport?: (result: ExportResult) => void;
  /** Called when a sound-only export finishes. */
  onExportAudio?: (result: AudioExportResult) => void;
  /** Called when a frame is saved as a picture. */
  onSaveFrame?: (image: FrameImage) => void;
  /** Gets media bytes for assets the host stores itself (`url` sources or its own keys). */
  resolveMedia?: (asset: Asset) => Promise<Blob | null>;
  /** Keep a local autosave + crash-recovery copy in the browser (default true). */
  autosave?: boolean;
  /** Base URL of the 3D sticker art (self-host it), or `false` to hide 3D stickers. */
  stickerLibrary?: string | false;
  /** The host's music & sound-effects source for the Audio panel. */
  audioLibrary?: AudioLibrary;
}

/**
 * Owns everything behind the editor UI: the core editor (project + undo), the engine worker, the
 * media analyzer, storage, UI state and the playhead. React components read from it with
 * selectors and call its methods; nothing here renders.
 */
export class EditorController {
  readonly editor: Editor;
  readonly ui = createUiStore();
  readonly playhead = new Playhead();
  readonly labels: Labels;
  readonly options: ControllerOptions;
  analyzer: MediaAnalyzer | null = null;
  storage: ProjectStorage | null = null;
  engine: Engine | null = null;
  caps: Capabilities | null = null;
  #filePicker: (() => void) | null = null;
  /** Bytes of every asset, for the engine and analyzer (Files/Blobs: no copies in memory). */
  readonly media = new Map<string, Blob>();
  #disposers: (() => void)[] = [];
  #pendingSeek: Time | null = null;
  #seekScheduled = false;
  #previewProject: Project | null = null;
  #previewScheduled = false;
  #toastId = 0;
  #autosave: { flush(): Promise<void>; detach(): void } | null = null;
  /** Bumped by stop(); async work from an older start() checks it and backs out. */
  #generation = 0;

  constructor(options: ControllerOptions, project?: Project) {
    this.options = options;
    this.labels = options.labels;
    this.editor = createEditor(project ?? createProject());
    this.#disposers.push(
      this.editor.store.subscribe((state, prev) => {
        if (state.project === prev.project) return;
        if (!this.#previewProject) void this.engine?.setProject(state.project).catch(() => {});
        const { selectedId, selectedIds } = this.ui.getState();
        if (selectedId && !findItem(state.project, selectedId)) this.select(null);
        else if (selectedIds.some((id) => !findItem(state.project, id)))
          this.ui.setState({
            selectedIds: selectedIds.filter((id) => findItem(state.project, id)),
          });
        if (this.playhead.time > projectDuration(state.project))
          this.seek(projectDuration(state.project));
      }),
    );
  }

  /** Opens the file picker (the shell registers it). */
  pickFiles(): void {
    this.#filePicker?.();
  }

  /** Registers the shell's file picker; returns an unregister function. */
  setFilePicker(open: (() => void) | null): () => void {
    this.#filePicker = open;
    return () => {
      if (this.#filePicker === open) this.#filePicker = null;
    };
  }

  get project(): Project {
    return this.editor.getProject();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  /** Storage, analyzer, autosave, and media for the opening project. */
  async start(caps: Capabilities, initial: Project | null): Promise<void> {
    const generation = this.#generation;
    this.caps = caps;
    const storage = await createProjectStorage();
    if (generation !== this.#generation) return;
    this.storage = storage;
    // Waveforms are cached next to the project's media, so reopening doesn't decode audio again.
    this.analyzer = createMediaAnalyzer({ tier: caps.tier, waveformCache: storage });
    let project = initial;
    if (!project && this.options.autosave !== false) {
      const latest = (await this.storage.listProjects())[0];
      const loaded = latest
        ? await this.storage.loadProject(latest.id).catch((error: unknown) => {
            this.toast(error instanceof Error ? error.message : String(error), 'error');
            return null;
          })
        : null;
      if (generation !== this.#generation) return;
      if (loaded) {
        project = loaded.project;
        for (const warning of loaded.warnings) this.toast(warning, 'info');
      }
    }
    if (project) this.editor.load(project);
    if (this.options.autosave !== false || this.options.onSave) {
      // Only the tab holding the project's lock saves it (two writers would corrupt the log).
      if (await this.#claim(false, generation)) this.#startAutosave();
      if (generation !== this.#generation) return;
    }
    void this.storage.status().then((s) => this.ui.setState({ persistent: s.persistent }));
    // Media a crash left behind (imported, never saved into a project): tidy once, later, and only
    // from the tab that owns the project (another tab may be mid-import).
    setTimeout(() => {
      if (generation === this.#generation && this.#lock)
        void this.storage?.sweepMedia().catch(() => 0);
    }, 10_000);
    // Tell once (per browser) that local storage may be cleared — after the first real edit, when
    // there is work to lose, not on an empty editor.
    const off = this.editor.onCommit(() => {
      off();
      if (this.ui.getState().persistent !== false) return;
      const key = 'video-ultra:storage-notice';
      try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, '1');
      } catch {
        /* storage blocked: show it anyway */
      }
      this.toast(this.labels.notPersistent, 'info');
    });
    await Promise.all(
      Object.values(this.project.assets).map(async (asset) => {
        const blob =
          (await this.options.resolveMedia?.(asset).catch(() => null)) ??
          (await this.storage!.getMedia(asset).catch(() => null));
        if (generation !== this.#generation) return;
        if (blob) this.#registerMedia(asset, blob);
        else this.toast(this.labels.mediaMissing(asset.name), 'error');
      }),
    );
  }

  #lock: ProjectLock | null = null;

  #startAutosave(): void {
    if (!this.storage) return;
    this.#autosave?.detach();
    this.#autosave = attachAutosave(this.editor, this.storage, {
      onSave: async (p) => {
        this.ui.setState({ save: 'saving' });
        await this.options.onSave?.(p);
        this.ui.setState({ save: 'saved' });
      },
      onError: (error) => this.toast(error.message, 'error'),
    });
  }

  /**
   * Takes this project's lock (one tab saves a project at a time). Without it the editor stays
   * read-only: edits work but aren't saved, and a banner offers to take over. Losing the lock
   * later (another tab took over) stops saving here at once — no final flush, the other tab owns
   * the log now.
   */
  async #claim(steal: boolean, generation = this.#generation): Promise<boolean> {
    let lock = await lockProject(this.project.id, { steal }).catch(() => null);
    // A remount (React strict mode, a host re-rendering) releases its lock a moment late: one
    // retry before deciding another tab really has it.
    if (!lock && !steal) {
      await new Promise((r) => setTimeout(r, 300));
      if (generation === this.#generation)
        lock = await lockProject(this.project.id).catch(() => null);
    }
    if (generation !== this.#generation) {
      lock?.release();
      return false;
    }
    if (!lock) {
      this.ui.setState({ readOnly: true });
      return false;
    }
    this.#lock?.release();
    this.#lock = lock;
    this.ui.setState({ readOnly: false });
    void lock.lost.then(() => {
      if (this.#lock !== lock) return;
      this.#lock = null;
      this.#autosave?.detach();
      this.#autosave = null;
      this.ui.setState({ readOnly: true, save: 'idle' });
    });
    return true;
  }

  /**
   * "Use it here": takes the project over from the other tab, reloads what that tab saved, and
   * saves from this tab from now on.
   */
  async takeOver(): Promise<void> {
    const storage = this.storage;
    if (!storage) return;
    const id = this.project.id;
    if (!(await this.#claim(true))) return;
    const latest = await storage.loadProject(id).catch(() => null);
    if (latest) this.editor.load(latest.project);
    this.#startAutosave();
    this.toast(this.labels.tookOver, 'success');
  }

  /** Hands the preview canvas to a new engine worker. Returns a disposer. */
  async attachCanvas(canvas: HTMLCanvasElement): Promise<() => void> {
    if (!this.caps) throw new Error('start() first');
    const generation = this.#generation;
    const engine = await createEngine(canvas, {
      tier: this.caps.tier,
      backend: this.options.backend ?? 'auto',
    });
    if (this.#generation !== generation) {
      engine.destroy();
      return () => {};
    }
    this.engine = engine;
    engine.onTime = (time, playing) => {
      // A trim drag shows the edge frame without moving the playhead.
      if (this.#previewSeeking && !playing) return;
      // While paused the playhead is ours: the engine only echoes seeks we already made, a frame
      // late — applying them would pull a scrubbing timeline back and make it jitter. Time from
      // the engine counts while playing and at the moment playback stops.
      if (!playing && !this.ui.getState().playing) return;
      this.playhead.set(time);
      if (this.ui.getState().playing !== playing) this.ui.setState({ playing });
    };
    engine.onEnded = () => this.ui.setState({ playing: false });
    engine.onError = (message) => {
      // Audio problems are reported once, not as a blocking error.
      this.toast(this.labels.engineError(message), 'error');
    };
    engine.onFatal = (message) => {
      // Keep everything saved, then say plainly what happened and offer a way out.
      this.ui.setState({ playing: false, status: 'stopped', statusMessage: message });
      void this.#autosave?.flush();
    };
    engine.onAudioUnavailable = (reason, detail) => {
      // Not an error the user caused or can fix in the editor: a calm note, once.
      this.toast(
        reason === 'insecure' ? this.labels.audioNeedsSecure : this.labels.audioUnavailable(detail),
        'info',
      );
    };
    await engine.setProject(this.project);
    for (const [assetId, blob] of this.media) await engine.addMedia(assetId, blob);
    await engine.seek(this.playhead.time);
    return () => {
      if (this.engine === engine) this.engine = null;
      engine.destroy();
    };
  }

  /**
   * Stops everything start() and attachCanvas() began (autosave, analyzer, engine). The controller
   * can be started again — React strict mode unmounts and remounts once in development.
   */
  stop(): void {
    this.#generation++;
    void this.#autosave?.flush();
    this.#autosave?.detach();
    this.#autosave = null;
    this.#lock?.release();
    this.#lock = null;
    this.engine?.destroy();
    this.engine = null;
    this.analyzer?.destroy();
    this.analyzer = null;
    // Close after the autosave flush above has been handed its writes.
    const storage = this.storage;
    this.storage = null;
    setTimeout(() => storage?.close(), 1000);
    this.media.clear();
  }

  // ── playback ───────────────────────────────────────────────────────────

  togglePlay(): void {
    if (this.ui.getState().playing) this.pause();
    else this.play();
  }

  play(): void {
    if (!this.engine || projectDuration(this.project) === 0) return;
    this.ui.setState({ playing: true });
    // play() must start inside the user's gesture (audio on iOS) — no await before it.
    void this.engine.play().catch((e: unknown) => this.toast(String(e), 'error'));
  }

  pause(): void {
    this.ui.setState({ playing: false });
    void this.engine?.pause();
  }

  /** Moves the playhead. Engine seeks are coalesced to one per animation frame (latest wins). */
  seek(time: Time): void {
    const t = Math.max(0, Math.min(Math.round(time), projectDuration(this.project)));
    this.playhead.set(t);
    this.#pendingSeek = t;
    if (this.#seekScheduled) return;
    this.#seekScheduled = true;
    requestAnimationFrame(() => {
      this.#seekScheduled = false;
      const next = this.#pendingSeek;
      this.#pendingSeek = null;
      if (next !== null) void this.engine?.seek(next).catch(() => {});
    });
  }

  #previewSeeking = false;
  #previewSeekScheduled = false;
  #previewSeekTime = 0;

  /**
   * Shows the frame at `time` in the preview without moving the playhead (trimming shows the new
   * edge); `null` returns the preview to the playhead. Coalesced per frame.
   */
  previewSeek(time: Time | null): void {
    if (time === null) {
      if (!this.#previewSeeking) return;
      this.#previewSeeking = false;
      void this.engine?.seek(this.playhead.time).catch(() => {});
      return;
    }
    this.#previewSeeking = true;
    this.#previewSeekTime = Math.max(0, Math.round(time));
    if (this.#previewSeekScheduled) return;
    this.#previewSeekScheduled = true;
    requestAnimationFrame(() => {
      this.#previewSeekScheduled = false;
      if (this.#previewSeeking) void this.engine?.seek(this.#previewSeekTime).catch(() => {});
    });
  }

  /** Steps by whole frames (arrow keys). */
  step(frames: number): void {
    const frame = projectFrame(this.project);
    this.seek(Math.round(this.playhead.time / frame + frames) * frame);
  }

  // ── transient previews (drags) ─────────────────────────────────────────

  /**
   * Shows a not-yet-committed version of the project in the preview (stage drags, sliders before
   * release). Nothing is written to the store or the undo history. Coalesced per frame.
   */
  preview(recipe: ((draft: Project, ctx: EditContext) => void) | null): Project | null {
    if (!recipe) {
      if (this.#previewProject) void this.engine?.setProject(this.project).catch(() => {});
      this.#previewProject = null;
      return null;
    }
    try {
      this.#previewProject = produce(this.project, (draft) => {
        recipe(draft, { ids: randomId });
      });
    } catch {
      return this.#previewProject; // an invalid intermediate state just isn't shown
    }
    if (this.#previewScheduled) return this.#previewProject;
    this.#previewScheduled = true;
    requestAnimationFrame(() => {
      this.#previewScheduled = false;
      if (this.#previewProject) void this.engine?.setProject(this.#previewProject).catch(() => {});
    });
    return this.#previewProject;
  }

  // ── editing ────────────────────────────────────────────────────────────

  /** Runs an edit; refused edits show their reason instead of throwing. */
  run<R>(
    label: string,
    recipe: (draft: Project, ctx: EditContext) => R,
    options?: { coalesceKey?: string },
  ): R | undefined {
    this.#previewProject = null;
    try {
      return this.editor.apply(label, recipe, options);
    } catch (error) {
      if (error instanceof EditError) this.toast(error.message, 'error');
      else this.toast(String(error), 'error');
      return undefined;
    }
  }

  undo(): void {
    this.editor.undo();
  }

  redo(): void {
    this.editor.redo();
  }

  /** History panel: undoes or redoes until `position` steps are applied (0 = as opened). */
  jumpToHistory(position: number): void {
    const { labels } = this.editor.history();
    if (!this.editor.goTo(position)) return;
    this.#announce(
      this.labels.historyJumped(
        position === 0 ? this.labels.historyOriginal : labels[position - 1]!,
      ),
    );
  }

  /**
   * Selects an item (closing any open tool, since tools belong to the selection). `keepPanel`
   * keeps the open panel/tool — used when a panel selects the clip it is about to act on.
   * Picking a group member selects the whole group (`only` picks just that member); `add`
   * toggles the item (and its group) in a multi-selection (Shift-click, Layers "Select several").
   */
  select(
    itemId: string | null,
    options: { keepPanel?: boolean; add?: boolean; only?: boolean } = {},
  ): void {
    const state = this.ui.getState();
    let ids: readonly string[];
    let primary = itemId;
    if (itemId === null) ids = [];
    else if (options.add) {
      const members = groupOf(this.project, itemId);
      const on = state.selectedIds.includes(itemId);
      ids = on
        ? state.selectedIds.filter((id) => !members.includes(id))
        : [...state.selectedIds, ...members.filter((id) => !state.selectedIds.includes(id))];
      primary = on ? (ids[ids.length - 1] ?? null) : itemId;
    } else if (options.only) ids = [itemId];
    else if (state.selectedIds.includes(itemId) && state.selectedIds.length > 1)
      ids = state.selectedIds; // pressing inside a multi-selection keeps it (to drag it)
    else ids = groupOf(this.project, itemId);
    if (
      state.selectedId === primary &&
      ids.length === state.selectedIds.length &&
      ids.every((id, i) => state.selectedIds[i] === id)
    )
      return;
    const multi = ids.length > 1;
    const wasMulti = state.selectedIds.length > 1;
    if (options.keepPanel || (multi && wasMulti))
      this.ui.setState({ selectedId: primary, selectedIds: ids });
    else this.ui.setState({ selectedId: primary, selectedIds: ids, tool: null, sheetPanel: false });
  }

  selectedItem(): Item | null {
    const id = this.ui.getState().selectedId;
    return id ? (findItem(this.project, id)?.item ?? null) : null;
  }

  /** Everything selected (one item, a group, or a multi-selection). */
  selectedItems(): Item[] {
    const out: Item[] = [];
    for (const id of this.ui.getState().selectedIds) {
      const item = findItem(this.project, id)?.item;
      if (item) out.push(item);
    }
    return out;
  }

  /** Whether an item can't be changed: locked itself, or on a locked row. */
  isLocked(itemId: string): boolean {
    const found = findItem(this.project, itemId);
    return !!found && (!!found.item.locked || found.track.locked);
  }

  /** ⌘A: every element on screen at the playhead (not the main video, not hidden ones). */
  selectAll(): void {
    const main = mainTrack(this.project);
    const ids = visibleItemsAt(this.project, this.playhead.time)
      .filter((item) => !main.items.includes(item))
      .map((item) => item.id)
      .reverse();
    if (ids.length === 0) {
      this.toast(this.labels.nothingOnScreen, 'info');
      return;
    }
    this.ui.setState({ selectedId: ids[ids.length - 1]!, selectedIds: ids, tool: null });
  }

  // ── organising: lock, hide, group, arrange, align ──────────────────────

  /** Locks or unlocks the selection (all locked → unlock all). */
  toggleLockSelected(): void {
    const items = this.selectedItems();
    if (items.length === 0) return;
    const lock = !items.every((i) => i.locked);
    this.run(lock ? this.labels.lock : this.labels.unlock, (d) => {
      for (const item of items) setItemFlags(d, item.id, { locked: lock });
    });
    this.#announce(lock ? this.labels.lock : this.labels.unlock);
  }

  /** Hides or shows the selection (all hidden → show all). */
  toggleHideSelected(): void {
    const items = this.selectedItems().filter((i) => i.kind !== 'audio');
    if (items.length === 0) return;
    const hide = !items.every((i) => i.hidden);
    this.run(hide ? this.labels.hide : this.labels.show, (d) => {
      for (const item of items) setItemFlags(d, item.id, { hidden: hide });
    });
  }

  /** One row of the Layers panel: lock / hide / rename a single item. */
  setItemLocked(itemId: string, locked: boolean): void {
    this.run(locked ? this.labels.lock : this.labels.unlock, (d) =>
      setItemFlags(d, itemId, { locked }),
    );
  }

  setItemHidden(itemId: string, hidden: boolean): void {
    this.run(hidden ? this.labels.hide : this.labels.show, (d) =>
      setItemFlags(d, itemId, { hidden }),
    );
  }

  renameItem(itemId: string, name: string): void {
    const value = name.trim().slice(0, 120);
    const found = findItem(this.project, itemId);
    if (!found || (found.item.name ?? '') === value) return;
    this.run(this.labels.rename, (d) => {
      // Renaming works on locked items too (it changes nothing on screen).
      const target = findItem(d, itemId)!.item;
      if (value) target.name = value;
      else delete target.name;
    });
  }

  /** Lane header: locks or unlocks a whole row. */
  toggleTrackLock(trackId: string): void {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    this.run(track.locked ? this.labels.unlockLane : this.labels.lockLane, (d) =>
      setTrackFlags(d, trackId, { locked: !track.locked }),
    );
  }

  /** Why the selection can't be grouped (null = it can). */
  groupReason(): string | null {
    const items = this.selectedItems();
    if (items.length < 2) return this.labels.groupNeedsTwo;
    const main = mainTrack(this.project);
    if (items.some((i) => main.items.includes(i))) return this.labels.groupNoMainVideo;
    const group = items[0]!.groupId;
    if (group && items.every((i) => i.groupId === group)) return this.labels.groupNeedsTwo;
    return null;
  }

  groupSelected(): void {
    const reason = this.groupReason();
    if (reason) {
      this.toast(reason, 'info');
      return;
    }
    const ids = this.ui.getState().selectedIds;
    const done = this.run(this.labels.group, (d, ctx) => groupItems(d, ids, ctx.ids));
    if (done) this.#announce(this.labels.groupedDone(ids.length));
  }

  /** The group the selection is (null when it isn't exactly one group). */
  selectedGroup(): string | null {
    const items = this.selectedItems();
    const group = items[0]?.groupId;
    return group && items.every((i) => i.groupId === group) ? group : null;
  }

  ungroupSelected(): void {
    const group = this.selectedGroup();
    if (!group) return;
    this.run(this.labels.ungroup, (d) => ungroupItems(d, group));
    this.#announce(this.labels.ungroupedDone);
  }

  /** Why the selection can't move in the stack (null = it can). */
  arrangeReason(to: ArrangeTo): string | null {
    const items = this.selectedItems();
    if (items.length === 0) return this.labels.selectFirst;
    const main = mainTrack(this.project);
    if (items.every((i) => main.items.includes(i))) return this.labels.arrangeMainVideo;
    if (items.every((i) => i.kind === 'audio')) return this.labels.arrangeSound;
    if (items.some((i) => this.isLocked(i.id))) return this.labels.lockedReason;
    const probe = produce(this.project, (d) => {
      this.#arrangeDraft(d, items, to);
    });
    if (probe === this.project)
      return to === 'forward' || to === 'front' ? this.labels.atFront : this.labels.atBack;
    return null;
  }

  #arrangeDraft(d: Project, items: readonly Item[], to: ArrangeTo): void {
    const t = this.playhead.time;
    // Keep the selection's own order: going up, move the top one first; going down, the bottom.
    const z = (id: string) => d.tracks.findIndex((tr) => tr.items.some((i) => i.id === id));
    const lanes = items
      .filter((i) => i.kind !== 'audio' && z(i.id) > 0)
      .sort((a, b) => z(a.id) - z(b.id));
    const up = to === 'forward' || to === 'front';
    for (const item of up ? lanes.reverse() : lanes) {
      try {
        arrangeItem(d, item.id, to, t, randomId);
      } catch {
        // Already at that end: the others still move.
      }
    }
  }

  arrangeSelected(to: ArrangeTo): void {
    const reason = this.arrangeReason(to);
    if (reason) {
      this.toast(reason, 'info');
      return;
    }
    const items = this.selectedItems();
    this.run(this.labels.arrangeStep, (d) => this.#arrangeDraft(d, items, to));
  }

  /**
   * Layers panel drag: puts an element at `toIndex` in the on-screen stack (0 = front), one step
   * at a time so lanes stay tidy. One undo step.
   */
  moveInStack(itemId: string, toIndex: number): void {
    const stack = () =>
      visibleItemsAt(this.project, this.playhead.time).filter(
        (i) => !mainTrack(this.project).items.includes(i),
      );
    const from = stack().findIndex((i) => i.id === itemId);
    if (from === -1 || from === toIndex) return;
    const t = this.playhead.time;
    this.run(this.labels.arrangeStep, (d, ctx) => {
      const steps = Math.abs(toIndex - from);
      for (let n = 0; n < steps; n++)
        arrangeItem(d, itemId, toIndex < from ? 'forward' : 'backward', t, ctx.ids);
    });
  }

  /** Boxes of the selected on-screen pictures (canvas px), for align / distribute. */
  #selectedBoxes(): { item: Item; box: Box }[] {
    const { width, height } = this.project.settings;
    const out: { item: Item; box: Box }[] = [];
    for (const item of this.selectedItems()) {
      if (!('transform' in item) || this.isLocked(item.id)) continue;
      const box = itemBox(item, this.project, width, height, measureText);
      if (box) out.push({ item, box });
    }
    return out;
  }

  alignReason(): string | null {
    const items = this.selectedItems();
    if (items.length === 0 || items.every((i) => !('transform' in i)))
      return this.labels.alignNeedsPicture;
    if (items.some((i) => this.isLocked(i.id))) return this.labels.lockedReason;
    return null;
  }

  distributeReason(): string | null {
    return (
      this.alignReason() ??
      (this.#selectedBoxes().length < 3 ? this.labels.distributeNeedsThree : null)
    );
  }

  /** Lines up the selection: one element against the frame, several against each other. */
  align(edge: AlignEdge): void {
    const reason = this.alignReason();
    if (reason) {
      this.toast(reason, 'info');
      return;
    }
    const { width, height } = this.project.settings;
    const list = this.#selectedBoxes();
    const offsets = alignOffsets(
      list.map((e) => e.box),
      edge,
      width,
      height,
    );
    this.#nudge(list, offsets);
  }

  distribute(axis: 'x' | 'y'): void {
    const reason = this.distributeReason();
    if (reason) {
      this.toast(reason, 'info');
      return;
    }
    const list = this.#selectedBoxes();
    this.#nudge(
      list,
      distributeOffsets(
        list.map((e) => e.box),
        axis,
      ),
    );
  }

  #nudge(list: { item: Item; box: Box }[], offsets: { dx: number; dy: number }[]): void {
    const { width, height } = this.project.settings;
    this.run(this.labels.alignStep, (d) => {
      list.forEach(({ item }, i) => {
        const o = offsets[i]!;
        if (!('transform' in item) || (o.dx === 0 && o.dy === 0)) return;
        updateItem(d, item.id, {
          transform: {
            ...item.transform,
            x: item.transform.x + o.dx / width,
            y: item.transform.y + o.dy / height,
          },
        });
      });
    });
  }

  /** Opens or closes the Layers panel (left panel on desktop / tablet, the sheet on phones). */
  toggleLayers(): void {
    const s = this.ui.getState();
    if (s.layout !== 'phone') {
      this.ui.setState({
        panel: s.panel === 'layers' ? null : 'layers',
        tool: null,
        layersSelecting: false,
      });
      return;
    }
    const open = s.panel === 'layers' && s.sheetPanel;
    this.ui.setState({ panel: 'layers', sheetPanel: !open, tool: null, layersSelecting: false });
  }

  /** Opens the context menu for the selection at a point in the editor root (px). */
  openMenu(x: number, y: number): void {
    this.ui.setState({ menu: { x, y }, historyOpen: false });
  }

  closeMenu(): void {
    if (this.ui.getState().menu) this.ui.setState({ menu: null });
  }

  /** Screen-reader announcement (the toasts' live region would also show it, so a quiet one). */
  #announce(text: string): void {
    this.ui.setState({ announcement: text });
  }

  openTool(tool: ToolId | null): void {
    this.ui.setState({ tool: this.ui.getState().tool === tool ? null : tool });
  }

  openPanel(panel: PanelId | null): void {
    this.ui.setState({ panel, tool: null });
  }

  /** The ratio button: video settings live in the inspector (desktop) or the dock (phone/tablet). */
  openCanvasSettings(): void {
    if (this.ui.getState().layout === 'desktop') this.select(null);
    else this.ui.setState({ selectedId: null, tool: 'canvas', sheetPanel: false });
  }

  /** Preview mode: just the video and play controls; real fullscreen where the browser allows. */
  #root: HTMLElement | null = null;
  /** The editor's root element (preview mode's fullscreen target). */
  setRoot(root: HTMLElement | null): void {
    this.#root = root;
  }

  setPreviewMode(on: boolean): void {
    const root = this.#root;
    this.ui.setState({ previewMode: on, tool: null, sheetPanel: false });
    if (!on && typeof document !== 'undefined' && document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    if (on && root?.requestFullscreen && document.fullscreenEnabled)
      void root.requestFullscreen().catch(() => {});
  }

  #zoomHandler: ((factor: number) => void) | null = null;
  /** The timeline registers how to zoom around the playhead. */
  setZoomHandler(handler: ((factor: number) => void) | null): () => void {
    this.#zoomHandler = handler;
    return () => {
      if (this.#zoomHandler === handler) this.#zoomHandler = null;
    };
  }
  zoom(factor: number): void {
    this.#zoomHandler?.(factor);
  }

  setLayout(layout: LayoutMode): void {
    if (this.ui.getState().layout !== layout) this.ui.setState({ layout });
  }

  /** The item to split/freeze: the selection, or the main clip under the playhead. */
  /** What each action would act on now (shared with the buttons, see targets.ts). */
  targets(): Targets {
    return computeTargets(
      this.project,
      this.ui.getState().selectedId,
      this.playhead.time,
      this.labels,
    );
  }

  /** Splits the selection (or the main clip under the playhead) at the playhead. */
  split(): void {
    const { split } = this.targets();
    if (!split.item) {
      if (split.reason) this.toast(split.reason, 'info');
      return;
    }
    const item = split.item;
    const t = this.playhead.time;
    const second = this.run(this.labels.split, (d, ctx) => splitItem(d, item.id, t, ctx.ids));
    if (!second) return;
    // Show what happened: the cut flashes on the timeline and the new right half is selected.
    this.#emitCut(t);
    this.select(second);
    this.toast(this.labels.splitDone, 'success', {
      label: this.labels.undo,
      run: () => this.undo(),
    });
  }

  deleteSelected(): void {
    const items = this.selectedItems();
    const item = items[items.length - 1];
    if (!item) return;
    if (items.some((i) => this.isLocked(i.id))) {
      this.toast(this.labels.lockedReason, 'info');
      return;
    }
    const name =
      items.length > 1
        ? this.labels.selectedCount(items.length)
        : itemTitle(item, this.project.assets);
    this.run(this.labels.delete, (d) => {
      for (const i of items) deleteItem(d, i.id);
    });
    if (findItem(this.project, item.id)) return; // refused: run() said why
    this.toast(this.labels.deletedDone(name), 'info', {
      label: this.labels.undo,
      run: () => this.undo(),
    });
  }

  duplicateSelected(): void {
    const items = this.selectedItems();
    if (items.length === 0) return;
    if (items.length > 1) {
      // Several: copies of all of them, kept together as a group when they were one.
      const grouped = this.selectedGroup() !== null;
      const ids = this.run(this.labels.duplicate, (d, ctx) => {
        const made = items.map((i) => duplicateItem(d, i.id, ctx.ids));
        const lanes = made.filter((id) => !mainTrack(d).items.some((m) => m.id === id));
        if (grouped && lanes.length > 1) groupItems(d, lanes, ctx.ids);
        return made;
      });
      if (!ids) return;
      this.ui.setState({ selectedId: ids[ids.length - 1]!, selectedIds: ids });
      this.toast(this.labels.duplicatedDone, 'success', {
        label: this.labels.undo,
        run: () => this.undo(),
      });
      return;
    }
    const item = items[0]!;
    const id = this.run(this.labels.duplicate, (d, ctx) => duplicateItem(d, item.id, ctx.ids));
    if (!id) return;
    this.select(id);
    this.toast(this.labels.duplicatedDone, 'success', {
      label: this.labels.undo,
      run: () => this.undo(),
    });
  }

  freezeSelected(): void {
    const { freeze } = this.targets();
    if (!freeze.item) {
      if (freeze.reason) this.toast(freeze.reason, 'info');
      return;
    }
    const item = freeze.item;
    const id = this.run(this.labels.freeze, (d, ctx) =>
      freezeFrame(d, item.id, this.playhead.time, ctx.ids),
    );
    if (!id) return;
    this.#emitCut(this.playhead.time);
    this.select(id);
    this.toast(this.labels.frozenDone, 'success', {
      label: this.labels.undo,
      run: () => this.undo(),
    });
  }

  /** Timeline listeners for "a cut happened here" (the split flash). */
  readonly #cutListeners = new Set<(t: Time) => void>();
  onCut(listener: (t: Time) => void): () => void {
    this.#cutListeners.add(listener);
    return () => this.#cutListeners.delete(listener);
  }
  #emitCut(t: Time): void {
    for (const listener of this.#cutListeners) listener(t);
  }

  /** Copies a video's sound to an audio lane and mutes the video, so it can be edited alone. */
  extractAudio(): void {
    const item = this.selectedItem();
    if (!item || item.kind !== 'video') return;
    const asset = this.project.assets[item.assetId];
    if (!asset?.hasAudio) return;
    this.run(this.labels.extractAudio, (d, ctx) => {
      const audio = audioItem(asset, ctx.ids(), item.start);
      audio.sourceIn = item.sourceIn;
      audio.speed = item.speed;
      audio.duration = item.duration;
      audio.volume = item.volume;
      addToLane(d, audio, ctx.ids);
      updateItem(d, item.id, { muted: true });
    });
  }

  /** Sets (or clears) a clip's filter; keeps the intensity the user chose. */
  applyFilter(item: Item, filterId: string | null): void {
    const intensity = 'filter' in item && item.filter ? item.filter.intensity : 1;
    this.run(this.labels.filter, (d) =>
      updateItem(d, item.id, { filter: filterId ? { id: filterId, intensity } : null }),
    );
  }

  /** The same filter on every video and photo clip of the main track. */
  applyFilterToAll(filterId: string | null): void {
    this.run(this.labels.filter, (d) => {
      for (const clip of mainTrack(d).items) {
        if (!('filter' in clip)) continue;
        updateItem(d, clip.id, {
          filter: filterId ? { id: filterId, intensity: clip.filter?.intensity ?? 1 } : null,
        });
      }
    });
  }

  #rangeStop: (() => void) | null = null;
  /**
   * Plays `from`…`to` once and pauses (a preview after picking a transition or an animation).
   * Any user play/pause/seek in between cancels the auto-stop.
   */
  playRange(from: Time, to: Time): void {
    this.#rangeStop?.();
    this.pause();
    this.seek(Math.max(0, from));
    requestAnimationFrame(() => {
      this.play();
      const off = this.playhead.subscribe((t) => {
        if (t >= to || !this.ui.getState().playing) {
          off();
          this.#rangeStop = null;
          if (this.ui.getState().playing) this.pause();
        }
      });
      this.#rangeStop = off;
    });
  }

  /** Sets (or clears) the transition into a main-track clip. */
  applyTransition(item: Item, type: string | null, duration: Time): void {
    this.run(this.labels.transition, (d) =>
      setTransition(d, item.id, type ? { type, duration } : null),
    );
  }

  /** The same transition between every pair of main-track clips. */
  applyTransitionToAll(type: string, duration: Time): void {
    const label = this.labels.transition;
    this.run(label, (d) => {
      for (const clip of mainTrack(d).items.slice(1)) {
        try {
          setTransition(d, clip.id, { type, duration });
        } catch {
          // Clips too short for a transition keep a plain cut.
        }
      }
    });
  }

  /** Lane header toggle: mutes the main track and audio lanes, hides visual lanes. */
  toggleTrack(trackId: string): void {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const sound = track.kind === 'main' || track.kind === 'audio';
    this.run(
      sound ? (track.muted ? this.labels.unmute : this.labels.mute) : this.labels.hideLane,
      (d) => setTrackFlags(d, trackId, sound ? { muted: !track.muted } : { hidden: !track.hidden }),
    );
  }

  /** Adds an overlay/lane item at the playhead and selects it. */
  addLaneItem(label: string, make: (id: string, start: Time) => Item): void {
    const id = this.run(label, (d, ctx) => {
      const item = make(ctx.ids(), this.playhead.time);
      addToLane(d, item, ctx.ids);
      return item.id;
    });
    if (id) this.select(id);
  }

  // ── media ──────────────────────────────────────────────────────────────

  #registerMedia(asset: Asset, blob: Blob): void {
    this.media.set(asset.id, blob);
    this.analyzer?.addMedia(
      asset.id,
      blob,
      asset.kind,
      asset.audioTrack !== undefined ? { audioTrack: asset.audioTrack } : {},
    );
    void this.engine?.addMedia(asset.id, blob).catch(() => {});
  }

  /**
   * Imports files: probe (in a worker), store, register, and add to the timeline — videos and
   * photos after the clip under the playhead, audio on a lane at the playhead. Each file fails on
   * its own with a clear message.
   */
  async importFiles(
    files: readonly File[],
    options: {
      addToTimeline?: boolean;
      asSticker?: boolean;
      /** Licence / attribution line kept on the asset (library sounds). */
      credit?: string;
      /** Display name instead of the file name (library sounds: their title). */
      name?: string;
      /** Select the added sound clip (library sounds: its settings show next). */
      selectSound?: boolean;
    } = {},
  ): Promise<void> {
    const addToTimeline = options.addToTimeline ?? true;
    for (const file of files) {
      const rowId = randomId();
      this.ui.setState((s) => ({
        imports: [...s.imports, { id: rowId, name: file.name, status: 'working' }],
      }));
      const fail = (message: string) =>
        this.ui.setState((s) => ({
          imports: s.imports.map((r) => (r.id === rowId ? { ...r, status: 'error', message } : r)),
        }));
      try {
        const probe = await this.analyzer!.probe(file, file.name);
        if (!probe.ok) {
          fail(probe.message);
          continue;
        }
        for (const warning of probe.warnings)
          this.toast(`${file.name}: ${warning.message}`, 'info');
        const assetId = randomId();
        const source = await this.storage!.putMedia(assetId, file);
        const asset = assetFromProbe(probe.media, assetId, source);
        if (options.credit) asset.credit = options.credit.slice(0, 500);
        if (options.name) asset.name = options.name;
        let selectId: string | null = null;
        this.run(this.labels.addMedia, (d, ctx) => {
          addAsset(d, asset);
          if (!addToTimeline) return;
          if (options.asSticker && asset.kind === 'image') {
            const sticker = stickerItem(ctx.ids(), this.playhead.time, { assetId: asset.id });
            addToLane(d, sticker, ctx.ids);
            selectId = sticker.id;
          } else if (asset.kind === 'audio') {
            const sound = audioItem(asset, ctx.ids(), this.playhead.time);
            addToLane(d, sound, ctx.ids);
            if (options.selectSound) selectId = sound.id;
          } else {
            const main = mainTrack(d).items;
            const under = itemIndexAt(main, this.playhead.time);
            insertMain(d, visualItem(asset, ctx.ids()), under === -1 ? main.length : under + 1);
          }
        });
        this.#registerMedia(asset, file);
        if (selectId) this.select(selectId);
        this.ui.setState((s) => ({ imports: s.imports.filter((r) => r.id !== rowId) }));
      } catch (error) {
        fail(
          error instanceof StorageFullError
            ? this.labels.storageFull
            : error instanceof Error
              ? error.message
              : String(error),
        );
      }
    }
  }

  /** Adds an already-imported asset to the timeline (media panel). */
  addAssetToTimeline(assetId: string): void {
    const asset = this.project.assets[assetId];
    if (!asset) return;
    this.run(this.labels.addToTimeline, (d, ctx) => {
      if (asset.kind === 'audio') {
        addToLane(d, audioItem(asset, ctx.ids(), this.playhead.time), ctx.ids);
      } else {
        const main = mainTrack(d).items;
        const under = itemIndexAt(main, this.playhead.time);
        insertMain(d, visualItem(asset, ctx.ids()), under === -1 ? main.length : under + 1);
      }
    });
  }

  dismissImport(rowId: string): void {
    this.ui.setState((s) => ({ imports: s.imports.filter((r) => r.id !== rowId) }));
  }

  // ── sound: ducking, music & sounds library (v0.2 B) ────────────────────

  /** Why "Lower under voice" can't act on the selection now (null: it can). */
  duckReason(): string | null {
    const l = this.labels;
    const items = this.selectedItems();
    if (items.length === 0)
      return this.project.tracks.some((t) => t.items.length) ? l.duckNeedsSound : l.needClips;
    const sounding = items.filter(isSounding);
    if (sounding.length === 0) return l.duckNeedsSound;
    if (sounding.some((i) => this.isLocked(i.id))) return l.lockedReason;
    if (sounding.every((i) => i.muted)) return l.duckMuted;
    return null;
  }

  /** Turns "Lower under voice" on (default amount) or off for the selected music, sounds, clips. */
  toggleDuckSelected(): void {
    const items = this.selectedItems().filter(isSounding);
    if (items.length === 0 || this.duckReason()) return;
    const on = !items.every((i) => i.duck);
    this.run(this.labels.duck, (d) => {
      for (const item of items) updateItem(d, item.id, { duck: on ? DEFAULT_DUCK : 0 });
    });
    this.#announce(on ? this.labels.duckOn : this.labels.duckOff);
  }

  /**
   * Whether anything in the project can be heard for ducked items to lower under: a sounding
   * item (not `exceptId`, not itself ducked, not muted) whose media has sound.
   */
  hasVoiceFor(exceptId: string, project: Project = this.project): boolean {
    const p = project;
    return p.tracks.some(
      (t) =>
        !t.muted &&
        t.items.some(
          (i) =>
            isSounding(i) &&
            i.id !== exceptId &&
            !i.duck &&
            !i.muted &&
            i.volume > 0 &&
            p.assets[i.assetId]?.hasAudio !== false,
        ),
    );
  }

  /**
   * Adds a sound from the host's library at the playhead (on a sound lane) and selects it. The
   * file is stored in the project like an import; its licence line goes on the asset.
   */
  async addLibrarySound(track: AudioLibraryTrack, signal?: AbortSignal): Promise<boolean> {
    const library = this.options.audioLibrary;
    if (!library) return false;
    try {
      const blob = await library.load(track, signal ?? new AbortController().signal);
      if (signal?.aborted) return false;
      const safe = track.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Sound';
      const file = new File([blob], `${safe}.${audioExtension(blob.type)}`, {
        type: blob.type || 'audio/mpeg',
      });
      await this.importFiles([file], {
        name: track.title.slice(0, 200),
        ...(track.credit ? { credit: track.credit } : {}),
        selectSound: true,
      });
      return true;
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
        return false;
      this.toast(this.labels.soundFailed(track.title), 'error');
      return false;
    }
  }

  // ── export ─────────────────────────────────────────────────────────────

  /** Renders the project to a video file (the engine pauses preview meanwhile). */
  async exportVideo(
    options: ExportOptions,
    onProgress: (p: ExportProgress) => void,
    signal: AbortSignal,
  ): Promise<ExportResult> {
    const engine = this.engine;
    if (!engine) throw new Error(this.labels.exportUnavailable);
    this.pause();
    const result = await engine.export(options, onProgress, signal);
    for (const warning of result.warnings) this.toast(warning, 'info');
    this.options.onExport?.(result);
    return result;
  }

  // ── v0.2 D. Capture & export ───────────────────────────────────────────

  /**
   * The part to export starts at the playhead (key I). Its end stays where it was, or is the end
   * of the video when there was none (or it came before the new start).
   */
  setExportIn(): void {
    const duration = projectDuration(this.project);
    const t = Math.min(this.playhead.time, duration);
    if (duration === 0 || t >= duration) return;
    const r = this.project.settings.exportRange;
    const end = r && r.end > t && r.end <= duration ? r.end : duration;
    this.#setRange({ start: t, end }, this.labels.rangeInSet(formatClock(t)));
  }

  /** The part to export ends at the playhead (key O); its start stays, or is the video's start. */
  setExportOut(): void {
    const duration = projectDuration(this.project);
    const t = Math.min(this.playhead.time, duration);
    if (t <= 0) return;
    const r = this.project.settings.exportRange;
    const start = r && r.start < t ? r.start : 0;
    this.#setRange({ start, end: t }, this.labels.rangeOutSet(formatClock(t)));
  }

  /** Sets (or clears, `null`) the part to export as one undoable edit. */
  setExportRange(range: { start: Time; end: Time } | null): void {
    this.#setRange(range, null);
  }

  #setRange(range: { start: Time; end: Time } | null, message: string | null): void {
    const before = this.project;
    this.run(this.labels.rangeChange, (d) => setExportRange(d, range));
    if (this.project === before || !message) return;
    this.toast(message, 'success', { label: this.labels.undo, run: () => this.undo() });
  }

  /** Exports only the sound (the same mix as the video export). */
  async exportAudio(
    options: AudioExportOptions,
    onProgress: (p: ExportProgress) => void,
    signal: AbortSignal,
  ): Promise<AudioExportResult> {
    const engine = this.engine;
    if (!engine) throw new Error(this.labels.exportUnavailable);
    this.pause();
    const result = await engine.exportAudio(options, onProgress, signal);
    for (const warning of result.warnings) this.toast(warning, 'info');
    this.options.onExportAudio?.(result);
    return result;
  }

  /** Saves the frame under the playhead as a picture at the project's size. */
  async saveFrame(options: FrameImageOptions): Promise<FrameImage> {
    const engine = this.engine;
    if (!engine) throw new Error(this.labels.exportUnavailable);
    this.pause();
    const image = await engine.captureImage(this.playhead.time, options);
    this.options.onSaveFrame?.(image);
    return image;
  }

  /** Opens / closes the camera recorder (it covers the editor while open). */
  setCameraOpen(open: boolean): void {
    if (open) this.pause();
    this.ui.setState({ cameraOpen: open, tool: null, sheetPanel: false });
  }

  /**
   * Adds a finished camera recording (already streamed into storage as `assetId`): probed like an
   * import, then placed in the main video at the playhead or as a layer over it. Returns false
   * (after saying why) when the file can't be used.
   */
  async addRecording(
    file: File,
    assetId: string,
    source: Asset['source'],
    place: 'main' | 'layer',
  ): Promise<boolean> {
    if (!this.analyzer) return false;
    const probe = await this.analyzer.probe(file, file.name).catch((error: unknown) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (!probe.ok) {
      this.toast(this.labels.recordingFailed(probe.message), 'error');
      return false;
    }
    const asset = assetFromProbe(probe.media, assetId, source);
    let added: string | null = null;
    this.run(this.labels.addMedia, (d, ctx) => {
      addAsset(d, asset);
      const item = visualItem(asset, ctx.ids(), this.playhead.time);
      if (place === 'layer') {
        if ('transform' in item) item.transform = { ...item.transform, scale: LAYER_SCALE };
        addToLane(d, item, ctx.ids);
      } else {
        const main = mainTrack(d).items;
        const under = itemIndexAt(main, this.playhead.time);
        insertMain(d, item, under === -1 ? main.length : under + 1);
      }
      added = item.id;
    });
    if (!added) return false;
    this.#registerMedia(asset, file);
    this.select(added);
    this.toast(this.labels.recordingAdded, 'success', {
      label: this.labels.undo,
      run: () => this.undo(),
    });
    return true;
  }

  // ── feedback ───────────────────────────────────────────────────────────

  toast(
    message: string,
    tone: 'info' | 'error' | 'success' = 'info',
    action?: { label: string; run: () => void },
  ): void {
    const id = ++this.#toastId;
    this.ui.setState((s) => ({
      toasts: [...s.toasts.slice(-2), { id, message, tone, ...(action ? { action } : {}) }],
    }));
    // Long enough to read: ~60 ms per character, at least 3.5 s (errors 7 s).
    setTimeout(
      () => this.dismissToast(id),
      Math.max(tone === 'error' ? 7000 : 3500, message.length * 60),
    );
  }

  dismissToast(id: number): void {
    this.ui.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }

  /** Validates a host-provided project (JSON or object). */
  static parse(input: unknown): { project: Project | null; error: string | null } {
    const result = parseProject(input);
    return result.ok
      ? { project: result.project, error: null }
      : { project: null, error: result.error };
  }
}
