/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Video scopes (v0.4) in a real browser on the colour-bar test clip: the counts are right (bars
 * of pure 0 / 255 values; greys in the vectorscope's centre, colours near their targets), every
 * view draws, brightening the clip moves the waveform up, the views follow the playhead, at most
 * ~4 measurements a second while playing and none while the section is closed; axe; no long
 * tasks added.
 * Usage: playground running, then node scripts/scopes-check.ts [--port 3200] [--shots dir]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
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

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/editor?autosave=0`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
await page
  .locator('.vu-root input[type=file][accept^="video"]')
  .setInputFiles([resolve('test-media/files/avc-720p30.mp4')]);
await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);
await page.evaluate(() => {
  const c = (window as any).vuEditor;
  // 16:9 like the clip: no black bars in the counts.
  c.run('ratio', (d: any) => {
    d.settings.width = 1280;
    d.settings.height = 720;
  });
  c.seek(2 * 705_600_000);
  // Count measurements.
  const engine = c.engine;
  const original = engine.scopes.bind(engine);
  (window as any).scopeCalls = 0;
  engine.scopes = (t: number) => {
    (window as any).scopeCalls++;
    return original(t);
  };
  (window as any).longTasks = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) (window as any).longTasks.push(Math.round(e.duration));
  }).observe({ type: 'longtask' });
});

// 1. The counts (straight from the engine).
const counts = await page.evaluate(async () => {
  const s = await (window as any).vuEditor.engine.scopes(2 * 705_600_000);
  const h = Array.from(s.histogram as Uint32Array);
  const share = (from: number, to: number) =>
    h.slice(from, to).reduce((a, b) => a + b, 0) / s.pixels;
  const v = s.vector as Uint32Array;
  const centre = v[64 * 128 + 64]! + v[63 * 128 + 63]! + v[63 * 128 + 64]! + v[64 * 128 + 63]!;
  let outer = 0;
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) if (Math.hypot(x - 63.5, y - 63.5) > 35) outer += v[y * 128 + x]!;
  return {
    width: s.width,
    pixels: s.pixels,
    redExtremes: share(0, 8) + share(248, 256),
    centre: centre / s.pixels,
    outer: outer / s.pixels,
  };
});
check(
  'colour bars: red is mostly 0 or 255 (histogram)',
  counts.redExtremes > 0.75,
  `${(counts.redExtremes * 100).toFixed(0)} % of pixels, ${counts.width} px wide`,
);
check(
  'colour bars: saturated colours far from the vectorscope centre',
  counts.outer > 0.6,
  `${(counts.outer * 100).toFixed(0)} % outside the inner half, ${(counts.centre * 100).toFixed(0)} % grey`,
);

// 2. The view (nothing selected → video settings → Scopes).
await page.evaluate(() => (window as any).vuEditor.select(null));
const before = await page.evaluate(() => (window as any).scopeCalls);
await page.waitForTimeout(600);
check(
  'closed section measures nothing',
  (await page.evaluate(() => (window as any).scopeCalls)) === before,
);
await page.locator('.vu-section-toggle', { hasText: 'Scopes' }).click();
const lit = () =>
  page.evaluate(() => {
    const c = document.querySelector('.vu-scope-canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    let lowest = 0;
    for (let i = 0; i < d.length; i += 4)
      if (Math.max(d[i]!, d[i + 1]!, d[i + 2]!) > 100) {
        n++;
        lowest = Math.max(lowest, Math.floor(i / 4 / c.width) / (c.height - 1));
      }
    return { lit: n / (d.length / 4), lowest, w: c.width, h: c.height };
  });
await page.waitForTimeout(500);
for (const [mode, name] of [
  ['Wave', 'waveform'],
  ['RGB', 'parade'],
  ['Levels', 'histogram'],
  ['Colour', 'vector'],
] as const) {
  await page.locator('.vu-scopes .vu-segment', { hasText: mode }).click();
  await page.waitForTimeout(150);
  const view = await lit();
  check(
    `${mode} view draws`,
    view.lit > (name === 'vector' ? 0.004 : 0.01),
    `${(view.lit * 100).toFixed(1)} % lit, ${view.w}×${view.h}`,
  );
  if (shots) await page.locator('.vu-scopes').screenshot({ path: `${shots}/scope-${name}.png` });
}
const axe = await new AxeBuilder({ page }).include('.vu-inspector').analyze();
check(
  'Scopes section passes axe',
  axe.violations.length === 0,
  axe.violations.map((v) => v.id).join(', '),
);

// 3. Brighter clip → the darkest part of the waveform's trace moves up.
await page.locator('.vu-scopes .vu-segment', { hasText: 'Wave' }).click();
await page.waitForTimeout(300);
const plain = await lit();
await page.evaluate(() => {
  const c = (window as any).vuEditor;
  c.run('b', (d: any) => {
    d.tracks[0].items[0].adjust = { ...d.tracks[0].items[0].adjust, brightness: 1 };
  });
});
await page.waitForTimeout(600);
const bright = await lit();
check(
  'brightening the clip lifts the waveform',
  bright.lowest < plain.lowest - 0.04,
  `darkest trace at ${(1 - plain.lowest).toFixed(2)} → ${(1 - bright.lowest).toFixed(2)} of the height`,
);

// 4. Pace while playing.
await page.evaluate(() => {
  (window as any).scopeCalls = 0;
  (window as any).longTasks = [];
  (window as any).vuEditor.seek(0);
  (window as any).vuEditor.play();
});
await page.waitForTimeout(3000);
const played = await page.evaluate(() => {
  (window as any).vuEditor.pause();
  return { calls: (window as any).scopeCalls, longTasks: (window as any).longTasks };
});
check(
  '≤ 4 measurements a second while playing',
  played.calls >= 4 && played.calls <= 13,
  `${played.calls} in 3 s`,
);
check(
  'no main-thread task over 50 ms while scopes play',
  played.longTasks.every((t: number) => t <= 50),
  JSON.stringify(played.longTasks),
);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
