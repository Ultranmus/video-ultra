import type { TranscriptWord } from '@video-ultra/core';
import type * as Ort from 'onnxruntime-web';
import { activeFrames, joinHeard, voicedSeconds } from '../windows';
import { firstFrames, heardUntil, tokenStartTimes, wordsFromTokens } from './align';
import { MelExtractor, N_FRAMES, SAMPLE_RATE } from './mel';
import type { WhisperTokenizer } from './tokenizer';

/**
 * A Whisper model on the ONNX runtime, kept lean: one encoder pass per 30 s window, then greedy
 * decoding with the merged decoder's key/value cache, collecting only the alignment heads'
 * cross-attention for word times. No sampling fallbacks; a repetition guard stops runaway loops.
 */

export interface WhisperConfig {
  decoderLayers: number;
  decoderHeads: number;
  headDim: number;
  nMels: number;
  /** [layer, head] pairs whose attention follows the speech. */
  alignmentHeads: [number, number][];
  suppressTokens: number[];
  beginSuppressTokens: number[];
  maxNewTokens: number;
}

type Session = Ort.InferenceSession;

/** Languages "Detect" chooses from (the ones the Captions panel offers). */
const DETECT_AMONG = new Set([
  'en',
  'hi',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'nl',
  'id',
  'tr',
  'ru',
  'ar',
  'bn',
  'ur',
  'ta',
  'te',
  'mr',
]);

/** Most extra hearings of one window after early ends (DECISIONS #208). */
export const MAX_SEEKS = 3;
/** An early end: the text stops more than this before the window's end (s)… */
const SEEK_MIN_LEFT = 1.5;
/** …and at least this much sound with voice follows it (s). */
const SEEK_MIN_VOICE = 2;
/** The next hearing starts this long before the last word's peak (s). */
const SEEK_BACK = 0.4;

export class WhisperRunner {
  readonly #ort: typeof Ort;
  readonly #encoder: Session;
  readonly #decoder: Session;
  readonly #tok: WhisperTokenizer;
  readonly #cfg: WhisperConfig;
  readonly #mel: MelExtractor;
  /** Logit mask: tokens never produced (special ones, timestamps, the config's list). */
  readonly #suppress: Uint8Array;

