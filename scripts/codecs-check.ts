/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Export codecs (v0.4) in a real browser: every codec the device's encoders accept (H.264, HEVC,
 * AV1 in MP4; VP9, AV1 in WebM) exports a 2 s part; ffprobe must read the codec asked for and
 * ffmpeg must decode every frame. Codecs the device can't encode must fail with a clear message.
 * Usage: playground running, then node scripts/codecs-check.ts [--port 3200]
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const dir = mkdtempSync(join(tmpdir(), 'vu-codecs-'));
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext()).newPage();
await page.goto(`http://localhost:${port}/editor?autosave=0`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
await page
  .locator('.vu-root input[type=file][accept^="video"]')
  .setInputFiles([resolve('test-media/files/avc-720p30.mp4')]);
await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);

const want: Record<string, string> = {
  auto: 'h264',
  h264: 'h264',
  hevc: 'hevc',
  av1: 'av1',
  vp9: 'vp9',
};
const sizes: Record<string, number> = {};
for (const [format, codec] of [
  ['mp4', 'auto'],
  ['mp4', 'hevc'],
  ['mp4', 'av1'],
  ['webm', 'auto'],
  ['webm', 'av1'],
] as const) {
  const r = await page.evaluate(
    async ([f, c]) => {
      try {
        const res = await (window as any).vuEditor.exportVideo(
          {
            format: f,
            height: 480,
            fps: 30,
            quality: 'medium',
            videoCodec: c,
            range: { start: 0, end: 2 * 705_600_000 },
          },
          () => {},
          new AbortController().signal,
        );
        return { ok: true, bytes: Array.from(new Uint8Array(await res.blob.arrayBuffer())) };
      } catch (e) {
        return { ok: false, err: String(e) };
      }
    },
    [format, codec] as const,
  );
  const label = `${format} · ${codec}`;
  if (!r.ok) {
    check(`${label}: not available here — says so clearly`, /can't encode/.test(r.err!), r.err);
    continue;
  }
  const file = join(dir, `out-${codec}.${format}`);
  writeFileSync(file, Buffer.from(r.bytes as number[]));
  sizes[`${format}-${codec}`] = r.bytes!.length;
  const probed = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'csv=p=0',
    file,
  ])
    .toString()
    .trim();
  const expected = format === 'webm' && codec === 'auto' ? ['vp9', 'vp8'] : [want[codec]!];
  let decoded: number;
  try {
    const log = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-i', file, '-map', '0:v', '-f', 'framemd5', '-'],
      { encoding: 'utf8' },
    );
    decoded = log.split('\n').filter((l) => /^\d/.test(l)).length;
  } catch {
    decoded = -1;
  }
  check(
    `${label}: ${probed}, every frame decodes`,
    expected.includes(probed) && decoded >= 58,
    `${decoded} frames, ${(r.bytes!.length / 1024).toFixed(0)} KB`,
  );
}
if (sizes['mp4-av1'] && sizes['mp4-auto'])
  check(
    'AV1 is about half the size of H.264 at the same quality',
    sizes['mp4-av1'] < sizes['mp4-auto'] * 0.7,
    `${sizes['mp4-av1']} vs ${sizes['mp4-auto']} bytes`,
  );
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
