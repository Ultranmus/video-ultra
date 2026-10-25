import type { Labels } from './labels';
import {
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  fromSeconds,
  type Asset,
  type AudioItem,
  type Item,
  type RegionItem,
  type StickerItem,
  type TextItem,
  type Time,
  type VideoItem,
} from '@video-ultra/core';

/** Factories for new timeline items with the editor's defaults. */

const OVERLAY_SECONDS = 3;

/** Media items are built in core (the assistant adds them too). */
export { visualItem, audioItem } from '@video-ultra/core/internal';

/** "Lower under voice" amount when switched on: 75 % lower ≈ −12 dB, a classic voice-over duck. */
export const DEFAULT_DUCK = 0.75;

/** Items that make sound (video clips and music / sound / voiceover clips). */
export function isSounding(item: Item): item is VideoItem | AudioItem {
  return item.kind === 'video' || item.kind === 'audio';
}

/** A text item with a style preset applied. */
export function textItem(
  id: string,
  start: Time,
  text: string,
  font?: { family: string; weight: number },
): TextItem {
  return {
    id,
    kind: 'text',
    start,
    duration: fromSeconds(OVERLAY_SECONDS),
    text,
    style: {
      ...DEFAULT_TEXT_STYLE,
      ...(font ? { fontFamily: font.family, fontWeight: font.weight } : {}),
    },
    transform: { ...DEFAULT_TRANSFORM },
    filter: null,
    adjust: {},
  };
}

/** An emoji or image sticker, a third of the canvas, centred. */
export function stickerItem(
  id: string,
  start: Time,
  content: { emoji: string } | { assetId: string },
): StickerItem {
  return {
    id,
    kind: 'sticker',
    start,
    duration: fromSeconds(OVERLAY_SECONDS),
    assetId: 'assetId' in content ? content.assetId : null,
    emoji: 'emoji' in content ? content.emoji : null,
    // Upper right, so it doesn't land on a centred title.
    transform: { ...DEFAULT_TRANSFORM, x: 0.72, y: 0.3, scale: 0.3 },
    filter: null,
    adjust: {},
  };
}

/**
 * A blurred / pixelated area (v0.2 C3) at `start`: a box a third of the canvas's shorter side,
 * square on screen, centred.
 */
export function regionItem(
  id: string,
  start: Time,
  effect: RegionItem['effect'],
  shape: RegionItem['shape'],
  canvasW: number,
  canvasH: number,
): RegionItem {
  const side = Math.min(canvasW, canvasH) * 0.34;
  return {
    id,
    kind: 'region',
    start,
    duration: fromSeconds(OVERLAY_SECONDS),
    effect,
    shape,
    amount: 0.5,
    width: side / canvasW,
    height: side / canvasH,
    transform: { ...DEFAULT_TRANSFORM },
  };
}

/** An item kind's name: `title` for headings ("Blurred area"), else lower case for sentences. */
export function kindLabel(l: Labels, kind: Item['kind'], title = false): string {
  if (kind === 'region') return title ? l.blurArea : l.regionKind;
  return title ? l.kindName(kind) : (l.kind[kind] ?? kind);
}

/** Short human name for an item (timeline labels, screen readers). */
export function itemTitle(item: Item, assets: Record<string, Asset>): string {
  if (item.name) return item.name;
  switch (item.kind) {
    case 'text':
      return item.text.split('\n')[0] || 'Text';
    case 'sticker':
      return item.emoji ?? assets[item.assetId ?? '']?.name ?? 'Sticker';
    case 'region':
      return item.effect === 'pixelate' ? 'Pixelate' : 'Blur';
    default:
      return assets[item.assetId]?.name ?? item.kind;
  }
}

/** Canvas sizes for each ratio choice (even pixels, ≥ 1080 on the short side). */
export const RATIOS = [
  { id: '9:16', width: 1080, height: 1920 },
  { id: '1:1', width: 1080, height: 1080 },
  { id: '4:5', width: 1080, height: 1350 },
  { id: '16:9', width: 1920, height: 1080 },
  { id: '4:3', width: 1440, height: 1080 },
  { id: '21:9', width: 2520, height: 1080 },
] as const;

/** The ratio id matching a canvas size, or null for a custom size. */
export function ratioOf(width: number, height: number): string | null {
  const r = width / height;
  return RATIOS.find((x) => Math.abs(x.width / x.height - r) < 0.01)?.id ?? null;
}
