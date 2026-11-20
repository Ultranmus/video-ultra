import * as z from 'zod/mini';
import { checkInvariants } from './invariants';
import {
  ALLOWED_KINDS,
  itemEnd,
  laneKindFor,
  projectFrame,
  randomId,
  sourceSpan,
  type IdFactory,
} from './project';
import { PROJECT_VERSION, ProjectSchema, type Item, type Project, type Track } from './schema';

/** Result of {@link parseProject}. */
export type ParseResult =
  | { ok: true; project: Project; /** Things that were fixed while loading. */ warnings: string[] }
  | { ok: false; error: string };

/**
 * Migrations from older file versions. `MIGRATIONS[n]` turns a version-n project into version
 * n + 1. Never edit a shipped migration — add a new one.
 */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {
  /** 1 → 2: text and stickers take filters and adjustments too (none yet). */
  1: (old) => ({
    ...old,
    version: 2,
    tracks: Array.isArray(old.tracks)
      ? old.tracks.map((track: unknown) => {
          if (typeof track !== 'object' || track === null) return track;
          const t = track as { items?: unknown };
          if (!Array.isArray(t.items)) return track;
          return {
            ...t,
            items: t.items.map((item: unknown) => {
              if (typeof item !== 'object' || item === null) return item;
              const i = item as { kind?: unknown };
              return i.kind === 'text' || i.kind === 'sticker'
                ? { filter: null, adjust: {}, ...i }
                : item;
            }),
          };
        })
      : old.tracks,
  }),
  /** 2 → 3: items may be locked, hidden and grouped (all optional, none yet). */
  2: (old) => ({ ...old, version: 3 }),
  /** 3 → 4: pictures may have a shape mask (optional, none yet). */
  3: (old) => ({ ...old, version: 4 }),
  /** 4 → 5: combined clips (assets of kind `compound`; none yet). */
  4: (old) => ({ ...old, version: 5 }),
  /** 5 → 6: captions may be marked unsure (optional, none yet). */
  5: (old) => ({ ...old, version: 6 }),
};

/**
 * Opens a project from untrusted JSON (a saved file, the host's database, a crash-recovery
 * snapshot): migrates old versions, validates the shape, and repairs broken timing so a damaged
 * file still opens. Never throws.
 */
export function parseProject(input: unknown, ids: IdFactory = randomId): ParseResult {
  let data: unknown = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return { ok: false, error: 'This project file is not valid JSON.' };
    }
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'This is not a VideoUltra project.' };
  }
  let record = data as Record<string, unknown>;
  if (typeof record.version !== 'number' || !Number.isInteger(record.version)) {
    return { ok: false, error: 'This is not a VideoUltra project.' };
  }
  const version = record.version;
  if (version > PROJECT_VERSION) {
    return {
      ok: false,
      error: `This project was made with a newer version of the editor (file version ${version}). Update the editor to open it.`,
    };
  }
  for (let v = version; v < PROJECT_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) return { ok: false, error: `Can't upgrade a project from file version ${v}.` };
    record = migrate(record);
  }

  const parsed = z.safeParse(ProjectSchema, record);
  if (!parsed.success) {
    return { ok: false, error: `This project file is damaged: ${z.prettifyError(parsed.error)}` };
  }
  const project = parsed.data;
  const warnings = repairProject(project, ids);
  const remaining = checkInvariants(project);
  if (remaining.length > 0) {
    return {
      ok: false,
      error: `This project file is damaged: ${remaining.slice(0, 3).join('; ')}`,
    };
  }
  return { ok: true, project, warnings };
}

/**
 * Fixes timing problems in place: drops items whose media is gone, re-packs the main track,
 * moves overlapping lane items to new lanes, removes empty lanes. Returns what it changed.
 */
export function repairProject(project: Project, ids: IdFactory = randomId): string[] {
  const warnings: string[] = [];
  // Combined clips first (the timeline's clips are then checked against their lengths) (file version 5+): each inside the same way; one that contains itself, or
  // holds captions, loses those items; its length covers what's inside.
  for (const asset of Object.values(project.assets)) {
    if (asset.kind !== 'compound') continue;
    const inner = { ...project, tracks: asset.tracks ?? [] };
    warnings.push(...repairTracks(inner, ids));
    asset.tracks = inner.tracks.filter((t) => t.kind !== 'caption');
  }
  for (const asset of Object.values(project.assets)) {
    if (asset.kind !== 'compound' || !asset.tracks) continue;
    const reaches = (id: string, seen: Set<string>): boolean => {
      const a = project.assets[id];
      if (!a?.tracks || seen.has(id)) return false;
      seen.add(id);
      return a.tracks.some((t) =>
        t.items.some(
          (i) =>
            'assetId' in i && !!i.assetId && (i.assetId === asset.id || reaches(i.assetId, seen)),
        ),
      );
    };
    for (const t of asset.tracks) {
      const before = t.items.length;
      t.items = t.items.filter(
        (i) =>
          !('assetId' in i) ||
          !i.assetId ||
          (i.assetId !== asset.id && !reaches(i.assetId, new Set())),
      );
      if (t.items.length !== before)
        warnings.push(`Removed a combined clip that contained itself.`);
    }
    let end = 0;
    for (const t of asset.tracks) for (const i of t.items) end = Math.max(end, itemEnd(i));
    asset.duration = Math.max(asset.duration, end, projectFrame(project));
  }
  warnings.push(...repairTracks(project, ids));
  return [...new Set(warnings)];
}

