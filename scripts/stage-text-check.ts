/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Typing on the stage in a real browser: double-click a text (desktop, Chrome) or tap a selected
 * one (phone, WebKit, iPhone size) → a field over it; typing writes nothing to the project until
 * the field closes, then one undo step; Esc puts the old text back; the engine hides the item
 * while the field shows. Screenshots with --shots (field open vs. the engine's text after).
 * Usage: playground running, then node scripts/stage-text-check.ts [--shots <dir>] [--only desktop|phone]
 */
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

async function load(page: Page): Promise<string> {
  await page.goto(`http://localhost:${port}/editor?autosave=0`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles([resolve('test-media/files/avc-1080p30.mp4')]);
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks[0].items.length === 1,
    null,
    { timeout: 30000 },
  );
  return page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.seek(0);
    let out = '';
    c.addLaneItem('Add text', (id: string, start: number) => {
      out = id;
      return {
        kind: 'text',
        id,
        start,
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
          background: { color: '#7a3cff', padding: 0.3, radius: 0.2 },
        },
        filter: null,
        adjust: {},
        transform: {
          x: 0.5,
          y: 0.4,
          scale: 1,
          rotation: 8,
          opacity: 1,
          flipX: false,
          flipY: false,
        },
      };
    });
    c.select(null);
    return out;
  });
}

const textOf = (page: Page, id: string) =>
  page.evaluate((itemId) => {
    for (const t of (window as any).vuEditor.project.tracks)
      for (const i of t.items) if (i.id === itemId) return i.text as string;
    return null;
  }, id);

async function stagePoint(page: Page, id: string) {
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  const tf = await page.evaluate((itemId) => {
    for (const t of (window as any).vuEditor.project.tracks)
      for (const i of t.items) if (i.id === itemId) return i.transform;
    return null;
  }, id);
  return { x: frame.x + tf.x * frame.width, y: frame.y + tf.y * frame.height };
}

const field = (page: Page) => page.locator('.vu-stage-text');

