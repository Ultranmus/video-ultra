import { describe, expect, it } from 'vitest';
import { insertMain, setTransition, trimItem } from '../edit/ops';
import { mainTrack } from '../model/project';
import { fromSeconds as s } from '../model/time';
import { fixtureProject, videoItem } from '../test/fixtures';
import { audioSpan, spanGain } from './spans';

const setup = () => {
  const project = fixtureProject();
  insertMain(project, videoItem('a', 'vidA', 5));
  insertMain(project, videoItem('b', 'vidB', 4));
  return project;
};
const mediaLength = (project: ReturnType<typeof fixtureProject>, id: string) =>
  project.assets[id]!.duration;

describe('audio under transitions', () => {
  it('without a transition, sound plays exactly within the clip', () => {
    const project = setup();
    const span = audioSpan(mainTrack(project), 0, mediaLength(project, 'vidA'));
    expect([span.start, span.end]).toEqual([0, s(5)]);
    expect(spanGain(span, s(4.99))).toBe(1);
  });

  it('crossfades with handles: the outgoing clip runs on, the incoming starts early', () => {
    const project = setup();
    // Trim so both clips have spare media around the cut.
    trimItem(project, 'a', 'end', -s(1)); // a: 0–4 s of a longer file
    trimItem(project, 'b', 'start', s(1)); // b starts 1 s into its file
    setTransition(project, 'b', { type: 'fade', duration: s(1) });
    const track = mainTrack(project);
    const cut = track.items[1]!.start;
    const a = audioSpan(track, 0, mediaLength(project, 'vidA'));
    const b = audioSpan(track, 1, mediaLength(project, 'vidB'));
    expect(a.end).toBe(cut + s(0.5)); // runs on half the window
    expect(b.start).toBe(cut - s(0.5)); // starts half the window early
    // Equal power at the cut: both near √½, and together about constant loudness.
    const ga = spanGain(a, cut);
    const gb = spanGain(b, cut);
    expect(ga).toBeCloseTo(Math.SQRT1_2, 1);
    expect(gb).toBeCloseTo(Math.SQRT1_2, 1);
    expect(ga * ga + gb * gb).toBeCloseTo(1, 1);
    expect(spanGain(a, a.end)).toBeCloseTo(0, 6);
    expect(spanGain(b, b.start)).toBeCloseTo(0, 6);
  });

  it('without spare media, each side fades inside its own clip (a dip, not a hard cut)', () => {
    const project = setup();
    setTransition(project, 'b', { type: 'fade', duration: s(1) });
    const track = mainTrack(project);
    const cut = track.items[1]!.start;
    // b starts at its file's first sample: nothing to start early with.
    const b = audioSpan(track, 1, mediaLength(project, 'vidB'));
    expect(b.start).toBe(cut);
    expect(spanGain(b, cut)).toBe(0);
    expect(spanGain(b, cut + s(0.5))).toBeCloseTo(1, 6);
  });
});
