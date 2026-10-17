import {
  addAsset,
  addToLane,
  createEditor,
  createProject,
  deleteItem,
  duplicateItem,
  EditError,
  findItem,
  freezeFrame,
  insertMain,
  itemEnd,
  mainTrack,
  parseProject,
  projectDuration,
  projectFrame,
  randomId,
  splitItem,
  updateItem,
  type Asset,
  type Capabilities,
  type Editor,
  type EditContext,
  type Item,
  type Project,
  type Time,
} from '@video-ultra/core';
import { assetFromProbe, createEngine, itemIndexAt, type Engine } from '@video-ultra/core/internal';
import { produce } from 'immer';
import { audioItem, visualItem } from './items';
import type { Labels } from './labels';
import {
  attachAutosave,
  createMediaAnalyzer,
  createProjectStorage,
  StorageFullError,
  type ExportOptions,
  type ExportProgress,
  type ExportResult,
  type MediaAnalyzer,
  type ProjectStorage,
} from './pending';
import { createUiStore, Playhead, type LayoutMode, type PanelId, type ToolId } from './state';

/** Options the `<VideoEditor />` passes to its controller. */
export interface ControllerOptions {
  labels: Labels;
  backend?: 'auto' | 'webgpu' | 'webgl2';
  /** Called (debounced) after edits with the current project — the host's durable save. */
  onSave?: (project: Project) => void | Promise<void>;
  /** Called when an export finishes. */
  onExport?: (result: ExportResult) => void;
  /** Gets media bytes for assets the host stores itself (`url` sources or its own keys). */
  resolveMedia?: (asset: Asset) => Promise<Blob | null>;
  /** Keep a local autosave + crash-recovery copy in the browser (default true). */
  autosave?: boolean;
}

type ExportFn = (
  options: ExportOptions,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
) => Promise<ExportResult>;

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
        const selected = this.ui.getState().selectedId;
        if (selected && !findItem(state.project, selected)) this.select(null);
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
    this.analyzer = createMediaAnalyzer({ tier: caps.tier });
    let project = initial;
    if (!project && this.options.autosave !== false) {
      const latest = (await this.storage.listProjects())[0];
      const loaded = latest ? await this.storage.loadProject(latest.id) : null;
      if (generation !== this.#generation) return;
      if (loaded) project = loaded.project;
    }
    if (project) this.editor.load(project);
    if (this.options.autosave !== false || this.options.onSave) {
      this.#autosave = attachAutosave(this.editor, this.storage, {
        onSave: async (p) => {
          this.ui.setState({ save: 'saving' });
          await this.options.onSave?.(p);
          this.ui.setState({ save: 'saved' });
        },
        onError: (error) => this.toast(error.message, 'error'),
      });
    }
    void this.storage.status().then((s) => this.ui.setState({ persistent: s.persistent }));
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
        if (blob && generation === this.#generation) this.#registerMedia(asset, blob);
      }),
    );
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
      this.playhead.set(time);
      if (this.ui.getState().playing !== playing) this.ui.setState({ playing });
    };
    engine.onEnded = () => this.ui.setState({ playing: false });
    engine.onError = (message) => {
      // Audio problems are reported once, not as a blocking error.
      this.toast(this.labels.engineError(message), 'error');
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
    this.engine?.destroy();
    this.engine = null;
    this.analyzer?.destroy();
    this.analyzer = null;
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

  select(itemId: string | null): void {
    const state = this.ui.getState();
    if (state.selectedId === itemId) return;
    this.ui.setState({ selectedId: itemId, tool: null, sheetPanel: false });
  }

  selectedItem(): Item | null {
    const id = this.ui.getState().selectedId;
    return id ? (findItem(this.project, id)?.item ?? null) : null;
  }

  openTool(tool: ToolId | null): void {
    this.ui.setState({ tool: this.ui.getState().tool === tool ? null : tool });
  }

  openPanel(panel: PanelId | null): void {
    this.ui.setState({ panel, tool: null });
  }

  setLayout(layout: LayoutMode): void {
    if (this.ui.getState().layout !== layout) this.ui.setState({ layout });
  }

  /** The item to split/freeze: the selection, or the main clip under the playhead. */
  #targetAtPlayhead(): Item | null {
    const selected = this.selectedItem();
    if (selected) return selected;
    const items = mainTrack(this.project).items;
    return items[itemIndexAt(items, this.playhead.time)] ?? null;
  }

  split(): void {
    const item = this.#targetAtPlayhead();
    if (!item) return;
    const t = this.playhead.time;
    const frame = projectFrame(this.project);
    if (t < item.start + frame || t > itemEnd(item) - frame) {
      this.toast(this.labels.splitOutside, 'info');
      return;
    }
    const second = this.run(this.labels.split, (d, ctx) => splitItem(d, item.id, t, ctx.ids));
    if (second && this.ui.getState().selectedId) this.select(second);
  }

  deleteSelected(): void {
    const item = this.selectedItem();
    if (!item) return;
    this.run(this.labels.delete, (d) => deleteItem(d, item.id));
  }

  duplicateSelected(): void {
    const item = this.selectedItem();
    if (!item) return;
    const id = this.run(this.labels.duplicate, (d, ctx) => duplicateItem(d, item.id, ctx.ids));
    if (id) this.select(id);
  }

  freezeSelected(): void {
    const item = this.#targetAtPlayhead();
    if (!item) return;
    const id = this.run(this.labels.freeze, (d, ctx) =>
      freezeFrame(d, item.id, this.playhead.time, ctx.ids),
    );
    if (id) this.select(id);
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
    this.analyzer?.addMedia(asset.id, blob, asset.kind);
    void this.engine?.addMedia(asset.id, blob).catch(() => {});
  }

  /**
   * Imports files: probe (in a worker), store, register, and add to the timeline — videos and
   * photos after the clip under the playhead, audio on a lane at the playhead. Each file fails on
   * its own with a clear message.
   */
  async importFiles(
    files: readonly File[],
    options: { addToTimeline?: boolean } = {},
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
        this.run(this.labels.addMedia, (d, ctx) => {
          addAsset(d, asset);
          if (!addToTimeline) return;
          if (asset.kind === 'audio') {
            addToLane(d, audioItem(asset, ctx.ids(), this.playhead.time), ctx.ids);
          } else {
            const main = mainTrack(d).items;
            const under = itemIndexAt(main, this.playhead.time);
            insertMain(d, visualItem(asset, ctx.ids()), under === -1 ? main.length : under + 1);
          }
        });
        this.#registerMedia(asset, file);
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

  // ── export ─────────────────────────────────────────────────────────────

  /** The engine's export, when this build has it. */
  get exporter(): ExportFn | null {
    const engine = this.engine as (Engine & { export?: ExportFn }) | null;
    return engine?.export ? engine.export.bind(engine) : null;
  }

  async exportVideo(
    options: ExportOptions,
    onProgress: (p: ExportProgress) => void,
    signal: AbortSignal,
  ): Promise<ExportResult> {
    const exporter = this.exporter;
    if (!exporter) throw new Error(this.labels.exportUnavailable);
    this.pause();
    const result = await exporter(options, onProgress, signal);
    this.options.onExport?.(result);
    return result;
  }

  // ── feedback ───────────────────────────────────────────────────────────

  toast(message: string, tone: 'info' | 'error' | 'success' = 'info'): void {
    const id = ++this.#toastId;
    this.ui.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone }] }));
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
