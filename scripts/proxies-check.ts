/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Proxies (v0.4) in a real browser with a 4K clip: a lighter copy is made in its own worker (540p,
 * a keyframe every second, every frame decodes), playback from it drops fewer frames than from
 * the 4K original, exports still read the original (the exported frame matches the original
 * better than the copy), and after a reload the kept copy is found instead of made again.
 * Usage: playground running, then node scripts/proxies-check.ts [--port 3200]
 */
import { chromium, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const dir = mkdtempSync(join(tmpdir(), 'vu-proxies-'));
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const source = resolve('test-media/files/avc-4k30.mp4');

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];

async function open(mode: string, autosave = false, add = true): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/editor?autosave=${autosave ? 1 : 0}&proxies=${mode}`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  if (add) await page.locator('.vu-root input[type=file][accept^="video"]').setInputFiles([source]);
  await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);
  return page;
}

/** Plays 3 s from the start; frames shown and late. */
async function playStats(page: Page) {
  return page.evaluate(async () => {
    const c = (window as any).vuEditor;
    c.seek(0);
    await new Promise((r) => setTimeout(r, 800));
    const before = await c.engine.stats();
    c.play();
    await new Promise((r) => setTimeout(r, 3000));
    c.pause();
    const after = await c.engine.stats();
    return {
      presented: after.presented - before.presented,
      late: after.late - before.late,
      skipped: after.skipped - before.skipped,
    };
  });
}

// 1. Without a copy (proxies off): the 4K original.
let page = await open('off');
await page.waitForTimeout(1500);
const original = await playStats(page);
await page.close();

// 2. With a copy (autosaved, so step 4 can open the same project again).
page = await open('always', true);
const t0 = Date.now();
const made = await page
  .waitForFunction(() => (window as any).vuEditor.proxies.size === 1, null, { timeout: 180000 })
  .then(() => true)
  .catch(() => false);
const seconds = (Date.now() - t0) / 1000;
check('a 540p copy of the 4K clip is made', made, `${seconds.toFixed(1)} s`);
const proxyBytes: number[] = await page.evaluate(async () => {
  const file = [...(window as any).vuEditor.proxies.values()][0] as File;
  return Array.from(new Uint8Array(await file.arrayBuffer()));
});
const proxyFile = join(dir, 'proxy.mp4');
writeFileSync(proxyFile, Buffer.from(proxyBytes));
const probe = JSON.parse(
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,nb_frames:format=duration',
    '-of',
    'json',
    proxyFile,
  ]).toString(),
);
const keyframes = execFileSync('ffprobe', [
  '-v',
  'error',
  '-select_streams',
  'v:0',
  '-skip_frame',
  'nokey',
  '-show_entries',
  'frame=pts_time',
  '-of',
  'csv=p=0',
  proxyFile,
])
  .toString()
  .trim()
  .split('\n').length;
const stream = probe.streams[0];
const sourceProbe = JSON.parse(
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=nb_frames:format=duration',
    '-of',
    'json',
    source,
  ]).toString(),
);
const sourceDuration = +sourceProbe.format.duration;
const sourceFrames = +sourceProbe.streams[0].nb_frames;
check(
  'the copy is 960×540, same length, a keyframe every second',
  stream.width === 960 &&
    stream.height === 540 &&
    Math.abs(probe.format.duration - sourceDuration) < 0.1 &&
    keyframes >= Math.floor(sourceDuration),
  `${stream.width}×${stream.height}, ${(+probe.format.duration).toFixed(2)} s, ${keyframes} keyframes, ${(proxyBytes.length / 2 ** 20).toFixed(1)} MB (original ${(statSync(source).size / 2 ** 20).toFixed(0)} MB)`,
);
const decoded = execFileSync('ffmpeg', ['-v', 'error', '-i', proxyFile, '-f', 'framemd5', '-'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((l) => /^\d/.test(l)).length;
check(
  'every frame of the copy decodes (as many as the original)',
  decoded === sourceFrames,
  `${decoded} of ${sourceFrames} frames`,
);

const withProxy = await playStats(page);
check(
  'playback from the copy drops fewer frames than from the 4K original',
  withProxy.late + withProxy.skipped < original.late + original.skipped ||
    (original.late + original.skipped === 0 && withProxy.late + withProxy.skipped === 0),
  `4K: ${original.presented} shown, ${original.late} late, ${original.skipped} skipped · copy: ${withProxy.presented} shown, ${withProxy.late} late, ${withProxy.skipped} skipped`,
);

// 3. Exports read the original: give the clip a deliberately *different* copy (a frame of the
// Sintel trailer) — the preview must show it, the export must not.
const routing = await page.evaluate(async () => {
  const c = (window as any).vuEditor;
  c.run('ratio', (d: any) => {
    d.settings.width = 1920;
    d.settings.height = 1080;
  });
  const assetId = c.project.tracks[0].items[0].assetId;
  const fake = await (await fetch('/media/sintel-trailer-480p.mp4')).blob();
  const lumaMean = (s: any) => {
    let m = 0;
    for (let i = 0; i < 256; i++) m += i * s.histogram[768 + i];
    return m / s.pixels;
  };
  const real = lumaMean(await c.engine.scopes(705_600_000));
  await c.engine.setProxy(assetId, fake);
  await new Promise((r) => setTimeout(r, 500));
  const preview = lumaMean(await c.engine.scopes(705_600_000));
  const res = await c.exportVideo(
    {
      format: 'mp4',
      height: 360,
      fps: 30,
      quality: 'medium',
      range: { start: 0, end: 2 * 705_600_000 },
    },
    () => {},
    new AbortController().signal,
  );
  const v = document.createElement('video');
  v.muted = true;
  v.src = URL.createObjectURL(res.blob);
  await new Promise((r) => (v.onloadeddata = r));
  v.currentTime = 1;
  await new Promise((r) => (v.onseeked = r));
  const canvas = new OffscreenCanvas(64, 36);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(v, 0, 0, 64, 36);
  const d = ctx.getImageData(0, 0, 64, 36).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4)
    sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
  // Put the real copy back.
  await c.engine.setProxy(assetId, [...c.proxies.values()][0]);
  return { real, preview, exported: sum / (64 * 36) };
});
check(
  'preview reads the copy, export reads the original',
  Math.abs(routing.preview - routing.real) > 20 && Math.abs(routing.exported - routing.real) < 12,
  `luma: original ${routing.real.toFixed(0)}, preview with a different copy ${routing.preview.toFixed(0)}, export ${routing.exported.toFixed(0)}`,
);
await page.waitForTimeout(2000); // autosave
await page.close();

// 4. Opening the same project again finds the kept copy.
page = await open('always', true, false);
const reused = await page
  .waitForFunction(() => (window as any).vuEditor.proxies.size === 1, null, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
const jobs = await page.evaluate(
  () => Object.keys((window as any).vuEditor.ui.getState().proxyJobs).length,
);
check('after a reload the kept copy is used at once (not made again)', reused && jobs === 0);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
