/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Picture tools (v0.2 group C) in a real browser, through the UI: green screen (switch, pick from
 * video, sliders), LUT import (a generated .cube, plus a broken one that must say why), blurred /
 * pixelated areas (add from the Blur panel, stretch from a side handle), blend modes (inspector
 * chips), LUT tiles (previews, rename, delete + undo, import with no picture to put it on) and a
 * text's wrap width from its side handle (one undo step) — desktop (Chrome, mouse) and phone
 * (WebKit, iPhone size, touch). Screenshots of each state with --shots; axe on the new controls.
 * Usage: playground running, then node scripts/picture-check.ts [--shots <dir>] [--only desktop|phone]
 *   [--port 3200]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices, webkit, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const shots = arg('shots');
const only = arg('only');
const theme = arg('theme') ?? 'dark';
const media = ['avc-1080p30.mp4', 'photo.jpg'].map((f) => resolve('test-media/files', f));

// A 17-point "teal & orange"-ish look and a broken file.
const dir = mkdtempSync(join(tmpdir(), 'vu-luts-'));
const rows = ['TITLE "Teal orange"', 'LUT_3D_SIZE 17'];
for (let b = 0; b < 17; b++)
  for (let g = 0; g < 17; g++)
    for (let r = 0; r < 17; r++) {
      const [R, G, B] = [r / 16, g / 16, b / 16];
      rows.push(
        [R * 1.1, G * 0.95 + 0.03, B * 0.8 + 0.12].map((v) => Math.min(1, v).toFixed(5)).join(' '),
      );
    }
const goodLut = join(dir, 'Teal orange.cube');
writeFileSync(goodLut, rows.join('\n'));
const badLut = join(dir, 'Broken.cube');
writeFileSync(badLut, 'LUT_3D_SIZE 33\n0 0 0\n1 1 1\n');

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
const axe = async (page: Page, label: string, include: string) => {
  const result = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  check(
    `${label}: axe WCAG 2.2 AA`,
    result.violations.length === 0,
    result.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`).join('; '),
  );
};

async function load(page: Page) {
  await page.goto(`http://localhost:${port}/editor?autosave=0&fresh=1&theme=${theme}`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  // The dev server's own badge can sit over the phone toolbar.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.locator('.vu-root input[type=file][accept^="video"]').setInputFiles(media);
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks[0].items.length === 2,
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1200);
}

const mainClip = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.seek(705_600_000);
    const id = c.project.tracks[0].items[0].id;
    c.select(id);
    return id as string;
  });
const item = (page: Page, id: string) =>
  page.evaluate((i) => {
    for (const t of (window as any).vuEditor.project.tracks)
      for (const it of t.items) if (it.id === i) return it;
    return null;
  }, id);

