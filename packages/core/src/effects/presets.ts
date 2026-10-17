import type { Adjust, Direction, Ease } from '../model/schema';

/**
 * Catalogues the editor UI offers: filters, transitions, animations, adjustments, sticker emoji
 * and text styles — data only (ids, labels, groups), so the UI bundle doesn't carry the engine's
 * parameter tables and look functions (effects/filters.ts, transitions.ts, animations.ts, keyed
 * by these ids). Ids are stored in projects, so they never change once released; labels are
 * plain English defaults (the UI translates them).
 */

// ── filters ───────────────────────────────────────────────────────────────

/** Filter groups, in display order. */
export type FilterCategory =
  | 'natural'
  | 'vivid'
  | 'warm'
  | 'cool'
  | 'film'
  | 'vintage'
  | 'cinematic'
  | 'moody'
  | 'pastel'
  | 'bw'
  | 'retro'
  | 'food'
  | 'portrait'
  | 'landscape'
  | 'night';

/** A filter the user can pick. `id` goes into `item.filter.id`. */
export interface FilterPreset {
  readonly id: string;
  readonly label: string;
  /** Group for the UI (see {@link FILTER_CATEGORIES}). */
  readonly category: FilterCategory;
}

// prettier-ignore
const FILTERS: readonly (readonly [string, string, FilterCategory])[] = [
  ['natural', 'Natural', 'natural'],
  ['bright', 'Bright', 'natural'],
  ['clear', 'Clear', 'natural'],
  ['crisp', 'Crisp', 'natural'],
  ['soft', 'Soft', 'natural'],
  ['daylight', 'Daylight', 'natural'],
  ['true', 'True colour', 'natural'],
  ['fresh', 'Fresh', 'natural'],
  ['vivid', 'Vivid', 'vivid'],
  ['punch', 'Punch', 'vivid'],
  ['pop', 'Pop', 'vivid'],
  ['electric', 'Electric', 'vivid'],
  ['juicy', 'Juicy', 'vivid'],
  ['bold', 'Bold', 'vivid'],
  ['neon', 'Neon', 'vivid'],
  ['rich', 'Rich', 'vivid'],
  ['warm', 'Warm', 'warm'],
  ['golden', 'Golden', 'warm'],
  ['sunset', 'Sunset', 'warm'],
  ['honey', 'Honey', 'warm'],
  ['amber', 'Amber', 'warm'],
  ['cozy', 'Cozy', 'warm'],
  ['peach', 'Peach', 'warm'],
  ['autumn', 'Autumn', 'warm'],
  ['cool', 'Cool', 'cool'],
  ['arctic', 'Arctic', 'cool'],
  ['blue-hour', 'Blue hour', 'cool'],
  ['mint', 'Mint', 'cool'],
  ['ice', 'Ice', 'cool'],
  ['ocean', 'Ocean', 'cool'],
  ['steel', 'Steel', 'cool'],
  ['lagoon', 'Lagoon', 'cool'],
  ['film', 'Film', 'film'],
  ['fade', 'Fade', 'film'],
  ['matte', 'Matte', 'film'],
  ['warm-film', 'Warm film', 'film'],
  ['cool-film', 'Cool film', 'film'],
  ['grainy', 'Grainy', 'film'],
  ['expired', 'Expired', 'film'],
  ['super8', 'Home movie', 'film'],
  ['vintage', 'Vintage', 'vintage'],
  ['sepia', 'Sepia', 'vintage'],
  ['antique', 'Antique', 'vintage'],
  ['instant', 'Instant', 'vintage'],
  ['old-photo', 'Old photo', 'vintage'],
  ['dusty', 'Dusty', 'vintage'],
  ['tea', 'Tea', 'vintage'],
  ['teal-orange', 'Teal & orange', 'cinematic'],
  ['blockbuster', 'Blockbuster', 'cinematic'],
  ['bleach', 'Bleach', 'cinematic'],
  ['epic', 'Epic', 'cinematic'],
  ['dune', 'Dune', 'cinematic'],
  ['cyber', 'Cyber', 'cinematic'],
  ['western', 'Western', 'cinematic'],
  ['thriller', 'Thriller', 'cinematic'],
  ['moody', 'Moody', 'moody'],
  ['dark', 'Dark', 'moody'],
  ['storm', 'Storm', 'moody'],
  ['dusk', 'Dusk', 'moody'],
  ['shadow', 'Shadow', 'moody'],
  ['melancholy', 'Melancholy', 'moody'],
  ['deep', 'Deep', 'moody'],
  ['dream', 'Dream', 'pastel'],
  ['pastel', 'Pastel', 'pastel'],
  ['cotton', 'Cotton candy', 'pastel'],
  ['lavender', 'Lavender', 'pastel'],
  ['blush', 'Blush', 'pastel'],
  ['airy', 'Airy', 'pastel'],
  ['sorbet', 'Sorbet', 'pastel'],
  ['milk', 'Milk', 'pastel'],
  ['mono', 'Mono', 'bw'],
  ['noir', 'Noir', 'bw'],
  ['silver', 'Silver', 'bw'],
  ['bright-bw', 'Bright B&W', 'bw'],
  ['contrast-bw', 'Hard B&W', 'bw'],
  ['soft-bw', 'Soft B&W', 'bw'],
  ['grain-bw', 'Grain B&W', 'bw'],
  ['blue-tone', 'Blue tone', 'bw'],
  ['seventies', '70s', 'retro'],
  ['eighties', '80s', 'retro'],
  ['nineties', '90s', 'retro'],
  ['tape', 'Tape', 'retro'],
  ['disco', 'Disco', 'retro'],
  ['arcade', 'Arcade', 'retro'],
  ['retro-pop', 'Retro pop', 'retro'],
  ['cross', 'Cross process', 'retro'],
  ['tasty', 'Tasty', 'food'],
  ['savory', 'Savory', 'food'],
  ['sweet', 'Sweet', 'food'],
  ['bistro', 'Bistro', 'food'],
  ['brunch', 'Brunch', 'food'],
  ['crispy', 'Crispy', 'food'],
  ['spice', 'Spice', 'food'],
  ['portrait', 'Portrait', 'portrait'],
  ['glow', 'Glow', 'portrait'],
  ['skin', 'Skin', 'portrait'],
  ['rosy', 'Rosy', 'portrait'],
  ['studio', 'Studio', 'portrait'],
  ['soft-focus', 'Soft focus', 'portrait'],
  ['bronze', 'Bronze', 'portrait'],
  ['landscape', 'Landscape', 'landscape'],
  ['sky', 'Sky', 'landscape'],
  ['green', 'Green', 'landscape'],
  ['mountain', 'Mountain', 'landscape'],
  ['desert', 'Desert', 'landscape'],
  ['tropical', 'Tropical', 'landscape'],
  ['mist', 'Mist', 'landscape'],
  ['harvest', 'Harvest', 'landscape'],
  ['night', 'Night', 'night'],
  ['neon-night', 'Neon night', 'night'],
  ['city-lights', 'City lights', 'night'],
  ['moonlight', 'Moonlight', 'night'],
  ['midnight', 'Midnight', 'night'],
  ['night-vision', 'Night vision', 'night'],
  ['candle', 'Candlelight', 'night'],
];

