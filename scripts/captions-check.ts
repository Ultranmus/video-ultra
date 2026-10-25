/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Captions (v0.2 A) in a real browser: auto captions through the editor's audio path (a stand-in
 * transcriber, then the real on-device one on a speech clip), styles and word highlight drawn by
 * the engine, editing in the list, import / download of .srt, dragging moves every caption, undo,
 * axe on the panel; phone: the Captions tool and sheet. Screenshots with --shots.
 * Usage: playground running, then node scripts/captions-check.ts [--shots <dir>] [--no-model]
 *   [--port 3200]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices, webkit, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const shots = arg('shots');
const withModel = !process.argv.includes('--no-model');
const webkitModel = process.argv.includes('--webkit-model');
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const snap = async (page: Page, name: string) => {
  if (!shots) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/${name}.png` });
};
const captions = (page: Page) =>
  page.evaluate(() => {
    const t = (window as any).vuEditor.project.tracks.find((x: any) => x.kind === 'caption');
    return t
      ? {
          look: t.caption,
          items: t.items.map((i: any) => ({
            id: i.id,
            text: i.text,
            start: i.start,
            words: i.words?.length ?? 0,
            y: i.transform.y,
            font: i.style.fontFamily,
          })),
        }
      : null;
  });

async function load(page: Page, query: string, files: string[]) {
  await page.goto(`http://localhost:${port}/editor?autosave=0&${query}`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles(files.map((f) => resolve('test-media/files', f)));
  await page.waitForFunction(
    (n) =>
      (window as any).vuEditor.project.tracks.reduce(
        (s: number, t: any) => s + t.items.length,
        0,
      ) >= n,
    files.length,
    { timeout: 30000 },
  );
}

// ── desktop, stand-in transcriber ────────────────────────────────────────
{
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, 'transcriber=fake', ['avc-1080p30.mp4']);
  await page.locator('.vu-rail .vu-btn', { hasText: 'Captions' }).click();
  await page.waitForTimeout(400);
  await snap(page, 'c1-panel-empty');
  await page.locator('.vu-panel .vu-btn', { hasText: 'Make captions' }).click();
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption'),
    null,
    { timeout: 60000 },
  );
  let caps = await captions(page);
  check(
    'auto captions fill the caption row',
    !!caps && caps.items.length >= 2,
    `${caps?.items.length}`,
  );
  check('captions carry word times', !!caps && caps.items.every((i) => i.words > 0));
  await snap(page, 'c2-made');

  // Style: a preset with word highlight, then the engine draws it.
  await page.locator('.vu-caption-preset', { hasText: 'Karaoke' }).click();
  caps = await captions(page);
  check(
    'a preset restyles every caption',
    caps!.look.preset === 'karaoke' && caps!.look.highlight === 'fill',
  );
  const first = caps!.items[0]!;
  await page.evaluate((t) => (window as any).vuEditor.seek(t + 705_600_000 * 0.6), first.start);
  await page.waitForTimeout(600);
  await snap(page, 'c3-karaoke');
  for (const mode of ['Colour', 'Box', 'Word by word', 'Letter by letter']) {
    await page
      .locator('.vu-panel .vu-chip, .vu-panel button', { hasText: new RegExp(`^${mode}$`) })
      .first()
      .click();
    await page.waitForTimeout(250);
    // Halfway into the second word of the first caption.
    await page.evaluate((t) => (window as any).vuEditor.seek(t + 705_600_000 * 0.7), first.start);
    await page.waitForTimeout(500);
    if (shots)
      await page
        .locator('.vu-stage-frame')
        .screenshot({ path: `${shots}/c3-${mode.replace(/ /g, '-').toLowerCase()}.png` });
  }
  caps = await captions(page);
  check('highlight modes switch', caps!.look.highlight === 'type');
  await page.locator('.vu-panel button', { hasText: /^Top$/ }).first().click();
  caps = await captions(page);
  check(
    'position moves every caption',
    caps!.items.every((i) => i.y < 0.3),
  );

  // Edit in the list.
  const box = page.locator('.vu-caption-text').first();
  await box.fill('Edited first caption');
  await box.press('Enter');
  caps = await captions(page);
  check('editing a caption in the list', caps!.items[0]!.text === 'Edited first caption');

  // Drag a caption on the stage: all move.
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  await page.evaluate((t) => (window as any).vuEditor.seek(t + 7_056_000), caps!.items[0]!.start);
  await page.waitForTimeout(300);
  const y0 = caps!.items[0]!.y;
  const sx = frame.x + frame.width / 2;
  const sy = frame.y + y0 * frame.height;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(sx, sy + i * 20);
  await page.mouse.up();
  caps = await captions(page);
  check(
    'dragging one caption moves them all',
    caps!.items.every((i) => Math.abs(i.y - caps!.items[0]!.y) < 1e-9) && caps!.items[0]!.y > y0,
    `${y0.toFixed(3)} → ${caps!.items[0]!.y.toFixed(3)}`,
  );

  // Download .srt.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.vu-panel .vu-btn', { hasText: /^\.srt$/ }).click(),
  ]);
  const srtPath = join(mkdtempSync(join(tmpdir(), 'vu-cap-')), 'out.srt');
  await download.saveAs(srtPath);
  const srt = readFileSync(srtPath, 'utf8');
  check(
    'downloaded .srt lists every caption',
    srt.includes('Edited first caption') && srt.includes('-->'),
  );

  // Import .srt (replaces).
  const srtIn = join(mkdtempSync(join(tmpdir(), 'vu-cap-')), 'in.srt');
  writeFileSync(
    srtIn,
    '1\n00:00:00,500 --> 00:00:02,000\nImported one\n\n2\n00:00:02,500 --> 00:00:04,000\nImported two\n',
  );
  await page.locator('.vu-panel input[type=file][accept^=".srt"]').setInputFiles(srtIn);
  await page.waitForTimeout(300);
  caps = await captions(page);
  check(
    'importing .srt replaces the captions',
    caps!.items.map((i) => i.text).join('|') === 'Imported one|Imported two',
  );
  await snap(page, 'c4-imported');
  const a11y = await new AxeBuilder({ page })
    .include('.vu-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  check(
    'Captions panel passes axe',
    a11y.violations.length === 0,
    a11y.violations.map((v) => v.id).join(','),
  );
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  caps = await captions(page);
  check('undo brings the earlier captions back', caps!.items[0]!.text === 'Edited first caption');
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── desktop, the real on-device model on a speech clip ─────────────────
if (withModel) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, '', ['avc-1080p30.mp4', 'speech-en-gb.m4a']);
  // Put the speech under the video and lower nothing.
  await page.locator('.vu-rail .vu-btn', { hasText: 'Captions' }).click();
  check(
    'on the device: English only, no language to choose',
    (await page.locator('.vu-panel .vu-captions').innerText()).includes(
      'Spoken language: English',
    ) && (await page.locator('.vu-panel button', { hasText: /^Hindi$|^Detect$/ }).count()) === 0,
  );
  const t0 = Date.now();
  await page.locator('.vu-panel .vu-btn', { hasText: 'Make captions' }).click();
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption'),
    null,
    { timeout: 300000 },
  );
  const caps = await captions(page);
  const text = caps!.items.map((i) => i.text).join(' ');
  check(
    'the on-device model captions real speech',
    /welcome back to the channel/i.test(text) && /rice/i.test(text),
    `${caps!.items.length} captions in ${((Date.now() - t0) / 1000).toFixed(1)} s: "${text.slice(0, 60)}…"`,
  );
  await page.evaluate((t) => (window as any).vuEditor.seek(t + 300_000_000), caps!.items[1]!.start);
  await snap(page, 'c5-real');
  check('no page errors (model)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── the real model in WebKit (Safari's engine: its call-argument limit once broke this) ────
