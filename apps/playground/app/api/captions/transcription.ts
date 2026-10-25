import type { CaptionsEndpointReply } from '@video-ultra/ai';
import { wav } from './wav';

/**
 * Captions from a speech-to-text service with the OpenAI transcription API (DECISIONS #164):
 * Groq, OpenAI, or a self-hosted Whisper server. Each word comes with its time from the
 * recogniser itself, in ~99 languages.
 *
 * A chosen language is checked first: the piece is heard with detection on; when the language
 * heard is the chosen one (or one it's easily mistaken for: Hindi / Urdu…) those words are used,
 * else it's heard again in the chosen language and the reply says what was heard — the editor
 * keeps speech that switches languages, and says so when none of it was the chosen one.
 */
export async function transcriptionCaptions(
  samples: Float32Array,
  language: string,
  service: { key: string; url: string; model: string },
  hints: { context: string; vocabulary: string },
  signal: AbortSignal,
): Promise<CaptionsEndpointReply | Response> {
  const sound = new Blob([wav(samples)], { type: 'audio/wav' });
  const prompt = promptOf(hints);
  const detected = await hear(sound, null, prompt, service, signal);
  if (detected instanceof Response || language === 'auto') return detected;
  // Nothing believable heard: its language is a guess too — not "another language".
  if (!believable(detected)) return { words: [], language };
  if (detected.language === language) return detected;
  const forced = await hear(sound, language, prompt, service, signal);
  if (forced instanceof Response) return forced;
  return {
    words: forced.words,
    language: sameAs(language, detected.language) ? language : detected.language,
  };
}

/** Whisper's `prompt`: names to spell right, then the words said just before (≤ ~224 tokens). */
function promptOf(hints: { context: string; vocabulary: string }): string {
  return [hints.vocabulary, hints.context].filter(Boolean).join('. ').slice(-600);
}

/** Some words the editor will keep (it drops those under 0.3). */
const believable = (reply: CaptionsEndpointReply) =>
  reply.words.some((w) => typeof w === 'string' || (w.confidence ?? 1) >= 0.3);

