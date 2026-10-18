import * as z from 'zod/mini';

/**
 * The project file format. Plain JSON, validated on load, versioned with migrations (see
 * `migrate.ts`). Everything an edit changes lives here — media files are never modified.
 *
 * Conventions:
 * - Times are integer flicks (see `time.ts`).
 * - Positions are fractions of the canvas (0…1, centre = 0.5) and scale is relative to the size
 *   that fits the item inside the canvas, so changing the aspect ratio keeps layouts sensible.
 */

export const PROJECT_VERSION = 2;

const time = z.int().check(z.nonnegative());
const positiveTime = z.int().check(z.positive());
const unit = z.number().check(z.gte(0), z.lte(1));
const id = z.string().check(z.minLength(1), z.maxLength(64));

export const FrameRateSchema = z.object({
  num: z.int().check(z.positive()),
  den: z.int().check(z.positive()),
});

export const TransformSchema = z.object({
  /** Centre, as a fraction of canvas width (0.5 = centred). */
  x: z.number(),
  /** Centre, as a fraction of canvas height. */
  y: z.number(),
  /** 1 = fits inside the canvas (contain). */
  scale: z.number().check(z.positive()),
  /** Degrees, clockwise. */
  rotation: z.number(),
  opacity: unit,
  flipX: z.boolean(),
  flipY: z.boolean(),
});

export const CropSchema = z.object({
  /** Fractions of the source cut from each edge. */
  left: unit,
  top: unit,
  right: unit,
  bottom: unit,
});

export const FilterSchema = z.object({
  /** Preset id, e.g. `'warm'`. */
  id,
  intensity: unit,
});

/** Each value −1…1; 0 = unchanged. Missing = 0. */
export const AdjustSchema = z.object({
  brightness: z.optional(z.number()),
  contrast: z.optional(z.number()),
  saturation: z.optional(z.number()),
  warmth: z.optional(z.number()),
  tint: z.optional(z.number()),
  highlights: z.optional(z.number()),
  shadows: z.optional(z.number()),
  sharpen: z.optional(z.number()),
  vignette: z.optional(z.number()),
});

/** Which way a transition (or a directional animation) moves. */
export const DirectionSchema = z.enum(['left', 'right', 'up', 'down']);

/** Timing curve of a transition: `smooth` (default), `linear`, `snappy` or `bounce`. */
export const EaseSchema = z.enum([
  'linear',
  'smooth',
  'ease-in',
  'ease-out',
  'snappy',
  'expo',
  'back',
  'anticipate',
  'bounce',
  'elastic',
  'ball',
  'slow-mo',
  'steps',
]);

export const TransitionSchema = z.object({
  /** Transition preset id (`TRANSITION_PRESETS`), e.g. `'fade'`. */
  type: id,
  /** Centred on the cut: half before, half after. */
  duration: positiveTime,
  /**
   * Which way it moves, for presets that list `directions`. Missing = the preset's first
   * direction. Ignored by presets without directions.
   */
  direction: z.optional(DirectionSchema),
  /** Timing curve. Missing = the preset's own curve. */
  ease: z.optional(EaseSchema),
});

/** One entrance or exit animation of a lane item: a preset id and how long it plays. */
export const AnimationClipSchema = z.object({
  /** Animation preset id (`ANIMATION_PRESETS`, slot `in` or `out`). */
  type: id,
  /** Flicks. Clamped to the item's length when played (in + out never overlap). */
  duration: time,
});

/** A repeating animation of a lane item, from its start to its end. */
export const AnimationLoopSchema = z.object({
  /** Animation preset id (`ANIMATION_PRESETS`, slot `loop`). */
  type: id,
  /** Speed multiplier 0.25–4 (missing = 1). */
  speed: z.optional(z.number().check(z.gte(0.25), z.lte(4))),
});

/**
 * Entrance (`in`), exit (`out`) and repeating (`loop`) animations of a lane item (text, sticker,
 * picture-in-picture video / photo). Played from the item's own time, in preview and export.
 */
