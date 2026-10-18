import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../model/invariants';
import { findItem, sequentialIds } from '../model/project';
import { fromSeconds as s } from '../model/time';
import {
  addCaptions,
  captionTrack,
  mergeCaptionWithNext,
  setCaptionLook,
  setCaptionText,
  splitItem,
  trimItem,
  EditError,
} from '../edit/ops';
import { fixtureProject } from '../test/fixtures';
import { groupCaptions } from './group';
import { CAPTION_PRESETS } from './presets';
import { formatSrt, formatVtt, parseSubtitles } from './subtitles';
import { captionWordTimes, speechAt } from './timing';
import { parseProject } from '../model/migrate';

describe('subtitle files', () => {
  it('reads SRT and VTT forgivingly and writes them back', () => {
    const srt =
      '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello <i>there</i>\r\nfriend\r\n\r\n2\r\n00:00:03,2 --> 00:00:04,000\r\n{\\an8}Top line\r\n\r\n3\r\n00:00:05,000 --> 00:00:05,000\r\nempty time\r\n';
    const cues = parseSubtitles(srt);
    expect(cues).toEqual([
      { start: s(1), end: s(2.5), text: 'Hello there\nfriend' },
      { start: s(3.2), end: s(4), text: 'Top line' },
    ]);
    const vtt =
      'WEBVTT\n\nintro\n00:01.000 --> 00:02.500 line:80%\n<v Ann>Hi &amp; bye\n\n01:00:00.000 --> 01:00:01.000\nLate';
    expect(parseSubtitles(vtt)).toEqual([
      { start: s(1), end: s(2.5), text: 'Hi & bye' },
      { start: s(3600), end: s(3601), text: 'Late' },
    ]);
    expect(formatSrt(cues)).toBe(
      '1\n00:00:01,000 --> 00:00:02,500\nHello there\nfriend\n\n2\n00:00:03,200 --> 00:00:04,000\nTop line\n',
    );
    expect(parseSubtitles(formatVtt(cues))).toEqual(cues);
    expect(formatVtt(cues).startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:02.500')).toBe(true);
  });
});

describe('grouping words into captions', () => {
  const w = (text: string, start: number, end: number) => ({ text, start, end });
  it('breaks at sentence ends, pauses and length; never overlaps', () => {
    const words = [
      w('Hello', 0, 0.4),
      w('there.', 0.45, 0.9),
      w('Today', 1.0, 1.3),
      w('we', 1.35, 1.5),
      w('cook', 1.55, 1.9),
      // pause
      w('rice', 3.0, 3.4),
      w('with', 3.45, 3.6),
      w('a', 3.62, 3.65),
      w('very', 3.7, 3.9),
      w('long', 3.95, 4.2),
      w('extraordinarily', 4.25, 5.0),
      w('complicated', 5.05, 5.6),
      w('name.', 5.65, 6.0),
    ];
    const caps = groupCaptions(words, s(10));
    expect(caps.map((c) => c.text)).toEqual([
      'Hello there.',
      'Today we cook',
      'rice with a very long',
      'extraordinarily complicated',
      'name.',
    ]);
    expect(caps[0]!.start).toBe(s(10));
    expect(caps[1]!.words[0]).toEqual({ text: 'Today', start: 0, end: s(0.3) });
    for (let i = 1; i < caps.length; i++)
      expect(caps[i]!.start).toBeGreaterThanOrEqual(caps[i - 1]!.end);
  });

  it('a lone word after a short pause joins the next caption', () => {
    const caps = groupCaptions([
      w('First,', 0, 0.4),
      w('rinse', 1.1, 1.4),
      w('the', 1.45, 1.6),
      w('rice.', 1.65, 2),
    ]);
    expect(caps.map((c) => c.text)).toEqual(['First, rinse the rice.']);
    expect(caps[0]!.words.map((x) => x.start)).toEqual([0, s(1.1), s(1.45), s(1.65)]);
  });
});

describe('speech timing', () => {
  it('uses word times when they match, else shares time by length', () => {
    const item = {
      text: 'one two',
      duration: s(2),
      words: [
        { text: 'one', start: 0, end: s(0.5) },
        { text: 'two', start: s(1), end: s(2) },
      ],
    };
    expect(captionWordTimes(item)[1]).toEqual({ text: 'two', start: s(1), end: s(2) });
    const even = captionWordTimes({ text: 'ab abcd', duration: s(3) });
    expect(even.map((x) => [x.start, x.end])).toEqual([
      [0, s(1)],
      [s(1), s(3)],
    ]);
    const times = captionWordTimes(item);
    expect(speechAt(times, -1)).toMatchObject({ word: -1, chars: 0 });
    expect(speechAt(times, s(0.25))).toMatchObject({ word: 0, progress: 0.5, chars: 1.5 });
    expect(speechAt(times, s(0.75))).toMatchObject({ word: 0, progress: 1, chars: 3 });
    expect(speechAt(times, s(2))).toMatchObject({ word: 1, progress: 1, chars: 6, totalChars: 6 });
  });
});

describe('caption edits', () => {
  function withCaptions() {
    const ids = sequentialIds('c');
    const project = fixtureProject();
    addCaptions(
      project,
      [
        {
          start: s(1),
          end: s(3),
          text: 'Hello big world',
          words: [
            { text: 'Hello', start: 0, end: s(0.5) },
            { text: 'big', start: s(0.6), end: s(1) },
            { text: 'world', start: s(1.2), end: s(2) },
          ],
        },
        { start: s(2.5), end: s(4), text: 'overlaps, dropped' },
        { start: s(4), end: s(5), text: 'Next one' },
      ],
      ids,
    );
    return { project, ids, track: captionTrack(project)! };
  }

  it('adds captions to one row on top, skipping overlaps, with a look', () => {
    const { project, track } = withCaptions();
    expect(project.tracks.at(-1)).toBe(track);
    expect(track.items.map((i) => i.kind === 'text' && i.text)).toEqual([
      'Hello big world',
      'Next one',
    ]);
    expect(track.caption).toEqual({
      preset: 'clean',
      highlight: 'none',
      highlightColor: '#ffd84a',
    });
    expect(checkInvariants(project)).toEqual([]);
    expect(() => addCaptions(project, [], sequentialIds('z'), { replace: true })).toThrow(
      EditError,
    );
  });

  it('restyles every caption at once', () => {
    const { project, track } = withCaptions();
    const pop = CAPTION_PRESETS.find((p) => p.id === 'pop')!;
    setCaptionLook(project, { preset: pop });
    setCaptionLook(project, { y: 0.3, highlightColor: '#ff0000' });
    for (const item of track.items) {
      expect(item.kind === 'text' && item.style.fontWeight).toBe(900);
      expect('transform' in item && item.transform.y).toBe(0.3);
    }
    expect(track.caption).toMatchObject({
      preset: 'pop',
      highlight: 'word',
      highlightColor: '#ff0000',
    });
  });

  it('text edits keep word times when words line up', () => {
    const { project, track } = withCaptions();
    const id = track.items[0]!.id;
    setCaptionText(project, id, 'Hallo  big   world');
    const item = findItem(project, id)!.item;
    expect(item.kind === 'text' && item.words?.map((w) => w.text)).toEqual([
      'Hallo',
      'big',
      'world',
    ]);
    setCaptionText(project, id, 'Hello world');
    expect(findItem(project, id)!.item).not.toHaveProperty('words');
    expect(() => setCaptionText(project, id, '   ')).toThrow(EditError);
  });

  it('split keeps each part’s words; merge joins them back', () => {
    const { project, ids, track } = withCaptions();
    const id = track.items[0]!.id;
    const second = splitItem(project, id, s(2.1), ids);
    const a = findItem(project, id)!.item;
    const b = findItem(project, second)!.item;
    expect(a.kind === 'text' && a.text).toBe('Hello big');
    expect(b.kind === 'text' && b.text).toBe('world');
    expect(b.kind === 'text' && b.words).toEqual([{ text: 'world', start: s(0.1), end: s(0.9) }]);
    mergeCaptionWithNext(project, id);
    const m = findItem(project, id)!.item;
    expect(m.kind === 'text' && m.text).toBe('Hello big world');
    expect(m.kind === 'text' && m.words?.[2]).toEqual({ text: 'world', start: s(1.2), end: s(2) });
    expect(checkInvariants(project)).toEqual([]);
  });

  it('trimming the start keeps words on the speech', () => {
    const { project, track } = withCaptions();
    const id = track.items[0]!.id;
    trimItem(project, id, 'start', s(0.55));
    const item = findItem(project, id)!.item;
    expect(item.kind === 'text' && item.words?.map((w) => [w.text, w.start])).toEqual([
      ['big', s(0.6) - item.start + s(1)],
      ['world', s(1.2) - item.start + s(1)],
    ]);
  });

  it('a v3 file with a caption row opens unchanged', () => {
    const { project } = withCaptions();
    const result = parseProject(JSON.parse(JSON.stringify(project)));
    expect(result.ok && result.project).toEqual(project);
  });
});
