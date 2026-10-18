/**
 * Whisper's tokenizer, decode side only: token ids → text (byte-level BPE, as GPT-2), plus the
 * special-token ids decoding needs. Built from the model's `tokenizer.json`.
 */

/** GPT-2's printable stand-ins for bytes (so every byte has a visible character in the vocab). */
function byteDecoder(): Map<string, number> {
  const bytes: number[] = [];
  for (let b = 33; b <= 126; b++) bytes.push(b);
  for (let b = 161; b <= 172; b++) bytes.push(b);
  for (let b = 174; b <= 255; b++) bytes.push(b);
  const chars = [...bytes];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bytes.includes(b)) {
      bytes.push(b);
      chars.push(256 + n++);
    }
  }
  return new Map(chars.map((c, i) => [String.fromCodePoint(c), bytes[i]!]));
}

export interface SpecialTokens {
  sot: number;
  eot: number;
  transcribe: number;
  noTimestamps: number;
  /** "Nobody is speaking here" — its probability tells silence and noise from speech. */
  noSpeech: number;
  /** First timestamp token; every id from here up is a timestamp. */
  timestampBegin: number;
  /** `<|en|>` → id … */
  languages: Map<string, number>;
}

export class WhisperTokenizer {
  readonly #pieces: string[];
  readonly #bytes = byteDecoder();
  readonly #utf8 = new TextDecoder('utf-8', { fatal: false });
  readonly special: SpecialTokens;
  /** Ids that are special (never text). */
  readonly specialIds = new Set<number>();

  constructor(json: {
    model: { vocab: Record<string, number> };
    added_tokens: { id: number; content: string; special?: boolean }[];
  }) {
    // A loop, not Math.max(...): the vocabulary has 50 000+ entries, more arguments than
    // Safari allows in one call ("Maximum call stack size exceeded").
    let size = 0;
    for (const id of Object.values(json.model.vocab)) if (id > size) size = id;
    for (const t of json.added_tokens) if (t.id > size) size = t.id;
    this.#pieces = new Array<string>(size + 1).fill('');
    for (const [piece, id] of Object.entries(json.model.vocab)) this.#pieces[id] = piece;
    const byName = new Map<string, number>();
    for (const t of json.added_tokens) {
      this.#pieces[t.id] = t.content;
      byName.set(t.content, t.id);
      this.specialIds.add(t.id);
    }
    const id = (name: string) => {
      const v = byName.get(name);
      if (v === undefined) throw new Error(`Tokenizer has no ${name}`);
      return v;
    };
    const languages = new Map<string, number>();
    for (const [name, v] of byName) {
      const m = /^<\|([a-z]{2,3}|haw|jw)\|>$/.exec(name);
      if (m && !['nocaptions', 'notimestamps'].includes(m[1]!)) languages.set(m[1]!, v);
    }
    const noTimestamps = id('<|notimestamps|>');
    this.special = {
      sot: id('<|startoftranscript|>'),
      eot: id('<|endoftext|>'),
      transcribe: id('<|transcribe|>'),
      noTimestamps,
      noSpeech: byName.get('<|nospeech|>') ?? id('<|nocaptions|>'),
      timestampBegin: noTimestamps + 1,
      languages,
    };
  }

  /** Bytes of a text token (empty for special ones). */
  bytes(id: number): number[] {
    if (this.specialIds.has(id) || id >= this.special.timestampBegin) return [];
    const out: number[] = [];
    for (const ch of this.#pieces[id] ?? '') {
      const b = this.#bytes.get(ch);
      if (b !== undefined) out.push(b);
    }
    return out;
  }

  /** Text of a run of tokens (bytes joined first, so multi-byte characters decode whole). */
  decode(ids: readonly number[]): string {
    return this.#utf8.decode(new Uint8Array(ids.flatMap((id) => this.bytes(id))));
  }
}
