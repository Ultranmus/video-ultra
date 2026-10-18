/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Keyframes (v0.4) in a real browser, the way a user animates a title: ◆ Position at 0 s, move
 * the playhead to 2 s, drag the title on the video (it keys itself there), and the exported
 * frames show it moving (left at 0 s, right at 2 s, between at 1 s); the graph editor's curve
 * choice and a dragged ◆ are single undo steps; splitting keeps the motion; axe on the section.
 * Usage: playground running, then node scripts/keyframes-check.ts [--port 3200] [--shots <dir>]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const shots = arg('shots');
const F = 705_600_000;
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

/** Mean x (0…1) of the bright text pixels in the exported frame at `t` seconds. */
const textX = (page: Page, t: number) =>
  page.evaluate(async (s) => {
    const c = (window as any).vuEditor;
    c.seek(Math.round(s * 705_600_000));
    const img = await c.saveFrame({ format: 'png', height: 360 });
    const bmp = await createImageBitmap(img.blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const g = canvas.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let sx = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i]! > 240 && d[i + 1]! > 240 && d[i + 2]! > 240) {
        sx += (i / 4) % bmp.width;
        n++;
      }
    return n ? sx / n / bmp.width : -1;
  }, t);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/editor?autosave=0`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
// A dark still under a white title (16:9, so moving left / right is easy to see).
await page.evaluate(() =>
  (window as any).vuEditor.run('ratio', (d: any) => {
    d.settings.width = 1280;
    d.settings.height = 720;
    d.settings.background = { type: 'color', color: '#202020' };
  }),
);
await page
  .locator('.vu-root input[type=file][accept^="video"]')
  .setInputFiles([resolve('test-media/files', 'avc-noaudio.mp4')]);
await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);
const textId = await page.evaluate(() => {
  const c = (window as any).vuEditor;
  c.seek(0);
  let id = '';
  c.addLaneItem('Add text', (newId: string, start: number) => {
    id = newId;
    return {
      id: newId,
      kind: 'text',
      text: 'HELLO',
      start,
      duration: 4 * 705_600_000,
      style: {
        fontFamily: 'system-ui',
        fontWeight: 900,
        italic: false,
        size: 0.12,
        color: '#ffffff',
        align: 'center',
        lineHeight: 1.2,
        letterSpacing: 0,
        outline: null,
        shadow: null,
        background: { color: '#000000', padding: 0.3, radius: 0.1 },
      },
      transform: { x: 0.25, y: 0.5, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false },
      filter: null,
      adjust: {},
    };
  });
  // Hide the video: only the title is white in the frame.
  c.run('hide', (d: any) => {
    d.tracks[0].items[0].hidden = true;
  });
  c.select(id);
  return id;
});
const item = () =>
  page.evaluate(
    (id) =>
      (window as any).vuEditor.project.tracks
        .flatMap((t: any) => t.items)
        .find((i: any) => i.id === id),
    textId,
  );

// ◆ Position at 0 s.
await page.locator('.vu-section-toggle', { hasText: 'Keyframes' }).click();
const axe = await new AxeBuilder({ page }).include('.vu-inspector').analyze();
check(
  'Keyframes section passes axe',
  axe.violations.length === 0,
  axe.violations.map((v) => v.id).join(', '),
);
await page
  .locator('.vu-keyframe-row', { hasText: 'position' })
  .locator('.vu-keyframe-diamond')
  .click();
let it = await item();
check(
  '◆ Position keys x and y at the playhead',
  it.keyframes?.x?.length === 1 && it.keyframes?.y?.length === 1,
);

// Move to 2 s and drag the title to the right on the video: it keys itself.
await page.evaluate(() => (window as any).vuEditor.seek(2 * 705_600_000));
await page.waitForTimeout(300);
const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
const from = { x: frame.x + frame.width * 0.25, y: frame.y + frame.height * 0.5 };
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move(from.x + frame.width * 0.5, from.y, { steps: 10 });
await page.mouse.up();
it = await item();
const xs = (it.keyframes?.x ?? []).map((k: any) => [k.t / F, +k.v.toFixed(2)]);
check(
  'dragging at 2 s adds an x keyframe there',
  xs.length === 2 && xs[1][0] === 2 && xs[1][1] > 0.6,
  JSON.stringify(xs),
);
if (shots) await page.screenshot({ path: `${shots}/k1-dragged.png` });

const x0 = await textX(page, 0);
const x1 = await textX(page, 1);
const x2 = await textX(page, 2);
check(
  'the export shows it moving: left at 0 s, right at 2 s, between at 1 s',
  x0 < 0.32 && x2 > 0.68 && x1 > x0 + 0.05 && x1 < x2 - 0.05,
  `${x0.toFixed(2)} → ${x1.toFixed(2)} → ${x2.toFixed(2)}`,
);

// Graph editor: pick Linear for the segment — one undo step.
await page.locator('.vu-curve-segment').first().dispatchEvent('pointerdown');
await page.locator('.vu-curve .vu-chip', { hasText: 'Even' }).first().click();
it = await item();
check(
  'the graph editor sets the curve (Linear)',
  it.keyframes.x[0].ease === 'linear',
  String(it.keyframes.x[0].ease),
);
const x1Linear = await textX(page, 1);
check(
  '…and the motion follows it (linear: halfway at 1 s)',
  Math.abs(x1Linear - (x0 + x2) / 2) < 0.03,
  `${x1Linear.toFixed(3)} vs ${((x0 + x2) / 2).toFixed(3)}`,
);
await page.keyboard.press('Control+z');
it = await item();
check('undo takes the curve back', it.keyframes.x[0].ease === undefined);

// Split at 1 s: each part moves exactly as before.
await page.evaluate(() => (window as any).vuEditor.seek(705_600_000));
await page.keyboard.press('s');
const parts = await page.evaluate(
  () =>
    (window as any).vuEditor.project.tracks
      .flatMap((t: any) => t.items)
      .filter((i: any) => i.kind === 'text').length,
);
const xA = await textX(page, 0.5);
const xB = await textX(page, 1.5);
check(
  'split keeps the motion (two parts, same places)',
  parts === 2 && xA > x0 && xA < x1 && xB > x1 && xB < x2,
  `${parts} parts · ${xA.toFixed(2)}, ${xB.toFixed(2)}`,
);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
