/**
 * Speech test clips with known transcripts, for the captions work (v0.2 A0): English (two
 * accents), Hindi, and English over music. Uses macOS `say` and ffmpeg; writes
 * test-media/files/speech-*.m4a and speech.json (the reference text for word-error rates).
 * Synthetic voices are easier than real ones — real recordings are checked on devices.
 * Usage: node scripts/speech-media.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve('test-media/files');
const tmp = mkdtempSync(join(tmpdir(), 'vu-speech-'));

const EN =
  'Welcome back to the channel. Today we are making a quick video about cooking rice the easy way. ' +
  'First, rinse one cup of rice in cold water until the water runs clear. ' +
  'Then add two cups of water and a pinch of salt, and bring it to a boil. ' +
  'Turn the heat down low, cover the pot, and wait about fifteen minutes. ' +
  'Do not lift the lid while it cooks. When the time is up, let it rest for five minutes, ' +
  'fluff it with a fork, and it is ready to serve. Thanks for watching, and see you next time.';
const HI =
  'नमस्ते दोस्तों, आज हम घर पर आसानी से चाय बनाना सीखेंगे। ' +
  'सबसे पहले एक बर्तन में दो कप पानी डालिए और उसे गरम कीजिए। ' +
  'जब पानी उबलने लगे, तो उसमें अदरक और दो चम्मच चाय पत्ती डालिए। ' +
  'दो मिनट बाद दूध और चीनी मिलाइए और धीमी आंच पर पकने दीजिए। ' +
  'अब चाय को छानकर कप में डालिए और गरमा गरम पीजिए। ' +
  'वीडियो पसंद आए तो लाइक कीजिए और फिर मिलेंगे।';

const clips = [
  { name: 'speech-en-gb', voice: 'Daniel', text: EN, language: 'en' },
  { name: 'speech-en-in', voice: 'Rishi', text: EN, language: 'en' },
  { name: 'speech-hi', voice: 'Lekha', text: HI, language: 'hi' },
];

const manifest: Record<string, { text: string; language: string; seconds: number }> = {};
for (const clip of clips) {
  const aiff = join(tmp, `${clip.name}.aiff`);
  execFileSync('say', ['-v', clip.voice, '-o', aiff, clip.text]);
  const file = join(out, `${clip.name}.m4a`);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    aiff,
    '-ac',
    '1',
    '-ar',
    '44100',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    file,
  ]);
  manifest[clip.name] = { text: clip.text, language: clip.language, seconds: duration(file) };
}

// English over music (speech at full level, music 14 dB down, looped to length).
const mixed = join(out, 'speech-en-music.m4a');
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-i',
  join(out, 'speech-en-gb.m4a'),
  '-stream_loop',
  '-1',
  '-i',
  join(out, 'music.mp3'),
  '-filter_complex',
  '[1:a]volume=-14dB[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]',
  '-map',
  '[a]',
  '-ac',
  '2',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  mixed,
]);
manifest['speech-en-music'] = { text: EN, language: 'en', seconds: duration(mixed) };

// A long one (≈ 6 min) for memory staying flat: the English clip six times.
const long = join(out, 'speech-en-long.m4a');
const list = join(tmp, 'list.txt');
writeFileSync(
  list,
  Array(6)
    .fill(`file '${join(out, 'speech-en-gb.m4a')}'`)
    .join('\n'),
);
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  list,
  '-c',
  'copy',
  long,
]);
manifest['speech-en-long'] = {
  text: Array(6).fill(EN).join(' '),
  language: 'en',
  seconds: duration(long),
};

writeFileSync(join(out, 'speech.json'), JSON.stringify(manifest, null, 2));
console.log(
  Object.entries(manifest)
    .map(([k, v]) => `${k}: ${v.seconds.toFixed(1)} s`)
    .join('\n'),
);

function duration(file: string): number {
  return Number(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ])
      .toString()
      .trim(),
  );
}
