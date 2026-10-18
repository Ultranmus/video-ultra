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

export const PROJECT_VERSION = 4;

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

// Keyframes (v0.4, file version 4+; model/keyframes.ts has the maths).
/** A cubic Bézier timing curve `[x1, y1, x2, y2]` (CSS `cubic-bezier`; x in 0…1). */
export const BezierSchema = z.tuple([
  z.number().check(z.gte(0), z.lte(1)),
  z.number(),
  z.number().check(z.gte(0), z.lte(1)),
  z.number(),
]);

export const KeyframeSchema = z.object({
  /** Flicks from the item's start. */
  t: z.int().check(z.nonnegative()),
  /** The property's value there (transform units: canvas fractions, scale, degrees, 0…1). */
  v: z.number(),
  /** The curve from here to the next keyframe. Missing = `smooth`. */
  ease: z.optional(z.union([EaseSchema, BezierSchema])),
});

export const KeyframesSchema = z.object({
  /**
   * Flicks added to the item's time before sampling: a part of a split (or a clip trimmed at its
   * start) keeps the whole motion and plays its own share of it, exactly. Missing = 0.
   */
  shift: z.optional(z.int()),
  x: z.optional(z.array(KeyframeSchema)),
  y: z.optional(z.array(KeyframeSchema)),
  scale: z.optional(z.array(KeyframeSchema)),
  rotation: z.optional(z.array(KeyframeSchema)),
  opacity: z.optional(z.array(KeyframeSchema)),
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
  /** Can be selected but not moved, trimmed or edited until unlocked (file version 3+). */
  locked: z.optional(z.boolean()),
  /** Not drawn in the preview or the export; a video's sound still plays (file version 3+). */
  hidden: z.optional(z.boolean()),
  /**
   * Lane items sharing a group id select, move (on the stage and in time) and scale together
   * (file version 3+). Main-track clips are never grouped.
   */
  groupId: z.optional(id),
};

/**
 * Green screen (file version 3+, optional): pixels close to `color` become transparent. Values
 * 0…1: `tolerance` widens the range of removed colours, `softness` feathers the edge,
 * `spill` takes the key colour's tint off what remains (green fringes on hair).
 */
export const ChromaKeySchema = z.object({
  /** The colour to remove, `#rrggbb`. */
  color: z.string(),
  tolerance: unit,
  softness: unit,
  spill: unit,
});

/**
 * A 3D LUT look (file version 3+, optional): a `.cube` file stored as a `lut` asset, applied after
 * the filter and adjustments, mixed in by `intensity`.
 */
export const LutRefSchema = z.object({
  assetId: id,
  intensity: unit,
});

/**
 * How a layer mixes with the pictures under it (file version 3+, optional; missing = `normal`).
 * Lane items only — the main video is the bottom of the stack.
 */
export const BlendModeSchema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'add',
  'lighten',
  'darken',
  'difference',
]);

/**
 * A shape mask (file version 4+, optional): the picture shows only inside the shape (or only
 * outside it, `invert`). The shape fits the picture's box (effects/shapes.ts).
 */
export const ShapeMaskSchema = z.object({
  /** Shape preset id (`SHAPE_PRESETS`), e.g. `'circle'`, `'star-5'`, `'heart'`. */
  shape: id,
  /** Soft edge, 0 (sharp) … 1 (very soft). */
  feather: unit,
  /** Show the outside of the shape instead. */
  invert: z.optional(z.boolean()),
});

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
  /** Green screen (file version 3+). Missing = off. */
  key: z.optional(ChromaKeySchema),
  /** A 3D LUT look on top of the filter (file version 3+). Missing = none. */
  lut: z.optional(LutRefSchema),
  /** Lanes only: how the picture mixes with what's under it (file version 3+). */
  blend: z.optional(BlendModeSchema),
  /** Shape mask (file version 4+). Missing = the whole picture. */
  mask: z.optional(ShapeMaskSchema),
  /** Transform keyframes (file version 4+). */
  keyframes: z.optional(KeyframesSchema),
};

