/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Clean up noise (DECISIONS #156) on real speech, through the engine's own mixer: a LibriVox
 * Hindi reading with fan-like noise mixed in (test-media/files/real/hi1-fan.m4a; made from
 * hi1-clean.m4a if missing). Per 20 ms frame, against the clean reading: the noise left in the
 * pauses, and how much of the speech stays — effect off vs. on. Also: the setting saves and
 * Extract audio carries it to the sound clip.
 * Usage: playground running, then node scripts/denoise-check.ts [--port 3200] [--amount 0.7]
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const amount = Number(arg('amount') ?? 0.7);
const RATE = 16_000;
const FRAME = 320;

let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

const dir = resolve('test-media/files/real');
const clean = resolve(dir, 'hi1-clean.m4a');
const noisy = resolve(dir, 'hi1-fan.m4a');
if (!existsSync(noisy))
  execFileSync('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-i', clean, '-f', 'lavfi', '-t', '60'],
    ...['-i', 'anoisesrc=color=pink:amplitude=0.04:r=48000,lowpass=f=6000', '-filter_complex'],
    '[0:a]aresample=48000,pan=stereo|c0=c0|c1=c0[s];[s][1:a]amix=inputs=2:duration=first:normalize=0[o]',
    ...['-map', '[o]', '-c:a', 'aac', '-b:a', '160k', noisy],
  ]);

/** Frame levels (dB) of a file, decoded by ffmpeg at 16 kHz mono. */
function levels(file: string): number[] {
  const raw = execFileSync(
    'ffmpeg',
    [
      ...['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(RATE)],
      ...['-f', 'f32le', '-'],
    ],
    { maxBuffer: 1 << 30 },
  );
  const pcm = new Float32Array(Uint8Array.from(raw).buffer);
  const out: number[] = [];
  for (let i = 0; i + FRAME <= pcm.length; i += FRAME) {
    let s = 0;
    for (let j = i; j < i + FRAME; j++) s += pcm[j]! * pcm[j]!;
    out.push(10 * Math.log10(s / FRAME + 1e-12));
  }
  return out;
}

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/editor?autosave=0`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
await page.locator('.vu-root input[type=file][accept^="video"]').setInputFiles([noisy]);
await page.waitForFunction(
  () =>
    (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'audio' && t.items.length),
  null,
  { timeout: 30000 },
);

/** The engine's mix as frame levels (dB), with Clean up noise at `a`. */
const mix = (a: number) =>
  page.evaluate(
    async ({ a, frame, rate }) => {
      const c = (window as any).vuEditor;
      const track = c.project.tracks.find((t: any) => t.kind === 'audio');
      const id = track.items[0].id;
      c.run('Clean up noise', (d: any) => {
        const item = d.tracks.find((t: any) => t.kind === 'audio').items[0];
        item.audioFx = a > 0 ? { denoise: a } : undefined;
        if (!item.audioFx) delete item.audioFx;
      });
      await new Promise((r) => setTimeout(r, 300));
      const end = c.project.tracks.find((t: any) => t.kind === 'audio').items[0];
      const out: number[] = [];
      let carry: number[] = [];
      for await (const pcm of c.engine.listen(
        c.project,
        0,
        end.start + end.duration,
        rate,
        new AbortController().signal,
      )) {
        const all = carry.concat(Array.from(pcm as Float32Array));
        let i = 0;
        for (; i + frame <= all.length; i += frame) {
          let s = 0;
          for (let j = i; j < i + frame; j++) s += all[j]! * all[j]!;
          out.push(10 * Math.log10(s / frame + 1e-12));
        }
        carry = all.slice(i);
      }
      void id;
      return out;
    },
    { a, frame: FRAME, rate: RATE },
  );

const ref = levels(clean);
const off = await mix(0);
const on = await mix(amount);
// Pauses: the clean reading is silent there (below −55 dB); speech: it's loud (above −30 dB).
const pauses: number[] = [];
const speech: number[] = [];
// The effect's delay: one 1024-sample frame at the mixer's rate, in 20 ms frames.
const lag = Math.round(1024 / FRAME);
const quiet = (i: number) => ref.slice(i - 4, i + 5).every((v) => v < -55);
for (let i = 5; i < Math.min(ref.length, off.length, on.length) - lag - 5; i++) {
  if (quiet(i)) pauses.push(i);
  else if (ref[i]! > -30) speech.push(i);
}
const mean = (xs: number[], arr: number[], shift = 0) =>
  10 * Math.log10(xs.reduce((s, i) => s + 10 ** (arr[i + shift]! / 10), 0) / xs.length);
const noiseOff = mean(pauses, off);
const noiseOn = mean(pauses, on, lag);
const speechOff = mean(speech, off);
const speechOn = mean(speech, on, lag);
check(
  `noise in the pauses goes down at ${Math.round(amount * 100)} %`,
  noiseOn < noiseOff - 8,
  `${noiseOff.toFixed(1)} → ${noiseOn.toFixed(1)} dB (${pauses.length} pause frames)`,
);
check(
  'the speech stays',
  Math.abs(speechOn - speechOff) < 2,
  `${speechOff.toFixed(1)} → ${speechOn.toFixed(1)} dB (${speech.length} speech frames)`,
);

// Extract audio keeps the effect (a video's own sound): set it on a video, extract, compare.
await page
  .locator('.vu-root input[type=file][accept^="video"]')
  .setInputFiles([resolve('test-media/files/avc-1080p30.mp4')]);
await page.waitForFunction(
  () => (window as any).vuEditor.project.tracks[0].items.length === 1,
  null,
  { timeout: 30000 },
);
const carried = await page.evaluate(() => {
  const c = (window as any).vuEditor;
  const video = c.project.tracks[0].items[0];
  c.run('Fx', (d: any) => {
    const v = d.tracks[0].items[0];
    v.audioFx = { denoise: 0.5, compress: 0.3 };
    v.fadeIn = 705_600_000 / 2;
  });
  c.select(video.id);
  c.extractAudio();
  const sounds = c.project.tracks
    .filter((t: any) => t.kind === 'audio')
    .flatMap((t: any) => t.items);
  const extracted = sounds.find((s: any) => s.assetId === video.assetId);
  return extracted ? { fx: extracted.audioFx, fadeIn: extracted.fadeIn } : null;
});
check(
  'Extract audio keeps the effects and fades',
  carried?.fx?.denoise === 0.5 &&
    carried?.fx?.compress === 0.3 &&
    carried?.fadeIn === 705_600_000 / 2,
  JSON.stringify(carried),
);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
