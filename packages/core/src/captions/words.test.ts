import { describe, expect, it } from 'vitest';
import { measureReveal } from '../engine/text';
import { fromSeconds as s } from '../model/time';
import { groupCaptions } from './group';
import { captionWordTimes, speechAt } from './timing';
import { captionWords, graphemes, joinCaptionWords, joinWords, textWidth } from './words';

describe('words in every language', () => {
  it('splits at spaces, and per character in scripts written without them', () => {
    expect(captionWords('Hello,  world!')).toEqual(['Hello,', 'world!']);
    expect(captionWords('नमस्ते दोस्तों।')).toEqual(['नमस्ते', 'दोस्तों।']);
    expect(captionWords('你好，世界。')).toEqual(['你', '好，', '世', '界。']);
    expect(captionWords('「こんにちは」')).toEqual(['「こ', 'ん', 'に', 'ち', 'は」']);
    expect(captionWords('我用iPhone拍的')).toEqual(['我', '用', 'iPhone', '拍', '的']);
    expect(captionWords('สวัสดีครับ')).toHaveLength(graphemes('สวัสดีครับ').length);
  });

  it('joins without spaces next to those scripts, and round-trips', () => {
    expect(joinWords('你', '好，')).toBe('你好，');
    expect(joinWords('Hello,', 'world')).toBe('Hello, world');
    expect(joinWords('用', 'iPhone')).toBe('用iPhone');
    for (const text of [
      '你好，世界。',
      'Hello, world!',
      '我用iPhone拍的',
      'नमस्ते दोस्तों।',
      'สวัสดีครับ',
    ])
      expect(joinCaptionWords(captionWords(text))).toBe(text);
    expect(textWidth('你好')).toBe(4);
    expect(textWidth('hi')).toBe(2);
  });

  it('turns a transcript in Chinese into captions whose words match what is shown', () => {
    const caps = groupCaptions([
      { text: '你好', start: 0, end: 1 },
      { text: '世界。', start: 1, end: 2 },
      { text: '今天', start: 2.5, end: 3.5 },
    ]);
    expect(caps.map((c) => c.text)).toEqual(['你好世界。', '今天']);
    const first = caps[0]!;
    expect(first.words.map((w) => w.text)).toEqual(captionWords(first.text));
    // 你好 shares its second evenly.
    expect(first.words[1]!.start).toBe(s(0.5));
    const times = captionWordTimes({
      text: first.text,
      duration: first.end - first.start,
      words: first.words,
    });
    expect(times.map((w) => w.text)).toEqual(['你', '好', '世', '界。']);
  });

  it('keeps the characters of one word on one caption', () => {
    // 15 characters (30 of 32): 首 still fits, 先 wouldn't — the pair must not split.
    const caps = groupCaptions([
      { text: '我们今天来做一道简单好吃的米饭', start: 0, end: 2.6 },
      { text: '首先', start: 2.6, end: 3.0 },
      { text: '把米洗干净', start: 3.4, end: 4.4 },
    ]);
    expect(caps.some((c) => c.text.endsWith('首'))).toBe(false);
    expect(caps.some((c) => c.text.includes('首先'))).toBe(true);
  });

  it('counts characters as drawn, so a Hindi fill highlight keeps pace', () => {
    // नमस्ते: 6 code points, 3 characters as drawn.
    const words = [{ text: 'नमस्ते', start: 0, end: s(1) }];
    const half = speechAt(words, s(0.5));
    expect(half.totalChars).toBe(3);
    expect(half.chars).toBeCloseTo(1.5);
  });

  it('places the highlight on each Chinese character', () => {
    const layout = measureReveal(
      ['你好，世界'],
      [0],
      [50],
      '10px a',
      0,
      (_f, t) => graphemes(t).length * 10,
      {
        width: 50,
        height: 10,
        top: 0,
        lineHeight: 10,
        rtl: false,
      },
    );
    expect(Array.from(layout.lines[0]!.wordStart)).toEqual([0, 10, 30, 40]);
    expect(layout.words).toBe(4);
  });
});

describe('checking and hearing again', () => {
  it('marks captions heard with little confidence, and clears the mark when checked or edited', async () => {
    const { addCaptions, markCaptionChecked, setCaptionText, captionTrack } =
      await import('../edit/ops');
    const { fixtureProject } = await import('../test/fixtures');
    const { sequentialIds } = await import('../model/project');
    const caps = groupCaptions([
      { text: 'Clear', start: 0, end: 0.5, confidence: 0.95 },
      { text: 'words.', start: 0.5, end: 1, confidence: 0.9 },
      { text: 'Mumbled', start: 2, end: 2.5, confidence: 0.4 },
      { text: 'bit.', start: 2.5, end: 3, confidence: 0.5 },
    ]);
    expect(caps.map((c) => !!c.unsure)).toEqual([false, true]);
    const project = fixtureProject();
    const ids = sequentialIds('c');
    addCaptions(project, caps, ids);
    const flags = () =>
      captionTrack(project)!.items.map((i) => (i.kind === 'text' ? !!i.unsure : null));
    expect(flags()).toEqual([false, true]);
    markCaptionChecked(project, captionTrack(project)!.items[1]!.id);
    expect(flags()).toEqual([false, false]);
    // Made again: marked again; editing the words counts as checking them.
    addCaptions(project, caps, ids, { replace: true });
    expect(flags()).toEqual([false, true]);
    setCaptionText(project, captionTrack(project)!.items[1]!.id, 'Mumbled bit!');
    expect(flags()).toEqual([false, false]);
  });

  it('a part heard again replaces only the captions there', async () => {
    const { addCaptions, captionTrack } = await import('../edit/ops');
    const { fixtureProject } = await import('../test/fixtures');
    const { sequentialIds } = await import('../model/project');
    const project = fixtureProject();
    const ids = sequentialIds('c');
    addCaptions(
      project,
      groupCaptions([
        { text: 'One.', start: 0, end: 1 },
        { text: 'Two.', start: 2, end: 3 },
        { text: 'Three.', start: 4, end: 5 },
      ]),
      ids,
    );
    addCaptions(project, groupCaptions([{ text: 'Deux.', start: 2.1, end: 2.9 }]), ids, {
      replace: true,
      range: { start: s(1.5), end: s(3.5) },
    });
    expect(captionTrack(project)!.items.map((i) => (i.kind === 'text' ? i.text : ''))).toEqual([
      'One.',
      'Deux.',
      'Three.',
    ]);
  });
});
