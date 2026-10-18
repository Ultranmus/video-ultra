/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Animated and vector stickers (v0.3) in a real browser: an animated GIF sticker plays (exact
 * frames at two times differ; the same time twice is identical — it loops on its own clock), the
 * Animated tab adds a Noto animated emoji (credited) that plays too, and an SVG upload becomes a
 * crisp PNG sticker. Frames come from `saveFrame` (the export compositor).
 * Usage: playground running, then node scripts/stickers-check.ts [--port 3200] [--no-network]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const network = !process.argv.includes('--no-network');
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

/** Mean absolute difference (0…255) between the exact frames at two times. */
async function frameDiff(page: Page, a: number, b: number): Promise<number> {
  return page.evaluate(
    async ([ta, tb]) => {
      const c = (window as any).vuEditor;
      const grab = async (t: number) => {
        c.seek(Math.round(t * 705_600_000));
        const img = await c.saveFrame({ format: 'png', height: 360 });
        const bmp = await createImageBitmap(img.blob);
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const g = canvas.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height).data;
      };
      const x = await grab(ta);
      const y = await grab(tb);
      let sum = 0;
      for (let i = 0; i < x.length; i += 4)
        sum +=
          Math.abs(x[i]! - y[i]!) +
          Math.abs(x[i + 1]! - y[i + 1]!) +
          Math.abs(x[i + 2]! - y[i + 2]!);
      return sum / (x.length / 4) / 3;
    },
    [a, b] as const,
  );
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/editor?autosave=0`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
// A still background so only the sticker can change between frames.
await page
  .locator('.vu-root input[type=file][accept^="video"]')
  .setInputFiles([resolve('test-media/files', 'photo.jpg')]);
await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);
await page.locator('.vu-rail .vu-btn', { hasText: 'Stickers' }).click();
const upload = page.locator('.vu-stickers input[type=file]');

// 1. Animated GIF (20 frames at 10 fps).
await upload.setInputFiles([resolve('test-media/files', 'sticker.gif')]);
await page.waitForFunction(() =>
  (window as any).vuEditor.project.tracks.some((t: any) =>
    t.items.some((i: any) => i.kind === 'sticker'),
  ),
);
const moving = await frameDiff(page, 0.05, 0.55);
const same = await frameDiff(page, 0.25, 0.25);
// The sticker is a small part of the frame: any real change shows as a small mean difference.
check('a GIF sticker plays (frames 0.5 s apart differ)', moving > 0.3, moving.toFixed(2));
console.log(`GIF: ${moving.toFixed(2)} apart, ${same.toFixed(3)} same time`);
check('…and the same time gives the same frame', same < 0.01, same.toFixed(3));

// 2. SVG upload → PNG sticker.
const svgDir = mkdtempSync(join(tmpdir(), 'vu-svg-'));
const svg = join(svgDir, 'badge.svg');
writeFileSync(
  svg,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"><rect width="100" height="50" rx="12" fill="#e23"/><circle cx="25" cy="25" r="12" fill="#fff"/></svg>',
);
await upload.setInputFiles([svg]);
const svgAsset = await page.waitForFunction(() => {
  const assets = Object.values((window as any).vuEditor.project.assets) as any[];
  return assets.find((a) => a.name === 'badge.png') ?? null;
});
const svgInfo = (await svgAsset.jsonValue()) as any;
check(
  'an SVG upload becomes a 2048-px PNG sticker (its own aspect)',
  svgInfo.mimeType === 'image/png' && svgInfo.width === 2048 && svgInfo.height === 1024,
  `${svgInfo.mimeType} ${svgInfo.width}×${svgInfo.height}`,
);

// 3. Animated emoji from the library (needs the network).
if (network) {
  await page.locator('.vu-segmented button', { hasText: 'Animated' }).click();
  const grin = page.locator('.vu-emoji-animated[aria-label^="grinning face"]').first();
  await grin.waitFor({ timeout: 15000 });
  const tiles = await page.locator('.vu-emoji-animated').count();
  check('the Animated tab lists hundreds of animated emoji', tiles >= 100, String(tiles));
  await grin.click();
  const added = await page.waitForFunction(
    () => {
      const assets = Object.values((window as any).vuEditor.project.assets) as any[];
      return assets.find((a) => a.mimeType === 'image/webp') ?? null;
    },
    null,
    { timeout: 30000 },
  );
  const info = (await added.jsonValue()) as any;
  check(
    'the animated emoji keeps its licence line',
    /CC BY 4\.0/.test(info.credit ?? ''),
    info.credit,
  );
  // Only the new sticker on screen moves differently now: hide the GIF one.
  await page.evaluate(() => {
    const c = (window as any).vuEditor;
    for (const t of c.project.tracks)
      for (const i of t.items)
        if (
          i.kind === 'sticker' &&
          i.assetId &&
          c.project.assets[i.assetId].mimeType === 'image/gif'
        )
          c.run('hide', (d: any) => {
            for (const tt of d.tracks)
              for (const ii of tt.items) if (ii.id === i.id) ii.hidden = true;
          });
  });
  const emojiMoves = await frameDiff(page, 0.1, 0.9);
  check('the animated emoji plays', emojiMoves > 0.3, emojiMoves.toFixed(2));
}

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
