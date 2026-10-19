import {
  createProject,
  findItem,
  fromSeconds,
  insertMain,
  mainTrack,
  sequentialIds,
  setSpeed,
  updateItem,
  type Project,
  type VideoItem,
} from '@video-ultra/core';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { spread } from './fanout';

function clip(id: string, seconds: number): VideoItem {
  return {
    id,
    kind: 'video',
    assetId: 'a',
    start: 0,
    duration: fromSeconds(seconds),
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    fit: 'fit',
    filter: null,
    adjust: {},
    transitionIn: null,
  };
}

function project(): Project {
  const p = createProject({ ids: sequentialIds('p') });
  p.assets.a = {
    id: 'a',
    kind: 'video',
    name: 'a.mp4',
    mimeType: 'video/mp4',
    size: 1,
    duration: fromSeconds(60),
    hasAudio: true,
    source: { type: 'url', url: 'x' },
  };
  insertMain(p, clip('c1', 2));
  insertMain(p, clip('c2', 3));
  insertMain(p, clip('c3', 4));
  return p;
}

const ctx = { ids: sequentialIds('n') };
const item = (p: Project, id: string) => findItem(p, id)!.item as VideoItem;

describe('editing several at once', () => {
  it('copies a sound change to the other selected clips', () => {
    const base = project();
    const next = produce(base, (d) => {
      updateItem(d, 'c1', { volume: 0.4 });
      spread(base, d, ['c1', 'c3'], ctx);
    });
    expect(item(next, 'c1').volume).toBe(0.4);
    expect(item(next, 'c3').volume).toBe(0.4);
    expect(item(next, 'c2').volume).toBe(1); // not selected
  });

  it('speed goes through setSpeed: lengths change and later clips move up', () => {
    const base = project();
    const next = produce(base, (d) => {
      setSpeed(d, 'c1', 2, ctx.ids);
      spread(base, d, ['c1', 'c2'], ctx);
    });
    expect(item(next, 'c2').speed).toBe(2);
    expect(item(next, 'c2').duration).toBe(fromSeconds(1.5));
    const main = mainTrack(next).items;
    for (let i = 1; i < main.length; i++)
      expect(main[i]!.start).toBe(main[i - 1]!.start + main[i - 1]!.duration);
  });

  it('a filter and adjustments reach every selected picture; place and size stay their own', () => {
    const base = project();
    const next = produce(base, (d) => {
      updateItem(d, 'c2', {
        filter: { id: 'warm', intensity: 0.7 } as never,
        transform: { ...item(base, 'c2').transform, x: 0.2 },
      });
      spread(base, d, ['c2', 'c3'], ctx);
    });
    expect(item(next, 'c3').filter).toEqual({ id: 'warm', intensity: 0.7 });
    expect(item(next, 'c3').transform.x).toBe(0.5);
  });

  it('does nothing when the edit already changed several (or none)', () => {
    const base = project();
    const next = produce(base, (d) => {
      updateItem(d, 'c1', { volume: 0.2 });
      updateItem(d, 'c2', { volume: 0.3 });
      spread(base, d, ['c1', 'c2', 'c3'], ctx);
    });
    expect(item(next, 'c3').volume).toBe(1);
  });
});