if (only !== 'phone') {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  const clip = await mainClip(page);

  // Green screen: open the inspector section, switch it on, pick a colour from the video.
  await page.locator('.vu-inspector .vu-section-toggle', { hasText: 'Green screen' }).click();
  await snap(page, 'pc-d01-green-off');
  await page.locator('.vu-inspector [role=switch]', { hasText: 'Remove a colour' }).click();
  await page.waitForTimeout(300);
  const keyed = await item(page, clip);
  check('desktop: green screen switch turns the key on', !!keyed?.key, JSON.stringify(keyed?.key));
  await snap(page, 'pc-d02-green-on');
  await page.locator('.vu-inspector .vu-btn', { hasText: 'Pick from video' }).click();
  check('desktop: picking shows the stage hint', await page.locator('.vu-stage-pick').isVisible());
  await snap(page, 'pc-d03-picking');
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  await page.mouse.click(frame.x + frame.width * 0.3, frame.y + frame.height * 0.5);
  await page
    .waitForFunction(
      (i) => {
        for (const t of (window as any).vuEditor.project.tracks)
          for (const it of t.items) if (it.id === i) return it.key && it.key.color !== '#00b140';
        return false;
      },
      clip,
      { timeout: 10000 },
    )
    .catch(() => {});
  const picked = await item(page, clip);
  check(
    'desktop: pick from video sets the key colour',
    /^#[0-9a-f]{6}$/.test(picked?.key?.color ?? '') && picked.key.color !== '#00b140',
    picked?.key?.color,
  );
  check('desktop: picking ends after the tap', !(await page.locator('.vu-stage-pick').count()));
  await snap(page, 'pc-d04-picked');
  await axe(page, 'desktop green screen', '.vu-inspector');
  await page.locator('.vu-inspector [role=switch]', { hasText: 'Remove a colour' }).click();

  // LUT: Filters panel → Import .cube.
  await page.locator('.vu-rail .vu-btn', { hasText: 'Filters' }).click();
  await page.waitForTimeout(500);
  await page.locator('.vu-lut input[type=file]').setInputFiles(badLut);
  await page.waitForTimeout(800);
  const toast = (await page.locator('.vu-toast').allInnerTexts()).join(' ');
  check('desktop: a broken LUT says why', /incomplete/i.test(toast), toast.slice(0, 120));
  await snap(page, 'pc-d05-lut-broken');
  await page.locator('.vu-lut input[type=file]').setInputFiles(goodLut);
  await page
    .waitForFunction(
      (i) => {
        const c = (window as any).vuEditor;
        for (const t of c.project.tracks)
          for (const it of t.items) if (it.id === i) return !!it.lut;
        return false;
      },
      clip,
      { timeout: 10000 },
    )
    .catch(() => {});
  const looked = await item(page, clip);
  const lutAsset = await page.evaluate(
    (id) => (window as any).vuEditor.project.assets[id ?? ''],
    looked?.lut?.assetId,
  );
  check(
    'desktop: LUT import adds a lut asset (stored, not inlined) and applies it',
    lutAsset?.kind === 'lut' && lutAsset?.source?.type !== undefined && !('data' in lutAsset),
    JSON.stringify(lutAsset?.source),
  );
  check(
    'desktop: the media panel does not list the LUT',
    await page.evaluate(() => !document.querySelector('.vu-asset[aria-label*="Teal"]')),
  );
  await snap(page, 'pc-d06-lut');
  await axe(page, 'desktop LUT controls', '.vu-lut');

  // LUT tiles: previews drawn by the engine (No LUT + the look), rename, delete + undo.
  await page
    .waitForFunction(
      () => document.querySelectorAll('.vu-lut .vu-filter-thumb[data-ready]').length >= 2,
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  const lutTiles = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.vu-lut .vu-filter-thumb')];
    return canvases.map((c) => (c.hasAttribute('data-ready') ? c.width : 0));
  });
  check(
    'desktop: LUT tiles show previews (No LUT + the look)',
    lutTiles.length === 2 && lutTiles.every((w) => w > 0),
    JSON.stringify(lutTiles),
  );
  const lutId = looked?.lut?.assetId as string;
  await page.locator('.vu-lut-manage .vu-btn[aria-label="Rename look"]').click();
  await page.locator('.vu-lut-rename').fill('Warm film');
  await page.locator('.vu-lut-rename').press('Enter');
  await page.waitForTimeout(200);
  const renamed = await page.evaluate(
    (id) => (window as any).vuEditor.project.assets[id]?.name,
    lutId,
  );
  check(
    'desktop: Rename look renames it (tile label too)',
    renamed === 'Warm film' &&
      (await page.locator('.vu-lut .vu-filter-name', { hasText: 'Warm film' }).count()) === 1,
    renamed,
  );
  await snap(page, 'pc-d06b-lut-renamed');
  await page.locator('.vu-lut-manage .vu-btn[aria-label="Delete look"]').click();
  await page.waitForTimeout(200);
  const afterDelete = await page.evaluate(
    ([id, c]) => {
      const e = (window as any).vuEditor;
      const it = e.project.tracks[0].items.find((x: any) => x.id === c);
      return { asset: !!e.project.assets[id!], lut: !!it?.lut };
    },
    [lutId, clip],
  );
  const deleteToast = (await page.locator('.vu-toast').allInnerTexts()).join(' ');
  check(
    'desktop: Delete look removes it from the project and the clip, with Undo',
    !afterDelete.asset && !afterDelete.lut && /Deleted the look/.test(deleteToast),
    JSON.stringify(afterDelete),
  );
  await page.evaluate(() => (window as any).vuEditor.undo());
  await page.waitForTimeout(200);
  const restored = await page.evaluate(
    ([id, c]) => {
      const e = (window as any).vuEditor;
      const it = e.project.tracks[0].items.find((x: any) => x.id === c);
      return { asset: e.project.assets[id!]?.name, lut: it?.lut?.assetId };
    },
    [lutId, clip],
  );
  check(
    'desktop: one undo brings the look back on the clip',
    restored.asset === 'Warm film' && restored.lut === lutId,
    JSON.stringify(restored),
  );

  // Blurred area: Blur panel → Pixelate oval, then stretch it from the right side.
  await page.locator('.vu-rail .vu-btn', { hasText: 'Blur' }).click();
  await snap(page, 'pc-d07-blur-panel');
  await axe(page, 'desktop Blur panel', '.vu-panel');
  await page.locator('.vu-region-tile', { hasText: 'Pixelate oval' }).click();
  await page.waitForTimeout(500);
  const regionId = await page.evaluate(() => (window as any).vuEditor.ui.getState().selectedId);
  const region = await item(page, regionId);
  check(
    'desktop: Blur panel adds a selected pixelated oval on a layer',
    region?.kind === 'region' && region.effect === 'pixelate' && region.shape === 'ellipse',
  );
  await snap(page, 'pc-d08-region');
  const handle = page.locator('.vu-selection-box .vu-handle-side[data-handle="e"]');
  check('desktop: a blurred area has side handles', await handle.isVisible());
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 60, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const stretched = await item(page, regionId);
  check(
    'desktop: the side handle widens it, the height stays',
    stretched.width > region.width * 1.2 && Math.abs(stretched.height - region.height) < 1e-9,
    `${region.width.toFixed(3)} → ${stretched.width.toFixed(3)}`,
  );
  await snap(page, 'pc-d09-region-stretched');
  await axe(page, 'desktop blurred area inspector', '.vu-inspector');

  // Blend: a text layer, Appearance → the Screen tile (blend modes are tiles, #178).
  await page.locator('.vu-rail .vu-btn', { hasText: 'Text' }).click();
  await page.locator('.vu-panel .vu-btn', { hasText: 'Add text' }).first().click();
  await page.waitForTimeout(500);
  const textId = await page.evaluate(() => (window as any).vuEditor.ui.getState().selectedId);
  const appearance = page.locator('.vu-inspector .vu-section-toggle', { hasText: 'Appearance' });
  if ((await appearance.getAttribute('aria-expanded')) !== 'true') await appearance.click();
  const blendTile = (name: string) =>
    page.locator('.vu-inspector .vu-blend-grid .vu-filter-tile', { hasText: name });
  await blendTile('Screen').click();
  await page.waitForTimeout(300);
  check('desktop: blend tile sets the mode', (await item(page, textId))?.blend === 'screen');
  await blendTile('Screen').scrollIntoViewIfNeeded();
  await snap(page, 'pc-d10-blend');
  await blendTile('Normal').click();
  check('desktop: Normal removes the blend', !('blend' in ((await item(page, textId)) ?? {})));

  // A LUT import while a text is the target: it can't take a look, but the look is still added
  // to the list, and the toast says so.
  await page.evaluate(() => (window as any).vuEditor.seek(705_600_000));
  await page.locator('.vu-rail .vu-btn', { hasText: 'Filters' }).click();
  await page.waitForTimeout(400);
  check(
    'desktop: a text in Filters says LUT looks are for videos and photos',
    await page.locator('.vu-lut .vu-hint', { hasText: 'videos and photos' }).isVisible(),
  );
  const lutsBefore = await page.evaluate(
    () =>
      Object.values((window as any).vuEditor.project.assets).filter((a: any) => a.kind === 'lut')
        .length,
  );
  await page.locator('.vu-lut input[type=file]').setInputFiles(goodLut);
  await page
    .waitForFunction(
      (n) =>
        Object.values((window as any).vuEditor.project.assets).filter((a: any) => a.kind === 'lut')
          .length > n,
      lutsBefore,
      { timeout: 10000 },
    )
    .catch(() => {});
  const lutsAfter = await page.evaluate(
    () =>
      Object.values((window as any).vuEditor.project.assets).filter((a: any) => a.kind === 'lut')
        .length,
  );
  const onlyToast = (await page.locator('.vu-toast').allInnerTexts()).join(' ');
  check(
    'desktop: a LUT import with no picture to put it on is added to the list, and says so',
    lutsAfter === lutsBefore + 1 &&
      /pick a video or photo/.test(onlyToast) &&
      (await page.locator('.vu-lut .vu-filter-tile').count()) === lutsAfter,
    `${lutsBefore} → ${lutsAfter}: ${onlyToast.slice(0, 120)}`,
  );
  await snap(page, 'pc-d10b-lut-text');

  // Text wrap width: the text's right side handle narrows it; one undo step; the box fits it.
  await page.evaluate((id) => {
    const c = (window as any).vuEditor;
    c.run('t', (d: any) => {
      for (const t of d.tracks)
        for (const it of t.items) if (it.id === id) it.text = 'A longer title that should wrap';
    });
    c.select(id);
  }, textId);
  await page.waitForTimeout(400);
  const side = page.locator('.vu-selection-box .vu-handle-side[data-handle="e"]');
  const topSide = page.locator('.vu-selection-box .vu-handle-side[data-handle="n"]');
  check(
    'desktop: a text shows left / right handles only',
    (await side.isVisible()) && !(await topSide.isVisible()),
  );
  const boxBefore = (await page.locator('.vu-selection-box').boundingBox())!;
  const sb = (await side.boundingBox())!;
  const steps = await page.evaluate(() => (window as any).vuEditor.editor.history().position);
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x - boxBefore.width * 0.3, sb.y + sb.height / 2, { steps: 8 });
  await snap(page, 'pc-d11-wrap-drag');
  await page.mouse.up();
  await page.waitForTimeout(400);
  const wrapped = await item(page, textId);
  const boxAfter = (await page.locator('.vu-selection-box').boundingBox())!;
  check(
    'desktop: dragging the side sets a wrap width; the text gets taller and narrower',
    typeof wrapped?.maxWidth === 'number' &&
      wrapped.maxWidth < 1 &&
      boxAfter.height > boxBefore.height * 1.5 &&
      boxAfter.width < boxBefore.width,
    `maxWidth ${wrapped?.maxWidth?.toFixed?.(3)}, box ${boxBefore.width.toFixed(0)}×${boxBefore.height.toFixed(0)} → ${boxAfter.width.toFixed(0)}×${boxAfter.height.toFixed(0)}`,
  );
  const stepsAfter = await page.evaluate(() => (window as any).vuEditor.editor.history().position);
  if (steps !== null)
    check(
      'desktop: the drag is one undo step',
      stepsAfter === steps + 1,
      `${steps} → ${stepsAfter}`,
    );
  await snap(page, 'pc-d12-wrapped');
  await page.evaluate(() => (window as any).vuEditor.undo());
  check(
    'desktop: undo puts the text back on one line',
    !('maxWidth' in ((await item(page, textId)) ?? {})),
  );
  await axe(page, 'desktop text inspector (Text width)', '.vu-inspector');

  const stats = await page.evaluate(() => (window as any).vuEditor.engine.stats());
  check('desktop: no page errors', errors.length === 0, errors.join(' | '));
  check('desktop: frames are not leaked', stats.openFrames <= stats.decoderBudget + 2);
  await browser.close();
}