/**
 * Colour filters for video, photo and freeze clips, in display order (grouped by category; the
 * first 16 ids shipped in v0.1). "No filter" is not in the list: it is `item.filter = null`.
 */
export const FILTER_PRESETS: readonly FilterPreset[] = Object.freeze(
  FILTERS.map(([id, label, category]) => Object.freeze({ id, label, category })),
);

/** Filter groups with their labels, in display order. */
export const FILTER_CATEGORIES: readonly { readonly id: FilterCategory; readonly label: string }[] =
  Object.freeze([
    { id: 'natural', label: 'Natural' },
    { id: 'vivid', label: 'Vivid' },
    { id: 'warm', label: 'Warm' },
    { id: 'cool', label: 'Cool' },
    { id: 'film', label: 'Film' },
    { id: 'vintage', label: 'Vintage' },
    { id: 'cinematic', label: 'Cinematic' },
    { id: 'moody', label: 'Moody' },
    { id: 'pastel', label: 'Pastel' },
    { id: 'bw', label: 'Black & white' },
    { id: 'retro', label: 'Retro' },
    { id: 'food', label: 'Food' },
    { id: 'portrait', label: 'Portrait' },
    { id: 'landscape', label: 'Landscape' },
    { id: 'night', label: 'Night' },
  ]);

