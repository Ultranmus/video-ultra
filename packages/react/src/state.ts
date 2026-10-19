import { createStore } from 'zustand/vanilla';

/** Which layout the editor is in (from the root's width; CSS uses container queries too). */
export type LayoutMode = 'phone' | 'tablet' | 'desktop';

/** Add-content categories (rail on desktop, add tools on phones). */
export type PanelId =
  | 'media'
  | 'text'
  | 'audio'
  | 'stickers'
  | 'canvas'
  | 'filters'
  | 'transitions'
  | 'layers'
  | 'captions'
  /** Blurred / pixelated areas (v0.2 C3). */
  | 'blur'
  /** Templates (v0.3). */
  | 'templates'
  /** AI editing with the host's assistant (v0.4). */
  | 'assistant'
  /** A host's own panel (embedding API, v0.3). */
  | `custom:${string}`;

/** Tools whose controls open in the sheet (phone/tablet) or the inspector (desktop). */
export type ToolId =
  | 'speed'
  | 'volume'
  | 'fade'
  | 'filter'
  | 'adjust'
  | 'crop'
  | 'transform'
  | 'transition'
  | 'text-edit'
  | 'text-style'
  | 'opacity'
  | 'duration'
  | 'animate'
  | 'arrange'
  | 'canvas'
  | 'add-text'
  | 'add-sticker'
  | 'add-audio'
  | 'add-media'
  // v0.2 C. Picture tools
  | 'key'
  | 'blend'
  | 'region'
  // v0.3 Shape masks
  | 'mask'
  // v0.3 Background removal
  | 'cutout'
  // v0.4 Keyframes
  | 'keyframes'
  // v0.4 Fine trims
  | 'protrim'
  // v0.4 Scene detection
  | 'scenes'
  // v0.4 Sound effects
  | 'soundfx'
  // v0.4 Text to speech
  | 'readaloud';

/** One exchange with the AI assistant (v0.4). */
export interface AssistantTurn {
  id: number;
  instruction: string;
  reply: string;
  /** Changes applied (one undo step), 0 when none. */
  applied: number;
  /** Why the changes weren't applied (a bad action, a failed request). */
  error: string | null;
}

export interface ImportRow {
  id: string;
  name: string;
  status: 'working' | 'error';
  message?: string;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error' | 'success';
  /** One follow-up, e.g. Undo. */
  action?: { label: string; run: () => void };
}

/** UI-only state (selection, panels, playback flag). The project lives in the core editor store. */
export interface UiState {
  /** `stopped`: the engine died mid-session (the project is safe; reload to continue). */
  status: 'loading' | 'ready' | 'unsupported' | 'error' | 'stopped';
  statusMessage: string | null;
  layout: LayoutMode;
  /** The selected item the tools act on (the last one picked). */
  selectedId: string | null;
  /**
   * Everything selected, `selectedId` included (several after Shift-click, Select all, or picking
   * a group). Empty when nothing is selected.
   */
  selectedIds: readonly string[];
  /** The History popover is open. */
  /** "Your videos" popover (top bar). */
  videosOpen: boolean;
  historyOpen: boolean;
  /** Layers panel: tapping rows adds to the selection (phones have no Shift key). */
  layersSelecting: boolean;
  /** The context menu, at a point in the editor root (px). */
  menu: { x: number; y: number } | null;
  /** Auto captions running: what it's doing and how far (null = not running). */
  captionJob: {
    stage: 'listen' | 'download' | 'transcribe';
    fraction: number;
    loaded?: number;
    total?: number;
  } | null;
  /** Background removal running (v0.3): for which item, what it's doing, how far. */
  cutoutJob: { itemId: string; stage: 'download' | 'work'; fraction: number } | null;
  /** Scene detection running (v0.4): on which clip, how far. */
  sceneJob: { itemId: string; fraction: number } | null;
  /** AI editing (v0.4): this session's conversation, and whether a request is out. */
  assistantTurns: AssistantTurn[];
  assistantBusy: boolean;
  /** Text to speech (v0.4) is generating. */
  speechBusy: boolean;
  /** Proxies being made (v0.4): asset id → 0…1. */
  proxyJobs: Record<string, number>;
  /** A caption whose text box should take focus in the Captions panel. */
  captionEditing: string | null;
  /** Last screen-reader announcement (a polite live region reads it). */
  announcement: string;
  panel: PanelId | null;
  tool: ToolId | null;
  /** Phone/tablet: the add panel is open in the sheet. */
  sheetPanel: boolean;
  playing: boolean;
  /** Timeline zoom: pixels per second. */
  pxPerSecond: number;
  imports: ImportRow[];
  toasts: Toast[];
  exportOpen: boolean;
  helpOpen: boolean;
  /** Only the video and play controls (works everywhere, incl. iPhone). */
  previewMode: boolean;
  save: 'idle' | 'saving' | 'saved';
  /** This project is open (and saving) in another tab: this one doesn't save until it takes over. */
  readOnly: boolean;
  persistent: boolean | null;
  recording: boolean;
  /** The camera recorder covers the editor (v0.2 D. Capture & export). */
  cameraOpen: boolean;
  /** Green screen "pick from video": the next tap on the stage picks this item's key colour. */
  picking: string | null;
}

export function createUiStore() {
  return createStore<UiState>(() => ({
    status: 'loading',
    statusMessage: null,
    layout: 'desktop',
    selectedId: null,
    selectedIds: [],
    historyOpen: false,
    videosOpen: false,
    layersSelecting: false,
    menu: null,
    announcement: '',
    captionJob: null,
    cutoutJob: null,
    sceneJob: null,
    proxyJobs: {},
    assistantTurns: [],
    assistantBusy: false,
    speechBusy: false,
    captionEditing: null,
    panel: 'media',
    tool: null,
    sheetPanel: false,
    playing: false,
    pxPerSecond: 60,
    imports: [],
    toasts: [],
    exportOpen: false,
    helpOpen: false,
    previewMode: false,
    save: 'idle',
    readOnly: false,
    persistent: null,
    recording: false,
    cameraOpen: false,
    picking: null,
  }));
}

export type UiStore = ReturnType<typeof createUiStore>;

/**
 * The playhead time (flicks). Changes every frame while playing, so it is NOT React state:
 * subscribers (timecode text, timeline canvas) update themselves.
 */
export class Playhead {
  #time = 0;
  #listeners = new Set<(time: number) => void>();

  get time(): number {
    return this.#time;
  }

  set(time: number): void {
    if (time === this.#time) return;
    this.#time = time;
    for (const listener of this.#listeners) listener(time);
  }

  subscribe(listener: (time: number) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/**
 * Sound levels while playing (v0.4 meters): the loudest sample per side just heard, 0…1.
 * Updated per frame from the engine; components subscribe and draw through refs (no renders).
 */
export class Levels {
  left = 0;
  right = 0;
  #listeners = new Set<(left: number, right: number) => void>();

  set(left: number, right: number): void {
    if (left === this.left && right === this.right) return;
    this.left = left;
    this.right = right;
    for (const listener of this.#listeners) listener(left, right);
  }

  subscribe(listener: (left: number, right: number) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
