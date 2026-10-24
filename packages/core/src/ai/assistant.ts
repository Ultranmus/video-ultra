import * as z from 'zod/mini';
import { AUDIO_FX_PRESETS } from '../audio/fx';
import { ANIMATION_PRESETS, FILTER_PRESETS, TRANSITION_PRESETS } from '../effects/presets';
import {
  addMarker,
  addToLane,
  deleteItem,
  EditError,
  moveItem,
  setAnimation,
  setCanvasSize,
  setSpeed,
  setTransition,
  splitItem,
  trimItem,
  updateItem,
} from '../edit/ops';
import {
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  findItem,
  projectDuration,
  type IdFactory,
} from '../model/project';
import type { Item, Project, TextItem } from '../model/schema';
import { FLICKS_PER_SECOND, fromSeconds } from '../model/time';

/**
 * AI editing (v0.4, optional): a language model — the host's, through its own endpoint — reads a
 * short description of the project ({@link describeProject}) and answers with **edit actions**
 * ({@link EditAction}): a small, validated language over the editor's own operations, in seconds
 * and ids. {@link applyEditActions} checks every action and applies them all as one edit (one
 * undo), or none. The model never touches media or the project JSON directly.
 */

const seconds = z.number().check(z.gte(0), z.lte(24 * 3600));
const itemId = z.string().check(z.minLength(1));

/** The actions a model may ask for. Times are seconds on the timeline unless said otherwise. */
export const EditActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('split'), itemId, at: seconds }),
  /** Keep only `from`…`to` seconds of the clip itself (0 = its current start). */
  z.object({
    action: z.literal('trim'),
    itemId,
    from: z.optional(seconds),
    to: z.optional(seconds),
  }),
  z.object({ action: z.literal('delete'), itemIds: z.array(itemId) }),
  /** Text, stickers, sounds and picture-in-picture only: a new start. */
  z.object({ action: z.literal('move'), itemId, start: seconds }),
  z.object({ action: z.literal('speed'), itemId, speed: z.number().check(z.gte(0.1), z.lte(10)) }),
  z.object({
    action: z.literal('sound'),
    itemId,
    volume: z.optional(z.number().check(z.gte(0), z.lte(2))),
    muted: z.optional(z.boolean()),
    fadeIn: z.optional(seconds),
    fadeOut: z.optional(seconds),
    /** A sound look from `soundPresets`. */
    preset: z.optional(z.string()),
  }),
  z.object({
    action: z.literal('filter'),
    itemId,
    filter: z.nullable(z.string()),
    intensity: z.optional(z.number().check(z.gte(0), z.lte(1))),
  }),
  z.object({
    action: z.literal('adjust'),
    itemId,
    brightness: z.optional(z.number().check(z.gte(-1), z.lte(1))),
    contrast: z.optional(z.number().check(z.gte(-1), z.lte(1))),
    saturation: z.optional(z.number().check(z.gte(-1), z.lte(1))),
    warmth: z.optional(z.number().check(z.gte(-1), z.lte(1))),
  }),
  /** Main-video clips: the transition from the clip before into this one. */
  z.object({
    action: z.literal('transition'),
    itemId,
    transition: z.nullable(z.string()),
    duration: z.optional(z.number().check(z.gte(0.1), z.lte(3))),
  }),
  z.object({
    action: z.literal('addText'),
    text: z.string().check(z.minLength(1), z.maxLength(500)),
    start: seconds,
    duration: z.optional(z.number().check(z.gte(0.2), z.lte(600))),
    position: z.optional(z.enum(['top', 'center', 'bottom'])),
    color: z.optional(z.string()),
    size: z.optional(z.enum(['small', 'medium', 'large'])),
  }),
  z.object({
    action: z.literal('editText'),
    itemId,
    text: z.optional(z.string().check(z.minLength(1), z.maxLength(500))),
    color: z.optional(z.string()),
    size: z.optional(z.enum(['small', 'medium', 'large'])),
  }),
  /** Text, stickers, picture-in-picture: entrance / exit animations (`animations` ids). */
  z.object({
    action: z.literal('animate'),
    itemId,
    in: z.optional(z.nullable(z.string())),
    out: z.optional(z.nullable(z.string())),
  }),
  z.object({
    action: z.literal('canvas'),
    ratio: z.enum(['9:16', '16:9', '1:1', '4:5', '4:3', '21:9']),
  }),
  z.object({ action: z.literal('marker'), time: seconds, label: z.optional(z.string()) }),
]);

