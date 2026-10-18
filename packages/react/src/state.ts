import { createStore } from 'zustand/vanilla';

/** Which layout the editor is in (from the root's width; CSS uses container queries too). */
export type LayoutMode = 'phone' | 'tablet' | 'desktop';

/** Add-content categories (rail on desktop, add tools on phones). */
export type PanelId =
  'media' | 'text' | 'audio' | 'stickers' | 'canvas' | 'filters' | 'transitions';

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
  | 'canvas'
  | 'add-text'
  | 'add-sticker'
  | 'add-audio'
  | 'add-media';

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
  selectedId: string | null;
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
}

export function createUiStore() {
  return createStore<UiState>(() => ({
    status: 'loading',
    statusMessage: null,
    layout: 'desktop',
    selectedId: null,
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