// ── transitions ───────────────────────────────────────────────────────────

/** Transition groups, in display order. */
export type TransitionCategory =
  'basic' | 'slide' | 'wipe' | 'zoom' | 'blur' | 'light' | 'glitch' | 'shape' | 'distort' | '3d';

/** A transition the user can pick. `id` goes into `item.transitionIn.type`. */
export interface TransitionPreset {
  readonly id: string;
  readonly label: string;
  readonly category: TransitionCategory;
  /** Directions it can move in (`transitionIn.direction`); the first is the default. */
  readonly directions?: readonly Direction[];
  /** Suggested length in seconds (default 0.5). */
  readonly defaultDuration?: number;
  /** The curve it uses when `transitionIn.ease` is missing. */
  readonly ease: Ease;
}

const ALL: readonly Direction[] = Object.freeze(['left', 'right', 'up', 'down']);
const ALL_RIGHT: readonly Direction[] = Object.freeze(['right', 'left', 'up', 'down']);
const SIDES: readonly Direction[] = Object.freeze(['left', 'right']);
const SIDES_RIGHT: readonly Direction[] = Object.freeze(['right', 'left']);
/** Axis-only presets: `left` = horizontal, `up` = vertical. */
const AXES: readonly Direction[] = Object.freeze(['left', 'up']);

