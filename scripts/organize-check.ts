/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Layers & organising (v0.2 group E) in a real browser: multi-select, group, group drag, lock,
 * History jumps, the Layers panel (hide, restack), the context menu, align, arrange, lane lock —
 * desktop (Chrome, mouse + keyboard) and phone (WebKit, iPhone size, touch). Screenshots of each
 * state with --shots; axe on the Layers panel and the menu.
 * Usage: playground running, then node scripts/organize-check.ts [--shots <dir>] [--only desktop|phone]
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
const media = ['avc-1080p30.mp4', 'photo.jpg'].map((f) => resolve('test-media/files', f));

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

async function load(page: Page) {
  await page.goto(`http://localhost:${port}/editor?autosave=0`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page.locator('.vu-root input[type=file][accept^="video"]').setInputFiles(media);
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks[0].items.length === 2,
    null,
    {
      timeout: 30000,
    },
  );
}

/** Adds two texts (one through the panel, one cloned at another place) and returns their ids. */
async function addTexts(page: Page): Promise<[string, string]> {
  return page.evaluate(() => {
    const c = (window as any).vuEditor;
    const base = {
      kind: 'text',
      text: 'Hello',
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
    };
    const tf = (x: number, y: number) => ({
      x,
      y,
      scale: 1,
      rotation: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
    });
    c.seek(0);
    const ids: string[] = [];
    for (const [x, y, text] of [
      [0.5, 0.35, 'Alpha'],
      [0.5, 0.7, 'Beta'],
    ] as const) {
      c.addLaneItem('Add text', (id: string, start: number) => {
        ids.push(id);
        return { ...base, id, start, text, transform: tf(x, y) };
      });
    }
    c.select(null);
    return ids as [string, string];
  });
}

/** Screen point of an item's centre on the stage. */
async function stagePoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  const tf = await page.evaluate((itemId) => {
    const c = (window as any).vuEditor;
    for (const t of c.project.tracks)
      for (const i of t.items) if (i.id === itemId) return i.transform;
    return null;
  }, id);
  return { x: frame.x + tf.x * frame.width, y: frame.y + tf.y * frame.height };
}

const item = (page: Page, id: string) =>
  page.evaluate((itemId) => {
    const c = (window as any).vuEditor;
    for (const t of c.project.tracks)
      for (const i of t.items)
        if (i.id === itemId)
          return { ...i, trackIndex: c.project.tracks.indexOf(t), trackLocked: t.locked };
    return null;
  }, id);
const selection = (page: Page) =>
  page.evaluate(() => (window as any).vuEditor.ui.getState().selectedIds as string[]);

