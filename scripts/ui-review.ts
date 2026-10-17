/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Visual review: walks the editor through the states a first-time user sees and saves a
 * screenshot of each — desktop (Chrome) and phone (WebKit, iPhone size, touch). Look at every one
 * before calling UI work done (feedback memory "ui-quality-bar").
 * Usage: playground running, then node scripts/ui-review.ts --shots <dir> [--only desktop|phone]
 *   [--theme light]
 */
import { chromium, devices, webkit, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const shots = arg('shots') ?? '.';
const only = arg('only');
const theme = arg('theme') ?? 'dark';
const port = arg('port') ?? '3200';
const media = ['avc-1080p30.mp4', 'avc-rotated.mp4', 'photo.jpg', 'music.mp3'].map((f) =>
  resolve('test-media/files', f),
);

async function snap(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/${name}.png` });
}

async function load(page: Page) {
  await page.goto(`http://localhost:${port}/editor?autosave=0&theme=${theme}`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
}

async function addMedia(page: Page) {
  await page.locator('.vu-root input[type=file][accept^="video"]').setInputFiles(media);
  await page.waitForFunction(
    () =>
      (window as any).vuEditor.project.tracks.reduce(
        (n: number, t: any) => n + t.items.length,
        0,
      ) >= 4,
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1500);
}

const errors: string[] = [];

if (only !== 'phone') {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  ).newPage();
  page.on('pageerror', (e) => errors.push(`desktop: ${e.message}`));
  await load(page);
  await snap(page, 'd01-empty');
  await page.locator('.vu-bar-actions .vu-btn', { hasText: 'Split' }).hover();
  await page.waitForTimeout(700);
  await snap(page, 'd02-disabled-tooltip');
  await addMedia(page);
  await snap(page, 'd03-imported');
  // Hover a clip on the canvas timeline for its tooltip.
  const canvas = (await page.locator('.vu-timeline-canvas canvas').boundingBox())!;
  await page.mouse.move(canvas.x + 200, canvas.y + 50);
  await page.waitForTimeout(800);
  await snap(page, 'd04-clip-hover');
  await page.mouse.click(canvas.x + 200, canvas.y + 50);
  await snap(page, 'd05-clip-selected');
  await page.locator('.vu-rail .vu-btn', { hasText: 'Filters' }).click();
  await page.waitForTimeout(1500);
  await snap(page, 'd06-filters');
  await page.locator('.vu-browser-section[data-category="warm"] .vu-filter-tile').first().click();
  await snap(page, 'd07-filter-applied');
  await page.locator('.vu-rail .vu-btn', { hasText: 'Transitions' }).click();
  await snap(page, 'd08-transitions');
  await page
    .locator('.vu-browser-section[data-category="slide"] .vu-transition-tile')
    .first()
    .hover();
  await page.waitForTimeout(900);
  await snap(page, 'd08b-transition-hover');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).vuEditor.seek(705_600_000 * 4));
  await page.keyboard.press('s');
  await page.waitForTimeout(150);
  await snap(page, 'd09-split-feedback');
  await page.locator('.vu-rail .vu-btn', { hasText: 'Text' }).click();
  await page.locator('.vu-panel .vu-btn', { hasText: 'Add text' }).click();
  await page.locator('.vu-inspector .vu-textarea').fill('Summer trip');
  await snap(page, 'd10-text');
  await page.locator('.vu-inspector .vu-effect-head', { hasText: 'Outline' }).click();
  await page
    .locator('.vu-inspector .vu-effect-head', { hasText: 'Outline' })
    .scrollIntoViewIfNeeded();
  await snap(page, 'd10b-text-effects');
  await page.locator('.vu-rail .vu-btn', { hasText: 'Stickers' }).click();
  await page.locator('.vu-panel .vu-segment', { hasText: 'Emoji' }).click();
  await page.locator('.vu-emoji').nth(16).click();
  await snap(page, 'd11-sticker');
  // Drag the sticker clip on the timeline (mid-drag screenshot).
  const lane = await page.evaluate(() => {
    const c = (window as any).vuEditor;
    const pps = c.ui.getState().pxPerSecond;
    return { pps };
  });
  await page.mouse.move(
    canvas.x + 56 + 4.5 * lane.pps,
    // Ruler, gap, new-layer slot; the sticker is the top layer.
    canvas.y + 24 + 6 + 36 + 22,
  );
  await page.mouse.down();
  await page.mouse.move(canvas.x + 56 + 6 * lane.pps, canvas.y + 40, { steps: 6 });
  await snap(page, 'd12-dragging');
  await page.mouse.up();
  await page.locator('.vu-topbar .vu-btn', { hasText: 'Export' }).click();
  await snap(page, 'd13-export');
  await page.locator('.vu-modal .vu-export-option', { hasText: '480p' }).click();
  await page.locator('.vu-modal .vu-export-go').click();
  await page.waitForTimeout(2500);
  await snap(page, 'd13b-exporting');
  await page.locator('.vu-modal a[download]').waitFor({ timeout: 180000 });
  await page.waitForTimeout(900);
  await snap(page, 'd13c-done');
  await page.keyboard.press('Escape');
  await page
    .locator('.vu-modal-head .vu-btn')
    .click()
    .catch(() => {});
  await page.locator('.vu-bar-end .vu-btn[aria-label="Full screen"]').click();
  await snap(page, 'd14-preview');
  await browser.close();
}

if (only !== 'desktop') {
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  page.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await load(page);
  await snap(page, 'p01-empty');
  await addMedia(page);
  await snap(page, 'p02-imported');
  await page.locator('[role="option"]').first().focus();
  await snap(page, 'p03-selected');
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Speed' }).tap();
  await snap(page, 'p04-speed-dock');
  await page.locator('.vu-done').tap();
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Filter' }).first().tap();
  await page.waitForTimeout(1500);
  await snap(page, 'p05-filter-dock');
  await page.locator('.vu-done').tap();
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Back' }).first().tap();
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Text' }).first().tap();
  await snap(page, 'p06-text-panel');
  await page.locator('.vu-dock .vu-btn', { hasText: 'Add text' }).tap();
  await snap(page, 'p07-text-edit');
  await page.locator('.vu-done').tap();
  await snap(page, 'p08-text-selected');
  await page.locator('.vu-bar-end .vu-btn', { hasText: 'Full screen' }).tap();
  await snap(page, 'p09-preview');
  await browser.close();
}

console.log(errors.length ? errors.join('\n') : 'no page errors');
