import type { EditorCustomization, EditorEvent } from './embed';
import {
  applyEditActions,
  correctionRequest,
  describeProject,
  type EditingAssistant,
  type SpeechGenerator,
  addAsset,
  addToLane,
  arrangeItem,
  createEditor,
  createProject,
  deleteItem,
  duplicateItem,
  pasteItems,
  addMarker,
  removeMarker,
  setTransformAt,
  transformAt,
  applyTemplate,
  type TemplatePreset,
  type CopiedItem,
  EditError,
  findItem,
  freezeFrame,
  groupItems,
  combineItems,
  refreshCompound,
  separateItem,
  groupOf,
  insertMain,
  mainTrack,
  parseProject,
  projectDuration,
  projectFrame,
  FLICKS_PER_SECOND,
  fromSeconds,
  itemEnd,
  randomId,
  setItemFlags,
  setExportRange,
  setTrackFlags,
  setTransition,
  LAYER_SCALE,
  splitItem,
  splitItemAt,
  ungroupItems,
  updateItem,
  type ArrangeTo,
  addCaptions,
  captionTrack,
  CAPTION_PRESETS,
  formatSrt,
  formatVtt,
  groupCaptions,
  mergeCaptionWithNext,
  parseSubtitles,
  setCaptionLook,
  setCaptionText,
  markCaptionChecked,
  TRANSCRIBE_SAMPLE_RATE,
  type CaptionLookPatch,
  type SubtitleCue,
  type Transcriber,
  type BackgroundRemover,
  type BackgroundRemoverCheck,
  type TranscriberCheck,
  type Asset,
  type RegionItem,
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
  createProxyMaker,
  itemIndexAt,
  proxyHeightFor,
  type ProxyMaker,
  sceneCutTimes,
  type SceneSensitivity,
  StorageFullError,
  type Engine,
  type MediaAnalyzer,
  type ProjectStorage,
  type StoredProjectInfo,
} from '@video-ultra/core/internal';
import { produce } from 'immer';
import {
  audioItem,
  DEFAULT_DUCK,
  isSounding,
  itemTitle,
  regionItem,
  stickerItem,
  visualItem,
} from './items';
import { audioExtension, type AudioLibrary, type AudioLibraryTrack } from './library/audio-library';
import { formatClock, languageName } from './format';
import { DEFAULT_KEY, isPicture } from './picture';
import { computeTargets, type Targets } from './targets';
import type { Labels } from './labels';
import {
  createUiStore,
  Levels,
  Playhead,
  type AssistantTurn,
  type LayoutMode,
  type PanelId,
  type ToolId,
} from './state';
import { alignOffsets, distributeOffsets, type AlignEdge } from './stage/arrange';
import { itemBox, visibleItemsAt, type Box } from './stage/geometry';
import { measureText } from './stage/measure';
import { spread } from './fanout';

/** Options the `<VideoEditor />` passes to its controller. */
/** Choices for auto captions (DECISIONS #167). */
export interface CaptionOptions {
  /** Names and words that may be said, for transcribers that take them. */
  vocabulary?: readonly string[];
  /** Only this part of the video (a part heard again); its captions are replaced. */
  range?: { start: Time; end: Time };
}

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
  /**
   * Where animated emoji stickers come from (Noto Emoji Animation, CC BY 4.0): a base URL whose
   * `<code>/512.webp` files are the animations, or `false` to hide the Animated tab. Default:
   * Google's public copy. Placed stickers are stored in the project.
   */
  animatedStickerLibrary?: string | false;
  /**
   * Lighter copies of heavy videos for smooth editing (v0.4): `auto` (default) makes them for
   * videos this device would struggle with (4K; 1080p on budget phones), `always` for every
   * video over 540p, `off` never. Previews use the copy; exports always use the original.
   */
  proxies?: 'auto' | 'always' | 'off';
  /** The host's music & sound-effects source for the Audio panel. */
  audioLibrary?: AudioLibrary;
  /** Turns speech into timed words for auto captions (on-device or the host's service). */
  transcriber?: Transcriber;
  /** Host customisation: hidden tools, own panels, buttons and media sources (embed.ts). */
  customize?: EditorCustomization;
  /** Removes photo backgrounds (`createBackgroundRemover()` from `@video-ultra/ai`, or yours). */
  backgroundRemover?: BackgroundRemover;
  /** AI editing with the host's model (`createChatAssistant()` from `@video-ultra/ai`, or yours). */
  assistant?: EditingAssistant;
  /** Text to speech (`createSpeechEndpoint()` from `@video-ultra/ai`, or yours). */
  speech?: SpeechGenerator;
}

/**
 * Owns everything behind the editor UI: the core editor (project + undo), the engine worker, the
 * media analyzer, storage, UI state and the playhead. React components read from it with
 * selectors and call its methods; nothing here renders.
 */
/**
 * What ⌘C copied: shared by every editor on the page, so a copy in one project pastes into
 * another (with the media it uses). Plain objects from the project — never mutated.
 */
let clipboard: { items: CopiedItem[]; assets: Record<string, Asset> } | null = null;