// ── desktop ──────────────────────────────────────────────────────────────
if (only !== 'phone') {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  const [a, b] = await addTexts(page);
  await page.waitForTimeout(400);

  // Multi-select: click A, Shift-click B.
  const pa = await stagePoint(page, a);
  const pb = await stagePoint(page, b);
  await page.mouse.click(pa.x, pa.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(pb.x, pb.y);
  await page.keyboard.up('Shift');
  let sel = await selection(page);
  check(
    'shift-click selects two',
    sel.length === 2 && sel.includes(a) && sel.includes(b),
    sel.join(','),
  );
  check(
    'inspector shows the selection',
    await page.locator('.vu-inspector', { hasText: '2 selected' }).isVisible(),
  );
  await snap(page, 'd1-two-selected');

  // Group.
  await page.keyboard.press(`${mod}+g`);
  const ga = await item(page, a);
  const gb = await item(page, b);
  check('⌘G groups', !!ga?.groupId && ga.groupId === gb?.groupId);
  await page.keyboard.press('Escape');
  await page.mouse.click(pa.x, pa.y);
  sel = await selection(page);
  check('clicking a member selects the group', sel.length === 2, sel.join(','));
  await snap(page, 'd2-group-selected');

  // Drag the group.
  const before = [(await item(page, a))!.transform, (await item(page, b))!.transform];
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(pa.x + i * 12, pa.y + i * 4);
  await page.mouse.up();
  const after = [(await item(page, a))!.transform, (await item(page, b))!.transform];
  const dA = after[0].x - before[0].x;
  const dB = after[1].x - before[1].x;
  check(
    'dragging moves the whole group',
    dA > 0.01 && Math.abs(dA - dB) < 1e-6,
    `${dA.toFixed(4)} / ${dB.toFixed(4)}`,
  );

  // Lock.
  await page.keyboard.press(`${mod}+Shift+l`);
  check('⇧⌘L locks both', !!(await item(page, a))?.locked && !!(await item(page, b))?.locked);
  const lockedAt = (await item(page, a))!.transform.x;
  const pa2 = await stagePoint(page, a);
  await page.mouse.move(pa2.x, pa2.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(pa2.x + i * 10, pa2.y);
  await page.mouse.up();
  check('locked elements don’t move', (await item(page, a))!.transform.x === lockedAt);
  await page.keyboard.press('Delete');
  check('locked elements aren’t deleted', !!(await item(page, a)));
  await snap(page, 'd3-locked');
  await page.keyboard.press(`${mod}+Shift+l`);
  check('⇧⌘L again unlocks', !(await item(page, a))?.locked);

  // History: back to Original, then forward to the latest.
  const historyButton = page.locator('.vu-topbar .vu-btn[aria-label="History"]');
  await historyButton.click();
  check('History opens as a panel', await page.locator('.vu-panel .vu-history').isVisible());
  const steps = await page.locator('.vu-history-step').count();
  check('History lists Original + steps', steps >= 6, `${steps}`);
  await snap(page, 'd4-history');
  await page.locator('.vu-history-step').first().click();
  const original = await page.evaluate(
    () => (window as any).vuEditor.project.tracks[0].items.length,
  );
  check('History › Original restores the start', original === 0);
  await page.locator('.vu-history-step').last().click();
  check('History › last step comes back', !!(await item(page, a))?.groupId);
  await historyButton.click();
  check('History button closes it', !(await page.locator('.vu-history').isVisible()));

  // Layers panel: rows, hide, restack.
  await page.evaluate(() => (window as any).vuEditor.seek(705_600_000));
  await page.locator('.vu-topbar .vu-btn[aria-label="Layers"]').click();
  await page.waitForTimeout(300);
  const rows = await page.locator('.vu-layer').count();
  check('Layers lists what is on screen', rows === 3, `${rows} rows`);
  await snap(page, 'd5-layers');
  const a11y = await new AxeBuilder({ page })
    .include('.vu-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  check(
    'Layers panel passes axe',
    a11y.violations.length === 0,
    a11y.violations.map((v) => v.id).join(','),
  );
  await page.locator('.vu-layer').first().locator('.vu-btn[aria-label="Hide"]').click();
  const hiddenOne = await page.evaluate(
    () =>
      (window as any).vuEditor.project.tracks
        .flatMap((t: any) => t.items)
        .filter((i: any) => i.hidden).length,
  );
  check('Hide in Layers hides it', hiddenOne === 1);
  await page.locator('.vu-layer').first().locator('.vu-btn[aria-label="Show"]').click();
  const topBefore = await page.locator('.vu-layer .vu-layer-name').first().innerText();
  const grip = page.locator('.vu-layer').first().locator('.vu-layer-grip');
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++)
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + i * 10);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const topAfter = await page.locator('.vu-layer .vu-layer-name').first().innerText();
  check('dragging a layer restacks it', topBefore !== topAfter, `${topBefore} → ${topAfter}`);

  // Context menu and align (just A).
  await page.evaluate((id) => (window as any).vuEditor.select(id, { only: true }), a);
  const pa3 = await stagePoint(page, a);
  await page.mouse.click(pa3.x, pa3.y, { button: 'right' });
  check(
    'right-click opens the menu',
    await page.locator('.vu-menu[role="menu"]').first().isVisible(),
  );
  await snap(page, 'd6-menu');
  const menuA11y = await new AxeBuilder({ page })
    .include('.vu-menu')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  check(
    'menu passes axe',
    menuA11y.violations.length === 0,
    menuA11y.violations.map((v) => v.id).join(','),
  );
  await page.locator('.vu-menu-item[data-submenu]').click();
  await page.locator('.vu-submenu .vu-menu-item', { hasText: 'Left' }).click();
  const leftX = await page.evaluate(() => {
    const c = (window as any).vuEditor;
    return c.ui.getState().menu === null;
  });
  const alignedTf = (await item(page, a))!.transform;
  check(
    'Align › Left moves it to the left edge',
    leftX && alignedTf.x < 0.45,
    alignedTf.x.toFixed(3),
  );
  await page.mouse.click(pa3.x, pa3.y, { button: 'right' });
  await page.keyboard.press('Escape');
  check('Esc closes the menu', (await page.locator('.vu-menu').count()) === 0);

  // Arrange from the keyboard.
  await page.evaluate((id) => (window as any).vuEditor.select(id, { only: true }), b);
  const zBefore = (await item(page, b))!.trackIndex;
  await page.keyboard.press(`${mod}+[`);
  const zAfter = (await item(page, b))!.trackIndex;
  check('⌘[ sends to back', zAfter < zBefore || zBefore === 1, `${zBefore} → ${zAfter}`);

  // Lane lock from the timeline header.
  const textRow = await page.evaluate((id) => {
    const c = (window as any).vuEditor;
    return c.project.tracks.findIndex((t: any) => t.items.some((i: any) => i.id === id));
  }, a);
  await page
    .locator(`.vu-timeline .vu-sr-only button[aria-pressed]`)
    .nth(textRow * 2 + 1)
    .evaluate((el) => (el as HTMLElement).click());
  check('row lock locks the lane', !!(await item(page, a))?.trackLocked);
  await snap(page, 'd7-lane-locked');

  // Select all + duplicate as a group.
  await page.locator('.vu-stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${mod}+a`);
  sel = await selection(page);
  check('⌘A selects everything on screen', sel.length >= 2, `${sel.length}`);

  // Undo everything back.
  for (let i = 0; i < 40; i++) await page.keyboard.press(`${mod}+z`);
  const empty = await page.evaluate(() => (window as any).vuEditor.project.tracks[0].items.length);
  check('undo all the way back', empty === 0);
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── desktop: selection box started on the main video ─────────────────────
if (only !== 'phone') {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  const [a, b] = await addTexts(page);
  await page.waitForTimeout(4000); // toasts gone
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  const at = (fx: number, fy: number) => ({
    x: frame.x + frame.width * fx,
    y: frame.y + frame.height * fy,
  });
  const box = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  };
  const videoX = () =>
    page.evaluate(() => (window as any).vuEditor.project.tracks[0].items[0].transform.x as number);
  // Both drags start on the video (it fills the middle of the frame), not on empty stage.
  await box(at(0.03, 0.5), at(0.9, 0.3));
  check('box drawn from the video selects the text', (await selection(page)).join() === a);
  check('…and leaves the video where it was', (await videoX()) === 0.5);
  await page.keyboard.down('Shift');
  await box(at(0.03, 0.55), at(0.9, 0.8));
  await page.keyboard.up('Shift');
  const both = await selection(page);
  check('⇧ + a second box adds to the selection', both.length === 2 && both.includes(b));
  await page.keyboard.press(`${mod}+g`);
  const grouped = await page.evaluate(
    ([x, y]) => {
      const items = (window as any).vuEditor.project.tracks.flatMap((t: any) => t.items);
      const g = (id: string) => items.find((i: any) => i.id === id).groupId;
      return !!g(x) && g(x) === g(y);
    },
    [a, b],
  );
  check('boxed texts group with ⌘G', grouped);
  // Copy the group, move the playhead, paste: two new texts there, still a group of their own.
  await page.keyboard.press(`${mod}+c`);
  await page.evaluate(() => (window as any).vuEditor.seek(4 * 705_600_000));
  await page.keyboard.press(`${mod}+v`);
  const pasted = await page.evaluate(() => {
    const c = (window as any).vuEditor;
    const ids: string[] = c.ui.getState().selectedIds;
    const items = c.project.tracks.flatMap((t: any) => t.items);
    const got = ids.map((id) => items.find((i: any) => i.id === id));
    return {
      n: got.length,
      starts: got.map((i: any) => i.start / 705_600_000),
      grouped: !!got[0]?.groupId && got.every((i: any) => i.groupId === got[0].groupId),
      texts: items.filter((i: any) => i.kind === 'text').length,
    };
  });
  check(
    '⌘C then ⌘V pastes a copy at the playhead, as its own group',
    pasted.n === 2 && pasted.texts === 4 && pasted.grouped && pasted.starts.every((t) => t >= 4),
    JSON.stringify(pasted),
  );
  await page.keyboard.press(`${mod}+x`);
  const afterCut = await page.evaluate(
    () =>
      (window as any).vuEditor.project.tracks
        .flatMap((t: any) => t.items)
        .filter((i: any) => i.kind === 'text').length,
  );
  await page.keyboard.press(`${mod}+v`);
  const afterPaste = await page.evaluate(
    () =>
      (window as any).vuEditor.project.tracks
        .flatMap((t: any) => t.items)
        .filter((i: any) => i.kind === 'text').length,
  );
  check(
    '⌘X removes, ⌘V brings it back',
    afterCut === 2 && afterPaste === 4,
    `${afterCut} → ${afterPaste}`,
  );
  await page.mouse.click(at(0.03, 0.5).x, at(0.03, 0.5).y);
  const video = await page.evaluate(() => (window as any).vuEditor.project.tracks[0].items[0].id);
  check('a click on the video still selects it', (await selection(page)).join() === video);
  await box(at(0.5, 0.5), at(0.6, 0.5));
  check('a selected video still drags', (await videoX()) > 0.55);
  check('no page errors (selection box)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── phone ────────────────────────────────────────────────────────────────
if (only !== 'desktop') {
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  const [a] = await addTexts(page);
  await page.waitForTimeout(400);
  const pa = await stagePoint(page, a);
  await page.touchscreen.tap(pa.x, pa.y);
  check('phone: tap selects', (await selection(page)).includes(a));
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Arrange' }).tap();
  check('phone: Arrange opens its sheet', await page.locator('.vu-dock .vu-arrange').isVisible());
  await snap(page, 'p1-arrange');
  // Switching tools keeps the sheet and swaps what's in it.
  const sheet = await page.locator('.vu-dock').elementHandle();
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Style' }).tap();
  const same = await page.evaluate((el) => el?.isConnected ?? false, sheet);
  check('phone: switching tools keeps the open sheet', same);
  await page.locator('.vu-done').tap();
  await page.waitForTimeout(500);
  await page.locator('.vu-topbar .vu-btn[aria-label="Layers"]').tap();
  check('phone: Layers opens in the sheet', await page.locator('.vu-dock .vu-layers').isVisible());
  await snap(page, 'p2-layers');
  await page.locator('.vu-done').tap();
  await page.waitForTimeout(500);
  // Long-press the text: its menu.
  const cdp = page.locator('.vu-stage');
  await cdp.dispatchEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    clientX: pa.x,
    clientY: pa.y,
    isPrimary: true,
    button: 0,
  });
  await page.waitForTimeout(700);
  await cdp.dispatchEvent('pointerup', {
    pointerId: 7,
    pointerType: 'touch',
    clientX: pa.x,
    clientY: pa.y,
    isPrimary: true,
    button: 0,
  });
  check('phone: long-press opens the menu', await page.locator('.vu-menu').first().isVisible());
  await snap(page, 'p3-menu');
  check('no page errors (phone)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