const TRANSITIONS: TransitionPreset[] = [
  { id: 'fade', label: 'Fade', category: 'basic', ease: 'linear' },
  { id: 'dissolve', label: 'Dissolve', category: 'basic', ease: 'smooth' },
  { id: 'dip-white', label: 'Dip to white', category: 'basic', ease: 'linear' },
  { id: 'dip-color', label: 'Dip to colour', category: 'basic', ease: 'linear' },
  { id: 'flash', label: 'Flash', category: 'basic', defaultDuration: 0.4, ease: 'linear' },
  { id: 'luma-dissolve', label: 'Light dissolve', category: 'basic', ease: 'smooth' },
  { id: 'additive', label: 'Glow dissolve', category: 'basic', ease: 'smooth' },
  { id: 'push', label: 'Push', category: 'slide', directions: ALL, ease: 'smooth' },
  { id: 'cover', label: 'Cover', category: 'slide', directions: ALL, ease: 'smooth' },
  { id: 'reveal', label: 'Reveal', category: 'slide', directions: ALL, ease: 'smooth' },
  { id: 'slide-fade', label: 'Slide & fade', category: 'slide', directions: ALL, ease: 'smooth' },
  { id: 'elastic-slide', label: 'Elastic', category: 'slide', directions: ALL, ease: 'bounce' },
  {
    id: 'whip',
    label: 'Whip pan',
    category: 'slide',
    directions: ALL,
    defaultDuration: 0.4,
    ease: 'snappy',
  },
  { id: 'swipe', label: 'Swipe', category: 'slide', directions: ALL, ease: 'smooth' },
  { id: 'stack', label: 'Stack', category: 'slide', directions: ALL, ease: 'smooth' },
  { id: 'wipe', label: 'Wipe', category: 'wipe', directions: ALL_RIGHT, ease: 'smooth' },
  { id: 'wipe-soft', label: 'Soft wipe', category: 'wipe', directions: ALL_RIGHT, ease: 'smooth' },
  {
    id: 'wipe-diagonal',
    label: 'Diagonal',
    category: 'wipe',
    directions: ALL_RIGHT,
    ease: 'smooth',
  },
  { id: 'clock', label: 'Clock', category: 'wipe', directions: SIDES_RIGHT, ease: 'linear' },
  { id: 'circle-open', label: 'Circle open', category: 'wipe', ease: 'smooth' },
  { id: 'circle-close', label: 'Circle close', category: 'wipe', ease: 'smooth' },
  { id: 'diamond', label: 'Diamond', category: 'wipe', ease: 'smooth' },
  { id: 'box', label: 'Box', category: 'wipe', ease: 'smooth' },
  { id: 'blinds', label: 'Blinds', category: 'wipe', directions: ALL_RIGHT, ease: 'smooth' },
  { id: 'checker', label: 'Checkers', category: 'wipe', directions: ALL_RIGHT, ease: 'linear' },
  { id: 'split', label: 'Split', category: 'wipe', directions: AXES, ease: 'smooth' },
  { id: 'barn-doors', label: 'Barn doors', category: 'wipe', directions: AXES, ease: 'smooth' },
  { id: 'zigzag', label: 'Zigzag', category: 'wipe', directions: ALL_RIGHT, ease: 'smooth' },
  { id: 'wave-wipe', label: 'Wavy wipe', category: 'wipe', directions: ALL_RIGHT, ease: 'smooth' },
  { id: 'fan', label: 'Fan', category: 'wipe', ease: 'smooth' },
  { id: 'zoom', label: 'Zoom', category: 'zoom', ease: 'smooth' },
  { id: 'zoom-in', label: 'Zoom in', category: 'zoom', ease: 'smooth' },
  { id: 'zoom-out', label: 'Zoom out', category: 'zoom', ease: 'smooth' },
  { id: 'zoom-blur', label: 'Zoom blur', category: 'zoom', ease: 'smooth' },
  { id: 'spin-zoom', label: 'Spin zoom', category: 'zoom', directions: SIDES, ease: 'smooth' },
  { id: 'rotate', label: 'Rotate', category: 'zoom', directions: SIDES, ease: 'smooth' },
  { id: 'swirl', label: 'Swirl', category: 'zoom', directions: SIDES, ease: 'smooth' },
  { id: 'punch', label: 'Punch in', category: 'zoom', defaultDuration: 0.4, ease: 'snappy' },
  { id: 'pop-in', label: 'Pop in', category: 'zoom', ease: 'bounce' },
  { id: 'shrink', label: 'Shrink', category: 'zoom', ease: 'smooth' },
  { id: 'blur', label: 'Blur', category: 'blur', ease: 'smooth' },
  { id: 'motion-blur', label: 'Motion blur', category: 'blur', directions: ALL, ease: 'smooth' },
  { id: 'radial-blur', label: 'Radial blur', category: 'blur', ease: 'smooth' },
  { id: 'spin-blur', label: 'Spin blur', category: 'blur', directions: SIDES, ease: 'smooth' },
  { id: 'focus', label: 'Focus', category: 'blur', ease: 'smooth' },
  {
    id: 'light-leak',
    label: 'Light leak',
    category: 'light',
    directions: SIDES,
    defaultDuration: 1,
    ease: 'smooth',
  },
  { id: 'glow', label: 'Glow', category: 'light', ease: 'smooth' },
  { id: 'overexpose', label: 'Overexpose', category: 'light', ease: 'smooth' },
  {
    id: 'film-burn',
    label: 'Film burn',
    category: 'light',
    directions: SIDES,
    defaultDuration: 1,
    ease: 'smooth',
  },
  { id: 'flare', label: 'Flare', category: 'light', directions: SIDES, ease: 'smooth' },
  { id: 'strobe', label: 'Strobe', category: 'light', defaultDuration: 0.6, ease: 'linear' },
  { id: 'rgb-split', label: 'RGB split', category: 'glitch', defaultDuration: 0.5, ease: 'linear' },
  { id: 'pixelate', label: 'Pixelate', category: 'glitch', ease: 'linear' },
  { id: 'vhs', label: 'Tape glitch', category: 'glitch', ease: 'linear' },
  { id: 'noise-dissolve', label: 'Noise', category: 'glitch', ease: 'linear' },
  { id: 'glitch', label: 'Glitch', category: 'glitch', defaultDuration: 0.6, ease: 'linear' },
  { id: 'digital', label: 'Digital', category: 'glitch', ease: 'linear' },
  { id: 'static', label: 'Static', category: 'glitch', ease: 'linear' },
  { id: 'heart', label: 'Heart', category: 'shape', ease: 'smooth' },
  { id: 'star', label: 'Star', category: 'shape', ease: 'smooth' },
  { id: 'spotlight', label: 'Spotlight', category: 'shape', ease: 'smooth' },
  { id: 'flower', label: 'Flower', category: 'shape', ease: 'smooth' },
  { id: 'hexagon', label: 'Hexagon', category: 'shape', ease: 'smooth' },
  { id: 'triangle', label: 'Triangle', category: 'shape', ease: 'smooth' },
  { id: 'ripple', label: 'Ripple', category: 'distort', defaultDuration: 1, ease: 'smooth' },
  { id: 'wave', label: 'Wave', category: 'distort', directions: ALL, ease: 'smooth' },
  { id: 'page-curl', label: 'Page turn', category: 'distort', directions: ALL, ease: 'smooth' },
  { id: 'squeeze', label: 'Squeeze', category: 'distort', directions: ALL, ease: 'smooth' },
  { id: 'stretch', label: 'Stretch', category: 'distort', directions: ALL, ease: 'smooth' },
  { id: 'lens', label: 'Lens', category: 'distort', ease: 'smooth' },
  { id: 'shake', label: 'Shake', category: 'distort', defaultDuration: 0.5, ease: 'linear' },
  { id: 'cube', label: 'Cube', category: '3d', directions: ALL, ease: 'smooth' },
  { id: 'flip', label: 'Flip', category: '3d', directions: ALL, ease: 'smooth' },
  { id: 'door', label: 'Door', category: '3d', directions: ALL, ease: 'smooth' },
  { id: 'tilt', label: 'Tilt', category: '3d', directions: ALL, ease: 'smooth' },
  { id: 'swing', label: 'Swing', category: '3d', directions: ALL, ease: 'bounce' },
];

