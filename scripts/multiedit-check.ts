/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Editing several at once (DECISIONS #153) in a real browser: with several selected, the
 * inspector's Speed / Sound / Opacity, the left menu's Filters and Animation act on all of them,
 * one undo step each; the phone's multi-selection toolbar has the same tools. Desktop (Chrome)
 * and phone (WebKit, iPhone size). Screenshots with --shots.
 * Usage: playground running, then node scripts/multiedit-check.ts [--shots <dir>] [--only desktop|phone]
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
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

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

/** Two video clips on the main track and two texts on a lane; returns their ids. */
async function load(page: Page): Promise<{ v: [string, string]; t: [string, string] }> {
  await page.goto(`http://localhost:${port}/editor?autosave=0`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles(
      ['avc-1080p30.mp4', 'avc-720p30.mp4'].map((f) => resolve('test-media/files', f)),
    );
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks[0].items.length === 2,
    null,
    { timeout: 30000 },
  );
  return page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.seek(0);
    const t: string[] = [];
    for (const [y, text] of [
      [0.3, 'Alpha'],
      [0.7, 'Beta'],
    ] as const)
      c.addLaneItem('Add text', (id: string, start: number) => {
        t.push(id);
        return {
          kind: 'text',
          id,
          start,
          text,
          duration: 3 * 705_600_000,
          style: {
            fontFamily: 'system-ui',
            fontWeight: 700,
            italic: false,
            size: 0.08,
            color: '#ffffff',
            align: 'center',
            lineHeight: 1.2,
            letterSpacing: 0,
            outline: null,
            shadow: null,
            background: null,
          },
          filter: null,
          adjust: {},
          transform: { x: 0.5, y, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false },
        };
      });
    c.select(null);
    const v = c.project.tracks[0].items.map((i: any) => i.id);
    return { v: [v[0], v[1]], t: [t[0], t[1]] } as any;
  });
}

const get = (page: Page, id: string) =>
  page.evaluate((itemId) => {
    for (const t of (window as any).vuEditor.project.tracks)
      for (const i of t.items) if (i.id === itemId) return i;
    return null;
  }, id);
const selectAll = (page: Page, ids: string[]) =>
  page.evaluate((list) => {
    const c = (window as any).vuEditor;
    c.select(list[0], { only: true });
    for (const id of list.slice(1)) c.select(id, { add: true });
  }, ids);

// ── desktop ──────────────────────────────────────────────────────────────
if (only !== 'phone') {
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { v, t } = await load(page);

  await selectAll(page, v);
  const insp = page.locator('.vu-inspector');
  check(
    'several clips: the inspector says changes apply to all',
    await insp.locator('.vu-shared-note').isVisible(),
  );
  await insp.locator('.vu-segment', { hasText: /^2×$/ }).click();
  await page.waitForTimeout(200);
  const [a, b] = [await get(page, v[0]), await get(page, v[1])];
  check('Speed 2× → both clips', a.speed === 2 && b.speed === 2, `${a.speed}, ${b.speed}`);
  check(
    'the main track stays back to back',
    b.start === a.start + a.duration,
    `${a.start}+${a.duration} vs ${b.start}`,
  );
  await snap(page, 'd1-speed');
  await page.keyboard.press(`${mod}+z`);
  const [a2, b2] = [await get(page, v[0]), await get(page, v[1])];
  check('one undo puts both back', a2.speed === 1 && b2.speed === 1);

  // Mute through the sound section.
  await insp.locator('.vu-btn', { hasText: /^Mute$/ }).click();
  check('Mute → both', (await get(page, v[0])).muted && (await get(page, v[1])).muted);
  await page.keyboard.press(`${mod}+z`);

  // Filters (left menu) on both.
  await page
    .locator('.vu-rail button[aria-label="Filters"], .vu-rail button:has-text("Filters")')
    .first()
    .click();
  await page.waitForTimeout(500);
  const tile = page.locator('.vu-panel .vu-filter-tile').nth(3);
  await tile.click();
  await page.waitForTimeout(200);
  const fa = (await get(page, v[0])).filter;
  const fb = (await get(page, v[1])).filter;
  check(
    'a filter → both clips',
    !!fa && JSON.stringify(fa) === JSON.stringify(fb),
    JSON.stringify(fa),
  );
  await snap(page, 'd2-filter');
  const axe = await new AxeBuilder({ page })
    .include('.vu-inspector')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  check(
    'inspector (several) passes axe',
    axe.violations.length === 0,
    axe.violations.map((x) => x.id).join(','),
  );

  // Texts: opacity in the inspector, entrance in the left menu.
  await selectAll(page, t);
  await page.waitForTimeout(200);
  const slider = insp.locator('[role=slider]').first();
  await slider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  const [o1, o2] = [
    (await get(page, t[0])).transform.opacity,
    (await get(page, t[1])).transform.opacity,
  ];
  check('Opacity → both texts', o1 < 1 && o1 === o2, `${o1}, ${o2}`);
  const [x1, x2] = [(await get(page, t[0])).transform.y, (await get(page, t[1])).transform.y];
  check('…their places stay their own', x1 !== x2);
  await page
    .locator('.vu-rail button[aria-label="Transitions"], .vu-rail button:has-text("Transitions")')
    .first()
    .click();
  await page.waitForTimeout(500);
  await page.locator('.vu-panel .vu-transition-tile').nth(1).click();
  await page.waitForTimeout(300);
  const [n1, n2] = [(await get(page, t[0])).animation?.in, (await get(page, t[1])).animation?.in];
  check(
    'an entrance → both texts',
    !!n1 && JSON.stringify(n1) === JSON.stringify(n2),
    JSON.stringify(n1),
  );
  await snap(page, 'd3-animate');
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── phone ────────────────────────────────────────────────────────────────
if (only !== 'desktop') {
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { v, t } = await load(page);
  await selectAll(page, t);
  await page.waitForTimeout(300);
  const bar = page.locator('.vu-toolbar');
  check(
    'phone: several texts show Animate and Opacity',
    (await bar.locator('.vu-btn', { hasText: 'Animate' }).count()) > 0 &&
      (await bar.locator('.vu-btn', { hasText: 'Opacity' }).count()) > 0,
  );
  await snap(page, 'p1-toolbar');
  await bar.locator('.vu-btn', { hasText: 'Animate' }).tap();
  await page.waitForTimeout(400);
  await page.locator('.vu-dock .vu-transition-tile').nth(1).tap();
  await page.waitForTimeout(300);
  const [n1, n2] = [(await get(page, t[0])).animation?.in, (await get(page, t[1])).animation?.in];
  check('phone: an entrance → both texts', !!n1 && JSON.stringify(n1) === JSON.stringify(n2));
  await snap(page, 'p2-animate');
  await page.locator('.vu-done').tap();
  await page.waitForTimeout(400);
  await selectAll(page, v);
  await page.waitForTimeout(300);
  await bar.locator('.vu-btn', { hasText: 'Speed' }).tap();
  await page.waitForTimeout(400);
  await page.locator('.vu-dock .vu-segment', { hasText: /^0\.5×$/ }).tap();
  await page.waitForTimeout(200);
  check(
    'phone: Speed 0.5× → both clips',
    (await get(page, v[0])).speed === 0.5 && (await get(page, v[1])).speed === 0.5,
  );
  check('no page errors (phone)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
