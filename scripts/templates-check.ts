/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Templates (v0.3) in a real browser: the panel lists 150+ templates, a template's form fills its
 * variables (your words end up in the texts), it's added at the playhead as one group and the
 * playhead moves into it, a template without variables adds at once, undo removes it; axe on the
 * panel and the form; the phone's Templates tool. Screenshots with --shots.
 * Usage: playground running, then node scripts/templates-check.ts [--port 3200] [--shots <dir>]
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
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};
const lanes = (page: Page) =>
  page.evaluate(() =>
    (window as any).vuEditor.project.tracks
      .filter((t: any) => t.kind !== 'main')
      .flatMap((t: any) => t.items)
      .map((i: any) => ({ id: i.id, text: i.text ?? i.emoji, group: i.groupId, start: i.start })),
  );

{
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/editor?autosave=0`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  // Something on the timeline, so the playhead can sit at 2 s.
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles([resolve('test-media/files', 'photo.jpg')]);
  await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);
  await page.evaluate(() => (window as any).vuEditor.seek(2 * 705_600_000));
  await page.locator('.vu-rail .vu-btn', { hasText: 'Templates' }).click();
  await page.locator('.vu-template').first().waitFor();
  const count = await page.locator('.vu-template').count();
  check('the panel lists 150+ templates', count >= 150, String(count));
  const axe = await new AxeBuilder({ page }).include('.vu-panel').analyze();
  check(
    'Templates panel passes axe',
    axe.violations.length === 0,
    axe.violations.map((v) => v.id).join(', '),
  );
  await snap(page, 't1-panel');

  await page.locator('.vu-template[aria-label="Name and role · Bold"]').click();
  const name = page.locator('.vu-template-field', { hasText: 'Name' }).locator('input');
  await name.fill('Mathpal');
  const axeForm = await new AxeBuilder({ page }).include('.vu-panel').analyze();
  check(
    'the form passes axe',
    axeForm.violations.length === 0,
    axeForm.violations.map((v) => v.id).join(', '),
  );
  await snap(page, 't2-form');
  await page.locator('.vu-template-form button[type=submit]').click();
  const added = await lanes(page);
  check(
    'your words go into the texts; the example fills the rest',
    added.some((i: any) => i.text === 'Mathpal') &&
      added.some((i: any) => i.text === 'Product designer'),
    added.map((i: any) => i.text).join(' / '),
  );
  check(
    'added as one group at the playhead',
    added.length === 2 &&
      added[0].group &&
      added[0].group === added[1].group &&
      Math.min(...added.map((i: any) => i.start)) === 2 * 705_600_000,
  );
  const playhead = await page.evaluate(() => (window as any).vuEditor.playhead.time / 705_600_000);
  check(
    'the playhead moves into the template (so it shows)',
    playhead > 2 && playhead < 4.5,
    playhead.toFixed(2),
  );
  await snap(page, 't3-added');

  await page.locator('.vu-template[aria-label="Countdown · Neon"]').click();
  const withCountdown = await lanes(page);
  check(
    'a template without words adds at once (3, 2, 1)',
    withCountdown.length === 5,
    String(withCountdown.length),
  );
  await page.keyboard.press('Control+z');
  check('undo removes it', (await lanes(page)).length === 2);
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  const browser = await chromium.launch({ channel: 'chrome' });
  const iphone: Record<string, unknown> = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  const page = await (await browser.newContext(iphone)).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/editor?autosave=0`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page.locator('.vu-toolbar button', { hasText: 'Templates' }).first().tap();
  await page.locator('.vu-template[aria-label="Subscribe · Clean"]').tap();
  await page.locator('.vu-template-form button[type=submit]').tap();
  const added = await lanes(page);
  check('phone: Templates tool adds a template', added.length === 2, String(added.length));
  await snap(page, 'p1-phone');
  check('no page errors (phone)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