/**
 * Transitions between main-track clips, in display order (grouped by category). Each plays over a
 * window centred on the cut (half before, half after).
 */
export const TRANSITION_PRESETS: readonly TransitionPreset[] = Object.freeze(
  TRANSITIONS.map((p) => Object.freeze(p)),
);

/** Transition groups with their labels, in display order. */
export const TRANSITION_CATEGORIES: readonly {
  readonly id: TransitionCategory;
  readonly label: string;
}[] = Object.freeze([
  { id: 'basic', label: 'Basic' },
  { id: 'slide', label: 'Slide' },
  { id: 'wipe', label: 'Wipe' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'blur', label: 'Blur' },
  { id: 'light', label: 'Light' },
  { id: 'glitch', label: 'Glitch' },
  { id: 'shape', label: 'Shape' },
  { id: 'distort', label: 'Distort' },
  { id: '3d', label: '3D' },
]);

/** Ids released before the library (v0.1) that became a preset + direction. */
export const TRANSITION_ALIASES: Readonly<Record<string, { id: string; direction: Direction }>> =
  Object.freeze({
    'slide-left': { id: 'push', direction: 'left' },
    'slide-up': { id: 'push', direction: 'up' },
  });

/**
 * The preset for a stored transition type, including ids from before the library
 * (`slide-left` → Push, left). Undefined for unknown ids (they play as a dissolve).
 */
export function findTransitionPreset(type: string): TransitionPreset | undefined {
  const id = TRANSITION_ALIASES[type]?.id ?? type;
  return TRANSITION_PRESETS.find((p) => p.id === id);
}

// ── element animations ────────────────────────────────────────────────────

/** Which part of an item's life an animation plays in. */
export type AnimationSlot = 'in' | 'out' | 'loop';

/** An animation the user can pick, for one slot. */
export interface AnimationPreset {
  /** Unique across all slots; stored in `item.animation[slot].type`. */
  readonly id: string;
  readonly label: string;
  readonly slot: AnimationSlot;
  /** Group for the UI (see {@link ANIMATION_CATEGORIES}). */
  readonly category: string;
  /** Only for text items (typewriter, word by word); elsewhere they play as a fade. */
  readonly textOnly?: boolean;
  /** Suggested length in seconds (entrances and exits). */
  readonly defaultDuration?: number;
}

