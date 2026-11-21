/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Background removal (v0.3) in a real browser, with the real on-device models: a portrait photo
 * → Remove background → the photo shows only the person (exported pixels: the background is
 * gone, the person stays), Restore brings it back, undo works; time and the browser's memory
 * (renderer + workers) per model. Needs the network the first time (model download).
 * Usage: playground running, then node scripts/cutout-check.ts <portrait.jpg> [--port 3200]
 *   [--model people|objects] [--shots <dir>]
 */
import { chromium, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
// The photo is the first argument that isn't an option or an option's value. It must be a real
// portrait: a person in the middle against a light background (the left fifth is measured). The
// test library has none (its photo.jpg is a colour chart, which can't show either), so there
// is no default — stop and say so rather than fail on a picture that can't pass.
const given = process.argv
  .slice(2)
  .find((a, i, all) => !a.startsWith('--') && (i === 0 || !all[i - 1]!.startsWith('--')));
if (!given) {
  console.error(
    'cutout-check needs a portrait photo: a person in the middle, a light background.\n' +
      'Usage: node scripts/cutout-check.ts <portrait.jpg> [--port 3200] [--model people|objects] [--shots <dir>]',
  );
  process.exit(2);
}
const photo = resolve(given);
const port = arg('port') ?? '3200';
const model = arg('model') ?? 'auto';
const shots = arg('shots');
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

/** RSS of this test browser's processes (MB): the renderer (page + its workers) and all. */
function memory(): { renderer: number; total: number } {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='])
    .toString()
    .trim()
    .split('\n')
    .map((l) => {
      const [pid, ppid, kb, ...c] = l.trim().split(/\s+/);
      return { pid: +pid!, ppid: +ppid!, mb: +kb! / 1024, cmd: c.join(' ') };
    });
  const root = rows.find((r) => r.cmd.includes('--vu-cutout-probe') && !r.cmd.includes('--type='));
  const tree = new Set([root?.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows)
      if (!tree.has(r.pid) && tree.has(r.ppid)) {
        tree.add(r.pid);
        grew = true;
      }
  }
  const mine = rows.filter((r) => tree.has(r.pid));
  return {
    renderer: Math.max(
      0,
      ...mine.filter((r) => r.cmd.includes('--type=renderer')).map((r) => r.mb),
    ),
    total: mine.reduce((a, r) => a + r.mb, 0),
  };
}

/** The exact frame at 1 s as RGBA (project size). */
const frame = (page: Page) =>
  page.evaluate(async () => {
    const c = (window as any).vuEditor;
    c.seek(705_600_000);
    const img = await c.saveFrame({ format: 'png', height: 640 });
    const bmp = await createImageBitmap(img.blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const g = canvas.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    return {
      w: bmp.width,
      h: bmp.height,
      data: Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data),
    };
  });

const browser = await chromium.launch({ channel: 'chrome', args: ['--vu-cutout-probe'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/editor?autosave=0&cutout=${model}`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
// A 16:9 canvas so the landscape photo fills it.
await page.evaluate(() =>
  (window as any).vuEditor.run('ratio', (d: any) => {
    d.settings.width = 1920;
    d.settings.height = 1080;
  }),
);
await page.locator('.vu-root input[type=file][accept^="video"]').setInputFiles([photo]);
await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);
await page.evaluate(() => {
  const c = (window as any).vuEditor;
  c.select(c.project.tracks[0].items[0].id);
});
const before = await frame(page);
const base = memory();
let peak = base;
const timer = setInterval(() => {
  const m = memory();
  if (m.renderer > peak.renderer) peak = m;
}, 200);
const t0 = Date.now();
await page.locator('.vu-btn', { hasText: 'Remove background' }).first().click();
await page.waitForFunction(
  () => {
    const c = (window as any).vuEditor;
    return !!c.project.tracks[0].items[0].cutout || c.ui.getState().cutoutJob === null;
  },
  null,
  { timeout: 600000, polling: 500 },
);
await page.waitForFunction(() => (window as any).vuEditor.ui.getState().cutoutJob === null, null, {
  timeout: 600000,
});
const seconds = (Date.now() - t0) / 1000;
clearInterval(timer);
await page.waitForTimeout(1500);
const after = memory();
const cut = await page.evaluate(
  () => (window as any).vuEditor.project.tracks[0].items[0].cutout ?? null,
);
check('Remove background makes a cutout', !!cut, errors.join(' | '));
if (cut) {
  const now = await frame(page);
  if (shots) await page.screenshot({ path: `${shots}/cutout-${model}.png` });
  // Background: the left fifth of the photo (wall, sky); the person: the middle column.
  const luma = (img: typeof now, x0: number, x1: number, y0: number, y1: number) => {
    let s = 0;
    let n = 0;
    for (let y = Math.round(y0 * img.h); y < y1 * img.h; y += 2)
      for (let x = Math.round(x0 * img.w); x < x1 * img.w; x += 2) {
        const i = (y * img.w + x) * 4;
        s += (img.data[i]! + img.data[i + 1]! + img.data[i + 2]!) / 3;
        n++;
      }
    return s / n;
  };
  const bgBefore = luma(before, 0.02, 0.2, 0.1, 0.9);
  const bgAfter = luma(now, 0.02, 0.2, 0.1, 0.9);
  const subjBefore = luma(before, 0.42, 0.5, 0.2, 0.5);
  const subjAfter = luma(now, 0.42, 0.5, 0.2, 0.5);
  check(
    'the background is gone (the black canvas shows)',
    bgBefore > 60 && bgAfter < 15,
    `${bgBefore.toFixed(0)} → ${bgAfter.toFixed(0)}`,
  );
  check(
    'the person stays',
    Math.abs(subjAfter - subjBefore) < 25,
    `${subjBefore.toFixed(0)} → ${subjAfter.toFixed(0)}`,
  );
  await page.locator('.vu-btn', { hasText: 'Restore background' }).first().click();
  const restored = await page.evaluate(
    () => !(window as any).vuEditor.project.tracks[0].items[0].cutout,
  );
  check('Restore background brings it back', restored);
  await page.keyboard.press('Control+z');
  const again = await page.evaluate(
    () => !!(window as any).vuEditor.project.tracks[0].items[0].cutout,
  );
  check('undo of Restore removes it again', again);
}
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(
  `model ${model}: ${seconds.toFixed(1)} s (incl. first download) · renderer ${base.renderer.toFixed(0)} → peak ${peak.renderer.toFixed(0)} → after ${after.renderer.toFixed(0)} MB · all ${base.total.toFixed(0)} → ${peak.total.toFixed(0)} MB`,
);
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
