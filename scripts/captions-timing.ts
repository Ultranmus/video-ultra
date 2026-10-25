/**
 * Caption word timing against the truth (DECISIONS #165): the system voice speaks known text
 * (scripts/tts-words.swift reports when each word starts), the playground's captions endpoint
 * hears it, and each word's start is compared with the true one — English, Hindi, and English
 * after 15 s of silence (where recognisers stretch the first word back). The editor's own
 * correction (`snapToVoice`) is applied as the editor does. macOS (system voices + swiftc).
 * Usage: playground running with a captions service, then node scripts/captions-timing.ts
 *   [--port 3200]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapToVoice } from '../packages/ai/src/align-words.ts';

const port = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '3200';
const dir = mkdtempSync(join(tmpdir(), 'vu-timing-'));
const tool = join(dir, 'tts-words');
execFileSync('swiftc', ['-O', 'scripts/tts-words.swift', '-o', tool]);

const CASES = [
  {
    id: 'English',
    voice: 'en-GB',
    language: 'en',
    lead: 0,
    text: 'Welcome back to the channel. Today we are making a quick video about cooking rice the easy way. First, rinse one cup of rice in cold water until the water runs clear. Thanks for watching, and see you next time.',
  },
  {
    id: 'Hindi',
    voice: 'hi-IN',
    language: 'hi',
    lead: 0,
    text: 'नमस्ते दोस्तों, आज हम एक आसान तरीके से चावल बनाना सीखेंगे। सबसे पहले एक कप चावल को ठंडे पानी में धो लीजिए। फिर दो कप पानी और थोड़ा नमक डालिए। देखने के लिए धन्यवाद, फिर मिलेंगे।',
  },
  {
    id: 'English after 15 s of silence',
    voice: 'en-GB',
    language: 'en',
    lead: 15,
    // Speech that runs past the 30 s piece: how the stretched first word was seen.
    text: 'Welcome back to the channel. Today we are making a quick video about cooking rice the easy way. First, rinse one cup of rice in cold water until the water runs clear. Then add two cups of water and a pinch of salt.',
  },
];

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');
type Word = { text: string; start: number; end: number };

let failures = 0;
for (const c of CASES) {
  const caf = join(dir, `${c.id.length}-${c.language}.caf`);
  const marks = execFileSync(tool, [c.voice, c.text, caf])
    .toString()
    .trim()
    .split('\n')
    .map((l) => l.split('\t'))
    .map(([w, t]) => ({ text: w!, start: Number(t) + c.lead }));
  const pcm = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      ...(c.lead ? ['-f', 'lavfi', '-t', String(c.lead), '-i', 'anullsrc=r=16000:cl=mono'] : []),
      '-i',
      caf,
      '-filter_complex',
      c.lead
        ? '[1]aresample=16000,aformat=channel_layouts=mono[s];[0][s]concat=n=2:v=0:a=1'
        : 'aresample=16000,aformat=channel_layouts=mono',
      '-t',
      '30',
      '-f',
      'f32le',
      '-',
    ],
    { maxBuffer: 1 << 26 },
  );
  const response = await fetch(`http://localhost:${port}/api/captions?language=${c.language}`, {
    method: 'POST',
    body: pcm,
  });
  if (!response.ok) throw new Error(`/api/captions answered ${response.status}`);
  const given = ((await response.json()) as { words: Word[] }).words;
  const sound = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
  const score = (words: readonly Word[]) => {
    const errors: number[] = [];
    let j = 0;
    for (const w of words) {
      const k = marks.slice(j, j + 5).findIndex((m) => norm(m.text) === norm(w.text));
      if (k < 0) continue;
      errors.push(w.start - marks[j + k]!.start);
      j += k + 1;
    }
    const mean = errors.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, errors.length);
    const worst = Math.max(...errors.map(Math.abs));
    return { mean, worst, matched: `${errors.length}/${marks.length}` };
  };
  const raw = score(given);
  const fixed = score(snapToVoice(given, sound));
  // Good captions: words within a fifth of a second on average, none off by a second.
  const ok = fixed.mean < 0.2 && fixed.worst < 1;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${c.id}: mean ${fixed.mean.toFixed(2)} s, worst ${fixed.worst.toFixed(2)} s (${fixed.matched} words; as the service gave them: mean ${raw.mean.toFixed(2)}, worst ${raw.worst.toFixed(2)})`,
  );
}
// The case the owner found (2026-10-25): a real clip after 15 s of silence, where the service put
// the first words in the silence ("Welcome" 0–12 s). The first word must start with the voice.
{
  const pcm = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
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
      '-t',
      '30',
      '-f',
      'f32le',
      '-',
    ],
    { maxBuffer: 1 << 26 },
  );
  const response = await fetch(`http://localhost:${port}/api/captions?language=en`, {
    method: 'POST',
    body: pcm,
  });
  const given = ((await response.json()) as { words: Word[] }).words;
  const first = snapToVoice(given, new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4))[0];
  // The voice starts at 15.0 s; "Welcome" is said at about 15.3 s.
  const ok = !!first && first.start > 14.9 && first.start < 15.5;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} a real clip after 15 s of silence: first word at ${first?.start.toFixed(2)} s (the service said ${given[0]?.start.toFixed(2)} s; the voice starts at 15.0 s)`,
  );
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