const ANIMATIONS: AnimationPreset[] = [
  { id: 'fade-in', label: 'Fade', slot: 'in', category: 'basic', defaultDuration: 0.5 },
  { id: 'rise-in', label: 'Rise', slot: 'in', category: 'move', defaultDuration: 0.5 },
  { id: 'drop-in', label: 'Drop', slot: 'in', category: 'move', defaultDuration: 0.5 },
  { id: 'slide-left-in', label: 'From left', slot: 'in', category: 'move', defaultDuration: 0.5 },
  { id: 'slide-right-in', label: 'From right', slot: 'in', category: 'move', defaultDuration: 0.5 },
  { id: 'slide-top-in', label: 'From top', slot: 'in', category: 'move', defaultDuration: 0.5 },
  {
    id: 'slide-bottom-in',
    label: 'From bottom',
    slot: 'in',
    category: 'move',
    defaultDuration: 0.5,
  },
  { id: 'zoom-in', label: 'Zoom in', slot: 'in', category: 'scale', defaultDuration: 0.5 },
  { id: 'shrink-in', label: 'Zoom out', slot: 'in', category: 'scale', defaultDuration: 0.5 },
  { id: 'pop-in', label: 'Pop', slot: 'in', category: 'scale', defaultDuration: 0.5 },
  { id: 'bounce-in', label: 'Bounce', slot: 'in', category: 'fun', defaultDuration: 0.8 },
  { id: 'spin-in', label: 'Spin', slot: 'in', category: 'rotate', defaultDuration: 0.6 },
  { id: 'blur-in', label: 'Blur', slot: 'in', category: 'basic', defaultDuration: 0.5 },
  { id: 'wipe-right-in', label: 'Wipe', slot: 'in', category: 'reveal', defaultDuration: 0.5 },
  { id: 'wipe-up-in', label: 'Wipe up', slot: 'in', category: 'reveal', defaultDuration: 0.5 },
  {
    id: 'typewriter-in',
    label: 'Typewriter',
    slot: 'in',
    category: 'text',
    textOnly: true,
    defaultDuration: 1.5,
  },
  {
    id: 'words-in',
    label: 'Word by word',
    slot: 'in',
    category: 'text',
    textOnly: true,
    defaultDuration: 1.2,
  },
  { id: 'stomp-in', label: 'Stomp', slot: 'in', category: 'fun', defaultDuration: 0.6 },
  { id: 'tumble-in', label: 'Tumble', slot: 'in', category: 'rotate', defaultDuration: 0.7 },
  { id: 'flicker-in', label: 'Flicker', slot: 'in', category: 'fun', defaultDuration: 0.8 },
  { id: 'float-in', label: 'Float', slot: 'in', category: 'move', defaultDuration: 0.8 },
  { id: 'flip-in', label: 'Flip', slot: 'in', category: 'rotate', defaultDuration: 0.6 },
  { id: 'swing-in', label: 'Swing', slot: 'in', category: 'rotate', defaultDuration: 0.9 },
  { id: 'stretch-in', label: 'Stretch', slot: 'in', category: 'scale', defaultDuration: 0.5 },
  { id: 'grow-in', label: 'Grow', slot: 'in', category: 'scale', defaultDuration: 0.5 },
  { id: 'circle-in', label: 'Circle', slot: 'in', category: 'reveal', defaultDuration: 0.5 },
  { id: 'glitch-in', label: 'Glitch', slot: 'in', category: 'fun', defaultDuration: 0.5 },
  { id: 'elastic-in', label: 'Elastic', slot: 'in', category: 'scale', defaultDuration: 0.8 },
  { id: 'roll-in', label: 'Roll', slot: 'in', category: 'rotate', defaultDuration: 0.7 },
  { id: 'fly-in', label: 'Fly in', slot: 'in', category: 'move', defaultDuration: 0.5 },
  { id: 'fade-out', label: 'Fade', slot: 'out', category: 'basic', defaultDuration: 0.5 },
  { id: 'rise-out', label: 'Rise away', slot: 'out', category: 'move', defaultDuration: 0.5 },
  { id: 'drop-out', label: 'Fall', slot: 'out', category: 'move', defaultDuration: 0.5 },
  { id: 'slide-left-out', label: 'To left', slot: 'out', category: 'move', defaultDuration: 0.5 },
  { id: 'slide-right-out', label: 'To right', slot: 'out', category: 'move', defaultDuration: 0.5 },
  { id: 'slide-top-out', label: 'To top', slot: 'out', category: 'move', defaultDuration: 0.5 },
  {
    id: 'slide-bottom-out',
    label: 'To bottom',
    slot: 'out',
    category: 'move',
    defaultDuration: 0.5,
  },
  { id: 'shrink-out', label: 'Shrink', slot: 'out', category: 'scale', defaultDuration: 0.5 },
  { id: 'zoom-out', label: 'Zoom away', slot: 'out', category: 'scale', defaultDuration: 0.5 },
  { id: 'pop-out', label: 'Pop', slot: 'out', category: 'scale', defaultDuration: 0.5 },
  { id: 'bounce-out', label: 'Bounce', slot: 'out', category: 'fun', defaultDuration: 0.8 },
  { id: 'spin-out', label: 'Spin', slot: 'out', category: 'rotate', defaultDuration: 0.6 },
  { id: 'blur-out', label: 'Blur', slot: 'out', category: 'basic', defaultDuration: 0.5 },
  { id: 'wipe-right-out', label: 'Wipe', slot: 'out', category: 'reveal', defaultDuration: 0.5 },
  { id: 'wipe-up-out', label: 'Wipe up', slot: 'out', category: 'reveal', defaultDuration: 0.5 },
  {
    id: 'typewriter-out',
    label: 'Backspace',
    slot: 'out',
    category: 'text',
    textOnly: true,
    defaultDuration: 1,
  },
  {
    id: 'words-out',
    label: 'Word by word',
    slot: 'out',
    category: 'text',
    textOnly: true,
    defaultDuration: 1,
  },
  { id: 'tumble-out', label: 'Tumble', slot: 'out', category: 'rotate', defaultDuration: 0.7 },
  { id: 'flicker-out', label: 'Flicker', slot: 'out', category: 'fun', defaultDuration: 0.8 },
  { id: 'float-out', label: 'Float away', slot: 'out', category: 'move', defaultDuration: 0.8 },
  { id: 'flip-out', label: 'Flip', slot: 'out', category: 'rotate', defaultDuration: 0.6 },
  { id: 'swing-out', label: 'Swing', slot: 'out', category: 'rotate', defaultDuration: 0.9 },
  { id: 'stretch-out', label: 'Stretch', slot: 'out', category: 'scale', defaultDuration: 0.5 },
  { id: 'circle-out', label: 'Circle', slot: 'out', category: 'reveal', defaultDuration: 0.5 },
  { id: 'glitch-out', label: 'Glitch', slot: 'out', category: 'fun', defaultDuration: 0.5 },
  { id: 'roll-out', label: 'Roll', slot: 'out', category: 'rotate', defaultDuration: 0.7 },
  { id: 'fly-out', label: 'Fly out', slot: 'out', category: 'move', defaultDuration: 0.5 },
  { id: 'pulse', label: 'Pulse', slot: 'loop', category: 'pulse' },
  { id: 'wiggle', label: 'Wiggle', slot: 'loop', category: 'motion' },
  { id: 'float', label: 'Float', slot: 'loop', category: 'motion' },
  { id: 'spin', label: 'Spin', slot: 'loop', category: 'spin' },
  { id: 'blink', label: 'Blink', slot: 'loop', category: 'pulse' },
  { id: 'heartbeat', label: 'Heartbeat', slot: 'loop', category: 'pulse' },
  { id: 'shake', label: 'Shake', slot: 'loop', category: 'motion' },
  { id: 'sway', label: 'Sway', slot: 'loop', category: 'motion' },
  { id: 'breathe', label: 'Breathe', slot: 'loop', category: 'pulse' },
  { id: 'glow', label: 'Glow', slot: 'loop', category: 'pulse' },
  { id: 'hop', label: 'Hop', slot: 'loop', category: 'motion' },
  { id: 'jelly', label: 'Jelly', slot: 'loop', category: 'spin' },
  { id: 'orbit', label: 'Orbit', slot: 'loop', category: 'motion' },
];

