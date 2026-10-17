/**
 * TEMPORARY stand-ins for core APIs being built in parallel (export, preset catalogues). Same
 * names and shapes as the agreed contracts; replaced by imports from `@video-ultra/core` when that
 * work is merged.
 */
import type { DeviceTier } from '@video-ultra/core';

export interface ExportOptions {
  format: 'mp4' | 'webm';
  height: 480 | 720 | 1080 | 1440 | 2160;
  fps: 24 | 30 | 60;
  quality: 'low' | 'medium' | 'high';
}
export interface ExportProgress {
  fraction: number;
  framesDone: number;
  framesTotal: number;
  etaSeconds: number | null;
}
export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  width: number;
  height: number;
  durationSeconds: number;
  storage: 'opfs' | 'memory';
}

export function maxExportHeight(tier: DeviceTier): number {
  return tier === 'low' ? 1080 : tier === 'mid' ? 1440 : 2160;
}

export const FILTER_PRESETS: readonly { id: string; label: string }[] = [
  { id: 'vivid', label: 'Vivid' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'mono', label: 'Mono' },
  { id: 'fade', label: 'Fade' },
  { id: 'film', label: 'Film' },
  { id: 'noir', label: 'Noir' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dream', label: 'Dream' },
  { id: 'punch', label: 'Punch' },
  { id: 'teal-orange', label: 'Teal & orange' },
  { id: 'vintage', label: 'Vintage' },
];

export const TRANSITION_PRESETS: readonly { id: string; label: string }[] = [
  { id: 'fade', label: 'Fade' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'slide-left', label: 'Slide' },
  { id: 'slide-up', label: 'Slide up' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'wipe', label: 'Wipe' },
  { id: 'blur', label: 'Blur' },
];

export const ADJUST_KEYS: readonly { key: string; label: string }[] = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'warmth', label: 'Warmth' },
  { key: 'tint', label: 'Tint' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'sharpen', label: 'Sharpen' },
  { key: 'vignette', label: 'Vignette' },
];

export const STICKER_EMOJI: readonly string[] = [
  '😀',
  '😂',
  '😍',
  '🥳',
  '😎',
  '🤩',
  '😭',
  '😱',
  '🤔',
  '🙌',
  '👏',
  '👍',
  '❤️',
  '🔥',
  '✨',
  '⭐',
  '💯',
  '🎉',
  '🎂',
  '🎁',
  '🌈',
  '☀️',
  '🌙',
  '⚡',
  '🌸',
  '🍕',
  '☕',
  '🎵',
  '📍',
  '✈️',
  '🏖️',
  '🐶',
  '🐱',
  '🦋',
  '🌊',
  '🏆',
  '💪',
  '👀',
  '💬',
  '✅',
  '❌',
  '➡️',
  '⬆️',
  '💡',
  '📸',
  '🎬',
  '💥',
  '🙏',
];

export const FONT_PRESETS: readonly {
  id: string;
  label: string;
  family: string;
  weight: number;
}[] = [
  { id: 'classic', label: 'Classic', family: 'system-ui, sans-serif', weight: 700 },
  { id: 'light', label: 'Light', family: 'system-ui, sans-serif', weight: 300 },
  { id: 'serif', label: 'Serif', family: 'Georgia, "Times New Roman", serif', weight: 700 },
  { id: 'mono', label: 'Typewriter', family: 'ui-monospace, Menlo, monospace', weight: 500 },
  {
    id: 'rounded',
    label: 'Rounded',
    family: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
    weight: 800,
  },
  {
    id: 'condensed',
    label: 'Condensed',
    family: '"Arial Narrow", "Roboto Condensed", sans-serif-condensed, sans-serif',
    weight: 700,
  },
  {
    id: 'hand',
    label: 'Handwritten',
    family: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive',
    weight: 400,
  },
];
