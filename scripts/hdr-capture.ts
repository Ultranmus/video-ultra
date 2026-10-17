/**
 * HDR research (2026-10-17): captures each GPU import path's rendering of HDR iPhone frames
 * (Chrome + WebKit) and Apple's reference SDR frames (avconvert, macOS only) at the same
 * timestamps. Needs the playground running and the owner's files in test-media/private.
 * Output: test-media/files/hdr-research/*.png (git-ignored — these are private frames).
 * Then: python3 scripts/hdr-analyze.py (needs numpy + Pillow).
 */
import { chromium, webkit } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-media');
const out = join(root, 'files', 'hdr-research');
const media = join(root, 'private');
mkdirSync(out, { recursive: true });

const durations: Record<string, number> = {
  'iphone-1080p2997-hdr-landscape-mono.mov': 26,
  'iphone-1080p30-hdr-portrait.mov': 25,
  'iphone-1080p2997-hdr-portrait.mov': 34,
  'iphone-4k60-hdr-portrait-28s.mov': 28,
  'iphone-4k60-hdr-portrait-54s.mov': 53,
};
// Six moments spread across each HDR video: more varied scenes (dark, bright, colourful).
const shots: [string, number][] = Object.entries(durations).flatMap(([file, seconds]) =>
  [0.08, 0.25, 0.42, 0.58, 0.75, 0.92].map(
    (f) => [file, Math.round(seconds * f * 10) / 10] as [string, number],
  ),
);

const key = (file: string, t: number) => `${file.replace(/\.[^.]+$/, '')}@${t}`;

// Apple references: avconvert (AVFoundation's HDR → SDR) then the exact frame via ffmpeg.
for (const file of new Set(shots.map(([f]) => f))) {
  const sdr = join(out, `${file}.apple-sdr.mp4`);
  if (!existsSync(sdr)) {
    execFileSync('avconvert', [
      '--source',
      join(media, file),
      '--preset',
      'Preset1920x1080',
      '--output',
      sdr,
      '--replace',
    ]);
  }
  for (const [f, t] of shots.filter(([f]) => f === file)) {
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-ss',
      String(t),
      '-i',
      sdr,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      join(out, `apple--${key(f, t)}.png`),
    ]);
  }
}

for (const [name, type, opts] of [
  ['chrome', chromium, { channel: 'chrome' }],
  ['webkit', webkit, {}],
] as const) {
  const browser = await type.launch(opts);
  for (const [file, t] of shots) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:3200/lab/hdr?file=private/${file}&t=${t}`);
    await page.waitForFunction(
      () => !/Probing/.test(document.getElementById('report')?.textContent ?? 'Probing'),
      null,
      { timeout: 120000 },
    );
    const text = (await page.locator('#report').textContent()) ?? '';
    if (text.startsWith('FAILED')) {
      console.log(name, file, t, text);
      await page.close();
      continue;
    }
    const result = JSON.parse(text) as { images: Record<string, string> };
    for (const [path, png] of Object.entries(result.images)) {
      writeFileSync(join(out, `${name}-${path}--${key(file, t)}.png`), Buffer.from(png, 'base64'));
    }
    console.log(name, key(file, t), Object.keys(result.images).join(', '));
    await page.close();
  }
  await browser.close();
}
