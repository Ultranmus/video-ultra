import type { ReactNode } from 'react';
import type { EditorController } from './controller';

/**
 * The embedding API (v0.3): what a host app can change about the editor without forking it —
 * hide or reorder built-in tools, add its own panels and top-bar buttons, bring its own media
 * (stock footage, a team library), and listen to what happens. Custom text is `labels`.
 *
 * ```tsx
 * <VideoEditor
 *   customize={{
 *     hide: ['captions', 'blur'],
 *     railOrder: ['media', 'brand', 'text'],
 *     panels: [{ id: 'brand', label: 'Brand', icon: 'M4 4h16v16H4z', render: (ctl) => <BrandKit ctl={ctl} /> }],
 *     buttons: [{ id: 'share', label: 'Share', onClick: (ctl) => share(ctl.project) }],
 *     mediaSources: [stockFootage],
 *   }}
 *   onEvent={(e) => analytics.track(e.type)}
 * />
 * ```
 */
export interface EditorCustomization {
  /**
   * Built-in things to hide, by id: left-menu panels (`'templates'`, `'text'`, `'captions'`,
   * `'audio'`, `'stickers'`, `'filters'`, `'transitions'`, `'blur'`), phone / inspector tools
   * (`'speed'`, `'mask'`, `'key'`, `'cutout'`, …) and commands (`'duplicate'`, `'copy'`, …).
   */
  hide?: readonly string[];
  /** The left menu's order, by panel id (built-in and custom); the rest follow in their order. */
  railOrder?: readonly string[];
  /** The host's own panels in the left menu (and the phone's add tools). */
  panels?: readonly CustomPanel[];
  /** The host's own buttons in the top bar, before Export. */
  buttons?: readonly CustomButton[];
  /** The host's media in the Media panel: search, ▶ thumbnails, Add (stored in the project). */
  mediaSources?: readonly MediaSource[];
}

/** An icon: the `d` of one SVG path on a 24 × 24 grid, drawn as a 1.75-px stroke. */
export type CustomIconPath = string;

/** A panel the host adds. */
export interface CustomPanel {
  id: string;
  /** Visible, already translated. */
  label: string;
  icon: CustomIconPath;
  tip?: string;
  /** The panel's content. It can use the controller to edit the project. */
  render: (controller: EditorController) => ReactNode;
}

/** A top-bar button the host adds. */
export interface CustomButton {
  id: string;
  label: string;
  icon?: CustomIconPath;
  /** `secondary` (default) or `primary`. */
  variant?: 'primary' | 'secondary';
  onClick: (controller: EditorController) => void;
}

/** One result of a {@link MediaSource}. */
export interface MediaSourceItem {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  /** A small picture for the grid (any image URL). */
  thumbnailUrl?: string;
  /** Seconds (video / audio), shown on the tile. */
  duration?: number;
  /** Licence / attribution line, kept with the media in the project (`Asset.credit`). */
  credit?: string;
}

/**
 * A media source for the Media panel (stock footage, the host's library). Every call gets an
 * `AbortSignal`: the editor aborts when the user types on or closes the panel.
 */
export interface MediaSource {
  id: string;
  /** Visible, already translated (the panel's section heading). */
  label: string;
  /** Results for the search box text (empty = browse); `cursor` from the last page's `next`. */
  search(
    query: { text: string; cursor: string | null },
    signal: AbortSignal,
  ): Promise<{ items: readonly MediaSourceItem[]; next?: string | null }>;
  /** The file for a result the user adds. */
  load(item: MediaSourceItem, signal: AbortSignal): Promise<Blob>;
}

/** Something that happened in the editor (`onEvent` on `<VideoEditor />`, or `controller.on`). */
export type EditorEvent =
  | { type: 'change'; label: string | null }
  | { type: 'selection'; ids: readonly string[] }
  | { type: 'playback'; playing: boolean }
  | { type: 'command'; id: string }
  | { type: 'import'; assetId: string; name: string }
  | { type: 'export'; phase: 'start' | 'done' | 'cancelled' | 'error' }
  | { type: 'panel'; id: string | null };

/** Whether a built-in id is hidden by the host. */
export function isHidden(customize: EditorCustomization | undefined, id: string): boolean {
  return !!customize?.hide?.includes(id);
}

/** `items` in the host's order (`order` first, by `id`), the rest after in their own order. */
export function inHostOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[] | undefined,
): T[] {
  if (!order?.length) return [...items];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.id) - rank(b.item.id) || a.index - b.index)
    .map((x) => x.item);
}
