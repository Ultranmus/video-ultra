/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Shape masks (v0.3) in a real browser: the Shape section of the inspector (desktop) and the
 * Shape tool (phone sheet): pick a shape, the stage shows the picture only inside it (pixels),
 * soft edge, show outside, none; axe on the picker; opening the picker never blocks the main
 * thread for more than 50 ms (its tiles are drawn a few per frame).
 * Usage: playground running, then node scripts/shapes-check.ts [--port 3200] [--shots <dir>]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const shots = arg('shots');
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

async function load(page: Page) {
  await page.goto(`http://localhost:${port}/editor?autosave=0`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles([resolve('test-media/files', 'photo.jpg')]);
  await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);
  // Long tasks from here on (the picker must not add any).
  await page.evaluate(() => {
    (window as any).longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as any).longTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask' });
  });
}

const mask = (page: Page) =>
  page.evaluate(() => (window as any).vuEditor.project.tracks[0].items[0].mask ?? null);

/** Mean brightness of a few stage pixels (the stage canvas, by fractions of its box). */
async function stageLuma(page: Page, points: [number, number][]): Promise<number[]> {
  await page.waitForTimeout(500);
  const canvas = page.locator('.vu-stage-canvas');
  const box = (await canvas.boundingBox())!;
  const shot = await canvas.screenshot();
  const { data, width } = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return { data: Array.from(ctx.getImageData(0, 0, c.width, c.height).data), width: c.width };
  }, shot.toString('base64'));
  const k = width / box.width;
  return points.map(([fx, fy]) => {
    const x = Math.round(fx * box.width * k);
    const y = Math.round(fy * box.height * k);
    const i = (y * width + x) * 4;
    return Math.round((data[i]! + data[i + 1]! + data[i + 2]!) / 3);
  });
}

// ── desktop ──────────────────────────────────────────────────────────────
{
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  await page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.select(c.project.tracks[0].items[0].id);
  });
  const before = await stageLuma(page, [
    [0.5, 0.5],
    [0.06, 0.5],
  ]);
  // Count from here: reading the stage's pixels back (above) is the check's own long task.
  await page.evaluate(() => (window as any).longTasks.splice(0));
  await page.locator('.vu-section-toggle', { hasText: 'Shape' }).click();
  await page.locator('.vu-shape-tile[aria-label="Heart"]').waitFor();
  await page.waitForTimeout(800); // every tile drawn
  const drawn = await page.locator('.vu-shape-glyph[style*="--vu-shape-url"]').count();
  const total = await page.locator('.vu-shape-glyph').count();
  check(
    'the picker lists 100+ shapes, every tile drawn',
    total >= 100 && drawn === total,
    `${drawn}/${total}`,
  );
  const long = await page.evaluate(() => (window as any).longTasks as number[]);
  check(
    'opening the picker adds no main-thread task over 50 ms',
    long.length === 0,
    long.join(', '),
  );
  const axe = await new AxeBuilder({ page }).include('.vu-inspector').analyze();
  check(
    'Shape picker passes axe',
    axe.violations.length === 0,
    axe.violations.map((v) => v.id).join(', '),
  );
  await page.locator('.vu-shape-tile[aria-label="Heart"]').click();
  check('a click sets the shape', (await mask(page))?.shape === 'heart');
  await snap(page, 's1-heart');
  const heart = await stageLuma(page, [
    [0.5, 0.5],
    [0.06, 0.5],
  ]);
  check(
    'the stage shows the picture inside the heart only',
    Math.abs(heart[0]! - before[0]!) < 12 && heart[1]! < 8 && before[1]! > 20,
    `centre ${before[0]} → ${heart[0]}, edge ${before[1]} → ${heart[1]}`,
  );
  await page.locator('.vu-switch-row', { hasText: 'Show outside the shape' }).click();
  check('“Show outside” inverts', (await mask(page))?.invert === true);
  const inverted = await stageLuma(page, [
    [0.5, 0.5],
    [0.06, 0.5],
  ]);
  check(
    '…the centre is now cut out',
    inverted[0]! < 8 && inverted[1]! > 20,
    `${inverted.join(', ')}`,
  );
  await snap(page, 's2-inverted');
  const slider = page.locator('.vu-field', { hasText: 'Soft edge' }).getByRole('slider');
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const feather = (await mask(page))?.feather ?? 0;
  check('Soft edge slider feathers', feather > 0.05, feather.toFixed(2));
  await page.locator('.vu-shape-tile[aria-label="Star 5"]').click();
  const star = await mask(page);
  check(
    'a new shape keeps the edge and invert',
    star?.shape === 'star-5' && star.invert && star.feather === feather,
  );
  await page.keyboard.press('Control+z');
  check('undo goes back to the heart', (await mask(page))?.shape === 'heart');
  await page.locator('.vu-shape-tile[aria-label="No shape"]').click();
  check('No shape removes the mask', (await mask(page)) === null);
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── phone ────────────────────────────────────────────────────────────────
{
  const browser = await chromium.launch({ channel: 'chrome' });
  const iphone: Record<string, unknown> = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType; // Chrome with the iPhone's size and touch
  const context = await browser.newContext(iphone);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  await page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.select(c.project.tracks[0].items[0].id);
  });
  await page.locator('.vu-toolbar button', { hasText: 'Shape' }).first().tap();
  await page.locator('.vu-shape-tile[aria-label="Circle"]').tap();
  check('phone: the Shape tool sets a circle', (await mask(page))?.shape === 'circle');
  await snap(page, 'p1-circle');
  check('no page errors (phone)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