// ── desktop ──────────────────────────────────────────────────────────────
if (only !== 'phone') {
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await load(page);
  await page.waitForTimeout(500);
  await snap(page, 'd0-before');
  const p = await stagePoint(page, id);
  await page.mouse.dblclick(p.x, p.y);
  check('double-click opens the field', await field(page).isVisible());
  check(
    'the field has the focus, caret after the last letter',
    await page.evaluate(() => {
      const f = document.activeElement as HTMLTextAreaElement;
      return (
        f?.classList.contains('vu-stage-text') && f.selectionStart === 5 && f.selectionEnd === 5
      );
    }),
  );
  await snap(page, 'd1-open');
  await page.keyboard.type(' big sale today');
  check('typing writes nothing to the project', (await textOf(page, id)) === 'Hello');
  await page.keyboard.press('Enter');
  await page.keyboard.type('50% off');
  await snap(page, 'd2-typing');
  const fieldBox = (await field(page).boundingBox())!;
  check('the field grows with a second line', fieldBox.height > 60, `${fieldBox.height}px`);
  // Click empty stage → commits.
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  await page.mouse.click(frame.x + 10, frame.y + frame.height - 10);
  await page.waitForTimeout(300);
  check('closing commits the text', (await textOf(page, id)) === 'Hello big sale today\n50% off');
  check('the field is gone', !(await field(page).isVisible()));
  await snap(page, 'd3-committed');
  await page.keyboard.press(`${mod}+z`);
  check(
    'one undo brings the old text back (all the typing is one step)',
    (await textOf(page, id)) === 'Hello',
  );
  await page.keyboard.press(`${mod}+Shift+z`);

  // A single click on the already selected text types too (a double-click isn't needed).
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(600);
  check('a first click only selects', !(await field(page).isVisible()));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
  check('a click on the selected text opens the field', await field(page).isVisible());
  const look = await page.evaluate(() => {
    const f = document.querySelector('.vu-stage-text') as HTMLElement;
    const b = document.querySelector('.vu-selection-box') as HTMLElement;
    const cs = getComputedStyle(f);
    return {
      bare: cs.outlineStyle === 'none' && cs.boxShadow === 'none',
      frame: !b.hidden && b.hasAttribute('data-typing'),
      // The frame is the field plus 6 px of air each side.
      fit: Math.abs(b.offsetWidth - 12 - f.offsetWidth) <= 1,
      widths: `${f.offsetWidth} / ${b.offsetWidth}`,
    };
  });
  check('the field draws no border or focus ring of its own', look.bare);
  check('the selection frame stays while typing', look.frame);
  check('the frame fits the field', look.fit, look.widths);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Esc cancels.
  await page.mouse.dblclick(p.x, p.y);
  await page.keyboard.type('nope');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Esc keeps the old text', (await textOf(page, id)) === 'Hello big sale today\n50% off');
  check('Esc closes the field', !(await field(page).isVisible()));
  // Shortcuts don't fire while typing: Delete / Backspace edits text, not the element.
  await page.mouse.dblclick(p.x, p.y);
  await page.keyboard.press('Backspace');
  check('Backspace in the field leaves the element', (await textOf(page, id)) !== null);
  await page.keyboard.type('Hi');
  await page.keyboard.press(`${mod}+Enter`);
  await page.waitForTimeout(200);
  // The caret opens at the end: Backspace took the last letter, then 'Hi' went on.
  const committed = await textOf(page, id);
  check(
    '⌘/Ctrl+Enter commits',
    committed === 'Hello big sale today\n50% ofHi',
    JSON.stringify(committed),
  );

  // A wrapping text (templates give their titles a wrap width): the field hugs the drawn lines,
  // like the selection frame does, not the whole wrap width.
  await page.evaluate((itemId) => {
    const c = (window as any).vuEditor;
    c.run('Wrap', (d: any) => {
      for (const t of d.tracks)
        for (const i of t.items)
          if (i.id === itemId) {
            i.text = 'Summer in Lisbon, a long weekend by the sea';
            i.maxWidth = 0.5;
            // Bigger than at scale 1: the lines stay as they were (DECISIONS #157).
            i.transform.scale = 1.6;
          }
    });
    c.select(itemId);
  }, id);
  await page.waitForTimeout(300);
  const selectedWidth = await page.locator('.vu-selection-box').evaluate((b) => b.offsetWidth);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
  const typingWidth = await page.locator('.vu-selection-box').evaluate((b) => b.offsetWidth);
  check(
    'wrapping text (scaled up): the frame keeps its width when typing starts',
    Math.abs(typingWidth - selectedWidth) <= 3,
    `${selectedWidth} → ${typingWidth}`,
  );
  await page.keyboard.press('Escape');
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── phone ────────────────────────────────────────────────────────────────
if (only !== 'desktop') {
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await load(page);
  await page.waitForTimeout(500);
  const p = await stagePoint(page, id);
  await page.touchscreen.tap(p.x, p.y);
  check('phone: first tap selects', !(await field(page).isVisible()));
  await page.waitForTimeout(400);
  // Phones: a tap on the selected text opens the full-screen Edit sheet (DECISIONS #185), not a
  // field on the video (the keyboard would cover a text low in the frame).
  const sheet = page.locator('.vu-dock[data-cover]');
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(1000); // the sheet slides in
  check('phone: a tap on the selected text opens the Edit sheet', await sheet.isVisible());
  check('phone: …and no field on the video', !(await field(page).isVisible()));
  await snap(page, 'p1-edit-sheet');
  const box = await sheet.boundingBox();
  const view = page.viewportSize()!;
  check(
    'phone: the Edit sheet covers the whole editor',
    !!box && box.y <= 1 && box.height >= view.height - 2,
    JSON.stringify(box),
  );
  await sheet.locator('textarea').fill('HelloSale');
  await page.waitForTimeout(300);
  check('phone: typing in the sheet changes the text', (await textOf(page, id)) === 'HelloSale');
  check('no page errors (phone)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
