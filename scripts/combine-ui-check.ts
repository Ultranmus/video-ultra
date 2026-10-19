/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Combine into one clip in the editor (DECISIONS #155): Combine from the context menu, Open (the
 * bar over the timeline, the inside on the timeline), an edit inside reaching the outer clip,
 * Captions saying they're the whole video's, undo backing out of a clip that's gone, Back,
 * Separate, Export leaving the clip; axe. Desktop (Chrome) and phone (WebKit, long-press).
 * Usage: playground running, then node scripts/combine-ui-check.ts [--shots <dir>] [--only desktop|phone]
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
const F = 705_600_000;

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

async function load(page: Page): Promise<string[]> {
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
    {
      timeout: 30000,
    },
  );
  return page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.seek(0);
    let text = '';
    c.addLaneItem('Add text', (id: string, start: number) => {
      text = id;
      return {
        kind: 'text',
        id,
        start,
        text: 'Title',
        duration: 2 * 705_600_000,
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
        transform: {
          x: 0.5,
          y: 0.3,
          scale: 1,
          rotation: 0,
          opacity: 1,
          flipX: false,
          flipY: false,
        },
      };
    });
    return [...c.project.tracks[0].items.map((i: any) => i.id), text];
  });
}

const view = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).vuEditor;
    const p = c.project;
    return {
      items: p.tracks.reduce((n: number, t: any) => n + t.items.length, 0),
      inside: c.ui.getState().inside.length as number,
      first: p.tracks[0].items[0],
      combined: p.tracks[0].items[0] && p.assets[p.tracks[0].items[0].assetId]?.kind === 'compound',
    };
  });

async function selectAll(page: Page, ids: string[]) {
  await page.evaluate((list) => {
    const c = (window as any).vuEditor;
    c.select(list[0], { only: true });
    for (const id of list.slice(1)) c.select(id, { add: true });
  }, ids);
}

/** Opens the context menu: right-click (desktop) or a held touch (phone) on the stage centre. */
async function menu(page: Page, phone: boolean) {
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  const x = frame.x + frame.width / 2;
  const y = frame.y + frame.height * 0.55;
  if (!phone) {
    await page.mouse.click(x, y, { button: 'right' });
    return;
  }
  const stage = page.locator('.vu-stage');
  const ev = {
    pointerId: 9,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    isPrimary: true,
    button: 0,
  };
  await stage.dispatchEvent('pointerdown', ev);
  await page.waitForTimeout(700);
  await stage.dispatchEvent('pointerup', ev);
}

async function run(page: Page, phone: boolean) {
  const p = phone ? 'phone: ' : '';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ids = await load(page);
  await selectAll(page, ids);
  await menu(page, phone);
  const combine = page.locator('.vu-menu-item', { hasText: 'Combine into one clip' });
  check(`${p}the menu offers Combine for several`, await combine.isVisible());
  await snap(page, `${phone ? 'p' : 'd'}1-menu`);
  await combine.click();
  await page.waitForTimeout(300);
  let v = await view(page);
  check(
    `${p}Combine leaves one clip`,
    v.items === 1 && v.combined,
    JSON.stringify({ items: v.items }),
  );
  await snap(page, `${phone ? 'p' : 'd'}1b-combined`);
  const outerId = v.first.id;
  const outerLength = v.first.duration;

  await menu(page, phone);
  await page.locator('.vu-menu-item', { hasText: 'Open combined clip' }).click();
  await page.waitForTimeout(300);
  v = await view(page);
  check(
    `${p}Open shows the inside`,
    v.inside === 1 && v.items === 3,
    JSON.stringify({ inside: v.inside, items: v.items }),
  );
  check(`${p}the bar says where you are`, await page.locator('.vu-inside-bar').isVisible());
  await snap(page, `${phone ? 'p' : 'd'}2-inside`);
  const axe = await new AxeBuilder({ page })
    .include('.vu-inside-bar')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  check(
    `${p}the bar passes axe`,
    axe.violations.length === 0,
    axe.violations.map((x) => x.id).join(','),
  );

  // An edit inside: the first clip at 2× → the outer clip gets shorter.
  await page.evaluate(() => {
    const c = (window as any).vuEditor;
    const first = c.project.tracks[0].items[0];
    c.select(first.id);
  });
  const speed = phone
    ? page.locator('.vu-toolbar .vu-btn', { hasText: 'Speed' })
    : page.locator('.vu-inspector .vu-segment', { hasText: /^2×$/ });
  if (phone) {
    await speed.tap();
    await page.waitForTimeout(400);
    await page.locator('.vu-dock .vu-segment', { hasText: /^2×$/ }).tap();
  } else await speed.click();
  await page.waitForTimeout(300);
  const outer = await page.evaluate((id) => {
    const c = (window as any).vuEditor;
    const real = c.editor.getProject();
    return real.tracks[0].items.find((i: any) => i.id === id)?.duration as number;
  }, outerId);
  check(
    `${p}an edit inside reaches the outer clip`,
    outer < outerLength,
    `${outerLength / F} → ${outer / F} s`,
  );

  if (!phone) {
    await page.locator('.vu-rail button', { hasText: 'Captions' }).click();
    check(
      'Captions say they are the whole video’s',
      await page.locator('.vu-whole-video-only').isVisible(),
    );
    await page
      .locator('.vu-panel .vu-btn[aria-label="Close panel"]')
      .click()
      .catch(() => undefined);
  }

  // Undo the speed (still inside), then the combine: the editor backs out on its own.
  await page.evaluate(() => (window as any).vuEditor.undo());
  v = await view(page);
  check(`${p}undo inside stays inside`, v.inside === 1);
  await page.evaluate(() => (window as any).vuEditor.undo());
  await page.waitForTimeout(200);
  v = await view(page);
  check(
    `${p}undoing the combine backs out`,
    v.inside === 0 && v.items === 3,
    JSON.stringify({ inside: v.inside, items: v.items }),
  );
  await page.evaluate(() => (window as any).vuEditor.redo());
  await page.waitForTimeout(200);

  // Open again, Back.
  await page.evaluate((id) => (window as any).vuEditor.openCombined(id), outerId);
  await page.locator('.vu-inside-bar .vu-btn', { hasText: 'Back' }).click();
  v = await view(page);
  const sel = await page.evaluate(() => (window as any).vuEditor.ui.getState().selectedId);
  check(
    `${p}Back returns to the timeline with the clip selected`,
    v.inside === 0 && sel === outerId,
  );

  // Export from inside leaves the clip.
  await page.evaluate((id) => (window as any).vuEditor.openCombined(id), outerId);
  await page.evaluate(() => (window as any).vuEditor.ui.setState({ exportOpen: true }));
  await page.waitForTimeout(200);
  check(`${p}Export leaves the combined clip`, (await view(page)).inside === 0);
  await page.evaluate(() => (window as any).vuEditor.ui.setState({ exportOpen: false }));

  // Separate from the menu.
  await page.evaluate((id) => (window as any).vuEditor.select(id), outerId);
  await menu(page, phone);
  await page.locator('.vu-menu-item', { hasText: 'Separate' }).click();
  await page.waitForTimeout(300);
  v = await view(page);
  check(`${p}Separate puts the pieces back`, v.items === 3 && !v.combined);
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