/**
 * Animations of lane items (text, stickers, picture-in-picture): entrances, then exits (each the
 * mirror of an entrance), then loops, each in display order.
 */
export const ANIMATION_PRESETS: readonly AnimationPreset[] = Object.freeze(
  ANIMATIONS.map((p) => Object.freeze(p)),
);

/** Animation groups with their labels, in display order (`AnimationPreset.category`). */
export const ANIMATION_CATEGORIES: readonly { readonly id: string; readonly label: string }[] =
  Object.freeze([
    { id: 'basic', label: 'Basic' },
    { id: 'move', label: 'Move' },
    { id: 'scale', label: 'Scale' },
    { id: 'rotate', label: 'Rotate' },
    { id: 'reveal', label: 'Reveal' },
    { id: 'text', label: 'Text' },
    { id: 'fun', label: 'Fun' },
    { id: 'pulse', label: 'Pulse' },
    { id: 'motion', label: 'Motion' },
    { id: 'spin', label: 'Spin' },
  ]);

/** The preset with this id in this slot, or undefined. */
export function findAnimationPreset(slot: AnimationSlot, id: string): AnimationPreset | undefined {
  return ANIMATION_PRESETS.find((p) => p.slot === slot && p.id === id);
}

// ── adjustments, stickers, text ───────────────────────────────────────────

