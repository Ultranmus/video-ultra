/**
 * Voiceover for the promo video: renders each line to promo/work/vo-<n>.mp3.
 *
 * With ELEVENLABS_API_KEY in the environment it uses ElevenLabs text to speech (a warm, clear
 * premade narrator, model eleven_multilingual_v2). Without a key, or when the service refuses,
 * it falls back to the macOS `say` voice so the timing of the video still works. The key is only
 * read from the environment: it is never printed or written anywhere.
 *
 * A line is rendered again only when its text or engine changed (a small .json next to the mp3
 * remembers both). Usage on its own: node promo/voice.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The narration, one entry per scene that speaks (scene numbers match record.ts). */
export const LINES: readonly string[] = [
  'This is VideoUltra: a complete video editor you can drop into any React or Next.js app.',
  'Add your clips. They stay on the device: nothing is uploaded.',
  'Trim and split right on the timeline.',
  'Drop in music,',
  'add a title,',
  'then a warm filter and smooth transitions.',
  'It plays smoothly, even on a budget phone.',
  'Export an MP4 right in the browser.',
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

/** "Rachel": a warm, calm, clear premade narrator voice. */
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';
const ELEVEN_MODEL = 'eleven_multilingual_v2';
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
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.25 },
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

/** Renders every line (or reuses an up-to-date one) and returns their files and lengths. */
export async function renderVoice(lines: readonly string[] = LINES): Promise<VoiceLine[]> {
  mkdirSync(WORK, { recursive: true });
  const key = process.env.ELEVENLABS_API_KEY?.trim() || null;
  let elevenOk = key !== null;
  const result: VoiceLine[] = [];
  for (const [i, text] of lines.entries()) {
    const n = i + 1;
    const file = join(WORK, `vo-${n}.mp3`);
    const meta = join(WORK, `vo-${n}.json`);
    const wanted: VoiceEngine = elevenOk ? 'elevenlabs' : 'say';
    let engine: VoiceEngine | null = null;
    if (existsSync(file) && existsSync(meta)) {
      const old = JSON.parse(readFileSync(meta, 'utf8')) as { text: string; engine: VoiceEngine };
      if (old.text === text && (old.engine === wanted || old.engine === 'elevenlabs'))
        engine = old.engine;
    }
    if (!engine) {
      if (elevenOk && key && (await elevenLabs(text, file, key))) engine = 'elevenlabs';
      else {
        elevenOk = false;
        sayLine(text, file);
        engine = 'say';
      }
      writeFileSync(meta, JSON.stringify({ text, engine }));
    }
    const seconds = audioSeconds(file);
    result.push({ n, text, file, seconds, engine });
    console.log(`  vo-${n} ${seconds.toFixed(2)} s (${engine}): ${text}`);
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await renderVoice();
}