if (webkitModel) {
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, '', ['speech-en-gb.m4a']);
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Captions' }).first().tap();
  const t0 = Date.now();
  await page.locator('.vu-dock .vu-btn', { hasText: 'Make captions' }).tap();
  const outcome = await page
    .waitForFunction(
      () =>
        (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption') ||
        document.querySelector('.vu-toast[data-tone="error"]')?.textContent,
      null,
      { timeout: 600000 },
    )
    .then((h) => h.jsonValue());
  const caps = await captions(page);
  const text = caps?.items.map((i) => i.text).join(' ') ?? String(outcome);
  check(
    'WebKit: the on-device model captions real speech',
    /welcome back to the channel/i.test(text),
    `${((Date.now() - t0) / 1000).toFixed(1)} s: "${text.slice(0, 70)}"`,
  );
  check('no page errors (WebKit model)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── phone ───────────────────────────────────────────────────────────────
{
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, 'transcriber=fake', ['avc-1080p30.mp4']);
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Captions' }).tap();
  check(
    'phone: Captions opens in the sheet',
    await page.locator('.vu-dock .vu-captions').isVisible(),
  );
  // A host's own service with no language list: the panel offers its languages (Hindi too).
  await page
    .locator('.vu-dock button', { hasText: /^Hindi$/ })
    .first()
    .tap();
  await page.waitForTimeout(300);
  const make = page.locator('.vu-dock .vu-btn', { hasText: 'Make captions' });
  check(
    'phone: a host service can caption Hindi',
    (await make.getAttribute('aria-disabled')) !== 'true',
  );
  await page
    .locator('.vu-dock button', { hasText: /^English$/ })
    .first()
    .tap();
  // The sheet scrolls to its end while half open.
  const scrolls = await page.evaluate(() => {
    const body = document.querySelector('.vu-dock-body') as HTMLElement;
    body.scrollTop = body.scrollHeight;
    const last = body.querySelector('.vu-caption-sources') as HTMLElement;
    const r = last.getBoundingClientRect();
    const bar = document.querySelector('.vu-toolbar')!.getBoundingClientRect();
    return r.bottom <= bar.top + 1;
  });
  check('phone: the half-open sheet scrolls to its last control', scrolls);
  await page.locator('.vu-dock .vu-btn', { hasText: 'Make captions' }).tap();
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption'),
    null,
    { timeout: 60000 },
  );
  await snap(page, 'p1-captions-sheet');
  const caps = await captions(page);
  await page.evaluate((id) => (window as any).vuEditor.select(id), caps!.items[0]!.id);
  await page
    .locator('.vu-done')
    .tap()
    .catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate((id) => (window as any).vuEditor.select(id), caps!.items[0]!.id);
  check(
    'phone: a selected caption shows caption tools',
    await page.locator('.vu-toolbar .vu-btn', { hasText: 'Join with next' }).isVisible(),
  );
  await snap(page, 'p2-caption-tools');
  check('no page errors (phone)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
