import {
  createProject,
  fromSeconds,
  insertMain,
  sequentialIds,
  type VideoItem,
} from '@video-ultra/core';
import { describe, expect, it } from 'vitest';
import {
  hitTest,
  layoutRows,
  majorTickSeconds,
  reorderIndex,
  snapTime,
  tickLabel,
  timeToX,
  xToTime,
  type TimelineMetrics,
} from './geometry';

const m: TimelineMetrics = {
  ruler: 24,
  mainTrack: 56,
  track: 48,
  gap: 4,
  header: 0,
  trimHandle: 12,
  slot: 0,
};

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

function project() {
  const p = createProject({ ids: sequentialIds('p') });
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
  return p;
}

describe('timeline geometry', () => {
  it('maps time and x both ways', () => {
    const scale = { pps: 50, x0: 100 };
    expect(timeToX(scale, fromSeconds(2))).toBe(200);
    expect(xToTime(scale, 200)).toBe(fromSeconds(2));
  });

  it('picks readable tick steps', () => {
    expect(majorTickSeconds(100)).toBe(1);
    expect(majorTickSeconds(10)).toBe(10);
    expect(majorTickSeconds(600)).toBe(0.2);
    expect(tickLabel(65, 5)).toBe('1:05');
    expect(tickLabel(2.5, 0.5)).toBe('0:02.5');
  });

  it('snaps within the threshold only', () => {
    const near = snapTime(fromSeconds(1.05), [fromSeconds(1)], 100, 8);
    expect(near.snapped).toBe(fromSeconds(1));
    const far = snapTime(fromSeconds(1.2), [fromSeconds(1)], 100, 8);
    expect(far.snapped).toBeNull();
  });

  it('hit-tests clips, trim handles of the selection, and the ruler', () => {
    const p = project();
    const rows = layoutRows(p, m);
    const scale = { pps: 100, x0: 0 };
    const y = rows[0]!.top + 20;
    expect(hitTest(rows, m, scale, 50, 10, null, false).type).toBe('ruler');
    const body = hitTest(rows, m, scale, 50, y, null, false);
    expect(body.type === 'item' && body.item.id).toBe('c1');
    // The selected clip's end handle sits on a cut: it stands in for the transition button.
    const trim = hitTest(rows, m, scale, 205, y, 'c1', false);
    expect(trim.type === 'trim' && trim.edge).toBe('end');
    expect(trim.type === 'trim' && trim.transition?.id).toBe('c2');
    expect(hitTest(rows, m, scale, 200, rows[0]!.top + 28, null, false).type).toBe('transition');
  });

  it('a press on the selected clip edge grabs its trim handle', () => {
    const p = project();
    const rows = layoutRows(p, m);
    const scale = { pps: 100, x0: 0 };
    const y = rows[0]!.top + 20;
    // c1 runs 0–200 px: 4 px inside its end grabs the end handle (mouse), 10 px in on touch.
    const mouse = hitTest(rows, m, scale, 196, y, 'c1', false);
    expect(mouse.type === 'trim' && mouse.edge).toBe('end');
    const finger = hitTest(rows, m, scale, 190, y, 'c1', true);
    expect(finger.type === 'trim' && finger.edge).toBe('end');
    // The start edge the same way.
    const start = hitTest(rows, m, scale, 4, y, 'c1', false);
    expect(start.type === 'trim' && start.edge).toBe('start');
    // Further in is the clip's body (it can still be dragged).
    expect(hitTest(rows, m, scale, 150, y, 'c1', false).type).toBe('item');
  });

  it('phones: a "+" before the first clip adds at the start', () => {
    const p = project();
    const rows = layoutRows(p, m);
    // The playhead mid-screen at 0 s: time 0 sits 200 px in.
    const scale = { pps: 100, x0: 200 };
    const y = rows[0]!.top + m.mainTrack / 2;
    const hit = hitTest(rows, m, scale, 200 - 8 - m.trimHandle - 20, y, null, true, true);
    expect(hit.type === 'add' && hit.atStart).toBe(true);
    // Not on desktop, and nothing there to the left without the flag.
    expect(
      hitTest(rows, m, scale, 200 - 8 - m.trimHandle - 20, y, null, true, false).type,
    ).not.toBe('add');
  });

  it('the "+" after the last clip sits clear of its trim handle, selected or not', () => {
    const p = project();
    const rows = layoutRows(p, m);
    const scale = { pps: 100, x0: 0 };
    const y = rows[0]!.top + m.mainTrack / 2;
    // The video ends at 5 s (500 px): the "+" starts past the handle's room, in the same place
    // whether the last clip is selected or not.
    const plus = 500 + 8 + m.trimHandle + 4;
    expect(hitTest(rows, m, scale, plus, y, null, true).type).toBe('add');
    expect(hitTest(rows, m, scale, plus, y, 'c2', true).type).toBe('add');
    // Right after the selected clip's end is its trim handle.
    const handle = hitTest(rows, m, scale, 510, y, 'c2', true);
    expect(handle.type === 'trim' && handle.edge).toBe('end');
  });

  it('groups rows: main video, picture layers, text, then sound', () => {
    const p = project();
    const lane = (id: string, kind: 'overlay' | 'text' | 'audio') =>
      ({
        id,
        kind,
        muted: false,
        hidden: false,
        locked: false,
        items: [],
      }) as (typeof p.tracks)[number];
    p.tracks.push(lane('o1', 'overlay'), lane('s1', 'audio'), lane('t1', 'text'));
    const rows = layoutRows(p, { ...m, slot: 30 });
    expect(rows.map((r) => r.track.id)).toEqual([p.tracks[0]!.id, 'o1', 't1', 's1']);
    expect(rows[1]!.top).toBe(m.ruler + m.gap + m.mainTrack + m.gap + 30);
  });

  it('finds the reorder slot from the drag position', () => {
    const p = project();
    const items = p.tracks[0]!.items;
    expect(reorderIndex(items, 'c1', fromSeconds(2.0))).toBe(1);
    expect(reorderIndex(items, 'c2', fromSeconds(0.5))).toBe(0);
  });
});
