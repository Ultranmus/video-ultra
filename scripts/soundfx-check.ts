/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Sound effects and level meter (v0.4) in a real browser, measured on exported WAV files:
 * Pitch +12 doubles a tone, Keep the voice natural undoes a 2× speed-up, More bass lifts a 60 Hz
 * tone ~8 dB, Even out narrows the gap between loud and quiet, the presets / sliders write the
 * project, and the level meter moves while playing and rests when paused. Axe on the section.
 * Usage: playground running, then node scripts/soundfx-check.ts [--port 3200]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const dir = mkdtempSync(join(tmpdir(), 'vu-soundfx-'));
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

// Test tones (made here: exact, known content; "-ac 2" puts a mono tone at −3 dB on each side).
const tone = (name: string, filter: string) => {
  const file = join(dir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', filter, '-ac', '2', file]);
  return file;
};
const tone440 = tone('tone440.wav', 'aevalsrc=0.3*sin(2*PI*440*t):s=48000:d=4');
const tone60 = tone('tone60.wav', 'aevalsrc=0.3*sin(2*PI*60*t):s=48000:d=4');
const loudQuiet = tone(
  'loudquiet.wav',
  "aevalsrc='if(lt(t,2),0.8,0.05)*sin(2*PI*440*t)':s=48000:d=4",
);

/** Decodes a sound file to mono float samples at 48 kHz. */
function samples(file: string): Float32Array {
  const raw = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-ac',
    '1',
    '-ar',
    '48000',
    '-f',
    'f32le',
    '-',
  ]);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}
const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (to - from));
};
const db = (x: number) => 20 * Math.log10(x);
/** Strongest frequency between 100 and 1500 Hz (Goertzel, 2 Hz steps) over 1 s from 1 s in. */
function pitchOf(x: Float32Array): number {
  let best = 0;
  let bestPower = -1;
  const seg = x.subarray(48000, 96000);
  for (let f = 100; f <= 1500; f += 2) {
    const c = 2 * Math.cos((2 * Math.PI * f) / 48000);
    let s1 = 0;
    let s2 = 0;
    for (const v of seg) {
      const s0 = v + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const p = s1 * s1 + s2 * s2 - c * s1 * s2;
    if (p > bestPower) {
      bestPower = p;
      best = f;
    }
  }
  return best;
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

async function load(file: string) {
  await page.goto(`http://localhost:${port}/editor?autosave=0`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page.locator('.vu-root input[type=file][accept^="video"]').setInputFiles([file]);
  await page.waitForFunction(() =>
    (window as any).vuEditor.project.tracks.some((t: any) =>
      t.items.some((i: any) => i.kind === 'audio'),
    ),
  );
  return page.evaluate(() => {
    const c = (window as any).vuEditor;
    for (const t of c.project.tracks)
      for (const i of t.items) if (i.kind === 'audio') return i.id as string;
    return '';
  });
}
const setFx = (id: string, fx: unknown, speed?: number) =>
  page.evaluate(
    ([itemId, f, s]) => {
      const c = (window as any).vuEditor;
      c.run('fx', (d: any) => {
        for (const t of d.tracks)
          for (const i of t.items)
            if (i.id === itemId) {
              i.audioFx = f ?? undefined;
              if (s) {
                i.speed = s;
                i.duration = Math.round(i.duration / s);
              }
            }
      });
    },
    [id, fx, speed] as const,
  );
let n = 0;
async function exportWav(): Promise<Float32Array> {
  const bytes: number[] = await page.evaluate(async () => {
    const res = await (window as any).vuEditor.exportAudio(
      { format: 'wav', quality: 'high' },
      () => {},
      new AbortController().signal,
    );
    return Array.from(new Uint8Array(await res.blob.arrayBuffer()));
  });
  const file = join(dir, `out-${n++}.wav`);
  writeFileSync(file, Buffer.from(bytes));
  return samples(file);
}

// 1. Pitch, and keep pitch at 2×.
let id = await load(tone440);
const plain = pitchOf(await exportWav());
await setFx(id, { pitch: 12 });
const up = pitchOf(await exportWav());
check(
  'Pitch +12 doubles a 440 Hz tone',
  Math.abs(up - 880) <= 6 && Math.abs(plain - 440) <= 4,
  `${plain} → ${up} Hz`,
);
await setFx(id, undefined, 2);
const fast = pitchOf(await exportWav());
await setFx(id, { keepPitch: true });
const kept = pitchOf(await exportWav());
check(
  '2× speed raises it; Keep the voice natural brings it back',
  Math.abs(fast - 880) <= 6 && Math.abs(kept - 440) <= 6,
  `2×: ${fast} Hz, kept: ${kept} Hz`,
);

// 2. EQ through the UI: "More bass" on a 60 Hz tone.
id = await load(tone60);
const flat = await exportWav();
await page.evaluate((itemId) => (window as any).vuEditor.select(itemId), id);
await page.locator('.vu-section-toggle', { hasText: 'Sound effects' }).click();
const axe = await new AxeBuilder({ page }).include('.vu-inspector').analyze();
check(
  'Sound effects section passes axe',
  axe.violations.length === 0,
  axe.violations.map((v) => v.id).join(', '),
);
await page.locator('.vu-inspector .vu-chip', { hasText: 'More bass' }).click();
const fx = await page.evaluate((itemId) => {
  const c = (window as any).vuEditor;
  for (const t of c.project.tracks) for (const i of t.items) if (i.id === itemId) return i.audioFx;
}, id);
check('picking "More bass" sets the effect', fx?.eq?.low === 8, JSON.stringify(fx));
const bass = await exportWav();
const lift = db(rms(bass, 48000, 144000) / rms(flat, 48000, 144000));
check(
  'More bass lifts a 60 Hz tone by about 8 dB',
  lift > 6.5 && lift < 9.5,
  `${lift.toFixed(1)} dB`,
);
await page.locator('.vu-inspector .vu-chip', { hasText: 'Original' }).click();
check(
  '"Original" removes the effects',
  (await page.evaluate((itemId) => {
    const c = (window as any).vuEditor;
    for (const t of c.project.tracks)
      for (const i of t.items) if (i.id === itemId) return i.audioFx ?? null;
  }, id)) === null,
);

// 3. Even out (compressor).
id = await load(loudQuiet);
const raw = await exportWav();
await setFx(id, { compress: 1 });
const even = await exportWav();
const gap = (x: Float32Array) => db(rms(x, 24000, 90000) / rms(x, 120000, 186000));
check(
  'Even out narrows the loud / quiet gap',
  gap(even) < gap(raw) - 6,
  `${gap(raw).toFixed(1)} → ${gap(even).toFixed(1)} dB`,
);

// 4. The meter while playing.
await load(tone440);
await page.evaluate(() => (window as any).vuEditor.play());
await page.waitForTimeout(1200);
const playingScale = await page.evaluate(() => {
  const fill = document.querySelector('.vu-meter-fill') as HTMLElement | null;
  return fill ? fill.style.transform : 'none';
});
await page.evaluate(() => (window as any).vuEditor.pause());
await page.waitForTimeout(1500);
const restScale = await page.evaluate(() => (window as any).vuEditor.levels.left);
const level = parseFloat(/scaleX\(([\d.]+)\)/.exec(playingScale)?.[1] ?? '0');
check(
  'level meter moves while playing (a −13 dB tone ≈ 0.72 of the bar)',
  level > 0.66 && level < 0.78,
  playingScale,
);
check('meter rests when paused', restScale === 0, String(restScale));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
