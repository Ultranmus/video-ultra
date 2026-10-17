import {
  createProject,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  NO_CROP,
  sequentialIds,
  type IdFactory,
} from '../model/project';
import type {
  Asset,
  AudioItem,
  ImageItem,
  Project,
  StickerItem,
  TextItem,
  VideoItem,
} from '../model/schema';
import { fromSeconds } from '../model/time';

/** A project with four assets: 10 s video, 4 s video, a photo, 30 s music. */
export function fixtureProject(ids: IdFactory = sequentialIds('p')): Project {
  const project = createProject({ ids, now: '2026-10-17T00:00:00.000Z' });
  const assets: Asset[] = [
    asset('vidA', 'video', 10),
    asset('vidB', 'video', 4),
    asset('img', 'image', 0),
    asset('music', 'audio', 30),
  ];
  for (const a of assets) project.assets[a.id] = a;
  return project;
}

function asset(id: string, kind: Asset['kind'], seconds: number): Asset {
  return {
    id,
    kind,
    name: `${id}.bin`,
    mimeType: kind === 'image' ? 'image/jpeg' : kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
    size: 1000,
    duration: fromSeconds(seconds),
    ...(kind === 'audio' ? {} : { width: 1920, height: 1080 }),
    hasAudio: kind !== 'image',
    source: { type: 'opfs', key: id },
  };
}

export function videoItem(id: string, assetId = 'vidA', seconds = 5, sourceIn = 0): VideoItem {
  return {
    id,
    kind: 'video',
    assetId,
    start: 0,
    duration: fromSeconds(seconds),
    sourceIn: fromSeconds(sourceIn),
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
    crop: { ...NO_CROP },
    fit: 'fit',
    filter: null,
    adjust: {},
    transitionIn: null,
  };
}

export function imageItem(id: string, seconds = 3): ImageItem {
  return {
    id,
    kind: 'image',
    assetId: 'img',
    start: 0,
    duration: fromSeconds(seconds),
    transform: { ...DEFAULT_TRANSFORM },
    crop: { ...NO_CROP },
    fit: 'fit',
    filter: null,
    adjust: {},
    transitionIn: null,
  };
}

export function textItem(id: string, startSeconds: number, seconds = 2): TextItem {
  return {
    id,
    kind: 'text',
    text: 'Hello',
    start: fromSeconds(startSeconds),
    duration: fromSeconds(seconds),
    style: structuredClone(DEFAULT_TEXT_STYLE),
    transform: { ...DEFAULT_TRANSFORM },
  };
}

export function audioItem(id: string, startSeconds: number, seconds = 10): AudioItem {
  return {
    id,
    kind: 'audio',
    assetId: 'music',
    start: fromSeconds(startSeconds),
    duration: fromSeconds(seconds),
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
  };
}

export function stickerItem(id: string, startSeconds: number, seconds = 2): StickerItem {
  return {
    id,
    kind: 'sticker',
    assetId: null,
    emoji: '🎉',
    start: fromSeconds(startSeconds),
    duration: fromSeconds(seconds),
    transform: { ...DEFAULT_TRANSFORM },
  };
}