export const ItemAnimationSchema = z.object({
  in: z.optional(AnimationClipSchema),
  out: z.optional(AnimationClipSchema),
  loop: z.optional(AnimationLoopSchema),
});

export const BackgroundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('color'), color: z.string() }),
  /** Blurred, enlarged copy of the current main-track frame (the classic phone-video look). */
  z.object({ type: z.literal('blur'), amount: unit }),
]);

/**
 * Text look. Units (engine/text.ts): font size = `size` × canvas height × transform.scale;
 * `letterSpacing` in em; `lineHeight`, `outline.width`, `background.padding` and
 * `background.radius` × font size; `shadow` blur / x / y in px at a 1080-px-tall canvas.
 */
export const TextStyleSchema = z.object({
  fontFamily: z.string(),
  fontWeight: z.int(),
  italic: z.boolean(),
  /** Font size as a fraction of canvas height. */
  size: z.number().check(z.positive()),
  color: z.string(),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().check(z.positive()),
  letterSpacing: z.number(),
  outline: z.nullable(z.object({ color: z.string(), width: z.number().check(z.nonnegative()) })),
  shadow: z.nullable(
    z.object({
      color: z.string(),
      blur: z.number().check(z.nonnegative()),
      x: z.number(),
      y: z.number(),
    }),
  ),
  background: z.nullable(
    z.object({
      color: z.string(),
      padding: z.number().check(z.nonnegative()),
      radius: z.number().check(z.nonnegative()),
    }),
  ),
});

const base = {
  id,
  /** Where the item starts on the timeline. */
  start: time,
  /** How long it lasts on the timeline. */
  duration: positiveTime,
  name: z.optional(z.string()),
};

const visual = {
  transform: TransformSchema,
  crop: CropSchema,
  /** How the media fills the canvas at scale 1: inside it (`fit`) or covering it (`fill`). */
  fit: z.enum(['fit', 'fill']),
  filter: z.nullable(FilterSchema),
  adjust: AdjustSchema,
  /** Main track only: transition from the previous item into this one. */
  transitionIn: z.nullable(TransitionSchema),
  /** Lanes only (picture-in-picture): entrance / exit / loop animations. Ignored on the main track. */
  animation: z.optional(ItemAnimationSchema),
};

const audible = {
  /** Gain: 1 = original, 0…2. */
  volume: z.number().check(z.gte(0), z.lte(2)),
  muted: z.boolean(),
  fadeIn: time,
  fadeOut: time,
};

export const VideoItemSchema = z.object({
  ...base,
  ...visual,
  ...audible,
  kind: z.literal('video'),
  assetId: id,
  /** Where in the source media the item starts. */
  sourceIn: time,
  /** Playback speed; source span = duration × speed. */
  speed: z.number().check(z.gte(0.05), z.lte(100)),
});

export const ImageItemSchema = z.object({
  ...base,
  ...visual,
  kind: z.literal('image'),
  assetId: id,
});

/** A still frame taken from a video at `sourceTime`. */
export const FreezeItemSchema = z.object({
  ...base,
  ...visual,
  kind: z.literal('freeze'),
  assetId: id,
  sourceTime: time,
});

export const AudioItemSchema = z.object({
  ...base,
  ...audible,
  kind: z.literal('audio'),
  assetId: id,
  sourceIn: time,
  speed: z.number().check(z.gte(0.05), z.lte(100)),
});

export const TextItemSchema = z.object({
  ...base,
  kind: z.literal('text'),
  text: z.string(),
  style: TextStyleSchema,
  transform: TransformSchema,
  /** A colour look, as on pictures (file version 2+). */
  filter: z.nullable(FilterSchema),
  adjust: AdjustSchema,
  /** Entrance / exit / loop animations. */
  animation: z.optional(ItemAnimationSchema),
});

export const StickerItemSchema = z.object({
  ...base,
  kind: z.literal('sticker'),
  /**
   * An image/GIF asset, or an emoji character. Exactly one is set. At transform.scale 1 the
   * sticker contain-fits the canvas (an emoji is a square of side min(width, height)).
   */
  assetId: z.nullable(id),
  emoji: z.nullable(z.string()),
  transform: TransformSchema,
  /** A colour look, as on pictures (file version 2+). */
  filter: z.nullable(FilterSchema),
  adjust: AdjustSchema,
  /** Entrance / exit / loop animations. */
  animation: z.optional(ItemAnimationSchema),
});