  constructor(
    ort: typeof Ort,
    encoder: Session,
    decoder: Session,
    tokenizer: WhisperTokenizer,
    config: WhisperConfig,
  ) {
    this.#ort = ort;
    this.#encoder = encoder;
    this.#decoder = decoder;
    this.#tok = tokenizer;
    this.#cfg = config;
    this.#mel = new MelExtractor(config.nMels);
    const vocab = 51_866;
    this.#suppress = new Uint8Array(vocab + 1600);
    for (const id of config.suppressTokens) this.#suppress[id] = 1;
    for (const id of tokenizer.specialIds) if (id !== tokenizer.special.eot) this.#suppress[id] = 1;
    for (let id = tokenizer.special.timestampBegin; id < this.#suppress.length; id++)
      this.#suppress[id] = 1;
  }

  /**
   * Hears one window (≤ 30 s of 16 kHz mono). `language` is an ISO code or `'auto'`. Returns
   * words (seconds from the window's start) and the language used. When the model ends early
   * (a few words, then its end token, with speech still to come) it hears the rest again from
   * the last word, like a seek (DECISIONS #208), up to {@link MAX_SEEKS} times.
   */
  async transcribe(
    audio: Float32Array,
    language: string,
  ): Promise<{ words: TranscriptWord[]; language: string; seeks: number }> {
    const words: TranscriptWord[] = [];
    let lang = language;
    let offset = 0;
    let seeks = 0;
    for (;;) {
      const part = offset ? audio.subarray(Math.round(offset * SAMPLE_RATE)) : audio;
      const heard = await this.#hearOnce(part, lang);
      lang = heard.language;
      joinHeard(words, heard.words, offset);
      if (heard.endedAt === null || seeks >= MAX_SEEKS) break;
      offset += heard.endedAt;
      seeks++;
    }
    return { words, language: lang, seeks };
  }

  /**
   * One pass of the model over `audio`. `endedAt`: where the heard text ends (s) when the model
   * stopped early with more speech after it, else null.
   */
  async #hearOnce(
    audio: Float32Array,
    language: string,
  ): Promise<{ words: TranscriptWord[]; language: string; endedAt: number | null }> {
    const ort = this.#ort;
    const cfg = this.#cfg;
    const special = this.#tok.special;
    const features = this.#mel.extract(audio);
    const encoded = await this.#encoder.run({
      input_features: new ort.Tensor('float32', features, [1, cfg.nMels, N_FRAMES]),
    });
    const hidden = encoded.last_hidden_state!;

    // Language: given, or the most likely language token after <|startoftranscript|>.
    let lang = language;
    let langId = special.languages.get(language);
    let past: Record<string, Ort.Tensor> | null = null;
    if (!langId) {
      const out = await this.#step([special.sot], hidden, null);
      const logits = out.logits.data as Float32Array;
      let best = -Infinity;
      for (const [code, id] of special.languages) {
        // Only the languages captions offer: on noise, detection drifts to rare ones.
        if (!DETECT_AMONG.has(code)) continue;
        const v = logits[id]!;
        if (v > best) {
          best = v;
          lang = code;
          langId = id;
        }
      }
      disposeAll(out.raw);
    }
    const prompt = [special.sot, langId!, special.transcribe, special.noTimestamps];
    let noSpeech = 0;
    let logprobSum = 0;
    let picked = 0;

    const heads = cfg.alignmentHeads;
    const frames = Math.min(1500, Math.ceil(audio.length / SAMPLE_RATE / 0.02));
    // Attention rows per alignment head: one row per token (prompt + generated), frames wide.
    const rows: Float32Array[][] = heads.map(() => []);
    const tokens: number[] = [];
    let input = prompt;
    for (let step = 0; step < cfg.maxNewTokens; step++) {
      const out = await this.#step(input, hidden, past);
      if (past) disposeAll(past, out.keep);
      past = out.present;
      this.#collect(out.raw, input.length, rows, frames);
      // How likely "nobody speaks here" was, right after <|startoftranscript|> (first pass only).
      if (step === 0) noSpeech = this.#probability(out.logits, 0, special.noSpeech);
      const next = this.#pick(out.logits, step === 0);
      logprobSum += this.#lastLogprob;
      picked++;
      disposeAll(out.raw, out.keep);
      if (next === special.eot) {
        tokens.push(next);
        break;
      }
      tokens.push(next);
      if (repeating(tokens)) break;
      input = [next];
    }
    if (past) disposeAll(past);
    hidden.dispose?.();

    // Text tokens (without the end token and any trailing repetition cut).
    const text = tokens.filter((t) => t < special.eot);
    if (!text.length) return { words: [], language: lang, endedAt: null };
    // Made-up text (DECISIONS #130): with no clear speech the model still writes confident
    // sentences. Drop the window when it thought nobody was speaking and wasn't sure of what it
    // wrote (Whisper's own rule), when it was very unsure, or when it only repeated itself.
    const avg = logprobSum / Math.max(1, picked);
    // Repetition in words (tokens repeat a lot in scripts spelled byte by byte, like Devanagari).
    const said = this.#tok.decode(text).split(/\s+/).filter(Boolean);
    const unique = said.length ? new Set(said).size / said.length : 1;
    // Measured on real speech vs. made-up text (PERF.md "Captions"): speech scores no-speech
    // ≤ 0.04 and confidence ≥ −0.3; made-up text no-speech ≥ 0.08 and confidence ≤ −0.75.
    // A high no-speech probability alone doesn't mean nobody spoke: on real Hindi under background
    // sound it reads 0.4–0.7 while the window is full of words written with confidence (≥ −0.5).
    // Made-up text is sparse (a word or two: "आप", "Thank you.") or unsure (≤ −0.75), so a
    // confident, wordy window is kept whatever that probability says.
    const seconds = audio.length / SAMPLE_RATE;
    const wordy = said.length >= Math.max(4, seconds * 0.3);
    const totalRows = prompt.length + tokens.length;
    const attention = rows.map((r) => {
      const m = new Float32Array(totalRows * frames);
      r.slice(0, totalRows).forEach((row, i) => m.set(row, i * frames));
      return m;
    });
    // Ended early: the text stops well before the sound does and there is speech after it. The
    // words are timed within what was heard (the warping would stretch them over the rest), and
    // the caller hears on from there.
    const until = heardUntil(attention, frames, prompt.length, prompt.length + text.length - 1);
    const early =
      until >= 1 &&
      until < seconds - SEEK_MIN_LEFT &&
      voicedSeconds(activeFrames(audio), until + 0.3) >= SEEK_MIN_VOICE;
    if (
      avg < -1 ||
      (noSpeech > 0.06 && avg < -0.6) ||
      (noSpeech > 0.5 && !(wordy && avg >= -0.6)) ||
      (said.length > 8 && unique < 0.3)
    )
      return { words: [], language: lang, endedAt: null };
    const timedFrames = early ? Math.min(frames, Math.ceil((until + 0.3) / 0.02)) : frames;
    const jumps = tokenStartTimes(
      early ? firstFrames(attention, totalRows, frames, timedFrames) : attention,
      totalRows,
      timedFrames,
    );
    const starts = new Float32Array(text.length);
    const ends = new Float32Array(text.length);
    for (let k = 0; k < text.length; k++) {
      starts[k] = jumps[prompt.length + k]!;
      ends[k] = jumps[prompt.length + k + 1]!;
    }
    return {
      words: wordsFromTokens(this.#tok, text, starts, ends),
      language: lang,
      // Heard again from a little before the last word: the model skips words when its sound
      // starts mid-speech, and words heard twice are kept once.
      endedAt: early ? until - SEEK_BACK : null,
    };
  }

  /** One decoder pass for `ids` (the prompt, or one new token). */
  async #step(
    ids: number[],
    hidden: Ort.Tensor,
    past: Record<string, Ort.Tensor> | null,
  ): Promise<{
    logits: Ort.Tensor;
    present: Record<string, Ort.Tensor>;
    raw: Ort.InferenceSession.OnnxValueMapType;
    keep: Set<Ort.Tensor>;
  }> {
    const ort = this.#ort;
    const cfg = this.#cfg;
    const feeds: Record<string, Ort.Tensor> = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      encoder_hidden_states: hidden,
      use_cache_branch: new ort.Tensor('bool', [past !== null], [1]),
    };
    for (let l = 0; l < cfg.decoderLayers; l++) {
      for (const part of ['decoder.key', 'decoder.value', 'encoder.key', 'encoder.value']) {
        const name = `past_key_values.${l}.${part}`;
        feeds[name] =
          past?.[name] ??
          new ort.Tensor('float32', new Float32Array(0), [1, cfg.decoderHeads, 0, cfg.headDim]);
      }
    }
    const raw = await this.#decoder.run(feeds);
    // The cache for the next step: new decoder keys/values; the encoder's stay from step one.
    const present: Record<string, Ort.Tensor> = {};
    const keep = new Set<Ort.Tensor>();
    for (let l = 0; l < cfg.decoderLayers; l++) {
      for (const part of ['decoder.key', 'decoder.value', 'encoder.key', 'encoder.value']) {
        const name = `past_key_values.${l}.${part}`;
        const fresh = raw[`present.${l}.${part}`]!;
        const value = part.startsWith('encoder') && past ? past[name]! : fresh;
        present[name] = value;
        keep.add(value);
      }
    }
    return { logits: raw.logits!, present, raw, keep };
  }

  /** Copies the alignment heads' attention rows for this step's tokens. */
  #collect(
    raw: Ort.InferenceSession.OnnxValueMapType,
    newRows: number,
    rows: Float32Array[][],
    frames: number,
  ): void {
    this.#cfg.alignmentHeads.forEach(([layer, head], h) => {
      const t = raw[`cross_attentions.${layer}`]!;
      const data = t.data as Float32Array;
      const [, nHeads, tgt, src] = t.dims as [number, number, number, number];
      for (let r = tgt - newRows; r < tgt; r++) {
        const offset = (head * tgt + r) * src;
        rows[h]!.push(data.slice(offset, offset + frames));
      }
      void nHeads;
    });
  }

  /** Log-probability of the last token `#pick` chose. */
  #lastLogprob = 0;

  /** Probability of token `id` at position `row` (softmax over the vocabulary). */
  #probability(logits: Ort.Tensor, row: number, id: number): number {
    const data = logits.data as Float32Array;
    const vocab = logits.dims[2]!;
    const base = row * vocab;
    let max = -Infinity;
    for (let v = 0; v < vocab; v++) if (data[base + v]! > max) max = data[base + v]!;
    let sum = 0;
    for (let v = 0; v < vocab; v++) sum += Math.exp(data[base + v]! - max);
    return Math.exp(data[base + id]! - max) / sum;
  }

  /** Greedy pick at the last position, with the suppression rules. */
  #pick(logits: Ort.Tensor, first: boolean): number {
    const data = logits.data as Float32Array;
    const [, len, vocab] = logits.dims as [number, number, number];
    const base = (len - 1) * vocab;
    let best = -Infinity;
    let id = this.#tok.special.eot;
    for (let v = 0; v < vocab; v++) {
      if (this.#suppress[v]) continue;
      if (first && this.#cfg.beginSuppressTokens.includes(v)) continue;
      const x = data[base + v]!;
      if (x > best) {
        best = x;
        id = v;
      }
    }
    // Its log-probability among the tokens it could have chosen.
    let sum = 0;
    for (let v = 0; v < vocab; v++) {
      if (this.#suppress[v] || (first && this.#cfg.beginSuppressTokens.includes(v))) continue;
      sum += Math.exp(data[base + v]! - best);
    }
    this.#lastLogprob = -Math.log(sum);
    return id;
  }
}

/**
 * Whether the tail is a loop (the same 1–8 tokens 4+ times running) — small models sometimes
 * repeat a syllable until the token limit. The repeats are dropped.
 */
function repeating(tokens: number[]): boolean {
  for (let n = 1; n <= 8; n++) {
    const times = n === 1 ? 6 : 4;
    if (tokens.length < n * times) continue;
    let same = true;
    for (let k = 1; k < times && same; k++)
      for (let i = 0; i < n && same; i++)
        if (tokens[tokens.length - 1 - i] !== tokens[tokens.length - 1 - i - k * n]) same = false;
    if (same) {
      tokens.length -= n * (times - 1);
      return true;
    }
  }
  return false;
}

function disposeAll(
  values: Record<string, Ort.Tensor> | Ort.InferenceSession.OnnxValueMapType,
  except?: Set<Ort.Tensor>,
): void {
  for (const v of Object.values(values)) {
    const t = v as Ort.Tensor;
    if (except?.has(t)) continue;
    t.dispose?.();
  }
}