const audible = {
  /** Gain: 1 = original, 0…2. */
  volume: z.number().check(z.gte(0), z.lte(2)),
  muted: z.boolean(),
  fadeIn: time,
  fadeOut: time,
  /**
   * Lower under voice (ducking, file version 3+): while the project's other sound — video clips'
   * own sound, voiceovers, anything not itself ducked — has a voice in it, this item plays at
   * `1 − duck` of its volume (eased in and out). 0…1; missing = off.
   */
  duck: z.optional(unit),
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

/**
 * A picture with its background removed (file version 4+): the engine draws this image asset
 * (same size, transparent background) instead of the item's own. The original stays, so
 * restoring the background is removing this.
 */
export const CutoutSchema = z.object({ assetId: id });

export const ImageItemSchema = z.object({
  ...base,
  ...visual,
  kind: z.literal('image'),
  assetId: id,
  /** Background removed (file version 4+). */
  cutout: z.optional(CutoutSchema),
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

/** One spoken word of a caption: its text and when it's said, relative to the caption's start. */
export const CaptionWordSchema = z.object({
  text: z.string(),
  start: time,
  end: time,
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
  /** How the text mixes with what's under it (file version 3+). Missing = normal. */
  blend: z.optional(BlendModeSchema),
  /**
   * Captions: each spoken word and its time from the caption's start (file version 3+). Drives
   * word highlighting; captions typed or imported without it share their time evenly.
   */
  words: z.optional(z.array(CaptionWordSchema)),
  /** Transform keyframes (file version 4+). */
  keyframes: z.optional(KeyframesSchema),
  /**
   * Wrap width as a fraction of the canvas width (file version 3+): lines break at spaces to fit,
   * balanced so they're about the same length. Missing = lines break only where the text does.
   */
  maxWidth: z.optional(z.number().check(z.gte(0.05), z.lte(1))),
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
  /** How the sticker mixes with what's under it (file version 3+). Missing = normal. */
  blend: z.optional(BlendModeSchema),
  /** Transform keyframes (file version 4+). */
  keyframes: z.optional(KeyframesSchema),
  /** Image stickers: background removed (file version 4+). */
  cutout: z.optional(CutoutSchema),
});

/**
 * A blurred or pixelated area (file version 3+): hides what is under it (faces, number plates)
 * for its time on a picture layer. The box is `width × height` (fractions of the canvas width and
 * height) at `transform.scale` 1, centred at `transform.x / y` and turned by `transform.rotation`;
 * `transform.opacity` fades the effect.
 */
export const RegionItemSchema = z.object({
  ...base,
  kind: z.literal('region'),
  /** Blur, or a mosaic of big pixels. */
  effect: z.enum(['blur', 'pixelate']),
  shape: z.enum(['rectangle', 'ellipse']),
  /** Strength 0…1: how soft the blur is / how big the mosaic's cells are. */
  amount: unit,
  width: z.number().check(z.positive()),
  height: z.number().check(z.positive()),
  transform: TransformSchema,
  /** Transform keyframes (file version 4+). */
  keyframes: z.optional(KeyframesSchema),
});

export const ItemSchema = z.discriminatedUnion('kind', [
  VideoItemSchema,
  ImageItemSchema,
  FreezeItemSchema,
  AudioItemSchema,
  TextItemSchema,
  StickerItemSchema,
  RegionItemSchema,
]);

/**
 * How a caption row looks beyond each caption's own text style (file version 3+): the style
 * preset it came from, and the word highlight (karaoke) as words are spoken.
 */
export const CaptionLookSchema = z.object({
  /** Caption style preset id (`CAPTION_PRESETS`), for the picker. */
  preset: z.string(),
  /**
   * `none`; `word`: the word being said changes colour; `box`: it gets a box behind it; `fill`:
   * words fill with colour letter by letter as they're said; `reveal`: words appear as they're
   * said; `type`: letters appear as they're said.
   */
  highlight: z.enum(['none', 'word', 'box', 'fill', 'reveal', 'type']),
  /** Colour of the highlight (text colour, or the box). */
  highlightColor: z.string(),
});

export const TrackSchema = z.object({
  id,
  /**
   * `main`: the story — items back to back from 0, no gaps (exactly one main track).
   * `overlay`: picture-in-picture video/images/stickers and blurred areas. `text`: titles. `audio`: music, sfx, voice.
   * `caption`: captions — text items in time order with one look (file version 3+).
   * Items within one track never overlap.
   */
  kind: z.enum(['main', 'overlay', 'text', 'audio', 'caption']),
  muted: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean(),
  items: z.array(ItemSchema),
  /** Caption rows only: their look (file version 3+). */
  caption: z.optional(CaptionLookSchema),
});

export const AssetSchema = z.object({
  id,
  /** `lut`: a `.cube` colour look file (file version 3+), used by items' `lut`. */
  kind: z.enum(['video', 'audio', 'image', 'lut']),
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
  /**
   * Licence / attribution line for media that came from a library (e.g. "Song — Artist, CC BY
   * 4.0"), kept so the host can credit it (file version 3+).
   */
  credit: z.optional(z.string().check(z.maxLength(500))),
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
    /**
     * The part of the timeline to export (in / out points, flicks; `end` exclusive). Optional
     * (file version 3+); missing = the whole video. May lie past the end after edits: exports
     * clamp it to the video's length.
     */
    exportRange: z.optional(z.object({ start: time, end: positiveTime })),
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
/** One spoken word of a caption (times relative to the caption's start). */
export type CaptionWord = z.infer<typeof CaptionWordSchema>;
/** A caption row's look: preset and word highlight. */
export type CaptionLook = z.infer<typeof CaptionLookSchema>;
export type VideoItem = z.infer<typeof VideoItemSchema>;
export type ImageItem = z.infer<typeof ImageItemSchema>;
export type FreezeItem = z.infer<typeof FreezeItemSchema>;
export type AudioItem = z.infer<typeof AudioItemSchema>;
export type TextItem = z.infer<typeof TextItemSchema>;
export type StickerItem = z.infer<typeof StickerItemSchema>;
/** A blurred / pixelated area on a picture layer. */
export type RegionItem = z.infer<typeof RegionItemSchema>;
/** Green-screen settings of a picture. */
export type ChromaKey = z.infer<typeof ChromaKeySchema>;
/** A picture's LUT look. */
export type LutRef = z.infer<typeof LutRefSchema>;
/** How a layer mixes with what's under it. */
export type BlendMode = z.infer<typeof BlendModeSchema>;
/** A custom timing curve `[x1, y1, x2, y2]`. */
export type Bezier = z.infer<typeof BezierSchema>;
/** One keyframe: a time (flicks from the item's start), a value, the curve to the next. */
export type Keyframe = z.infer<typeof KeyframeSchema>;
/** An item's keyframes, per transform property (time order). */
export type Keyframes = z.infer<typeof KeyframesSchema>;
/** A picture with its background removed. */
export type Cutout = z.infer<typeof CutoutSchema>;
/** A picture's shape mask. */
export type ShapeMask = z.infer<typeof ShapeMaskSchema>;
/** Anything that sits on a track. */
export type Item = z.infer<typeof ItemSchema>;
export type ItemKind = Item['kind'];
export type Track = z.infer<typeof TrackSchema>;
export type TrackKind = Track['kind'];
/** An imported media file. */
export type Asset = z.infer<typeof AssetSchema>;
/** A whole project: settings, media and tracks. */
export type Project = z.infer<typeof ProjectSchema>;
