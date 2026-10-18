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
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
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
    canvas.x + 100 + 4.5 * lane.pps,
    // Ruler, gap, main video, gap, new-layer slot; the sticker is the first layer.
    canvas.y + 24 + 6 + 56 + 6 + 36 + 22,
  );
  await page.mouse.down();
  await page.mouse.move(canvas.x + 100 + 6 * lane.pps, canvas.y + 24 + 6 + 56 + 6 + 15, {
    steps: 6,
  });
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
  await page.keyboard.press('Escape');
  // v0.2 D. Capture & export: presets, part, sound only, picture, camera.
  await page.evaluate(() => (window as any).vuEditor.setPreviewMode(false));
  await page.evaluate(() => (window as any).vuEditor.seek(705_600_000 * 2));
  await page.locator('.vu-topbar .vu-btn', { hasText: 'Export' }).click();
  await page.locator('.vu-modal .vu-export-option', { hasText: 'Widescreen' }).click();
  await snap(page, 'd15-export-preset-note');
  await page.locator('.vu-modal .vu-segment', { hasText: 'Part' }).click();
  await page.locator('.vu-modal .vu-range').scrollIntoViewIfNeeded();
  await snap(page, 'd16-export-part');
  await page.locator('.vu-modal .vu-segment', { hasText: 'Sound only' }).click();
  await snap(page, 'd17-export-sound');
  await page.locator('.vu-modal .vu-export-go').click();
  await page.locator('.vu-modal a[download]').waitFor({ timeout: 60000 });
  await snap(page, 'd17b-export-sound-done');
  await page.locator('.vu-modal .vu-btn', { hasText: 'Back to editing' }).click();
  await page.locator('.vu-topbar .vu-btn', { hasText: 'Export' }).click();
  await page.locator('.vu-modal .vu-segment', { hasText: 'Picture' }).click();
  await snap(page, 'd18-export-picture');
  await page.locator('.vu-modal .vu-export-go').click();
  await page.locator('.vu-modal a[download]').waitFor({ timeout: 60000 });
  await snap(page, 'd18b-export-picture-done');
  await page.locator('.vu-modal .vu-btn', { hasText: 'Back to editing' }).click();
  await page.locator('.vu-rail .vu-btn', { hasText: 'Media' }).click();
  await snap(page, 'd19-media-panel-camera');
  await page.locator('.vu-panel .vu-camera-open').click();
  await page.locator('.vu-camera[data-phase="live"]').waitFor({ timeout: 20000 });
  await snap(page, 'd20-camera-live');
  await page.locator('.vu-record').click();
  await page.waitForTimeout(1600);
  await snap(page, 'd21-camera-recording');
  await page.locator('.vu-record').click();
  await page.locator('.vu-camera[data-phase="review"]').waitFor({ timeout: 20000 });
  await snap(page, 'd22-camera-review');
  await page.locator('.vu-camera-bar .vu-btn', { hasText: 'Add to video' }).click();
  await page.locator('.vu-camera').waitFor({ state: 'detached' });
  await page.keyboard.press('i');
  await snap(page, 'd23-range-on-ruler');
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
  await page.waitForTimeout(600); // the sheet slides away first
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Filter' }).first().tap();
  await page.waitForTimeout(1500);
  await snap(page, 'p05-filter-dock');
  await page.locator('.vu-done').tap();
  await page.waitForTimeout(600); // the sheet slides away first
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Back' }).first().tap();
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Text' }).first().tap();
  await snap(page, 'p06-text-panel');
  await page.locator('.vu-dock .vu-btn', { hasText: 'Add text' }).tap();
  await snap(page, 'p07-text-edit');
  await page.locator('.vu-done').tap();
  await page.waitForTimeout(600); // the sheet slides away first
  await snap(page, 'p08-text-selected');
  await page.locator('.vu-bar-end .vu-btn', { hasText: 'Full screen' }).tap();
  await snap(page, 'p09-preview');
  await page.locator('.vu-preview-bar .vu-btn').tap();
  // v0.2 D. Capture & export
  await page.locator('.vu-topbar .vu-btn', { hasText: 'Export' }).tap();
  await snap(page, 'p10-export');
  await page.locator('.vu-modal .vu-export-option', { hasText: 'Square' }).tap();
  await page.locator('.vu-modal .vu-export-note').scrollIntoViewIfNeeded();
  await snap(page, 'p11-export-preset-note');
  await page.locator('.vu-modal .vu-segment', { hasText: 'Part' }).tap();
  await page.locator('.vu-modal .vu-range').scrollIntoViewIfNeeded();
  await snap(page, 'p12-export-part');
  await page.locator('.vu-modal .vu-segment', { hasText: 'Picture' }).tap();
  await snap(page, 'p13-export-picture');
  await page.locator('.vu-modal-head .vu-btn').tap();
  await page.evaluate(() => (window as any).vuEditor.select(null));
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Media' }).first().tap();
  await snap(page, 'p14-media-sheet');
  await page.locator('.vu-dock .vu-camera-open').tap();
  await page.locator('.vu-camera[data-phase="live"], .vu-camera[data-phase="error"]').waitFor({
    timeout: 20000,
  });
  await snap(page, 'p15-camera');
  await browser.close();
}

console.log(errors.length ? errors.join('\n') : 'no page errors');
