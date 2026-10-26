/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Cut-off text in the settings panel at its narrowest (280 px, the default): selects a video, a
 * photo, a text and a sound, opens each section one at a time (opening one closes the others)
 * and lists every label whose text doesn't fit; then video settings and the left panels.
 * Usage: playground running, then node scripts/cutoff-check.ts [--port 3200]
 */
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`http://localhost:${port}/editor?autosave=0`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
await page
  .locator('.vu-root input[type=file][accept^="video"]')
  .first()
  .setInputFiles(
    ['avc-1080p30.mp4', 'photo.jpg', 'music.mp3'].map((f) => resolve('test-media/files', f)),
  );
await page.waitForFunction(
  () => (window as any).vuEditor.project.tracks[0].items.length === 2,
  null,
  {
    timeout: 30000,
  },
);
await page.locator('.vu-rail .vu-btn', { hasText: 'Text' }).click();
await page.locator('.vu-panel .vu-btn', { hasText: 'Add text' }).click();
await page.waitForTimeout(300);

const cutIn = (scope: string) =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll<HTMLElement>(`${sel} *`)]
        .filter(
          (e) =>
            e.offsetParent &&
            !e.children.length &&
            e.textContent?.trim() &&
            e.scrollWidth > e.clientWidth + 1,
        )
        .map((e) => e.textContent!.trim().slice(0, 40)),
    scope,
  );

/** Opens each inspector section in turn and collects what's cut off. */
async function sections(): Promise<string[]> {
  const found = new Set((await cutIn('.vu-inspector')).map((t) => `top: ${t}`));
  const heads = page.locator('.vu-inspector [aria-expanded]');
  const n = await heads.count();
  for (let i = 0; i < n; i++) {
    const head = heads.nth(i);
    const name = (await head.textContent())?.trim();
    if ((await head.getAttribute('aria-expanded')) === 'false') await head.click();
    await page.waitForTimeout(200);
    for (const t of await cutIn('.vu-inspector')) found.add(`${name}: ${t}`);
  }
  return [...found];
}

const ids = await page.evaluate(() => {
  const items = (window as any).vuEditor.project.tracks.flatMap((t: any) => t.items);
  return {
    'video clip': items.find((i: any) => i.kind === 'video')?.id,
    photo: items.find((i: any) => i.kind === 'image')?.id,
    text: items.find((i: any) => i.kind === 'text')?.id,
    sound: items.find((i: any) => i.kind === 'audio')?.id,
  };
});
let failures = 0;
const report = (what: string, cut: string[]) => {
  console.log(
    `${cut.length ? 'FAIL' : 'PASS'} ${what}${cut.length ? ` — ${cut.join(' · ')}` : ''}`,
  );
  if (cut.length) failures++;
};
for (const [kind, id] of Object.entries(ids)) {
  if (!id) continue;
  await page.evaluate((i) => (window as any).vuEditor.select(i), id);
  await page.waitForTimeout(400);
  report(`${kind} settings`, await sections());
}
await page.evaluate(() => (window as any).vuEditor.select(null));
await page.waitForTimeout(300);
report('video settings', await sections());
for (const p of [
  'Media',
  'Templates',
  'Text',
  'Captions',
  'Audio',
  'Stickers',
  'Filters',
  'Transitions',
]) {
  await page.locator('.vu-rail .vu-btn', { hasText: p }).click();
  await page.waitForTimeout(500);
  report(`${p} panel`, await cutIn('.vu-panel'));
}
await browser.close();
process.exit(failures ? 1 : 0);