export const ItemSchema = z.discriminatedUnion('kind', [
  VideoItemSchema,
  ImageItemSchema,
  FreezeItemSchema,
  AudioItemSchema,
  TextItemSchema,
  StickerItemSchema,
]);

export const TrackSchema = z.object({
  id,
  /**
   * `main`: the story — items back to back from 0, no gaps (exactly one main track).
   * `overlay`: picture-in-picture video/images/stickers. `text`: titles. `audio`: music, sfx, voice.
   * Items within one track never overlap.
   */
  kind: z.enum(['main', 'overlay', 'text', 'audio']),
  muted: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean(),
  items: z.array(ItemSchema),
});

export const AssetSchema = z.object({
  id,
  kind: z.enum(['video', 'audio', 'image']),
  name: z.string(),
  mimeType: z.string(),
  size: z.int().check(z.nonnegative()),
  /** Media duration; 0 for still images. */
  duration: time,
  width: z.optional(z.int().check(z.positive())),
  height: z.optional(z.int().check(z.positive())),
  /** Clockwise rotation from the file's metadata. */
  rotation: z.optional(z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])),
  hasAudio: z.boolean(),
  hdr: z.optional(z.boolean()),
  /** Best-guess frame rate (video). */
  fps: z.optional(z.number().check(z.positive())),
  /** Variable frame rate (video). */
  vfr: z.optional(z.boolean()),
  /** Which of the file's audio tracks plays (iPhones add an extra spatial-audio track). */
  audioTrack: z.optional(z.int().check(z.nonnegative())),
  /** Where the bytes live. The host can resolve `url` sources itself. */
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('opfs'), key: z.string() }),
    z.object({ type: z.literal('handle'), key: z.string() }),
    z.object({ type: z.literal('url'), url: z.string() }),
  ]),
});

export const ProjectSchema = z.object({
  version: z.literal(PROJECT_VERSION),
  id,
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: z.object({
    width: z.int().check(z.positive()),
    height: z.int().check(z.positive()),
    frameRate: FrameRateSchema,
    background: BackgroundSchema,
  }),
  assets: z.record(z.string(), AssetSchema),
  tracks: z.array(TrackSchema),
});

export type Transform = z.infer<typeof TransformSchema>;
export type Crop = z.infer<typeof CropSchema>;
export type Filter = z.infer<typeof FilterSchema>;
export type Adjust = z.infer<typeof AdjustSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
/** Which way a transition moves. */
export type Direction = z.infer<typeof DirectionSchema>;
/** A transition's timing curve. */
export type Ease = z.infer<typeof EaseSchema>;
/** An entrance or exit animation (`animation.in` / `animation.out`). */
export type AnimationClip = z.infer<typeof AnimationClipSchema>;
/** A repeating animation (`animation.loop`). */
export type AnimationLoop = z.infer<typeof AnimationLoopSchema>;
/** A lane item's animations. */
export type ItemAnimation = z.infer<typeof ItemAnimationSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type VideoItem = z.infer<typeof VideoItemSchema>;
export type ImageItem = z.infer<typeof ImageItemSchema>;
export type FreezeItem = z.infer<typeof FreezeItemSchema>;
export type AudioItem = z.infer<typeof AudioItemSchema>;
export type TextItem = z.infer<typeof TextItemSchema>;
export type StickerItem = z.infer<typeof StickerItemSchema>;
/** Anything that sits on a track. */
export type Item = z.infer<typeof ItemSchema>;
export type ItemKind = Item['kind'];
export type Track = z.infer<typeof TrackSchema>;
export type TrackKind = Track['kind'];
/** An imported media file. */
export type Asset = z.infer<typeof AssetSchema>;
/** A whole project: settings, media and tracks. */
export type Project = z.infer<typeof ProjectSchema>;
