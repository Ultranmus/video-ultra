import {
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  fromSeconds,
  NO_CROP,
  type Asset,
  type AudioItem,
  type ImageItem,
  type Item,
  type StickerItem,
  type TextItem,
  type Time,
  type VideoItem,
} from '@video-ultra/core';

/** Factories for new timeline items with the editor's defaults. */

const PHOTO_SECONDS = 3;
const OVERLAY_SECONDS = 3;

function look() {
  return {
    transform: { ...DEFAULT_TRANSFORM },
    crop: { ...NO_CROP },
    fit: 'fit' as const,
    filter: null,
    adjust: {},
    transitionIn: null,
  };
}

/** A main-track (or picture-in-picture) item showing an imported video or photo. */
export function visualItem(asset: Asset, id: string, start: Time = 0): VideoItem | ImageItem {
  if (asset.kind === 'image') {
    return {
      id,
      kind: 'image',
      assetId: asset.id,
      start,
      duration: fromSeconds(PHOTO_SECONDS),
      name: asset.name,
      ...look(),
    };
  }
  return {
    id,
    kind: 'video',
    assetId: asset.id,
    start,
    duration: asset.duration,
    name: asset.name,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    ...look(),
  };
}

/** An audio-lane item playing an audio file (or a video's sound). */
export function audioItem(asset: Asset, id: string, start: Time): AudioItem {
  return {
    id,
    kind: 'audio',
    assetId: asset.id,
    start,
    duration: asset.duration,
    name: asset.name,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
  };
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
    transform: { ...DEFAULT_TRANSFORM, scale: 0.3 },
  };
}

/** Short human name for an item (timeline labels, screen readers). */
export function itemTitle(item: Item, assets: Record<string, Asset>): string {
  if (item.name) return item.name;
  switch (item.kind) {
    case 'text':
      return item.text.split('\n')[0] || 'Text';
    case 'sticker':
      return item.emoji ?? assets[item.assetId ?? '']?.name ?? 'Sticker';
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
