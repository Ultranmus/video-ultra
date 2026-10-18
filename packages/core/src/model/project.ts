import {
  PROJECT_VERSION,
  type Asset,
  type Crop,
  type Item,
  type ItemKind,
  type Project,
  type TextStyle,
  type Track,
  type TrackKind,
  type Transform,
} from './schema';
import { FRAME_RATES, frameDuration, type FrameRate, type Time } from './time';

/** Makes unique ids. Injectable so tests are deterministic. */
export type IdFactory = () => string;

/** Random 12-character base-36 ids (≈ 62 bits). */
export const randomId: IdFactory = () => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(36).padStart(2, '0');
  return out.slice(0, 12);
};

/** Deterministic ids for tests: `id1`, `id2`, … */
export function sequentialIds(prefix = 'id'): IdFactory {
  let n = 0;
  return () => `${prefix}${++n}`;
}

export const DEFAULT_TRANSFORM: Readonly<Transform> = Object.freeze({
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  opacity: 1,
  flipX: false,
  flipY: false,
});

export const NO_CROP: Readonly<Crop> = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

export const DEFAULT_TEXT_STYLE: Readonly<TextStyle> = Object.freeze({
  fontFamily: 'system-ui',
  fontWeight: 700,
  italic: false,
  size: 0.06,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,
  outline: null,
  shadow: { color: 'rgba(0,0,0,0.5)', blur: 4, x: 0, y: 2 },
  background: null,
});

/** Options for {@link createProject}. */
export interface CreateProjectOptions {
  name?: string;
  /** Canvas size in pixels. Default 1080 × 1920 (9:16, phone video). */
  width?: number;
  height?: number;
  frameRate?: FrameRate;
  ids?: IdFactory;
  /** ISO timestamp; defaults to now. */
  now?: string;
}

/** A new, empty project with one (empty) main track. */
export function createProject(options: CreateProjectOptions = {}): Project {
  const ids = options.ids ?? randomId;
  const now = options.now ?? new Date().toISOString();
  return {
    version: PROJECT_VERSION,
    id: ids(),
    name: options.name ?? 'Untitled video',
    createdAt: now,
    updatedAt: now,
    settings: {
      width: options.width ?? 1080,
      height: options.height ?? 1920,
      frameRate: { ...(options.frameRate ?? FRAME_RATES.fps30) },
      background: { type: 'color', color: '#000000' },
    },
    assets: {},
    tracks: [{ id: ids(), kind: 'main', muted: false, hidden: false, locked: false, items: [] }],
  };
}

/** Which track kind an item kind lives on, when it isn't on the main track. */
export function laneKindFor(kind: ItemKind): Exclude<TrackKind, 'main'> {
  switch (kind) {
    case 'text':
      return 'text';
    case 'audio':
      return 'audio';
    default:
      return 'overlay';
  }
}

/** Item kinds allowed on each track kind. */
export const ALLOWED_KINDS: Record<TrackKind, readonly ItemKind[]> = {
  main: ['video', 'image', 'freeze'],
  overlay: ['video', 'image', 'freeze', 'sticker', 'region'],
  text: ['text'],
  audio: ['audio'],
};

/** End of an item on the timeline. */
export function itemEnd(item: Item): Time {
  return item.start + item.duration;
}

/** Total length of the project: the end of the last item on any track. */
export function projectDuration(project: Project): Time {
  let end = 0;
  for (const track of project.tracks) {
    const last = track.items[track.items.length - 1];
    if (last && itemEnd(last) > end) end = itemEnd(last);
    // Lanes are sorted, so the last item ends last.
  }
  return end;
}

/** The single main track. */
export function mainTrack(project: Project): Track {
  const track = project.tracks[0];
  if (!track || track.kind !== 'main') throw new Error('Project has no main track');
  return track;
}

/** Finds an item and the track holding it. */
export function findItem(
  project: Project,
  itemId: string,
): { track: Track; item: Item; index: number } | null {
  for (const track of project.tracks) {
    const index = track.items.findIndex((i) => i.id === itemId);
    if (index !== -1) return { track, item: track.items[index]!, index };
  }
  return null;
}

/**
 * The ids an item moves and selects with: every member of its group, or just the item itself
 * when it isn't grouped.
 */
export function groupOf(project: Project, itemId: string): string[] {
  const item = findItem(project, itemId)?.item;
  if (!item) return [];
  if (!item.groupId) return [item.id];
  const ids: string[] = [];
  for (const track of project.tracks)
    for (const other of track.items) if (other.groupId === item.groupId) ids.push(other.id);
  return ids;
}

/** One frame of the project's frame rate, in flicks. */
export function projectFrame(project: Project): Time {
  return frameDuration(project.settings.frameRate);
}

/** Media items read a span of their source: `[sourceIn, sourceIn + duration × speed)`. */
export function sourceSpan(item: Extract<Item, { speed: number }>): Time {
  return Math.round(item.duration * item.speed);
}

/** Asset kind an item kind must reference. */
export function assetKindsFor(kind: ItemKind): readonly Asset['kind'][] {
  switch (kind) {
    case 'video':
    case 'freeze':
      return ['video'];
    case 'image':
    case 'sticker':
      return ['image'];
    case 'audio':
      // Audio items can play the sound of a video file ("extract audio").
      return ['audio', 'video'];
    case 'text':
    case 'region':
      return [];
  }
}