async function hear(
  sound: Blob,
  language: string | null,
  prompt: string,
  service: { key: string; url: string; model: string },
  signal: AbortSignal,
): Promise<CaptionsEndpointReply | Response> {
  const form = new FormData();
  form.append('file', sound, 'speech.wav');
  form.append('model', service.model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');
  if (language) form.append('language', language);
  if (prompt) form.append('prompt', prompt);
  const upstream = await fetch(service.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${service.key}` },
    body: form,
    signal,
  }).catch(() => null);
  if (signal.aborted) return new Response(null, { status: 499 });
  if (!upstream) return new Response('The captions service is unreachable', { status: 502 });
  if (!upstream.ok) {
    // A busy service's "try again in N s" reaches the editor, which waits that long.
    const retry = upstream.headers.get('retry-after');
    return new Response(await upstream.text(), {
      status: upstream.status,
      ...(retry ? { headers: { 'retry-after': retry } } : {}),
    });
  }
  const body = (await upstream.json()) as {
    language?: string;
    text?: string;
    words?: { word?: string; start?: number; end?: number }[];
    segments?: { start: number; end: number; no_speech_prob?: number; avg_logprob?: number }[];
  };
  const segments = body.segments ?? [];
  const confidenceAt = (t: number) => {
    const g = segments.find((s) => t >= s.start && t < s.end) ?? segments.at(-1);
    return g ? confidenceOf(g) : undefined;
  };
  const words = Array.isArray(body.words)
    ? body.words
        .filter((w) => typeof w.word === 'string' && w.word.trim())
        .map((w) => {
          const confidence = confidenceAt(w.start ?? 0);
          return {
            text: w.word!.trim(),
            start: w.start ?? 0,
            end: w.end ?? w.start ?? 0,
            ...(confidence !== undefined ? { confidence } : {}),
          };
        })
    : // No word times from this service: the text, timed from the sound by the editor.
      (body.text ?? '').split(/\s+/).filter(Boolean);
  return { words, language: isoCode(body.language) ?? language ?? 'en' };
}

/**
 * How sure Whisper is of a stretch (0…1, DECISIONS #166, #167): its average token probability,
 * and when it also thinks nobody was speaking (made-up speech), that much less. Measured on the
 * test library: real speech 0.55–0.95; invented and translated text 0.04–0.18 (dropped < 0.3).
 */
function confidenceOf(g: { no_speech_prob?: number; avg_logprob?: number }): number {
  const sure = Math.exp(Math.min(0, g.avg_logprob ?? 0));
  const silent = g.no_speech_prob ?? 0;
  const value = silent > 0.5 && (g.avg_logprob ?? 0) < -0.5 ? sure * (1 - silent) : sure;
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

/** Languages a recogniser easily mistakes for each other (spoken alike): not "another language". */
const ALIKE = [
  ['hi', 'ur'],
  ['no', 'nn'],
  ['ms', 'id'],
  ['sr', 'hr', 'bs'],
];
const sameAs = (a: string, b: string) =>
  a === b || ALIKE.some((g) => g.includes(a) && g.includes(b));

/** A language as the service names it ("hindi", "Hindi" or "hi") → its ISO 639-1 code. */
function isoCode(name: string | undefined): string | null {
  if (!name) return null;
  const lower = name.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(lower)) return lower;
  return WHISPER_LANGUAGES[lower] ?? null;
}

/** Whisper's language names → ISO 639-1 codes (what its transcription APIs report). */
const WHISPER_LANGUAGES: Record<string, string> = {
  english: 'en',
  chinese: 'zh',
  german: 'de',
  spanish: 'es',
  russian: 'ru',
  korean: 'ko',
  french: 'fr',
  japanese: 'ja',
  portuguese: 'pt',
  turkish: 'tr',
  polish: 'pl',
  catalan: 'ca',
  dutch: 'nl',
  arabic: 'ar',
  swedish: 'sv',
  italian: 'it',
  indonesian: 'id',
  hindi: 'hi',
  finnish: 'fi',
  vietnamese: 'vi',
  hebrew: 'he',
  ukrainian: 'uk',
  greek: 'el',
  malay: 'ms',
  czech: 'cs',
  romanian: 'ro',
  danish: 'da',
  hungarian: 'hu',
  tamil: 'ta',
  norwegian: 'no',
  thai: 'th',
  urdu: 'ur',
  croatian: 'hr',
  bulgarian: 'bg',
  lithuanian: 'lt',
  latin: 'la',
  maori: 'mi',
  malayalam: 'ml',
  welsh: 'cy',
  slovak: 'sk',
  telugu: 'te',
  persian: 'fa',
  latvian: 'lv',
  bengali: 'bn',
  serbian: 'sr',
  azerbaijani: 'az',
  slovenian: 'sl',
  kannada: 'kn',
  estonian: 'et',
  macedonian: 'mk',
  breton: 'br',
  basque: 'eu',
  icelandic: 'is',
  armenian: 'hy',
  nepali: 'ne',
  mongolian: 'mn',
  bosnian: 'bs',
  kazakh: 'kk',
  albanian: 'sq',
  swahili: 'sw',
  galician: 'gl',
  marathi: 'mr',
  punjabi: 'pa',
  sinhala: 'si',
  khmer: 'km',
  shona: 'sn',
  yoruba: 'yo',
  somali: 'so',
  afrikaans: 'af',
  occitan: 'oc',
  georgian: 'ka',
  belarusian: 'be',
  tajik: 'tg',
  sindhi: 'sd',
  gujarati: 'gu',
  amharic: 'am',
  yiddish: 'yi',
  lao: 'lo',
  uzbek: 'uz',
  faroese: 'fo',
  'haitian creole': 'ht',
  pashto: 'ps',
  turkmen: 'tk',
  nynorsk: 'nn',
  maltese: 'mt',
  sanskrit: 'sa',
  luxembourgish: 'lb',
  myanmar: 'my',
  burmese: 'my',
  tibetan: 'bo',
  tagalog: 'tl',
  malagasy: 'mg',
  assamese: 'as',
  tatar: 'tt',
  hawaiian: 'haw',
  lingala: 'ln',
  hausa: 'ha',
  bashkir: 'ba',
  javanese: 'jw',
  sundanese: 'su',
  cantonese: 'yue',
};
