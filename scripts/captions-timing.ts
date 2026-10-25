/**
 * Captions against the truth (DECISIONS #165, #167), through the editor's own captions helper
 * (`createCaptionsEndpoint`, with the speech detector) and the playground's captions endpoint:
 * the system voice speaks known text (scripts/tts-words.swift reports when each word starts),
 * then each case is checked —
 *   timing:   word starts vs the true ones (clean English and Hindi; speech under music and
 *             under noise as loud as the voice);
 *   coverage: words found and none doubled (a 2½-minute talk: pieces cut at pauses);
 *   made up:  music alone, noise alone, speech buried in room noise → no words;
 *   silence:  a real clip after 15 s of silence → the first word starts with the voice.
 * macOS (system voices, swiftc, ffmpeg); needs the playground running with a captions service.
 * Usage: node scripts/captions-timing.ts [--port 3200]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type * as Ort from 'onnxruntime-web';
import { createCaptionsEndpoint } from '../packages/ai/dist/index.js';

const port = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '3200';
const RATE = 16_000;
const dir = mkdtempSync(join(tmpdir(), 'vu-timing-'));
const tool = join(dir, 'tts-words');
execFileSync('swiftc', ['-O', 'scripts/tts-words.swift', '-o', tool]);

// The speech detector, as the editor's worker runs it (Node has no workers of that kind).
// The ONNX runtime is the ai package's dependency: resolved from there.
const ort = (await import(
  pathToFileURL(createRequire(resolve('packages/ai/package.json')).resolve('onnxruntime-web')).href
)) as typeof Ort;
ort.env.wasm.numThreads = 1;
const model = await (
  await fetch(
    'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model_quantized.onnx',
  )
).arrayBuffer();
const session = await ort.InferenceSession.create(new Uint8Array(model));
async function detect(sound: Float32Array): Promise<Uint8Array> {
  let state: Ort.Tensor = new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]);
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  const input = new Float32Array(576);
  const chance: number[] = [];
  for (let i = 0; i < sound.length; i += 512) {
    input.copyWithin(0, 512, 576);
    input.fill(0, 64);
    input.set(sound.subarray(i, i + 512), 64);
    const out = await session.run({ input: new ort.Tensor('float32', input, [1, 576]), state, sr });
    chance.push((out.output!.data as Float32Array)[0]!);
    state = out.stateN as Ort.Tensor;
  }
  const frames = Math.floor(sound.length / 320);
  const voice = new Uint8Array(frames);
  for (let f = 0; f < frames; f++)
    if ((chance[Math.min(chance.length - 1, Math.floor((f * 320 + 160) / 512))] ?? 0) >= 0.5)
      voice[f] = 1;
  for (let f = 0, last = -1; f < frames; f++) {
    if (!voice[f]) continue;
    if (last >= 0 && f - last <= 10) voice.fill(1, last, f);
    last = f;
  }
  return voice;
}

const transcriber = createCaptionsEndpoint({
  endpoint: `http://localhost:${port}/api/captions`,
  voice: detect,
});
type Word = { text: string; start: number; end: number };
async function caption(sound: Float32Array, language: string): Promise<Word[]> {
  async function* pieces() {
    for (let i = 0; i < sound.length; i += 10 * RATE) yield sound.slice(i, i + 10 * RATE);
  }
  const r = await transcriber.transcribe({
    audio: pieces(),
    duration: sound.length / RATE,
    language,
    signal: new AbortController().signal,
  });
  return r.words;
}

const pcm = (args: string[]) => {
  const b = execFileSync(
    'ffmpeg',
    ['-v', 'error', ...args, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
    {
      maxBuffer: 1 << 28,
    },
  );
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};
function speak(voice: string, text: string, lead = 0) {
  const caf = join(dir, `${Math.random().toString(36).slice(2)}.caf`);
  const marks = execFileSync(tool, [voice, text, caf], { maxBuffer: 1 << 24 })
    .toString()
    .trim()
    .split('\n')
    .map((l) => l.split('\t'))
    .map(([w, t]) => ({ text: w!, start: Number(t) + lead }));
  const sound = pcm(lead ? ['-i', caf, '-af', `adelay=${lead * 1000}`] : ['-i', caf]);
  return { marks, sound };
}
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
/** `bg` under `speech`, as loud as the voice (0 dB) — or alone. */
function mix(speech: Float32Array, bg: Float32Array, withSpeech = true) {
  const k = rms(speech) / rms(bg.subarray(0, speech.length));
  return speech.map((x, i) => (withSpeech ? x : 0) + (bg[i % bg.length] ?? 0) * k);
}
const music = pcm(['-stream_loop', '-1', '-i', 'test-media/files/music.mp3', '-t', '200']);
const noise = pcm([
  '-f',
  'lavfi',
  '-i',
  'anoisesrc=color=brown:amplitude=0.3:r=16000',
  '-t',
  '200',
]);

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');
function score(words: readonly Word[], marks: readonly { text: string; start: number }[]) {
  const errors: number[] = [];
  let j = 0;
  for (const w of words) {
    const k = marks.slice(j, j + 6).findIndex((m) => norm(m.text) === norm(w.text));
    if (k < 0) continue;
    errors.push(Math.abs(w.start - marks[j + k]!.start));
    j += k + 1;
  }
  const mean = errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length);
  return { mean, found: errors.length / marks.length, worst: Math.max(0, ...errors) };
}

