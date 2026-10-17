import type { Adjust } from '../model/schema';

/**
 * Catalogues the editor UI offers: filters, transitions, adjustments, sticker emoji and text
 * styles. Ids are stored in projects, so they never change once released; labels are plain English
 * defaults (the UI translates them).
 */

/** A filter the user can pick. `id` goes into `item.filter.id`. */
export interface FilterPreset {
  readonly id: string;
  readonly label: string;
}

/**
 * Colour filters for video, photo and freeze clips, in display order. "No filter" is not in the
 * list: it is `item.filter = null`.
 */
export const FILTER_PRESETS: readonly FilterPreset[] = Object.freeze([
  { id: 'vivid', label: 'Vivid' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'golden', label: 'Golden' },
  { id: 'bright', label: 'Bright' },
  { id: 'punch', label: 'Punch' },
  { id: 'teal-orange', label: 'Teal & orange' },
  { id: 'film', label: 'Film' },
  { id: 'dream', label: 'Dream' },
  { id: 'fade', label: 'Fade' },
  { id: 'matte', label: 'Matte' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'moody', label: 'Moody' },
  { id: 'mono', label: 'Mono' },
  { id: 'noir', label: 'Noir' },
  { id: 'sepia', label: 'Sepia' },
]);

/** A transition the user can pick. `id` goes into `item.transitionIn.type`. */
export interface TransitionPreset {
  readonly id: string;
  readonly label: string;
}

/**
 * Transitions between main-track clips, in display order. Each plays over a window centred on the
 * cut (half before, half after).
 */
export const TRANSITION_PRESETS: readonly TransitionPreset[] = Object.freeze([
  { id: 'fade', label: 'Fade' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'slide-left', label: 'Slide left' },
  { id: 'slide-up', label: 'Slide up' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'wipe', label: 'Wipe' },
  { id: 'blur', label: 'Blur' },
]);

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
