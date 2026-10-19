/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * "Your videos" (DECISIONS #154) in a real browser, with local saving on: make a copy (opens it,
 * same media, original unchanged), back to the original, new video, open another, delete one;
 * every change saved; axe on the popover. Desktop (Chrome) and phone (WebKit).
 * Usage: playground running, then node scripts/videos-check.ts [--shots <dir>] [--only desktop|phone]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices, webkit, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const shots = arg('shots');
const only = arg('only');

let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const snap = async (page: Page, name: string) => {
  if (!shots) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${shots}/${name}.png` });
};
const state = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).vuEditor;
    return {
      id: c.project.id as string,
      name: c.project.name as string,
      clips: c.project.tracks[0].items.length as number,
      assets: Object.keys(c.project.assets) as string[],
      readOnly: c.ui.getState().readOnly as boolean,
    };
  });
const list = (page: Page) =>
  page.evaluate(async () =>
    ((await (window as any).vuEditor.listVideos()) as any[]).map((v) => `${v.id}:${v.name}`),
  );
const toggle = (page: Page) => page.locator('[data-videos-toggle] .vu-btn').first();

async function run(page: Page, phone: boolean) {
  const p = phone ? 'phone: ' : '';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/editor`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  // Start from an empty, saved project of our own.
  await page.evaluate(() => (window as any).vuEditor.newVideo());
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles([resolve('test-media/files/avc-1080p30.mp4')]);
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks[0].items.length === 1,
    null,
    {
      timeout: 30000,
    },
  );
  await page.evaluate(() => (window as any).vuEditor.run('Rename', (d: any) => (d.name = 'Trip')));
  await page.waitForTimeout(1500); // autosave
  const original = await state(page);

  await toggle(page).click();
  check(`${p}the button opens Your videos`, await page.locator('.vu-videos').isVisible());
  await snap(page, `${phone ? 'p' : 'd'}1-open`);
  const axe = await new AxeBuilder({ page })
    .include('.vu-videos')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  check(
    `${p}Your videos passes axe`,
    axe.violations.length === 0,
    axe.violations.map((v) => v.id).join(','),
  );
  await page.locator('.vu-videos .vu-btn', { hasText: 'Make a copy' }).click();
  await page.waitForFunction((id) => (window as any).vuEditor.project.id !== id, original.id, {
    timeout: 10000,
  });
  const copy = await state(page);
  check(
    `${p}Make a copy opens the copy`,
    copy.name === 'Trip (copy)' && copy.clips === 1,
    copy.name,
  );
  check(
    `${p}…with the same media (nothing copied)`,
    JSON.stringify(copy.assets) === JSON.stringify(original.assets),
  );
  check(`${p}…and it can be saved here`, !copy.readOnly);
  // Change the copy; the original must not change.
  await page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.select(c.project.tracks[0].items[0].id);
    c.run('Speed', (d: any) => (d.tracks[0].items[0].volume = 0.3));
  });
  await page.waitForTimeout(1500);
  await page.locator('.vu-toast-action', { hasText: 'Back to original' }).click();
  await page.waitForFunction((id) => (window as any).vuEditor.project.id === id, original.id, {
    timeout: 10000,
  });
  const back = await page.evaluate(
    () => (window as any).vuEditor.project.tracks[0].items[0].volume,
  );
  check(`${p}Back to original: the original is as it was`, back === 1, String(back));
  const videos = await list(page);
  check(
    `${p}both are listed`,
    videos.some((v) => v.startsWith(copy.id)) && videos.some((v) => v.startsWith(original.id)),
  );

  await toggle(page).click();
  await page.locator('.vu-videos-open', { hasText: 'Trip (copy)' }).click();
  await page.waitForFunction((id) => (window as any).vuEditor.project.id === id, copy.id, {
    timeout: 10000,
  });
  const reopened = await page.evaluate(
    () => (window as any).vuEditor.project.tracks[0].items[0].volume,
  );
  check(`${p}opening the copy again keeps its change`, reopened === 0.3, String(reopened));

  await toggle(page).click();
  await page.locator('.vu-videos .vu-btn', { hasText: 'New video' }).click();
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks[0].items.length === 0,
    null,
    { timeout: 10000 },
  );
  check(`${p}New video starts empty`, (await state(page)).clips === 0);

  await toggle(page).click();
  const row = page.locator('.vu-videos-row', { hasText: 'Trip (copy)' });
  await row.locator('.vu-btn').click();
  await page.locator('.vu-videos-confirm .vu-btn', { hasText: 'Delete' }).click();
  await page.waitForTimeout(500);
  const after = await list(page);
  check(
    `${p}Delete removes the copy only`,
    !after.some((v) => v.startsWith(copy.id)) && after.some((v) => v.startsWith(original.id)),
  );
  await snap(page, `${phone ? 'p' : 'd'}2-after`);
  // Tidy: back to the original, delete the empty new video.
  const fresh = (await state(page)).id;
  await page.evaluate((id) => (window as any).vuEditor.openVideo(id), original.id);
  await page.evaluate((id) => (window as any).vuEditor.deleteVideo(id), fresh);
  await page.evaluate((id) => (window as any).vuEditor.deleteVideo(id), original.id);
  check(`${p}no page errors`, errors.length === 0, errors.join(' | '));
}

if (only !== 'phone') {
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  await run(page, false);
  await browser.close();
}
if (only !== 'desktop') {
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  await run(page, true);
  await browser.close();
}
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
