import type { CaptionLook, TextStyle } from '../model/schema';

/**
 * Caption style presets (v0.2 A3): a text style, where captions sit, and how the word being said
 * is highlighted. Our own designs; fonts are the editor's font presets (system fonts).
 */
export interface CaptionPreset {
  id: string;
  label: string;
  style: TextStyle;
  /** Vertical centre as a fraction of the canvas (0.82 ≈ lower third). */
  y: number;
  highlight: CaptionLook['highlight'];
  highlightColor: string;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const HEAVY = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';
const ROUNDED =
  'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif';
const MONO = '"American Typewriter", "Courier New", ui-monospace, monospace';

const base: TextStyle = {
  fontFamily: SANS,
  fontWeight: 700,
  italic: false,
  size: 0.045,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,
  outline: null,
  shadow: null,
  background: null,
};

export const CAPTION_PRESETS: readonly CaptionPreset[] = Object.freeze([
  {
    id: 'clean',
    label: 'Clean',
    style: { ...base, shadow: { color: 'rgba(0,0,0,0.75)', blur: 6, x: 0, y: 2 } },
    y: 0.8,
    highlight: 'none',
    highlightColor: '#ffd84a',
  },
  {
    id: 'boxed',
    label: 'Boxed',
    style: {
      ...base,
      fontWeight: 600,
      size: 0.04,
      background: { color: 'rgba(0,0,0,0.72)', padding: 0.3, radius: 0.25 },
    },
    y: 0.84,
    highlight: 'none',
    highlightColor: '#ffd84a',
  },
  {
    id: 'pop',
    label: 'Pop',
    style: {
      ...base,
      fontFamily: HEAVY,
      fontWeight: 900,
      size: 0.06,
      letterSpacing: 0.02,
      outline: { color: '#000000', width: 0.09 },
    },
    y: 0.7,
    highlight: 'word',
    highlightColor: '#3df07c',
  },
  {
    id: 'karaoke',
    label: 'Karaoke',
    style: {
      ...base,
      fontFamily: ROUNDED,
      fontWeight: 800,
      size: 0.052,
      outline: { color: '#1a1030', width: 0.07 },
    },
    y: 0.78,
    highlight: 'fill',
    highlightColor: '#ffd84a',
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    style: { ...base, fontFamily: ROUNDED, fontWeight: 800, size: 0.05 },
    y: 0.74,
    highlight: 'box',
    highlightColor: '#9c479c',
  },
  {
    id: 'word-by-word',
    label: 'Word by word',
    style: {
      ...base,
      fontFamily: HEAVY,
      fontWeight: 900,
      size: 0.064,
      shadow: { color: 'rgba(0,0,0,0.85)', blur: 10, x: 0, y: 3 },
    },
    y: 0.62,
    highlight: 'reveal',
    highlightColor: '#ffffff',
  },
  {
    id: 'typewriter',
    label: 'Typewriter',
    style: {
      ...base,
      fontFamily: MONO,
      fontWeight: 600,
      size: 0.04,
      background: { color: 'rgba(255,255,255,0.92)', padding: 0.3, radius: 0.12 },
      color: '#141414',
    },
    y: 0.82,
    highlight: 'type',
    highlightColor: '#141414',
  },
  {
    id: 'subtle',
    label: 'Subtle',
    style: {
      ...base,
      fontWeight: 500,
      size: 0.036,
      color: '#f2f2f2',
      shadow: { color: 'rgba(0,0,0,0.6)', blur: 4, x: 0, y: 1 },
    },
    y: 0.9,
    highlight: 'none',
    highlightColor: '#ffd84a',
  },
]);

/** The preset new captions use. */
export const DEFAULT_CAPTION_PRESET = CAPTION_PRESETS[0]!;

/** A caption row's look from a preset. */
export function lookFromPreset(preset: CaptionPreset): CaptionLook {
  return {
    preset: preset.id,
    highlight: preset.highlight,
    highlightColor: preset.highlightColor,
  };
}
