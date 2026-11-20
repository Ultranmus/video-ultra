import {
  addToLane,
  createProject,
  fromSeconds,
  insertMain,
  sequentialIds,
  type VideoItem,
} from '@video-ultra/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS, type Labels } from './labels';
import { computeTargets } from './targets';

const l = DEFAULT_LABELS as Labels;

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

/** Main: c1 0–2 s, c2 2–5 s. A layer clip o1 at 0–1 s. */
function project() {
  const ids = sequentialIds('p');
  const p = createProject({ ids });
  p.assets.a = {
    id: 'a',
    kind: 'video',
    name: 'a.mp4',
    mimeType: 'video/mp4',
    size: 1,
    duration: fromSeconds(60),
    hasAudio: false,
    source: { type: 'url', url: 'x' },
  };
  insertMain(p, clip('c1', 2));
  insertMain(p, clip('c2', 3));
  addToLane(p, clip('o1', 1), ids);
  return p;
}

describe('Split target', () => {
  it('splits the selected clip when the playhead is inside it', () => {
    const t = computeTargets(project(), 'c1', fromSeconds(1), l);
    expect(t.split.item?.id).toBe('c1');
  });

  it('a selected main clip elsewhere: splits the main clip under the playhead', () => {
    // c1 selected, then a click on the ruler at 3 s (inside c2).
    const t = computeTargets(project(), 'c1', fromSeconds(3), l);
    expect(t.split.item?.id).toBe('c2');
    expect(t.split.reason).toBeNull();
  });

  it('a selected layer item elsewhere: no split, says why (never cuts the video by surprise)', () => {
    const t = computeTargets(project(), 'o1', fromSeconds(3), l);
    expect(t.split.item).toBeNull();
    expect(t.split.reason).toBe(l.playheadOutsideSelection);
  });

  it('nothing selected: the main clip under the playhead', () => {
    const t = computeTargets(project(), null, fromSeconds(3), l);
    expect(t.split.item?.id).toBe('c2');
  });
});