/** One edit a model asked for (validated by {@link EditActionSchema}). */
export type EditAction = z.infer<typeof EditActionSchema>;

/** What an {@link EditingAssistant} gets. */
export interface EditingRequest {
  /** What the person asked, in their words. */
  instruction: string;
  /** {@link describeProject} of the project now. */
  project: ProjectDescription;
  /** Ids of the selected items (the person may say "this clip"). */
  selection: string[];
  /** Playhead, seconds ("here"). */
  playhead: number;
  /** Earlier turns of this conversation (oldest first). */
  history: { instruction: string; reply: string }[];
  signal: AbortSignal;
}

/** What an {@link EditingAssistant} answers. */
export interface EditingResponse {
  /** A short sentence for the person (what was done, or a question back). */
  reply: string;
  /** Edits to apply (may be empty: a question or "can't do that"). */
  actions: unknown[];
}

/**
 * Turns an instruction into edit actions — implement it with your own model endpoint (keys stay
 * on your server). `@video-ultra/ai` has `createChatAssistant` for OpenAI-compatible endpoints.
 */
export interface EditingAssistant {
  edit(request: EditingRequest): Promise<EditingResponse>;
}

/** The compact view of a project a model reads. */
export interface ProjectDescription {
  canvas: { width: number; height: number };
  duration: number;
  tracks: {
    kind: string;
    items: Record<string, string | number | boolean | null>[];
  }[];
  markers: { time: number; label?: string }[];
  catalog: {
    filters: string[];
    transitions: string[];
    animationsIn: string[];
    animationsOut: string[];
    soundPresets: string[];
  };
}

const round = (flicks: number) => Math.round((flicks / FLICKS_PER_SECOND) * 100) / 100;

/** A compact, model-friendly description of `project` (ids, kinds, times in seconds, texts). */
export function describeProject(project: Project): ProjectDescription {
  return {
    canvas: { width: project.settings.width, height: project.settings.height },
    duration: round(projectDuration(project)),
    tracks: project.tracks.map((track) => ({
      kind: track.kind === 'main' ? 'main video' : track.kind,
      items: track.items.map((item) => {
        const row: Record<string, string | number | boolean | null> = {
          id: item.id,
          kind: item.kind,
          start: round(item.start),
          duration: round(item.duration),
        };
        if (item.name) row.name = item.name;
        else if ('assetId' in item && item.assetId)
          row.name = project.assets[item.assetId]?.name ?? null;
        if (item.kind === 'text') row.text = item.text.slice(0, 120);
        if (item.kind === 'video' || item.kind === 'audio') {
          row.speed = item.speed;
          row.volume = item.volume;
          if (item.muted) row.muted = true;
        }
        if ('filter' in item && item.filter) row.filter = item.filter.id;
        if ('transitionIn' in item && item.transitionIn) row.transitionIn = item.transitionIn.type;
        return row;
      }),
    })),
    markers: (project.markers ?? []).map((m) => ({
      time: round(m.time),
      ...(m.label ? { label: m.label } : {}),
    })),
    catalog: {
      filters: FILTER_PRESETS.map((f) => f.id),
      transitions: TRANSITION_PRESETS.map((t) => t.id),
      animationsIn: ANIMATION_PRESETS.filter((a) => a.slot === 'in').map((a) => a.id),
      animationsOut: ANIMATION_PRESETS.filter((a) => a.slot === 'out').map((a) => a.id),
      soundPresets: AUDIO_FX_PRESETS.map((p) => p.id),
    },
  };
}