if (only !== 'desktop') {
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  const clip = await mainClip(page);
  await page.waitForTimeout(400);
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Green screen' }).click();
  await page.waitForTimeout(600);
  await page.locator('.vu-dock [role=switch]', { hasText: 'Remove a colour' }).tap();
  await page.waitForTimeout(400);
  check('phone: Green screen tool turns the key on', !!(await item(page, clip))?.key);
  await snap(page, 'pc-p01-green');
  await axe(page, 'phone green screen sheet', '.vu-dock');
  await page.locator('.vu-dock .vu-btn', { hasText: 'Pick from video' }).tap();
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  await page.touchscreen.tap(frame.x + frame.width * 0.5, frame.y + frame.height * 0.4);
  await page.waitForTimeout(1500);
  check(
    'phone: tap on the video picks the colour',
    (await item(page, clip))?.key?.color !== '#00b140',
    (await item(page, clip))?.key?.color,
  );
  await snap(page, 'pc-p02-picked');
  // Nothing selected → the Blur tool opens the panel in the sheet.
  await page.evaluate(() => (window as any).vuEditor.select(null));
  await page.waitForTimeout(400);
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Blur' }).click();
  await page.waitForTimeout(600);
  await snap(page, 'pc-p03-blur-panel');
  await page.locator('.vu-region-tile', { hasText: 'Blur box' }).tap();
  await page.waitForTimeout(600);
  const regionId = await page.evaluate(() => (window as any).vuEditor.ui.getState().selectedId);
  check('phone: Blur box adds a blurred area', (await item(page, regionId))?.kind === 'region');
  await snap(page, 'pc-p04-region');
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Blurred area' }).click();
  await page.waitForTimeout(600);
  await snap(page, 'pc-p05-region-tool');
  await axe(page, 'phone blurred area sheet', '.vu-dock');

  // A text's wrap width with a finger: its right side handle, then one step on lift.
  const phoneText = await page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.seek(705_600_000);
    let out = '';
    c.addLaneItem('Add text', (id: string, start: number) => {
      out = id;
      return {
        kind: 'text',
        id,
        start,
        text: 'Hello there world',
        duration: 3 * 705_600_000,
        style: {
          fontFamily: 'system-ui',
          fontWeight: 700,
          italic: false,
          size: 0.07,
          color: '#ffffff',
          align: 'center',
          lineHeight: 1.2,
          letterSpacing: 0,
          outline: null,
          shadow: null,
          background: null,
        },
        transform: {
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
          opacity: 1,
          flipX: false,
          flipY: false,
        },
        filter: null,
        adjust: {},
      };
    });
    c.select(out);
    return out;
  });
  await page.waitForTimeout(600);
  const phoneSide = page.locator('.vu-selection-box .vu-handle-side[data-handle="e"]');
  check('phone: a text shows its side handles', await phoneSide.isVisible());
  const ps = (await phoneSide.boundingBox())!;
  const stage = page.locator('.vu-stage');
  const touch = (type: string, x: number, y: number) =>
    stage.dispatchEvent(type, {
      pointerId: 9,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      isPrimary: true,
      button: 0,
    });
  const x0 = ps.x + ps.width / 2;
  const y0 = ps.y + ps.height / 2;
  await phoneSide.dispatchEvent('pointerdown', {
    pointerId: 9,
    pointerType: 'touch',
    clientX: x0,
    clientY: y0,
    isPrimary: true,
    button: 0,
    bubbles: true,
  });
  for (let i = 1; i <= 6; i++) await touch('pointermove', x0 - i * 4, y0);
  const midDrag = await item(page, phoneText);
  check('phone: nothing is written to the project during the drag', !('maxWidth' in midDrag));
  await touch('pointerup', x0 - 24, y0);
  await page.waitForTimeout(400);
  const phoneWrapped = await item(page, phoneText);
  check(
    'phone: the side handle sets the wrap width on lift',
    typeof phoneWrapped?.maxWidth === 'number' && phoneWrapped.maxWidth < 1,
    String(phoneWrapped?.maxWidth),
  );
  await snap(page, 'pc-p06-wrapped');
  check('phone: no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

for (const line of results) console.log(line);
console.log(failures ? `\n${failures} check(s) failed` : '\nAll picture tool checks passed');
process.exitCode = failures ? 1 : 0;