/** One adjustment slider. Every value is −1…1 and 0 means unchanged. */
export interface AdjustKey {
  readonly key: keyof Adjust;
  readonly label: string;
}

/** The adjustment sliders (keys of `item.adjust`), in display order. */
export const ADJUST_KEYS: readonly AdjustKey[] = Object.freeze([
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'warmth', label: 'Warmth' },
  { key: 'tint', label: 'Tint' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'sharpen', label: 'Sharpen' },
  { key: 'vignette', label: 'Vignette' },
]);

/** Common emoji for the sticker panel (stored as `sticker.emoji`). Drawn with the system's font. */
// prettier-ignore
export const STICKER_EMOJI: readonly string[] = Object.freeze([
  '😀', '😂', '🥹', '😍', '🥰', '😎', '🤩', '🥳',
  '😮', '😢', '😡', '🤔', '🙈', '👀', '💀', '🤯',
  '👍', '👏', '🙌', '🙏', '💪', '✌️', '👋', '🫶',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '💔', '💯',
  '🔥', '✨', '⭐', '🌟', '⚡', '💥', '🎉', '🎂',
  '🎁', '🎵', '📍', '☀️', '🌈', '🌸', '🍕', '☕',
]);

/** A text style preset: a font stack the device already has (nothing is downloaded). */
export interface FontPreset {
  readonly id: string;
  readonly label: string;
  /** CSS font-family list for `TextStyle.fontFamily`. */
  readonly family: string;
  /** CSS font weight for `TextStyle.fontWeight`. */
  readonly weight: number;
}

/**
 * Text styles, in display order. Only system and generic font stacks, so text looks right offline
 * and costs no downloads; each platform shows its closest installed face.
 */
// prettier-ignore
export const FONT_PRESETS: readonly FontPreset[] = Object.freeze([
  { id: 'classic', label: 'Classic', family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weight: 700 },
  { id: 'bold', label: 'Bold', family: 'Impact, "Arial Black", "Helvetica Neue", sans-serif', weight: 900 },
  { id: 'rounded', label: 'Rounded', family: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif', weight: 800 },
  { id: 'serif', label: 'Serif', family: 'Georgia, "Times New Roman", "Noto Serif", serif', weight: 700 },
  { id: 'elegant', label: 'Elegant', family: 'Didot, "Bodoni 72", "Playfair Display", Georgia, serif', weight: 400 },
  { id: 'typewriter', label: 'Typewriter', family: '"American Typewriter", "Courier New", ui-monospace, monospace', weight: 600 },
  { id: 'mono', label: 'Mono', family: 'ui-monospace, Menlo, Consolas, "Roboto Mono", monospace', weight: 500 },
  { id: 'handwritten', label: 'Handwritten', family: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive', weight: 400 },
]);
