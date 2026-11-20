/**
 * Voiceover for the promo video: renders each line to promo/work/vo-<n>.mp3.
 *
 * With an ElevenLabs key it uses ElevenLabs text to speech (voice "Jessica", model eleven_v3),
 * then tightens the ends and speeds the pace up a little. The key comes from ELEVENLABS_API_KEY
 * or ELEVEN_LABS_KEY in the environment, or from a dotenv file given with `--env <file>` (e.g. a
 * gitignored .env.local). It is never printed or written anywhere. Without a key, or when the
 * service refuses, the macOS `say` voice stands in so the timing of the video still works.
 *
 * Requests go one at a time (free plans allow two at once) and every reply is cached in
 * promo/work/voice-cache by voice + model + text, so a rerun never spends quota on an unchanged
 * line. Usage on its own: node promo/voice.ts [--env <file>]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The narration, one line per scene (scene numbers match record.ts). */
export const LINES: readonly string[] = [
  'This is VideoUltra: a video editor you can drop into any React app.',
  'Most phone videos start like this. Six raw clips, a little flat.',
  'VideoUltra turns them into something worth sharing. Trim to the best moments,',
  'lift the colour, and add smooth transitions.',
  'Drop in music, and a big animated title.',
  'Need a voiceover? Type it. Captions? One tap.',
  'Then export an MP4, right in the browser.',
  'Before… and after. Made in a minute.',
  'And adding it to your app takes a few lines.',
  'VideoUltra. Free, fast and open source.',
];

/** Which engine spoke a line. */
export type VoiceEngine = 'elevenlabs' | 'say';

/** One rendered line. */
export interface VoiceLine {
  /** 1-based line number (vo-<n>.mp3). */
  n: number;
  text: string;
  file: string;
  /** Length of the audio in seconds. */
  seconds: number;
  engine: VoiceEngine;
}

const here = dirname(fileURLToPath(import.meta.url));
/** Work folder for intermediates (gitignored). */
export const WORK = join(here, 'work');

/** "Jessica": a bright, friendly default voice (works on every plan). */
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID ?? 'cgSgspJ2msm6clMCkdW9';
const ELEVEN_MODEL = 'eleven_v3';
/** Pace-up applied to the spoken lines (pitch kept). */
const TEMPO = 1.07;
const CACHE = join(WORK, 'voice-cache');
const SAY_VOICE = 'Samantha';

/** Length of an audio file in seconds (ffprobe). */
export function audioSeconds(file: string): number {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    file,
  ]).toString();
  return Number.parseFloat(out.trim());
}

async function elevenLabs(text: string, out: string, key: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: ELEVEN_MODEL,
          voice_settings: { stability: 0.5 },
        }),
      },
    );
    if (!res.ok) {
      console.warn(`  ElevenLabs refused (HTTP ${res.status}); using the stand-in voice`);
      return false;
    }
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch (error) {
    console.warn(`  ElevenLabs failed (${(error as Error).message}); using the stand-in voice`);
    return false;
  }
}

function sayLine(text: string, out: string): void {
  const raw = `${out}.say.wav`;
  execFileSync('say', ['-v', SAY_VOICE, '-r', '178', '-o', raw, '--data-format=LEF32@44100', text]);
  // Trim leading / trailing silence a little so the timing is tight, then mp3.
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    raw,
    '-af',
    'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    '-ar',
    '44100',
    '-ac',
    '1',
    '-b:a',
    '160k',
    out,
  ]);
}

const KEY_NAMES = ['ELEVENLABS_API_KEY', 'ELEVEN_LABS_KEY'] as const;

/** The ElevenLabs key from the environment or the `--env <file>` dotenv file (never logged). */
function elevenKey(): string | null {
  for (const name of KEY_NAMES) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  const i = process.argv.indexOf('--env');
  const file = i >= 0 ? process.argv[i + 1] : undefined;
  if (!file || !existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || !(KEY_NAMES as readonly string[]).includes(m[1]!)) continue;
    const v = m[2]!.replace(/^(['"])(.*)\1$/, '$2').trim();
    if (v) return v;
  }
  return null;
}

/** Tightens silence at both ends and applies the pace-up. */
function finish(raw: string, out: string, tempo: number): void {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    raw,
    '-af',
    'silenceremove=start_periods=1:start_threshold=-50dB,areverse,' +
      'silenceremove=start_periods=1:start_threshold=-50dB,areverse,' +
      `atempo=${tempo}`,
    '-ar',
    '44100',
    '-ac',
    '1',
    '-b:a',
    '160k',
    out,
  ]);
}

/** Renders every line (or reuses a cached one) and returns their files and lengths. */
export async function renderVoice(lines: readonly string[] = LINES): Promise<VoiceLine[]> {
  mkdirSync(CACHE, { recursive: true });
  const key = elevenKey();
  let elevenOk = key !== null;
  const result: VoiceLine[] = [];
  for (const [i, text] of lines.entries()) {
    const n = i + 1;
    const file = join(WORK, `vo-${n}.mp3`);
    const id = (engine: VoiceEngine) =>
      createHash('sha1')
        .update(engine === 'elevenlabs' ? `${ELEVEN_VOICE}|${ELEVEN_MODEL}|${text}` : `say|${text}`)
        .digest('hex')
        .slice(0, 16);
    let engine: VoiceEngine = 'say';
    let raw = join(CACHE, `${id('elevenlabs')}.mp3`);
    if (existsSync(raw)) engine = 'elevenlabs';
    else if (elevenOk && key && (await elevenLabs(text, `${raw}.part`, key))) {
      copyFileSync(`${raw}.part`, raw);
      engine = 'elevenlabs';
    } else {
      elevenOk = false;
      raw = join(CACHE, `${id('say')}.mp3`);
      if (!existsSync(raw)) sayLine(text, raw);
    }
    finish(raw, file, engine === 'elevenlabs' ? TEMPO : 1);
    const seconds = audioSeconds(file);
    result.push({ n, text, file, seconds, engine });
    console.log(`  vo-${n} ${seconds.toFixed(2)} s (${engine}): ${text}`);
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await renderVoice();
}
