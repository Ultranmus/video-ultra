/**
 * Hindi in Latin letters, the way people type it ("Hinglish": तुम्हारे माता पिता → "tumhare mata
 * pita"), for captions (DECISIONS #167). Rules plus the most common short words: each consonant carries a short
 * "a" unless a vowel sign or virama follows; that "a" is dropped at a word's end and between
 * two syllables (करना → "karna"); a long ā is "aa" in one-syllable words ("aaj", "baat") and
 * "a" elsewhere. Hindi spelling doesn't show every dropped "a", so some words come out a little
 * off (आजादी → "ajdi", said "aazadi") — captions can be edited. Pure; tested.
 */

const CONSONANTS: Record<string, string> = {
  क: 'k',
  ख: 'kh',
  ग: 'g',
  घ: 'gh',
  ङ: 'n',
  च: 'ch',
  छ: 'chh',
  ज: 'j',
  झ: 'jh',
  ञ: 'n',
  ट: 't',
  ठ: 'th',
  ड: 'd',
  ढ: 'dh',
  ण: 'n',
  त: 't',
  थ: 'th',
  द: 'd',
  ध: 'dh',
  न: 'n',
  प: 'p',
  फ: 'ph',
  ब: 'b',
  भ: 'bh',
  म: 'm',
  य: 'y',
  र: 'r',
  ल: 'l',
  व: 'v',
  श: 'sh',
  ष: 'sh',
  स: 's',
  ह: 'h',
  क़: 'q',
  ख़: 'kh',
  ग़: 'gh',
  ज़: 'z',
  ड़: 'r',
  ढ़: 'rh',
  फ़: 'f',
  य़: 'y',
};
/** With a nukta (◌़), written as two code points. */
const NUKTA: Record<string, string> = { क: 'q', ख: 'kh', ग: 'gh', ज: 'z', ड: 'r', ढ: 'rh', फ: 'f' };
const VOWELS: Record<string, string> = {
  अ: 'a',
  आ: 'aa',
  इ: 'i',
  ई: 'i',
  उ: 'u',
  ऊ: 'u',
  ऋ: 'ri',
  ए: 'e',
  ऐ: 'ai',
  ओ: 'o',
  औ: 'au',
  ऑ: 'o',
};
const SIGNS: Record<string, string> = {
  'ा': 'aa',
  'ि': 'i',
  'ी': 'i',
  'ु': 'u',
  'ू': 'u',
  'ृ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
  'ॉ': 'o',
};
/** The most common short words, spelled the everyday way (rules can't: हम is said "hum"). */
const COMMON: Record<string, string> = {
  हम: 'hum',
  में: 'mein',
  मैं: 'main',
  यह: 'yeh',
  वह: 'woh',
  ये: 'ye',
  वो: 'wo',
  नहीं: 'nahi',
  है: 'hai',
  हैं: 'hain',
  और: 'aur',
  भी: 'bhi',
  तो: 'to',
  जो: 'jo',
  कि: 'ki',
  की: 'ki',
  के: 'ke',
  का: 'ka',
  को: 'ko',
  से: 'se',
  पर: 'par',
  एक: 'ek',
  अब: 'ab',
  सब: 'sab',
  कुछ: 'kuch',
  बहुत: 'bahut',
  क्यों: 'kyun',
  कैसे: 'kaise',
  यहाँ: 'yahan',
  वहाँ: 'wahan',
  हाँ: 'haan',
};
const VIRAMA = '्';
const NUKTA_SIGN = '़';
const LABIAL = new Set(['p', 'ph', 'b', 'bh', 'm', 'f']);

/** A sound: a consonant (with its vowel) or a vowel. */
interface Unit {
  consonant: string | null;
  /** Its vowel: '' = none (virama, or a dropped "a"), 'a' = the inherent one, else a sign. */
  vowel: string;
  inherent: boolean;
  /** Nasal mark after it (ं / ँ): 'n' (or 'm' before p / b / m). */
  nasal: boolean;
  /** Visarga (ः). */
  h: boolean;
}

