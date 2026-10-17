/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Crash recovery through the editor UI: import media, edit, reload the tab without warning, and
 * check that the project, its media and the preview come back. WebKit (Playwright) has no OPFS, so
 * it only shows the memory fallback (nothing to recover) — run it in Chrome and Firefox.
 * Usage: playground running, then node scripts/editor-recovery.ts [--browsers chrome,firefox]
 */
import { chromium, firefox } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const browsers = (arg('browsers') ?? 'chrome,firefox').split(',');
const port = arg('port') ?? '3200';
const launch = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  firefox: () => firefox.launch(),
};

let failed = false;
for (const name of browsers) {
  const browser = await launch[name as keyof typeof launch]();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const ready = () =>
    page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page.goto(`http://localhost:${port}/editor`);
  await ready();
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles([
      resolve('test-media/files/avc-1080p30.mp4'),
      resolve('test-media/files/photo.jpg'),
    ]);
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks[0].items.length === 2,
    null,
    {
      timeout: 30000,
    },
  );
  // Edits: rename, split at 1 s.
  await page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.seek(705_600_000);
    c.split();
  });
  const before = await page.evaluate(() => {
    const v = (window as any).vuEditor.project.tracks;
    return JSON.stringify(v, (_k, x) =>
      x && typeof x === 'object' && !Array.isArray(x)
        ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
        : x,
    );
  });
  // Give the 250 ms log batch time to land, then "crash" (reload without a flush).
  await page.waitForTimeout(600);
  await page.reload();
  await ready();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(async () => {
    const c = (window as any).vuEditor;
    const stats = await c.engine.stats();
    return {
      tracks: ((v: unknown) =>
        JSON.stringify(v, (_k, x) =>
          x && typeof x === 'object' && !Array.isArray(x)
            ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
            : x,
        ))(c.project.tracks),
      media: c.media.size,
      assets: Object.keys(c.project.assets).length,
      drawn: stats.lastLayers,
      storage: c.storage.kind,
    };
  });
  if (after.tracks !== before)
    console.log(`  before ${before.slice(0, 600)}\n  after  ${after.tracks.slice(0, 600)}`);
  const ok = after.tracks === before && after.media === 2 && after.drawn > 0;
  if (!ok) failed = true;
  console.log(
    `${name}: ${ok ? 'PASS' : 'FAIL'} · storage ${after.storage} · project ${after.tracks === before ? 'same' : 'DIFFERENT'} · media ${after.media}/${after.assets} · layers drawn ${after.drawn}`,
  );
  await browser.close();
}
process.exit(failed ? 1 : 0);
