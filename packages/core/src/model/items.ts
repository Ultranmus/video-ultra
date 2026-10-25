import { DEFAULT_TRANSFORM, NO_CROP } from './project';
import type { Asset, AudioItem, ImageItem, VideoItem } from './schema';
import { fromSeconds, type Time } from './time';

/** Factories for timeline items made from imported media, with the editor's defaults. */

const PHOTO_SECONDS = 3;

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