/** Whether `text` has Devanagari letters. */
export function hasDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

/** Hindi (Devanagari) text in Latin letters; anything else stays as it is. */
export function romanizeHindi(text: string): string {
  return text.replace(/[ऀ-ॿ]+/g, (word) => romanizeWord(word));
}

function romanizeWord(word: string): string {
  // A common word with a full stop after it ("हम।") is still that word.
  const [, core = word, stops = ''] = /^(.*?)([।॥]*)$/u.exec(word) ?? [];
  const common = COMMON[core];
  if (common) return common + (stops ? '.' : '');
  const units: Unit[] = [];
  let out = '';
  const flush = () => {
    out += spell(units);
    units.length = 0;
  };
  const chars = Array.from(word);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const last = units[units.length - 1];
    if (ch === NUKTA_SIGN) continue;
    if (CONSONANTS[ch] !== undefined) {
      const nukta = chars[i + 1] === NUKTA_SIGN && NUKTA[ch] !== undefined;
      units.push({
        consonant: nukta ? NUKTA[ch]! : CONSONANTS[ch]!,
        vowel: 'a',
        inherent: true,
        nasal: false,
        h: false,
      });
    } else if (VOWELS[ch] !== undefined)
      units.push({ consonant: null, vowel: VOWELS[ch]!, inherent: false, nasal: false, h: false });
    else if (SIGNS[ch] !== undefined && last?.consonant) {
      last.vowel = SIGNS[ch]!;
      last.inherent = false;
    } else if (ch === VIRAMA && last) {
      last.vowel = '';
      last.inherent = false;
    } else if ((ch === 'ं' || ch === 'ँ') && last) last.nasal = true;
    else if (ch === 'ः' && last) last.h = true;
    else if (ch === 'ॐ') {
      flush();
      out += 'om';
    } else if (ch === '।' || ch === '॥') {
      flush();
      out += '.';
    } else if (ch >= '०' && ch <= '९') {
      flush();
      out += String(ch.charCodeAt(0) - 0x966);
    } else {
      flush();
      out += ch;
    }
  }
  flush();
  return out;
}

function spell(units: Unit[]): string {
  if (!units.length) return '';
  const isVowel = (u: Unit | undefined) => !!u && u.vowel !== '';
  // A word's final "a" isn't said (राम → "ram") — unless it's the only vowel (न → "na").
  const last = units[units.length - 1]!;
  if (last.inherent && units.some((u, k) => k < units.length - 1 && isVowel(u))) last.vowel = '';
  // Between two syllables the short "a" isn't said: vowel · C(a) · C+vowel → C (करना → karna).
  for (let i = units.length - 2; i >= 1; i--) {
    const u = units[i]!;
    if (!u.inherent || !u.consonant || u.nasal) continue;
    const before = units[i - 1]!;
    const after = units[i + 1]!;
    // Not after a nasal: three consonants together aren't said (ज़िंदगी → "zindagi").
    if (isVowel(before) && !before.nasal && after.consonant && isVowel(after)) u.vowel = '';
  }
  const syllables = units.filter(isVowel).length;
  return units
    .map((u, k) => {
      let vowel = u.vowel;
      // A long ā is "aa" in a one-syllable word or at the start ("aaj", "aap"), else "a".
      // After a consonant cluster it stays "a" too ("kya", "pyar").
      const cluster = k > 0 && units[k - 1]!.consonant !== null && units[k - 1]!.vowel === '';
      if (vowel === 'aa' && (cluster || (syllables > 1 && !(k === 0 && !u.consonant)))) vowel = 'a';
      const next = units[k + 1];
      const nasal = u.nasal ? (next?.consonant && LABIAL.has(next.consonant) ? 'm' : 'n') : '';
      return (u.consonant ?? '') + vowel + nasal + (u.h ? 'h' : '');
    })
    .join('');
}