/** An SVG file (by type or name — some systems send SVGs without a type). */
function isSvg(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

/** Longest side of an SVG drawn into a PNG (crisp at full-screen 4K, small enough to keep). */
const SVG_RASTER_PX = 2048;

/**
 * Draws an SVG into a PNG with transparency, at up to {@link SVG_RASTER_PX} on its longest side
 * (its own aspect; 1024 px square when it has no size).
 */
async function svgToPng(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 1024;
    const h = img.naturalHeight || 1024;
    const k = SVG_RASTER_PX / Math.max(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('SVG could not be drawn');
    return new File([blob], file.name.replace(/\.svg$/i, '') + '.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class EditorController {
  readonly editor: Editor;
  readonly ui = createUiStore();
  readonly playhead = new Playhead();
  /** Sound levels while playing (meters). */
  readonly levels = new Levels();
  readonly labels: Labels;
  readonly options: ControllerOptions;
  analyzer: MediaAnalyzer | null = null;
  storage: ProjectStorage | null = null;
  engine: Engine | null = null;
  caps: Capabilities | null = null;
  #filePicker: (() => void) | null = null;
  #pickPlace: 'playhead' | 'start' = 'playhead';
  /** Bytes of every asset, for the engine and analyzer (Files/Blobs: no copies in memory). */
  readonly media = new Map<string, Blob>();
  #disposers: (() => void)[] = [];
  #pendingSeek: Time | null = null;
  #seekScheduled = false;
  #previewProject: Project | null = null;
  #previewScheduled = false;
  readonly #previewListeners = new Set<(project: Project | null) => void>();
  #toastId = 0;
  #autosave: { flush(): Promise<void>; detach(): void } | null = null;
  /** Bumped by stop(); async work from an older start() checks it and backs out. */
  #generation = 0;

  #listeners = new Set<(event: EditorEvent) => void>();

  /** Listens to what happens in the editor (edits, selection, playback, …); returns an unsubscribe. */
  on(listener: (event: EditorEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Tells the listeners (a host's listener throwing never breaks the editor). */
  notify(event: EditorEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(error);
      }
    }
  }

  constructor(options: ControllerOptions, project?: Project) {
    this.options = options;
    this.labels = options.labels;
    this.editor = createEditor(project ?? createProject());
    this.#disposers.push(
      this.ui.subscribe((state, prev) => {
        if (!this.#listeners.size) return;
        if (state.selectedIds !== prev.selectedIds)
          this.notify({ type: 'selection', ids: state.selectedIds });
        if (state.playing !== prev.playing)
          this.notify({ type: 'playback', playing: state.playing });
        if (state.panel !== prev.panel) this.notify({ type: 'panel', id: state.panel });
      }),
      this.editor.store.subscribe((state, prev) => {
        if (state.project === prev.project || !this.#listeners.size) return;
        const { labels, position } = this.editor.history();
        this.notify({
          type: 'change',
          label: position > 0 ? (labels[position - 1] ?? null) : null,
        });
      }),
    );
    this.#disposers.push(
      this.editor.store.subscribe((state, prev) => {
        if (state.project === prev.project) return;
        // A combined clip that's open but gone (undone, separated): back out of it.
        const inside = this.ui.getState().inside;
        const gone = inside.findIndex((i) => state.project.assets[i.assetId]?.kind !== 'compound');
        if (gone !== -1) this.ui.setState({ inside: inside.slice(0, gone) });
        const shown = this.view(state.project);
        if (!this.#previewProject) void this.engine?.setProject(shown).catch(() => {});
        const { selectedId, selectedIds } = this.ui.getState();
        if (selectedId && !findItem(shown, selectedId)) this.select(null);
        else if (selectedIds.some((id) => !findItem(shown, id)))
          this.ui.setState({
            selectedIds: selectedIds.filter((id) => findItem(shown, id)),
          });
        if (this.playhead.time > projectDuration(shown)) this.seek(projectDuration(shown));
      }),
      this.ui.subscribe((state, prev) => {
        if (state.inside !== prev.inside) {
          this.#previewProject = null;
          void this.engine?.setProject(this.project).catch(() => {});
        }
        // Export is the whole video: leave any open combined clip first.
        if (state.exportOpen && !prev.exportOpen && state.inside.length) this.closeCombined(true);
      }),
    );
  }

  /** Opens the file picker (the shell registers it). */
  /** Opens the file picker; `start`: what's picked goes before the first clip. */
  pickFiles(place: 'playhead' | 'start' = 'playhead'): void {
    this.#pickPlace = place;
    this.#filePicker?.();
  }

  /** Where the files from the last `pickFiles` go (read once by the picker's change handler). */
  takePickPlace(): 'playhead' | 'start' {
    const place = this.#pickPlace;
    this.#pickPlace = 'playhead';
    return place;
  }

  /** Registers the shell's file picker; returns an unregister function. */
  setFilePicker(open: (() => void) | null): () => void {
    this.#filePicker = open;
    return () => {
      if (this.#filePicker === open) this.#filePicker = null;
    };
  }

  /** The project as the editor shows it: inside the open combined clip, if one is open. */
  get project(): Project {
    return this.view(this.editor.getProject());
  }

  readonly #views = new WeakMap<Project, { assetId: string; view: Project }>();

  /**
   * `project` as the editor shows it (DECISIONS #155): with a combined clip open, a project whose
   * tracks are its inside, drawn at its size (no markers or export range — those are the whole
   * video's). Cached per project object, so selectors stay stable.
   */
  view(project: Project): Project {
    const top = this.ui.getState().inside.at(-1);
    if (!top) return project;
    const asset = project.assets[top.assetId];
    if (!asset || asset.kind !== 'compound' || !asset.tracks) return project;
    const known = this.#views.get(project);
    if (known?.assetId === top.assetId) return known.view;
    const { exportRange: _range, ...settings } = project.settings;
    void _range;
    const { markers: _markers, ...rest } = project;
    void _markers;
    const view: Project = {
      ...rest,
      tracks: asset.tracks,
      settings: {
        ...settings,
        width: asset.width ?? settings.width,
        height: asset.height ?? settings.height,
      },
    };
    this.#views.set(project, { assetId: top.assetId, view });
    return view;
  }

  /**
   * `recipe` as it runs on the whole project while a combined clip is open: it sees the clip's
   * inside as the project's tracks; afterwards the clip (and the ones it sits in) follow their
   * new content (length, sound; clips playing them stay within it).
   */
  #scoped<F extends ((draft: Project, ctx: EditContext) => unknown) | null>(recipe: F): F {
    const chain = this.ui.getState().inside.map((i) => i.assetId);
    const assetId = chain.at(-1);
    if (!recipe || !assetId) return recipe;
    return ((draft: Project, ctx: EditContext) => {
      const scoped = new Proxy(draft, {
        get(target, key) {
          if (key === 'tracks') return target.assets[assetId]?.tracks ?? [];
          return Reflect.get(target, key);
        },
        set(target, key, value) {
          if (key === 'tracks') {
            const asset = target.assets[assetId];
            if (asset) asset.tracks = value as Project['tracks'];
            return true;
          }
          return Reflect.set(target, key, value);
        },
      });
      const result = recipe(scoped, ctx);
      for (const id of [...chain].reverse()) refreshCompound(draft, id);
      return result;
    }) as F;
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
      Object.values(this.project.assets)
        .filter((asset) => asset.kind !== 'compound')
        .map(async (asset) => {
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

  // ── your videos (DECISIONS #154) ──────────────────────────────────────

  /** The videos saved on this device, newest first (empty when the editor doesn't save here). */
  async listVideos(): Promise<StoredProjectInfo[]> {
    if (!this.storage || this.options.autosave === false) return [];
    return this.storage.listProjects().catch(() => []);
  }

  /**
   * Makes a copy of this video and opens it: the same media files (nothing is copied but the
   * project), a new name, its own history. The original stays as it was saved.
   */
  async duplicateVideo(): Promise<void> {
    const storage = this.storage;
    if (!storage || this.ui.getState().readOnly) return;
    await this.#autosave?.flush();
    const original = this.project;
    const copy: Project = {
      ...structuredClone(original),
      id: randomId(),
      name: this.labels.copyOf(original.name),
      updatedAt: new Date().toISOString(),
    };
    try {
      await storage.openWriter(copy);
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), 'error');
      return;
    }
    await this.#switchTo(copy);
    this.toast(this.labels.copyMade(copy.name), 'success', {
      label: this.labels.backToOriginal,
      run: () => void this.openVideo(original.id),
    });
  }

  /** Opens another saved video (the current one is saved first). */
  async openVideo(id: string): Promise<void> {
    const storage = this.storage;
    if (!storage || id === this.project.id) return;
    await this.#autosave?.flush();
    const loaded = await storage.loadProject(id).catch((error: unknown) => {
      this.toast(error instanceof Error ? error.message : String(error), 'error');
      return null;
    });
    if (!loaded) return;
    await this.#switchTo(loaded.project);
    for (const warning of loaded.warnings) this.toast(warning, 'info');
  }

  /** Starts a new, empty video (the current one is saved first and stays in the list). */
  async newVideo(): Promise<void> {
    if (!this.storage) return;
    await this.#autosave?.flush();
    const fresh = createProject({ name: this.labels.untitledVideo });
    await this.#switchTo(fresh);
  }

  /** Deletes a saved video other than the open one, and media only it used. */
  async deleteVideo(id: string): Promise<void> {
    if (!this.storage || id === this.project.id) return;
    await this.storage.deleteProject(id).catch((error: unknown) => {
      this.toast(error instanceof Error ? error.message : String(error), 'error');
    });
  }

  /** Puts `project` in the editor: its own lock, history and saving; its media registered. */
  async #switchTo(project: Project): Promise<void> {
    const generation = this.#generation;
    this.pause();
    this.#autosave?.detach();
    this.#autosave = null;
    this.#lock?.release();
    this.#lock = null;
    this.ui.setState({
      selectedId: null,
      selectedIds: [],
      menu: null,
      save: 'idle',
      inside: [],
    });
    this.editor.load(project);
    this.seek(0);
    if (await this.#claim(false, generation)) this.#startAutosave();
    if (generation !== this.#generation) return;
    await Promise.all(
      Object.values(project.assets)
        .filter((asset) => asset.kind !== 'compound' && !this.media.has(asset.id))
        .map(async (asset) => {
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
    engine.onTime = (time, playing, levels) => {
      this.levels.set(levels?.[0] ?? 0, levels?.[1] ?? 0);
      // A trim drag shows the edge frame without moving the playhead.
      if (this.#previewSeeking && !playing) return;
      // While paused the playhead is ours: the engine only echoes seeks we already made, a frame
      // late — applying them would pull a scrubbing timeline back and make it jitter. Time from
      // the engine counts while playing and at the moment playback stops.
      if (!playing && !this.ui.getState().playing) return;
      // Ticks sent before the engine took a pause in: stale (they'd move the playhead after a
      // pause-then-seek and mark it playing again).
      if (playing && this.#pausing !== 0) return;
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
    for (const [assetId, proxy] of this.proxies) await engine.setProxy(assetId, proxy);
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
    this.#proxyAbort.abort();
    this.#proxyAbort = new AbortController();
    this.#proxyMaker?.destroy();
    this.#proxyMaker = null;
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

  /** Non-zero from pause() until the engine has taken it in (see onTime). */
  #pausing = 0;
  #pauseSeq = 0;

  pause(): void {
    this.ui.setState({ playing: false });
    if (!this.engine) return;
    const id = ++this.#pauseSeq;
    this.#pausing = id;
    void this.engine
      .pause()
      .catch(() => {})
      .finally(() => {
        if (this.#pausing === id) this.#pausing = 0;
      });
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

  // ── editing several at once (DECISIONS #153) ─────────────────────────

  /** While set (a call through `fanOutController`), edits also reach these selected items. */
  fanOut: readonly string[] | null = null;

  /** `recipe`, spreading what it changes to the fan-out items when a fan-out is on. */
  #fanned<F extends ((draft: Project, ctx: EditContext) => unknown) | null>(recipe: F): F {
    const ids = this.fanOut;
    if (!recipe || !ids) return recipe;
    const base = this.project;
    return ((draft: Project, ctx: EditContext) => {
      const result = recipe(draft, ctx);
      spread(base, draft, ids, ctx);
      return result;
    }) as F;
  }

  // ── transient previews (drags) ─────────────────────────────────────────

  /**
   * Shows a not-yet-committed version of the project in the preview (stage drags, sliders before
   * release). Nothing is written to the store or the undo history. Coalesced per frame.
   */
  preview(recipe: ((draft: Project, ctx: EditContext) => void) | null): Project | null {
    recipe = this.#fanned(recipe);
    if (!recipe) {
      if (this.#previewProject) {
        void this.engine?.setProject(this.project).catch(() => {});
        this.#previewProject = null;
        for (const fn of this.#previewListeners) fn(null);
      }
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
      const shown = this.#previewProject;
      if (!shown) return;
      void this.engine?.setProject(shown).catch(() => {});
      for (const fn of this.#previewListeners) fn(shown);
    });
    return this.#previewProject;
  }

  /**
   * Called (at most once a frame) with each preview shown, and with `null` when it ends. For views
   * that follow the picture while a slider or drag is in progress; returns an unsubscribe.
   */
  onPreview(fn: (project: Project | null) => void): () => void {
    this.#previewListeners.add(fn);
    return () => this.#previewListeners.delete(fn);
  }

  // ── editing ────────────────────────────────────────────────────────────

  /** Runs an edit; refused edits show their reason instead of throwing. */
  run<R>(
    label: string,
    recipe: (draft: Project, ctx: EditContext) => R,
    options?: { coalesceKey?: string },
  ): R | undefined {
    recipe = this.#scoped(this.#fanned(recipe));
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
    // Picking a green-screen colour belongs to the item it was started for.
    if (state.picking && state.picking !== primary) this.ui.setState({ picking: null });
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

  // ── combined clips (DECISIONS #155) ─────────────────────────────────────

  /** Whether `item` plays a combined clip. */
  isCombined(item: Item | null | undefined): boolean {
    return (
      !!item && item.kind === 'video' && this.project.assets[item.assetId]?.kind === 'compound'
    );
  }

  /** Why the selection can't be combined (null = it can). */
  combineReason(): string | null {
    const items = this.selectedItems();
    if (items.length < 2) return this.labels.combineNeedsTwo;
    if (items.some((i) => findItem(this.project, i.id)?.track.kind === 'caption'))
      return this.labels.combineNoCaptions;
    const main = mainTrack(this.project).items;
    const at = items
      .map((i) => main.indexOf(i))
      .filter((i) => i !== -1)
      .sort((a, b) => a - b);
    if (at.some((v, k) => k > 0 && v !== at[k - 1]! + 1)) return this.labels.combineNextToEach;
    return null;
  }

  /** Combines the selection into one clip and selects it. */
  combineSelected(): void {
    const reason = this.combineReason();
    if (reason) {
      this.toast(reason, 'info');
      return;
    }
    const ids = this.ui.getState().selectedIds;
    const count = Object.values(this.project.assets).filter((a) => a.kind === 'compound').length;
    const id = this.run(this.labels.combine, (d, ctx) =>
      combineItems(d, ids, ctx.ids, this.labels.combinedName(count + 1)),
    );
    if (!id) return;
    this.select(id);
    this.#announce(this.labels.combinedDone(ids.length));
  }

  /**
   * Opens a combined clip to edit its inside (the selected one, or `itemId`): the timeline shows
   * what's in it, the playhead at the same moment of it. Edits change every place that plays it.
   */
  openCombined(itemId?: string): void {
    const item = itemId ? findItem(this.project, itemId)?.item : this.selectedItem();
    if (!item || item.kind !== 'video' || !this.isCombined(item)) return;
    const asset = this.project.assets[item.assetId]!;
    const outerTime = this.playhead.time;
    const local = Math.round(
      item.sourceIn + Math.max(0, Math.min(item.duration, outerTime - item.start)) * item.speed,
    );
    this.pause();
    this.ui.setState((s) => ({
      inside: [...s.inside, { assetId: asset.id, itemId: item.id, name: asset.name, outerTime }],
      selectedId: null,
      selectedIds: [],
      menu: null,
    }));
    this.seek(Math.min(local, Math.max(0, asset.duration - 1)));
    this.#announce(this.labels.insideCombined(asset.name));
  }

  /** Back out of the open combined clip (`all`: back to the timeline itself). */
  closeCombined(all = false): void {
    const inside = this.ui.getState().inside;
    const top = inside.at(-1);
    if (!top) return;
    const outer = all ? inside[0]! : top;
    this.pause();
    this.ui.setState({
      inside: all ? [] : inside.slice(0, -1),
      selectedId: null,
      selectedIds: [],
      menu: null,
    });
    this.seek(outer.outerTime);
    if (findItem(this.project, outer.itemId)) this.select(outer.itemId);
  }

  /** Puts the selected combined clip's pieces back on the timeline. */
  separateSelected(): void {
    const item = this.selectedItem();
    if (!item || !this.isCombined(item)) return;
    const ids = this.run(this.labels.separate, (d, ctx) => separateItem(d, item.id, ctx.ids));
    if (!ids) return;
    this.ui.setState({ selectedId: ids[0] ?? null, selectedIds: ids });
    this.#announce(this.labels.separatedDone(ids.length));
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
      const box = itemBox(item, this.project, width, height, measureText, this.playhead.time);
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
        const at = this.playhead.time;
        const tf = transformAt(item, at)!;
        setTransformAt(d, item.id, { ...tf, x: tf.x + o.dx / width, y: tf.y + o.dy / height }, at);
      });
    });
  }

  /**
   * Opens or closes Layers or History (top bar): the left panel on desktop / tablet, the sheet on
   * phones.
   */
  toggleSidePanel(id: 'layers' | 'history'): void {
    const s = this.ui.getState();
    if (s.layout !== 'phone') {
      this.ui.setState({
        panel: s.panel === id ? null : id,
        tool: null,
        layersSelecting: false,
      });
      return;
    }
    const open = s.panel === id && s.sheetPanel;
    this.ui.setState({ panel: id, sheetPanel: !open, tool: null, layersSelecting: false });
  }

  /** Opens the context menu for the selection at a point in the editor root (px). */
  openMenu(x: number, y: number): void {
    this.ui.setState({ menu: { x, y } });
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

  /** Copies the selection (and the media it uses) for {@link paste}. */
  copySelected(): number {
    const items = this.selectedItems();
    if (items.length === 0) return 0;
    const main = mainTrack(this.project);
    const assets: Record<string, Asset> = {};
    for (const item of items) {
      const ids = [
        'assetId' in item ? item.assetId : null,
        'lut' in item && item.lut ? item.lut.assetId : null,
        'cutout' in item && item.cutout ? item.cutout.assetId : null,
      ];
      for (const id of ids) if (id && this.project.assets[id]) assets[id] = this.project.assets[id];
    }
    clipboard = {
      items: items.map((item) => ({ item, fromMain: main.items.includes(item) })),
      assets,
    };
    this.toast(this.labels.copiedDone(items.length), 'success');
    return items.length;
  }

  /** Copies the selection, then deletes it. */
  cutSelected(): void {
    if (this.copySelected() === 0) return;
    this.deleteSelected();
  }

  /** Whether {@link paste} has something to paste. */
  hasClipboard(): boolean {
    return clipboard !== null;
  }

  /** Pastes what was copied at the playhead, and selects it. */
  paste(): void {
    const copied = clipboard;
    if (!copied) {
      this.toast(this.labels.nothingToPaste, 'info');
      return;
    }
    const at = this.playhead.time;
    const ids = this.run(this.labels.paste, (d, ctx) =>
      pasteItems(d, copied.items, copied.assets, at, ctx.ids),
    );
    if (!ids?.length) return;
    this.ui.setState({ selectedId: ids[ids.length - 1]!, selectedIds: ids, tool: null });
    this.toast(this.labels.pastedDone, 'success', {
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
      // The sound keeps what was done to it on the video: fades, effects, lowering under voice.
      audio.fadeIn = item.fadeIn;
      audio.fadeOut = item.fadeOut;
      if (item.audioFx) audio.audioFx = structuredClone(item.audioFx);
      if (item.duck) audio.duck = item.duck;
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

  /**
   * Gives every video and photo (main track and layers) the look of `from`: its filter at its
   * strength, and its LUT look. Locked ones are left alone. Returns how many changed.
   */
  applyFilterToAll(from: Item): number {
    const filter = 'filter' in from ? from.filter : null;
    const lut = isPicture(from) ? (from.lut ?? null) : undefined;
    let count = 0;
    this.run(this.labels.filter, (d) => {
      for (const track of d.tracks) {
        if (track.kind === 'audio' || track.locked) continue;
        for (const clip of track.items) {
          if (!isPicture(clip) || clip.locked) continue;
          updateItem(d, clip.id, {
            filter: filter ? { ...filter } : null,
            ...(lut === undefined ? {} : { lut: lut ? { ...lut } : null }),
          });
          count++;
        }
      }
    });
    return count;
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
  /** Adds a marker at the playhead (key M) — or removes the one that's there. */
  addMarkerHere(): void {
    const at = this.playhead.time;
    const half = projectFrame(this.project) / 2;
    const there = this.project.markers?.find((m) => Math.abs(m.time - at) <= half);
    if (there) {
      this.run(this.labels.removeMarker, (d) => removeMarker(d, there.id));
      return;
    }
    const id = this.run(this.labels.addMarker, (d, ctx) => addMarker(d, at, ctx.ids));
    if (!id) return;
    this.toast(this.labels.markerAdded(formatClock(at)), 'success', {
      label: this.labels.undo,
      run: () => this.undo(),
    });
  }

  /** The nearest marker after (1) or before (−1) the playhead, or null. */
  markerNear(direction: 1 | -1): Time | null {
    const t = this.playhead.time;
    const frame = projectFrame(this.project);
    const list = this.project.markers ?? [];
    const hit =
      direction === 1
        ? list.find((m) => m.time > t + frame / 2)
        : [...list].reverse().find((m) => m.time < t - frame / 2);
    return hit ? hit.time : null;
  }

  /** Adds a template at the playhead (one group) and selects it. */
  addTemplate(template: TemplatePreset, values: Readonly<Record<string, string>>): void {
    const at = this.playhead.time;
    const ids = this.run(this.labels.templates, (d, ctx) =>
      applyTemplate(d, template, values, at, ctx.ids),
    );
    if (!ids?.length) return;
    this.ui.setState({ selectedId: ids[ids.length - 1]!, selectedIds: ids, tool: null });
    // Entrances start invisible: show the template once it's in.
    this.seek(at + Math.min(fromSeconds(1.2), fromSeconds(template.duration / 2)));
    this.toast(this.labels.templateAdded, 'success', {
      label: this.labels.undo,
      run: () => this.undo(),
    });
  }

  addLaneItem(label: string, make: (id: string, start: Time) => Item): void {
    const id = this.run(label, (d, ctx) => {
      const item = make(ctx.ids(), this.playhead.time);
      addToLane(d, item, ctx.ids);
      return item.id;
    });
    if (id) this.select(id);
  }

  // ── media ──────────────────────────────────────────────────────────────

  readonly #mediaWaiters = new Map<string, (() => void)[]>();

  /**
   * Resolves once an asset's file is attached (the analyzer and engine have it): at once if it
   * is, else when it arrives. A project opens before its media is read back from storage, so
   * thumbnails wait for this instead of asking too early. Resolves (no wait) if `signal` aborts.
   */
  whenMedia(assetId: string, signal?: AbortSignal): Promise<void> {
    if (this.media.has(assetId) || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.#mediaWaiters.get(assetId) ?? [];
      list.push(resolve);
      this.#mediaWaiters.set(assetId, list);
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  #registerMedia(asset: Asset, blob: Blob): void {
    // A combined clip has no file (the engine draws it from its inside).
    if (asset.kind === 'compound') return;
    this.media.set(asset.id, blob);
    // LUT files are read by the engine only (no thumbnails or sound to analyse).
    if (asset.kind !== 'lut')
      this.analyzer?.addMedia(
        asset.id,
        blob,
        asset.kind,
        asset.audioTrack !== undefined ? { audioTrack: asset.audioTrack } : {},
      );
    void this.engine?.addMedia(asset.id, blob).catch(() => {});
    if (asset.kind === 'video') void this.#ensureProxy(asset, blob);
    const waiters = this.#mediaWaiters.get(asset.id);
    this.#mediaWaiters.delete(asset.id);
    for (const resolve of waiters ?? []) resolve();
  }

  // ── proxies (v0.4) ─────────────────────────────────────────────────────

  /** Lighter copies in use for previews, by asset id (device-local, not in the project). */
  readonly proxies = new Map<string, File>();
  #proxyMaker: ProxyMaker | null = null;
  #proxyAbort = new AbortController();

  /** Finds or makes the proxy a heavy video needs on this device, then previews from it. */
  async #ensureProxy(asset: Asset, blob: Blob): Promise<void> {
    const mode = this.options.proxies ?? 'auto';
    if (mode === 'off' || asset.kind !== 'video' || asset.hdr || this.proxies.has(asset.id)) return;
    if (!asset.width || !asset.height || typeof Worker === 'undefined') return;
    const turned = asset.rotation === 90 || asset.rotation === 270;
    const w = turned ? asset.height : asset.width;
    const h = turned ? asset.width : asset.height;
    const height =
      mode === 'always'
        ? Math.min(w, h) > 540
          ? 540
          : null
        : proxyHeightFor(w, h, this.caps?.tier ?? 'mid');
    if (!height) return;
    const maker = (this.#proxyMaker ??= createProxyMaker(this.caps?.tier ?? 'mid'));
    const signal = this.#proxyAbort.signal;
    let file = await maker.find(asset.id, height);
    if (!file) {
      if (signal.aborted) return;
      this.ui.setState((s) => ({ proxyJobs: { ...s.proxyJobs, [asset.id]: 0 } }));
      this.toast(this.labels.makingProxy(asset.name), 'info');
      try {
        file = await maker.make(asset.id, blob, height, {
          signal,
          onProgress: (done) =>
            this.ui.setState((s) =>
              asset.id in s.proxyJobs ? { proxyJobs: { ...s.proxyJobs, [asset.id]: done } } : {},
            ),
        });
      } finally {
        this.ui.setState((s) => {
          const rest = { ...s.proxyJobs };
          Reflect.deleteProperty(rest, asset.id);
          return { proxyJobs: rest };
        });
      }
    }
    if (!file || signal.aborted || !this.media.has(asset.id)) return;
    this.proxies.set(asset.id, file);
    await this.engine?.setProxy(asset.id, file).catch(() => {});
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
      /** Videos and photos go before the first clip (in the order given), not at the playhead. */
      atStart?: boolean;
      /** Sounds go here instead of the playhead (a voiceover: where its recording started). */
      at?: Time;
    } = {},
  ): Promise<void> {
    const addToTimeline = options.addToTimeline ?? true;
    let startIndex = 0;
    for (const original of files) {
      const rowId = randomId();
      // SVG: drawn once into a PNG here (the engine worker can't decode SVG).
      let file = original;
      if (isSvg(original)) {
        try {
          file = await svgToPng(original);
        } catch {
          this.ui.setState((s) => ({
            imports: [
              ...s.imports,
              {
                id: rowId,
                name: original.name,
                status: 'error',
                message: this.labels.svgFailed(original.name),
              },
            ],
          }));
          continue;
        }
      }
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
            const sound = audioItem(asset, ctx.ids(), options.at ?? this.playhead.time);
            addToLane(d, sound, ctx.ids);
            if (options.selectSound) selectId = sound.id;
          } else {
            const main = mainTrack(d).items;
            const under = itemIndexAt(main, this.playhead.time);
            const at = options.atStart
              ? Math.min(startIndex++, main.length)
              : under === -1
                ? main.length
                : under + 1;
            insertMain(d, visualItem(asset, ctx.ids()), at);
          }
        });
        this.#registerMedia(asset, file);
        this.notify({ type: 'import', assetId: asset.id, name: asset.name });
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

  // ── picture tools (v0.2 C) ─────────────────────────────────────────────

  /** Adds a blurred or pixelated box / oval at the playhead, selected (it can be dragged at once). */
  addRegion(effect: RegionItem['effect'], shape: RegionItem['shape']): void {
    const l = this.labels;
    const { width, height } = this.project.settings;
    const name =
      effect === 'pixelate'
        ? shape === 'ellipse'
          ? l.pixelateOval
          : l.pixelateBox
        : shape === 'ellipse'
          ? l.blurOval
          : l.blurBox;
    this.addLaneItem(l.addBlurArea, (id, start) => ({
      ...regionItem(id, start, effect, shape, width, height),
      name,
    }));
  }

  /**
   * Green screen "pick from video": the next tap on the stage picks `itemId`'s key colour
   * (`null` stops picking).
   */
  startPicking(itemId: string | null): void {
    this.ui.setState({ picking: itemId });
    if (itemId) this.#announce(this.labels.pickingHint);
  }

  /**
   * Picks the key colour of the item being picked for, at canvas point `x, y` (fractions): the
   * picture's own colour there (without its green screen), from the engine.
   */
  async pickKeyColour(x: number, y: number): Promise<void> {
    const l = this.labels;
    const itemId = this.ui.getState().picking;
    this.ui.setState({ picking: null });
    const engine = this.engine;
    if (!itemId || !engine) return;
    const color = await engine.pickColour(itemId, this.playhead.time, x, y).catch(() => null);
    if (!color) {
      this.toast(l.pickMissed, 'info');
      return;
    }
    const item = findItem(this.project, itemId)?.item;
    if (!isPicture(item)) return;
    this.run(l.greenScreen, (d) =>
      updateItem(d, itemId, { key: { ...(item.key ?? DEFAULT_KEY), color } }),
    );
    this.#announce(l.pickedColour(color.toUpperCase()));
  }

  /**
   * Imports a `.cube` LUT: checked in the engine worker (clear message when it can't be used),
   * stored like media (never inlined in the project), added as a `lut` asset and applied to
   * `itemId` when that is a picture.
   */
  async importLut(file: File, itemId: string | null): Promise<void> {
    const l = this.labels;
    const name = file.name;
    if (!/\.cube$/i.test(name)) {
      this.toast(l.lutFailed(name, l.lutNotFile), 'error');
      return;
    }
    const engine = this.engine;
    const storage = this.storage;
    if (!engine || !storage) {
      this.toast(l.lutUnavailable, 'error');
      return;
    }
    this.#announce(l.lutImporting(name));
    try {
      const info = await engine.checkLut(file);
      const assetId = randomId();
      const source = await storage.putMedia(assetId, file);
      const asset: Asset = {
        id: assetId,
        kind: 'lut',
        name: name.replace(/\.cube$/i, '') || info.title || name,
        mimeType: 'text/plain',
        size: file.size,
        duration: 0,
        hasAudio: false,
        source,
      };
      this.run(l.lutStep, (d) => {
        addAsset(d, asset);
        const target = itemId ? findItem(d, itemId)?.item : null;
        if (isPicture(target) && !this.isLocked(target.id))
          updateItem(d, target.id, { lut: { assetId, intensity: 1 } });
      });
      this.#registerMedia(asset, file);
      this.toast(l.lutAdded(asset.name), 'success');
    } catch (error) {
      this.toast(
        l.lutFailed(
          name,
          error instanceof StorageFullError
            ? l.storageFull
            : error instanceof Error
              ? error.message
              : String(error),
        ),
        'error',
      );
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
    this.notify({ type: 'export', phase: 'start' });
    let result: ExportResult;
    try {
      result = await engine.export(options, onProgress, signal);
    } catch (error) {
      this.notify({ type: 'export', phase: signal.aborted ? 'cancelled' : 'error' });
      throw error;
    }
    this.notify({ type: 'export', phase: 'done' });
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

  // ── background removal (v0.3) ────────────────────────────────────────────

  #cutoutAbort: AbortController | null = null;

  /** Whether background removal can run here (null: the host gave no remover). */
  async checkBackgroundRemoval(): Promise<BackgroundRemoverCheck | null> {
    const r = this.options.backgroundRemover;
    if (!r) return null;
    return (await r.check?.().catch(() => null)) ?? { available: true, onDevice: false };
  }

  /**
   * Removes the background of a photo or image sticker: the remover makes a transparent copy,
   * stored as a new image the item shows instead (its own image stays: Restore takes the copy
   * away). One undo step. Progress is in `ui.cutoutJob`; `cancelBackgroundRemoval()` stops it.
   */
  readonly #stickerBackground = new Map<string, boolean | null>();

  /**
   * Whether a sticker image has a background to remove: not when it's animated (a cut-out is one
   * still picture — the animation would stop) or already see-through at its edges (library
   * stickers, cut-out logos). `null` while not known yet: the check runs once per asset, off the
   * main thread's way (header bytes, a 48 px decode), and bumps `stickerChecks` when done.
   */
  stickerHasBackground(assetId: string): boolean | null {
    if (this.#stickerBackground.has(assetId)) return this.#stickerBackground.get(assetId)!;
    this.#stickerBackground.set(assetId, null);
    const asset = this.project.assets[assetId];
    void (async () => {
      const blob =
        this.media.get(assetId) ??
        (asset ? await this.options.resolveMedia?.(asset).catch(() => null) : null) ??
        (asset ? await this.storage?.getMedia(asset).catch(() => null) : null);
      const has = blob ? await hasBackground(blob).catch(() => true) : true;
      this.#stickerBackground.set(assetId, has);
      this.ui.setState((s) => ({ stickerChecks: s.stickerChecks + 1 }));
    })();
    return null;
  }

  async removeBackground(itemId: string): Promise<void> {
    const remover = this.options.backgroundRemover;
    const l = this.labels;
    const found = findItem(this.project, itemId)?.item;
    const assetId =
      found && (found.kind === 'image' || found.kind === 'sticker') ? found.assetId : null;
    const asset = assetId ? this.project.assets[assetId] : undefined;
    if (!remover || !asset || !this.storage) return;
    const blob =
      this.media.get(asset.id) ??
      (await this.options.resolveMedia?.(asset).catch(() => null)) ??
      (await this.storage.getMedia(asset).catch(() => null));
    if (!blob) {
      this.toast(l.mediaMissing(asset.name), 'error');
      return;
    }
    this.#cutoutAbort?.abort();
    const abort = new AbortController();
    this.#cutoutAbort = abort;
    this.ui.setState({ cutoutJob: { itemId, stage: 'work', fraction: 0 } });
    try {
      const png = await remover.remove({
        image: blob,
        signal: abort.signal,
        onProgress: (p) =>
          this.ui.setState({ cutoutJob: { itemId, stage: p.stage, fraction: p.fraction } }),
      });
      if (abort.signal.aborted) return;
      const name = `${asset.name.replace(/\.[^.]+$/, '')} (no background).png`;
      const file = new File([png], name, { type: 'image/png' });
      const probe = await this.analyzer!.probe(file, name);
      if (!probe.ok) throw new Error(probe.message);
      const cutId = randomId();
      const source = await this.storage.putMedia(cutId, file);
      const cutAsset = assetFromProbe(probe.media, cutId, source);
      this.run(l.removeBackground, (d) => {
        addAsset(d, cutAsset);
        updateItem(d, itemId, { cutout: { assetId: cutId } });
      });
      this.#registerMedia(cutAsset, file);
      this.toast(l.backgroundRemoved, 'success', { label: l.undo, run: () => this.undo() });
    } catch (error) {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError'))
        return;
      this.toast(
        error instanceof StorageFullError
          ? l.storageFull
          : l.backgroundFailed(error instanceof Error ? error.message : String(error)),
        'error',
      );
    } finally {
      if (this.#cutoutAbort === abort) {
        this.#cutoutAbort = null;
        this.ui.setState({ cutoutJob: null });
      }
    }
  }

  cancelBackgroundRemoval(): void {
    this.#cutoutAbort?.abort();
    this.#cutoutAbort = null;
    this.ui.setState({ cutoutJob: null });
  }

  /** Shows the photo's own background again. */
  restoreBackground(itemId: string): void {
    this.run(this.labels.restoreBackground, (d) => updateItem(d, itemId, { cutout: null }));
  }

  // ── text to speech (v0.4) ──────────────────────────────────────────────

  #speechAbort: AbortController | null = null;

  /**
   * Speaks `text` with the host's voice service and adds it as a sound clip at `at` (default:
   * the playhead). Progress: `ui.speechBusy`. Returns false when it failed or was stopped.
   */
  async speak(
    text: string,
    options: { voice?: string; speed?: number; at?: number } = {},
  ): Promise<boolean> {
    const speech = this.options.speech;
    const words = text.trim();
    if (!speech || !words) return false;
    const l = this.labels;
    this.#speechAbort?.abort();
    const abort = new AbortController();
    this.#speechAbort = abort;
    this.ui.setState({ speechBusy: true });
    try {
      const voice = options.voice ?? (await speech.voices())[0]?.id ?? 'default';
      const audio = await speech.speak({
        text: words,
        voice,
        speed: options.speed ?? 1,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return false;
      const extension = /wav/.test(audio.type)
        ? 'wav'
        : /ogg|opus/.test(audio.type)
          ? 'ogg'
          : /aac|mp4/.test(audio.type)
            ? 'm4a'
            : 'mp3';
      const short =
        words.length > 32 ? `${words.slice(0, 32).trimEnd()}…` : words.replace(/[.!?\s]+$/, '');
      const name = `${l.voiceFile} · ${short}.${extension}`;
      if (options.at !== undefined) this.seek(options.at);
      await this.importFiles([new File([audio], name, { type: audio.type })], {
        selectSound: true,
      });
      return true;
    } catch (error) {
      if (!abort.signal.aborted)
        this.toast(l.speechFailed(error instanceof Error ? error.message : String(error)), 'error');
      return false;
    } finally {
      if (this.#speechAbort === abort) {
        this.#speechAbort = null;
        this.ui.setState({ speechBusy: false });
      }
    }
  }

  /** Stops a running {@link speak}. */
  cancelSpeech(): void {
    this.#speechAbort?.abort();
    this.#speechAbort = null;
    this.ui.setState({ speechBusy: false });
  }

  // ── AI editing (v0.4) ───────────────────────────────────────────────────

  #assistantAbort: AbortController | null = null;
  #assistantTurn = 0;

  /**
   * Sends `instruction` to the host's assistant with a description of the project, then applies
   * the edits it answers with as one undo step — all of them or, if one is invalid, none (the
   * reason shows in the conversation). Returns the turn.
   */
  async askAssistant(instruction: string): Promise<AssistantTurn | null> {
    const assistant = this.options.assistant;
    const text = instruction.trim();
    if (!assistant || !text) return null;
    this.#assistantAbort?.abort();
    const abort = new AbortController();
    this.#assistantAbort = abort;
    this.ui.setState({ assistantBusy: true });
    const l = this.labels;
    const state = this.ui.getState();
    let turn: AssistantTurn = {
      id: ++this.#assistantTurn,
      instruction: text,
      reply: '',
      applied: 0,
      error: null,
    };
    try {
      const history = state.assistantTurns
        .slice(-6)
        .map((t) => ({ instruction: t.instruction, reply: t.reply }));
      let ask = text;
      // A rejected answer gets one second try: the model reads why and answers again.
      for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await assistant.edit({
          instruction: ask,
          project: describeProject(this.project),
          selection: [...state.selectedIds],
          playhead: this.playhead.time / FLICKS_PER_SECOND,
          history,
          signal: abort.signal,
        });
        if (abort.signal.aborted) return null;
        turn = { ...turn, reply: answer.reply, error: null };
        if (answer.actions.length === 0) break;
        try {
          this.editor.apply(l.assistantEdit(text), (d, ctx) =>
            applyEditActions(d, answer.actions, ctx.ids),
          );
          turn = { ...turn, applied: answer.actions.length, after: this.editor.getProject() };
          this.toast(l.assistantApplied(answer.actions.length), 'success', {
            label: l.undo,
            run: () => this.undo(),
          });
          break;
        } catch (error) {
          const why = error instanceof EditError ? error.message : String(error);
          turn = { ...turn, error: why };
          history.push({ instruction: ask, reply: answer.reply });
          ask = correctionRequest(text, why);
        }
      }
    } catch (error) {
      if (abort.signal.aborted) return null;
      // Busy or rate limited (the model's service, not this request): say so plainly.
      const status = (error as { status?: unknown } | null)?.status;
      const busy = status === 429 || status === 503 || status === 529;
      turn = {
        ...turn,
        error: busy
          ? l.assistantBusyRetry
          : l.assistantFailed(error instanceof Error ? error.message : String(error)),
      };
    } finally {
      if (this.#assistantAbort === abort) {
        this.#assistantAbort = null;
        this.ui.setState({ assistantBusy: false });
      }
    }
    this.ui.setState((s) => ({ assistantTurns: [...s.assistantTurns, turn] }));
    return turn;
  }

  /**
   * Undoes an assistant turn's changes — only while they're still the latest step (otherwise
   * undo would take back something else). Returns whether it did.
   */
  undoAssistantTurn(id: number): boolean {
    const turn = this.ui.getState().assistantTurns.find((t) => t.id === id);
    if (!turn?.after || turn.undone || turn.after !== this.editor.getProject()) return false;
    this.undo();
    this.ui.setState((s) => ({
      assistantTurns: s.assistantTurns.map((t) => (t.id === id ? { ...t, undone: true } : t)),
    }));
    return true;
  }

  /** Stops a request to the assistant. */
  cancelAssistant(): void {
    this.#assistantAbort?.abort();
    this.#assistantAbort = null;
    this.ui.setState({ assistantBusy: false });
  }

  // ── scene detection (v0.4) ──────────────────────────────────────────────

  #sceneAbort: AbortController | null = null;

  /**
   * Finds where the scenes change in a video clip (in the analyzer worker, frame by frame) and
   * splits the clip there — one undo step. Progress is in `ui.sceneJob`. Returns the number of
   * parts (1 = no scene changes), or `null` when stopped or the video couldn't be read.
   */
  async splitAtScenes(
    itemId: string,
    sensitivity: SceneSensitivity = 'normal',
  ): Promise<number | null> {
    const l = this.labels;
    const item = findItem(this.project, itemId)?.item;
    if (!item || item.kind !== 'video' || !this.analyzer) return null;
    this.#sceneAbort?.abort();
    const abort = new AbortController();
    this.#sceneAbort = abort;
    this.ui.setState({ sceneJob: { itemId, fraction: 0 } });
    try {
      const from = item.sourceIn / FLICKS_PER_SECOND;
      const cuts = await this.analyzer.scenes(item.assetId, {
        from,
        to: from + (item.duration * item.speed) / FLICKS_PER_SECOND,
        sensitivity,
        signal: abort.signal,
        onProgress: (fraction) => {
          if (!abort.signal.aborted) this.ui.setState({ sceneJob: { itemId, fraction } });
        },
      });
      if (abort.signal.aborted) return null;
      if (!cuts) {
        this.toast(l.scenesFailed, 'error');
        return null;
      }
      // The clip may have changed while the worker looked: map onto it as it is now.
      const now = findItem(this.project, itemId)?.item;
      if (!now || now.kind !== 'video') return null;
      const times = sceneCutTimes(cuts, now, FLICKS_PER_SECOND, projectFrame(this.project));
      if (times.length === 0) {
        this.toast(l.noScenesFound, 'info');
        return 1;
      }
      const parts = this.run(l.splitAtScenes, (d, ctx) => splitItemAt(d, itemId, times, ctx.ids));
      if (!parts) return null;
      this.toast(l.scenesSplit(parts.length), 'success', { label: l.undo, run: () => this.undo() });
      return parts.length;
    } finally {
      if (this.#sceneAbort === abort) {
        this.#sceneAbort = null;
        this.ui.setState({ sceneJob: null });
      }
    }
  }

  /** Stops a running {@link splitAtScenes}. */
  cancelSceneDetection(): void {
    this.#sceneAbort?.abort();
    this.#sceneAbort = null;
    this.ui.setState({ sceneJob: null });
  }

  // ── captions (v0.2 A) ──────────────────────────────────────────────────

  #captionAbort: AbortController | null = null;

  /** Whether auto captions can run, and what they'd take, for `language`. */
  async checkCaptions(language: string): Promise<TranscriberCheck | null> {
    const t = this.options.transcriber;
    if (!t) return null;
    return (await t.check?.(language).catch(() => null)) ?? { available: true, onDevice: false };
  }

  /** The last auto captions' choices, for hearing a part again the same way. */
  #captionRequest: { language: string } & CaptionOptions = { language: 'auto' };

  /**
   * Auto captions: the video's speech (music lowered under voice is left out, so the words come
   * through) goes to the transcriber piece by piece; the words become captions that replace any
   * there were — only those in `options.range` when it's given (a part heard again). One undo
   * step. Progress is in `ui.captionJob`; `cancelCaptions()` stops it.
   */
  async autoCaptions(language: string, options: CaptionOptions = {}): Promise<void> {
    const transcriber = this.options.transcriber;
    const engine = this.engine;
    const l = this.labels;
    if (!transcriber || !engine) return;
    const { range, ...choices } = options;
    if (!range) this.#captionRequest = { language, ...choices };
    const from = range ? Math.max(0, range.start) : 0;
    const total = projectDuration(this.project);
    const to = range ? Math.min(total, range.end) : total;
    const duration = to - from;
    if (duration <= 0) {
      this.toast(l.needClips, 'info');
      return;
    }
    this.#captionAbort?.abort();
    const abort = new AbortController();
    this.#captionAbort = abort;
    this.ui.setState({ captionJob: { stage: 'listen', fraction: 0 } });
    const speech = produce(this.project, (d) => {
      for (const track of d.tracks)
        track.items = track.items.filter((i) => !('duck' in i && i.duck));
    });
    const seconds = duration / FLICKS_PER_SECOND;
    try {
      const result = await transcriber.transcribe({
        audio: engine.listen(speech, from, to, TRANSCRIBE_SAMPLE_RATE, abort.signal),
        duration: seconds,
        language,
        ...(choices.vocabulary?.length ? { vocabulary: choices.vocabulary } : {}),
        signal: abort.signal,
        onProgress: (p) =>
          this.ui.setState({
            captionJob: {
              stage: p.stage,
              fraction: p.fraction,
              ...(p.loaded !== undefined ? { loaded: p.loaded } : {}),
              ...(p.total !== undefined ? { total: p.total } : {}),
            },
          }),
      });
      if (abort.signal.aborted) return;
      const captions = groupCaptions(result.words, from);
      if (captions.length === 0) {
        // Speech in another language than the one chosen: say which.
        // (Compared by language: Hinglish, `hi-Latn`, is Hindi heard.)
        const other =
          language !== 'auto' &&
          result.language &&
          result.language.split('-')[0] !== language.split('-')[0];
        this.toast(
          other
            ? l.captionsOtherLanguage(languageName(result.language), languageName(language))
            : l.captionsNoSpeech,
          'info',
        );
        return;
      }
      this.run(range ? l.hearAgain : l.autoCaptions, (d, ctx) =>
        addCaptions(d, captions, ctx.ids, {
          replace: true,
          preset: this.#captionPreset(),
          ...(range ? { range: { start: from, end: to } } : {}),
        }),
      );
      this.toast(l.captionsDone(captions.length), 'success', {
        label: l.undo,
        run: () => this.undo(),
      });
    } catch (error) {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError'))
        return;
      // The video has sound but this browser can't read it here — not "nobody spoke".
      if (error instanceof Error && error.name === 'SoundUnreadable') {
        this.toast(
          globalThis.isSecureContext === false ? l.captionsNeedSecure : l.captionsSoundUnreadable,
          'info',
        );
        return;
      }
      this.toast(l.captionsFailed(error instanceof Error ? error.message : String(error)), 'error');
    } finally {
      if (this.#captionAbort === abort) {
        this.#captionAbort = null;
        this.ui.setState({ captionJob: null });
      }
    }
  }

  cancelCaptions(): void {
    this.#captionAbort?.abort();
    this.#captionAbort = null;
    this.ui.setState({ captionJob: null });
  }

  /** The preset new captions use: the row's current one, else the default. */
  #captionPreset() {
    const id = captionTrack(this.project)?.caption?.preset;
    return CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0]!;
  }

  /** Reads an .srt / .vtt file into captions (replacing any). */
  async importSubtitles(file: File): Promise<void> {
    const l = this.labels;
    const text = await file.text().catch(() => '');
    const cues = parseSubtitles(text);
    if (cues.length === 0) {
      this.toast(l.subtitlesUnreadable(file.name), 'error');
      return;
    }
    const added = this.run(l.importCaptions, (d, ctx) =>
      addCaptions(d, cues, ctx.ids, { replace: true, preset: this.#captionPreset() }),
    );
    if (added)
      this.toast(l.captionsImported(cues.length), 'success', {
        label: l.undo,
        run: () => this.undo(),
      });
  }

  /** The captions as subtitle cues (for .srt / .vtt). */
  captionCues(): SubtitleCue[] {
    const track = captionTrack(this.project);
    if (!track) return [];
    return track.items
      .filter((i) => i.kind === 'text')
      .map((i) => ({ start: i.start, end: itemEnd(i), text: i.kind === 'text' ? i.text : '' }));
  }

  /** Downloads the captions as a subtitle file. */
  downloadSubtitles(format: 'srt' | 'vtt'): void {
    const cues = this.captionCues();
    if (cues.length === 0) return;
    const text = format === 'srt' ? formatSrt(cues) : formatVtt(cues);
    const blob = new Blob([text], {
      type: format === 'srt' ? 'application/x-subrip' : 'text/vtt',
    });
    const name = (this.project.name || 'captions').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Adds a caption to type at the playhead (2 s, or up to the next one). */
  addCaptionHere(): void {
    const l = this.labels;
    const t = this.playhead.time;
    const track = captionTrack(this.project);
    const next = track?.items.find((i) => i.start > t);
    const end = Math.min(t + fromSeconds(2), next ? next.start : Infinity);
    if (end - t < projectFrame(this.project) * 3) {
      this.toast(l.captionNoRoom, 'info');
      return;
    }
    const id = this.run(l.addCaption, (d, ctx) => {
      addCaptions(d, [{ start: t, end, text: l.captionPlaceholder }], ctx.ids, {
        preset: this.#captionPreset(),
      });
      return captionTrack(d)!.items.find((i) => i.start >= t - projectFrame(d))?.id;
    });
    if (id) {
      this.select(id);
      this.ui.setState({ captionEditing: id });
    }
  }

  setCaptionText(itemId: string, text: string): void {
    this.run(this.labels.editCaption, (d) => setCaptionText(d, itemId, text), {
      coalesceKey: `caption-text:${itemId}`,
    });
  }

  mergeCaption(itemId: string): void {
    this.run(this.labels.mergeCaptions, (d) => mergeCaptionWithNext(d, itemId));
  }

  /** The "check this" mark goes: a person read the caption and it's right. */
  markCaptionChecked(itemId: string): void {
    this.run(this.labels.captionChecked, (d) => markCaptionChecked(d, itemId));
  }

  /**
   * Hears one caption's part of the video again (half a second either side), the way the last
   * auto captions were made, and replaces the captions there.
   */
  hearCaptionAgain(itemId: string): void {
    const item = captionTrack(this.project)?.items.find((i) => i.id === itemId);
    if (!item) return;
    const pad = fromSeconds(0.5);
    const { language, ...choices } = this.#captionRequest;
    void this.autoCaptions(language, {
      ...choices,
      range: { start: item.start - pad, end: itemEnd(item) + pad },
    });
  }

  /** Selects and plays to the next caption marked to check (after the selected one). */
  nextCaptionToCheck(): void {
    const items = captionTrack(this.project)?.items ?? [];
    const at = items.findIndex((i) => i.id === this.ui.getState().selectedId);
    const next =
      items.slice(at + 1).find((i) => i.kind === 'text' && i.unsure) ??
      items.find((i) => i.kind === 'text' && i.unsure);
    if (!next) return;
    this.select(next.id, { keepPanel: true });
    this.seek(next.start);
  }

  /** Restyles every caption (one undo step per change; a slider drag is one). */
  setCaptionLook(patch: CaptionLookPatch, coalesceKey?: string): void {
    this.run(
      this.labels.captionStyle,
      (d) => setCaptionLook(d, patch),
      coalesceKey ? { coalesceKey } : undefined,
    );
  }
}

/** Animated image? (GIF with a loop block, animated WebP, APNG — from the first bytes.) */
function isAnimatedImage(head: Uint8Array): boolean {
  const ascii = (at: number, n: number) => String.fromCharCode(...head.subarray(at, at + n));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP')
    return ascii(12, 4) === 'VP8X' && (head[20]! & 0x02) !== 0;
  const text = String.fromCharCode(...head);
  if (ascii(0, 3) === 'GIF') return text.includes('NETSCAPE2.0') || text.includes('ANIMEXTS1.0');
  if (head[0] === 0x89 && ascii(1, 3) === 'PNG') {
    const idat = text.indexOf('IDAT');
    const actl = text.indexOf('acTL');
    return actl >= 0 && (idat < 0 || actl < idat);
  }
  return false;
}

/**
 * A still image that isn't see-through at its edges (so removing its background does
 * something). Reads 4 KB of header and decodes a 48 px copy.
 */
async function hasBackground(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  if (isAnimatedImage(head)) return false;
  if (head[0] === 0xff && head[1] === 0xd8) return true; // JPEG: never see-through
  const size = 48;
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: size,
    resizeHeight: size,
    resizeQuality: 'low',
  });
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  const px = g.getImageData(0, 0, size, size).data;
  // Any clearly see-through pixel on the border: it already has no background.
  for (let i = 0; i < size; i++)
    for (const [x, y] of [
      [i, 0],
      [i, size - 1],
      [0, i],
      [size - 1, i],
    ] as const)
      if (px[(y * size + x) * 4 + 3]! < 200) return false;
  return true;
}