/** For the model's instructions: what each action does. */
export const EDIT_ACTIONS_GUIDE = `You edit a video project for the person. Answer with JSON only:
{"reply": "<one short sentence for the person>", "actions": [<actions>]}.
Times are seconds on the timeline. Use only item ids from the project description.
"This", "it" and "the selected one" mean the items in "selection". Change only what the person asked
for: touch every item only when they ask for all of them.
Actions:
- {"action":"split","itemId","at"} cut a clip in two at a timeline time inside it
- {"action":"trim","itemId","from"?,"to"?} keep only from…to seconds of the clip itself (0 = its start)
- {"action":"delete","itemIds":[…]}
- {"action":"move","itemId","start"} text, stickers, sounds, picture-in-picture only
- {"action":"speed","itemId","speed"} 0.1–10 (video, sound)
- {"action":"sound","itemId","volume"?(0–2),"muted"?,"fadeIn"?,"fadeOut"?,"preset"?(catalog.soundPresets)}
- {"action":"filter","itemId","filter"(catalog.filters or null),"intensity"?(0–1)}
- {"action":"adjust","itemId","brightness"?,"contrast"?,"saturation"?,"warmth"?} each −1…1
- {"action":"transition","itemId","transition"(catalog.transitions or null),"duration"?} into a main-video clip from the one before
- {"action":"addText","text","start","duration"?,"position"?("top"|"center"|"bottom"),"color"?(#rrggbb),"size"?("small"|"medium"|"large")}
- {"action":"editText","itemId","text"?,"color"?,"size"?}
- {"action":"animate","itemId","in"?(catalog.animationsIn or null),"out"?(catalog.animationsOut or null)}
- {"action":"canvas","ratio"("9:16"|"16:9"|"1:1"|"4:5"|"4:3"|"21:9")}
- {"action":"marker","time","label"?}
If the request is unclear or impossible, return no actions and ask or explain in "reply".`;

const SIZES = { small: 0.04, medium: 0.06, large: 0.1 } as const;
const POSITIONS = { top: 0.15, center: 0.5, bottom: 0.82 } as const;
const RATIOS = {
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '4:3': [1440, 1080],
  '21:9': [2520, 1080],
} as const;

/** A `#rrggbb` colour, or an error a model can read. */
function colour(value: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value))
    throw new EditError('invalid', `Colour must be #rrggbb, not ${value}`);
  return value.toLowerCase();
}

function item(project: Project, id: string): Item {
  const found = findItem(project, id);
  if (!found) throw new EditError('not-found', `No item ${id}`);
  return found.item;
}

/**
 * Checks and applies `actions` (from a model: unknown values) to `project` in order. Throws an
 * {@link EditError} naming the first bad action — run it inside one editor edit so nothing is
 * applied then (the whole set is one undo step otherwise). Returns the number applied.
 */
export function applyEditActions(project: Project, actions: unknown[], ids: IdFactory): number {
  if (!Array.isArray(actions)) throw new EditError('invalid', 'Actions must be a list');
  if (actions.length > 200)
    throw new EditError('invalid', 'Too many actions at once (200 at most)');
  actions.forEach((raw, index) => {
    const parsed = EditActionSchema.safeParse(raw);
    if (!parsed.success)
      throw new EditError(
        'invalid',
        `Action ${index + 1} isn't valid: ${JSON.stringify(raw).slice(0, 200)}`,
      );
    try {
      applyOne(project, parsed.data, ids);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new EditError('invalid', `Action ${index + 1} (${parsed.data.action}): ${why}`);
    }
  });
  return actions.length;
}

