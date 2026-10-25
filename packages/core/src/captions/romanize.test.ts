import { describe, expect, it } from 'vitest';
import { hasDevanagari, romanizeHindi } from './romanize';

describe('Hindi in Latin letters', () => {
  it('writes everyday words the way people type them', () => {
    const cases: [string, string][] = [
      ['तुम्हारे माता पिता क्या तुम्हें इतनी', 'tumhare mata pita kya tumhen itni'],
      ['नमस्ते दोस्तों', 'namaste doston'],
      ['आज हम चावल बनाना सीखेंगे।', 'aaj hum chaval banana sikhenge.'],
      ['करना', 'karna'],
      ['मैं ठीक हूँ', 'main thik hun'],
      ['ज़िंदगी', 'zindagi'],
      ['धन्यवाद', 'dhanyavad'],
      ['काम', 'kaam'],
      ['दिल', 'dil'],
      ['न', 'na'],
      ['बात', 'baat'],
      ['१२३', '123'],
      ['यह मेरे लिए नहीं है', 'yeh mere lie nahi hai'],
      ['आज हम।', 'aaj hum.'],
    ];
    for (const [hi, latin] of cases) expect(romanizeHindi(hi)).toBe(latin);
  });

  it('leaves other text alone', () => {
    expect(romanizeHindi('iPhone 15, नया!')).toBe('iPhone 15, naya!');
    expect(hasDevanagari('hello')).toBe(false);
    expect(hasDevanagari('नमस्ते')).toBe(true);
  });
});
