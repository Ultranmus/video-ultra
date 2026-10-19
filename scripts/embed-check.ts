/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * The embedding API (v0.3) in a real browser, on the playground's `?embed=1` demo: a hidden panel
 * and command are gone (menu, toolbar, shortcut), the host's panel sits where `railOrder` puts it
 * and works, the host's top-bar button runs, its media source searches and adds (credited), and
 * events arrive (change, selection, playback, command, import, panel); axe on the host panel.
 * Usage: playground running, then node scripts/embed-check.ts [--port 3200]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices } from '@playwright/test';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

{
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/editor?autosave=0&embed=1`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  const rail = await page.locator('.vu-rail .vu-btn').allInnerTexts();
  const names = rail.map((t) => t.trim());
  check('the hidden Blur panel is gone from the menu', !names.includes('Blur'), names.join(' · '));
  check(
    'the host panel sits where railOrder puts it',
    names[1] === 'Brand' && names[2] === 'Templates',
    names.slice(0, 3).join(' · '),
  );

  // Media source: search, add (credited).
  // The Media panel is open by default (a click on it would close it).
  await page.evaluate(() => (window as any).vuEditor.openPanel('media'));
  await page.locator('.vu-media-sources .vu-asset').first().waitFor();
  const all = await page.locator('.vu-media-sources .vu-asset').count();
  await page.locator('.vu-media-sources input[type=search]').fill('ocean');
  await page.waitForFunction(
    () => document.querySelectorAll('.vu-media-sources .vu-asset').length === 1,
  );
  check('the host media source lists and searches', all === 12, `${all} → 1`);
  await page.locator('.vu-media-sources .vu-asset').first().click();
  await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);
  const asset = await page.evaluate(
    () => Object.values((window as any).vuEditor.project.assets)[0] as any,
  );
  check(
    '…adds its media with the credit',
    asset.name === 'Ocean background.png' && asset.credit === 'Made in the playground',
    `${asset.name} · ${asset.credit}`,
  );

  // Host panel.
  await page.locator('.vu-rail .vu-btn', { hasText: 'Brand' }).click();
  const axe = await new AxeBuilder({ page }).include('.vu-panel').analyze();
  check(
    'host panel passes axe (inside the editor chrome)',
    axe.violations.length === 0,
    axe.violations.map((v) => v.id).join(', '),
  );
  await page.locator('.vu-panel button', { hasText: 'Add brand title' }).click();
  const brand = await page.evaluate(() =>
    (window as any).vuEditor.project.tracks.some((t: any) =>
      t.items.some((i: any) => i.text === 'ACME STUDIO'),
    ),
  );
  check('the host panel edits the project through the controller', brand);

  // Hidden command: not in the menu, its shortcut does nothing.
  await page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.select(c.project.tracks[0].items[0].id);
  });
  const before = await page.evaluate(() => (window as any).vuEditor.project.tracks[0].items.length);
  await page.keyboard.press(`${mod}+d`);
  const after = await page.evaluate(() => (window as any).vuEditor.project.tracks[0].items.length);
  check('a hidden command’s shortcut does nothing', before === after, `${before} → ${after}`);
  const stage = (await page.locator('.vu-stage-frame').boundingBox())!;
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2, {
    button: 'right',
  });
  const menu = await page.locator('.vu-menu').first().innerText();
  check(
    '…and isn’t in the menu',
    !/Duplicate/.test(menu) && /Copy/.test(menu),
    menu.replace(/\s+/g, ' ').slice(0, 80),
  );
  await page.keyboard.press('Escape');

  // Top-bar button.
  await page.locator('.vu-topbar .vu-btn', { hasText: 'Share' }).click();
  const shared = await page.evaluate(() => (window as any).vuShared);
  check('the host’s top-bar button runs with the controller', shared === 2, String(shared));

  // Events.
  // (Space would press the focused Share button: play through the controller.)
  await page.evaluate(() => (window as any).vuEditor.play());
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as any).vuEditor.pause());
  await page.keyboard.press(`${mod}+c`);
  const types = await page.evaluate(() => [
    ...new Set(((window as any).vuEvents ?? []).map((e: any) => e.type)),
  ]);
  for (const type of ['import', 'change', 'selection', 'panel', 'playback', 'command'])
    check(`event: ${type}`, types.includes(type), types.join(', '));
  const command = await page.evaluate(() =>
    ((window as any).vuEvents ?? []).some((e: any) => e.type === 'command' && e.id === 'copy'),
  );
  check('…the command event names it (copy)', command);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  // Phone: the host panel joins the add tools.
  const browser = await chromium.launch({ channel: 'chrome' });
  const iphone: Record<string, unknown> = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  const page = await (await browser.newContext(iphone)).newPage();
  await page.goto(`http://localhost:${port}/editor?autosave=0&embed=1`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  const tools = (await page.locator('.vu-toolbar .vu-btn').allInnerTexts()).map((t) => t.trim());
  check(
    'phone: Brand is among the add tools, Blur isn’t',
    tools.includes('Brand') && !tools.includes('Blur'),
    tools.join(' · '),
  );
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Brand' }).tap();
  await page.locator('button', { hasText: 'Add brand title' }).tap();
  const brand = await page.evaluate(() =>
    (window as any).vuEditor.project.tracks.some((t: any) =>
      t.items.some((i: any) => i.text === 'ACME STUDIO'),
    ),
  );
  check('phone: the host panel works in the sheet', brand);
  await browser.close();
}

console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
