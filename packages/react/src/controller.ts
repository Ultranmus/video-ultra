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
  mainTrack,
  parseProject,
  projectDuration,
  projectFrame,
  randomId,
  setTrackFlags,
  setTransition,
  splitItem,
  updateItem,
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
} from '@video-ultra/core';
import {
  assetFromProbe,
  attachAutosave,
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
import { audioItem, itemTitle, stickerItem, visualItem } from './items';
import { computeTargets, type Targets } from './targets';
import type { Labels } from './labels';
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
  /** Base URL of the 3D sticker art (self-host it), or `false` to hide 3D stickers. */
  stickerLibrary?: string | false;
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
        if (generation !== this.#generation) return;
        if (blob) this.#registerMedia(asset, blob);
        else this.toast(this.labels.mediaMissing(asset.name), 'error');
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

  /**
   * Selects an item (closing any open tool, since tools belong to the selection). `keepPanel`
   * keeps the open panel/tool — used when a panel selects the clip it is about to act on.
   */
  select(itemId: string | null, options: { keepPanel?: boolean } = {}): void {
    const state = this.ui.getState();
    if (state.selectedId === itemId) return;
    if (options.keepPanel) this.ui.setState({ selectedId: itemId });
    else this.ui.setState({ selectedId: itemId, tool: null, sheetPanel: false });
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
    const item = this.selectedItem();
    if (!item) return;
    const name = itemTitle(item, this.project.assets);
    this.run(this.labels.delete, (d) => deleteItem(d, item.id));
    if (findItem(this.project, item.id)) return; // refused (e.g. locked track): run() said why
    this.toast(this.labels.deletedDone(name), 'info', {
      label: this.labels.undo,
      run: () => this.undo(),
    });
  }

  duplicateSelected(): void {
    const item = this.selectedItem();
    if (!item) return;
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
    options: { addToTimeline?: boolean; asSticker?: boolean } = {},
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
        let stickerId: string | null = null;
        this.run(this.labels.addMedia, (d, ctx) => {
          addAsset(d, asset);
          if (!addToTimeline) return;
          if (options.asSticker && asset.kind === 'image') {
            const sticker = stickerItem(ctx.ids(), this.playhead.time, { assetId: asset.id });
            addToLane(d, sticker, ctx.ids);
            stickerId = sticker.id;
          } else if (asset.kind === 'audio') {
            addToLane(d, audioItem(asset, ctx.ids(), this.playhead.time), ctx.ids);
          } else {
            const main = mainTrack(d).items;
            const under = itemIndexAt(main, this.playhead.time);
            insertMain(d, visualItem(asset, ctx.ids()), under === -1 ? main.length : under + 1);
          }
        });
        this.#registerMedia(asset, file);
        if (stickerId) this.select(stickerId);
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