/** {@link repairProject} for one track list (the timeline, or a combined clip's inside). */
function repairTracks(project: Project, ids: IdFactory): string[] {
  const warnings: string[] = [];

  // Exactly one main track, first.
  let main = project.tracks.find((t) => t.kind === 'main');
  if (!main) {
    main = { id: ids(), kind: 'main', muted: false, hidden: false, locked: false, items: [] };
    warnings.push('Added a missing main track.');
  }
  const extraMains = project.tracks.filter((t) => t.kind === 'main' && t !== main);
  const lanes = project.tracks.filter((t) => t.kind !== 'main');
  for (const extra of extraMains) {
    warnings.push('Merged a second main track into the first.');
    main.items.push(...extra.items);
  }

  // Drop items whose media is gone; fix impossible timing; move items on the wrong kind of
  // track (e.g. a title on the main track) to a lane.
  const frame = projectFrame(project);
  const strays: Item[] = [];
  const usable = (track: Track) => (item: Item) => {
    const assetId = 'assetId' in item ? item.assetId : null;
    const asset = assetId ? project.assets[assetId] : undefined;
    if (assetId && !asset) {
      warnings.push(`Removed "${item.name ?? item.kind}": its media file is missing.`);
      return false;
    }
    if ((item.kind === 'video' || item.kind === 'audio') && asset) {
      if (item.sourceIn >= asset.duration) {
        warnings.push(`Removed "${item.name ?? item.kind}": it starts after the end of its media.`);
        return false;
      }
      if (item.sourceIn + sourceSpan(item) > asset.duration + 1) {
        item.duration = Math.floor((asset.duration - item.sourceIn) / item.speed / frame) * frame;
        warnings.push(`Shortened "${item.name ?? item.kind}" to the length of its media.`);
      }
    }
    if (item.kind === 'freeze' && asset && item.sourceTime > asset.duration)
      item.sourceTime = asset.duration;
    if ('lut' in item && item.lut && project.assets[item.lut.assetId]?.kind !== 'lut') {
      delete item.lut;
      warnings.push(`Removed the LUT look of "${item.name ?? item.kind}": its file is missing.`);
    }
    if (item.duration < frame) {
      warnings.push(`Removed "${item.name ?? item.kind}": shorter than one frame.`);
      return false;
    }
    if ('duck' in item && item.duck !== undefined && !(item.duck > 0)) delete item.duck;
    if ('fadeIn' in item) {
      item.fadeIn = Math.min(item.fadeIn, item.duration);
      item.fadeOut = Math.min(item.fadeOut, item.duration - item.fadeIn);
    }
    if (!ALLOWED_KINDS[track.kind].includes(item.kind)) {
      warnings.push(`Moved "${item.name ?? item.kind}" to a lane that can hold it.`);
      strays.push(item);
      return false;
    }
    return true;
  };
  main.items = main.items.filter(usable(main));
  for (const item of main.items) delete item.groupId;
  for (const track of project.tracks) if (track.kind !== 'caption') delete track.caption;
  for (const lane of lanes) lane.items = lane.items.filter(usable(lane));

  // Main track: back to back from 0.
  let cursor = 0;
  let gaps = false;
  for (const [index, item] of main.items.entries()) {
    if (item.start !== cursor) gaps = true;
    item.start = cursor;
    cursor = itemEnd(item);
    if ('transitionIn' in item && item.transitionIn) {
      const previous = main.items[index - 1];
      if (!previous || item.transitionIn.duration > Math.min(previous.duration, item.duration)) {
        item.transitionIn = null;
        warnings.push('Removed a transition that no longer fit.');
      }
    }
  }
  if (gaps) warnings.push('Closed gaps on the main track.');

  // Lanes: keep their order; sort items; an item that overlaps its neighbour moves to another
  // lane of its kind (a new one at the end if none is free).
  const fixedLanes: Track[] = lanes.map((lane) => ({ ...lane, items: [] }));
  const laneById = new Map(fixedLanes.map((lane) => [lane.id, lane]));
  const pending = [
    ...lanes.flatMap((lane) =>
      lane.items.map((item) => ({ item, laneId: lane.id as string | null })),
    ),
    ...strays.map((item) => ({ item, laneId: null as string | null })),
  ].sort((x, y) => x.item.start - y.item.start);
  const fitsAtEnd = (track: Track, item: Item) => {
    const last = track.items.at(-1);
    return !last || itemEnd(last) <= item.start;
  };
  for (const { item, laneId } of pending) {
    const own = laneId ? laneById.get(laneId) : undefined;
    // Stay on its own row when that row can hold it (captions are text on a caption row).
    const kind =
      own && ALLOWED_KINDS[own.kind].includes(item.kind) ? own.kind : laneKindFor(item.kind);
    let target = own && own.kind === kind && fitsAtEnd(own, item) ? own : undefined;
    if (!target) {
      target = fixedLanes.find((t) => t.kind === kind && fitsAtEnd(t, item));
      if (!target) {
        target = { id: ids(), kind, muted: false, hidden: false, locked: false, items: [] };
        fixedLanes.push(target);
      }
      if (laneId)
        warnings.push(`Moved "${item.name ?? item.kind}" to another lane so it doesn't overlap.`);
    }
    target.items.push(item);
  }

  project.tracks = [main, ...fixedLanes.filter((t) => t.items.length > 0)];
  return [...new Set(warnings)];
}