let failures = 0;
const report = (ok: boolean, line: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${line}`);
};

const EN =
  'Welcome back to the channel. Today we are making a quick video about cooking rice the easy way. First, rinse one cup of rice in cold water until the water runs clear. Then add two cups of water and a pinch of salt, and bring it to a boil. Thanks for watching, and see you next time.';
const HI =
  'नमस्ते दोस्तों, आज हम एक आसान तरीके से चावल बनाना सीखेंगे। सबसे पहले एक कप चावल को ठंडे पानी में धो लीजिए। फिर दो कप पानी और थोड़ा नमक डालिए। देखने के लिए धन्यवाद, फिर मिलेंगे।';

// Timing.
for (const [name, voice, language, text, under] of [
  ['English', 'en-GB', 'en', EN, null],
  ['Hindi', 'hi-IN', 'hi', HI, null],
  ['English under music as loud as the voice', 'en-GB', 'en', EN, music],
  ['English under noise as loud as the voice', 'en-GB', 'en', EN, noise],
] as const) {
  const { marks, sound } = speak(voice, text, 1);
  const s = score(await caption(under ? mix(sound, under) : sound, language), marks);
  report(
    s.mean < 0.2 && s.found > 0.8,
    `${name}: ${(s.found * 100).toFixed(0)} % of words, mean ${s.mean.toFixed(2)} s off (worst ${s.worst.toFixed(2)} s)`,
  );
}

// Coverage over many pieces: a 2½-minute talk.
{
  const paragraphs = [
    EN,
    'Now let us talk about vegetables. Wash the carrots, peel them, and cut them into small pieces. Put them in a pan with a little oil and stir for five minutes.',
    'While the vegetables cook, prepare the sauce. Mix soy sauce, a spoon of honey, garlic and ginger in a small bowl. Taste it and add more salt if you like.',
    'When everything is ready, put the rice in a bowl, add the vegetables on top, and pour the sauce over it. It is simple, quick and very tasty.',
    'If you enjoyed this recipe, try it with chicken or tofu next time. Leave a comment and tell me how it went. See you in the next video.',
  ];
  const { marks, sound } = speak('en-GB', [...paragraphs, ...paragraphs].join(' '), 1);
  const words = await caption(sound, 'en');
  const s = score(words, marks);
  // Doubled at a cut: the same word twice in a row — beyond the times the text has it so
  // ("over it. It is").
  const pairs = (list: readonly { text: string }[]) =>
    list.filter((w, i) => i && norm(w.text) === norm(list[i - 1]!.text)).length;
  const doubled = Math.max(0, pairs(words) - pairs(marks));
  report(
    s.found > 0.9 && doubled === 0 && s.mean < 0.2,
    `${(sound.length / RATE).toFixed(0)} s talk: ${(s.found * 100).toFixed(0)} % of ${marks.length} words, ${doubled} doubled, mean ${s.mean.toFixed(2)} s off`,
  );
}

// Made-up words: music alone, noise alone.
for (const [name, bg] of [
  ['music alone', music],
  ['noise alone', noise],
] as const) {
  const quiet = speak('en-GB', EN).sound;
  const words = await caption(mix(quiet, bg, false), 'auto');
  report(words.length === 0, `${name}: ${words.length} words made up`);
}

// Speech nobody can make out (a phone re-recording in a noisy room): no captions, not guesses.
for (const file of ['hi1-phone', 'hi2-phone']) {
  const words = await caption(pcm(['-i', `test-media/files/real/${file}.m4a`]), 'auto');
  report(
    words.length === 0,
    `${file} (speech buried in room noise): ${words.length} words made up`,
  );
}
// Known limit (DECISIONS #167): Whisper answers this one with a confident Malay "translation"
// labelled English — every signal says it's fine. Reported, not counted.
{
  const words = await caption(pcm(['-i', 'test-media/files/real/en-tts-phone.m4a']), 'auto');
  console.log(`KNOWN en-tts-phone (speech buried in room noise): ${words.length} words made up`);
}

// The case the owner found: a real clip after 15 s of silence.
{
  const sound = pcm([
    '-f',
    'lavfi',
    '-t',
    '15',
    '-i',
    'anullsrc=r=16000:cl=mono',
    '-i',
    'test-media/files/speech-en-gb.m4a',
    '-filter_complex',
    '[1]aresample=16000,aformat=channel_layouts=mono[s];[0][s]concat=n=2:v=0:a=1',
  ]);
  const first = (await caption(sound, 'en'))[0];
  report(
    !!first && first.start > 14.9 && first.start < 15.5,
    `a real clip after 15 s of silence: first word at ${first?.start.toFixed(2)} s (the voice starts at 15.0 s)`,
  );
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