function applyOne(project: Project, a: EditAction, ids: IdFactory): void {
  const t = (s: number) => fromSeconds(s);
  switch (a.action) {
    case 'split':
      splitItem(project, a.itemId, t(a.at), ids);
      return;
    case 'trim': {
      const it = item(project, a.itemId);
      if (a.to !== undefined) trimItem(project, a.itemId, 'end', t(a.to) - it.duration);
      if (a.from) trimItem(project, a.itemId, 'start', t(a.from));
      return;
    }
    case 'delete':
      for (const id of a.itemIds) {
        item(project, id);
        deleteItem(project, id);
      }
      return;
    case 'move':
      moveItem(project, a.itemId, t(a.start), ids);
      return;
    case 'speed':
      setSpeed(project, a.itemId, a.speed, ids);
      return;
    case 'sound': {
      const it = item(project, a.itemId);
      if (it.kind !== 'video' && it.kind !== 'audio')
        throw new EditError('invalid', 'Only video and sound clips have sound');
      let preset;
      if (a.preset !== undefined) {
        preset = AUDIO_FX_PRESETS.find((p) => p.id === a.preset);
        if (!preset) throw new EditError('invalid', `No sound preset ${a.preset}`);
      }
      updateItem(project, a.itemId, {
        ...(a.volume !== undefined ? { volume: a.volume } : {}),
        ...(a.muted !== undefined ? { muted: a.muted } : {}),
        ...(a.fadeIn !== undefined ? { fadeIn: t(a.fadeIn) } : {}),
        ...(a.fadeOut !== undefined ? { fadeOut: t(a.fadeOut) } : {}),
        ...(preset ? { audioFx: { ...preset.fx } } : {}),
      });
      return;
    }
    case 'filter': {
      if (a.filter !== null && !FILTER_PRESETS.some((f) => f.id === a.filter))
        throw new EditError('invalid', `No filter ${a.filter}`);
      updateItem(project, a.itemId, {
        filter: a.filter === null ? null : { id: a.filter, intensity: a.intensity ?? 1 },
      });
      return;
    }
    case 'adjust': {
      const it = item(project, a.itemId);
      if (!('adjust' in it)) throw new EditError('invalid', `${it.kind} items have no adjustments`);
      const values: Record<string, number> = {};
      for (const key of ['brightness', 'contrast', 'saturation', 'warmth'] as const)
        if (a[key] !== undefined) values[key] = a[key];
      updateItem(project, a.itemId, { adjust: { ...it.adjust, ...values } });
      return;
    }
    case 'transition': {
      if (a.transition === null) {
        setTransition(project, a.itemId, null);
        return;
      }
      const preset = TRANSITION_PRESETS.find((p) => p.id === a.transition);
      if (!preset) throw new EditError('invalid', `No transition ${a.transition}`);
      setTransition(project, a.itemId, {
        type: preset.id,
        duration: t(a.duration ?? preset.defaultDuration ?? 0.5),
      });
      return;
    }
    case 'addText': {
      const text: TextItem = {
        id: ids(),
        kind: 'text',
        start: t(a.start),
        duration: t(a.duration ?? 3),
        text: a.text,
        style: {
          ...DEFAULT_TEXT_STYLE,
          ...(a.color ? { color: colour(a.color) } : {}),
          size: SIZES[a.size ?? 'medium'],
        },
        transform: { ...DEFAULT_TRANSFORM, y: POSITIONS[a.position ?? 'center'] },
        filter: null,
        adjust: {},
      };
      addToLane(project, text, ids);
      return;
    }
    case 'editText': {
      const it = item(project, a.itemId);
      if (it.kind !== 'text') throw new EditError('invalid', 'Not a text');
      updateItem(project, a.itemId, {
        ...(a.text !== undefined ? { text: a.text } : {}),
        style: {
          ...it.style,
          ...(a.color ? { color: colour(a.color) } : {}),
          ...(a.size ? { size: SIZES[a.size] } : {}),
        },
      });
      return;
    }
    case 'animate':
      for (const slot of ['in', 'out'] as const) {
        const id = a[slot];
        if (id === undefined) continue;
        if (id === null) {
          setAnimation(project, a.itemId, slot, null);
          continue;
        }
        const preset = ANIMATION_PRESETS.find((p) => p.id === id && p.slot === slot);
        if (!preset)
          throw new EditError('invalid', `No ${slot === 'in' ? 'entrance' : 'exit'} ${id}`);
        setAnimation(project, a.itemId, slot, {
          type: preset.id,
          duration: t(preset.defaultDuration ?? 0.5),
        });
      }
      return;
    case 'canvas': {
      const [w, h] = RATIOS[a.ratio];
      setCanvasSize(project, w, h);
      return;
    }
    case 'marker':
      addMarker(project, t(a.time), ids, a.label);
      return;
  }
}
