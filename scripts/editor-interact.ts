/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Drives the editor (/editor) like a user with mouse and keyboard and checks each edit landed:
 * import, seek on the ruler, split, undo/redo, trim drag, add + type text, drag text on the
 * stage, delete, play. Reports pass/fail per step, page errors and main-thread long tasks.
 * Usage: playground running, then node scripts/editor-interact.ts [--browsers chrome,webkit,firefox]
 */
import { chromium, firefox, webkit, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const browsers = (arg('browsers') ?? 'chrome').split(',');
const port = arg('port') ?? '3200';
const shots = arg('shots');
const launch = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  webkit: () => webkit.launch(),
  firefox: () => firefox.launch(),
};

interface Snapshot {
  main: { id: string; duration: number; kind: string }[];
  lanes: { kind: string; items: { id: string; kind: string; x?: number; text?: string }[] }[];
  selected: string | null;
  time: number;
  pps: number;
}

async function state(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const c = (window as unknown as { vuEditor: any }).vuEditor;
    const p = c.project;
    return {
      main: p.tracks[0].items.map((i: any) => ({ id: i.id, duration: i.duration, kind: i.kind })),
      lanes: p.tracks.slice(1).map((t: any) => ({
        kind: t.kind,
        items: t.items.map((i: any) => ({
          id: i.id,
          kind: i.kind,
          x: i.transform?.x,
          text: i.text,
        })),
      })),
      selected: c.ui.getState().selectedId,
      time: c.playhead.time / 705_600_000,
      pps: c.ui.getState().pxPerSecond,
    };
  });
}

let failures = 0;
for (const name of browsers) {
  const browser = await launch[name as keyof typeof launch]();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  await page.addInitScript(() => {
    (window as unknown as { longTasks: number[] }).longTasks = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          (window as unknown as { longTasks: string[] }).longTasks.push(
            `${Math.round(e.startTime)}+${Math.round(e.duration)}`,
          );
      }).observe({ type: 'longtask' });
    } catch {
      /* unsupported */
    }
  });
  const results: string[] = [];
  const check = async (label: string, ok: boolean, detail = '') => {
    const now = Math.round(await page.evaluate(() => performance.now()));
    results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''} @${now}`);
    if (!ok) failures++;
  };

  await page.goto(`http://localhost:${port}/editor?autosave=0`);
  await page.waitForFunction(() => (window as unknown as { vuEditor?: unknown }).vuEditor);
  await page.waitForSelector('.vu-stage-canvas');
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles([
      resolve('test-media/files/avc-1080p30.mp4'),
      resolve('test-media/files/photo.jpg'),
    ]);
  await page.waitForFunction(
    () => (window as unknown as { vuEditor: any }).vuEditor.project.tracks[0].items.length === 2,
    null,
    { timeout: 30000 },
  );
  let s = await state(page);
  await check('import 2 files', s.main.length === 2);

  // Seek: click the ruler at 2 s.
  const canvas = page.locator('.vu-timeline-canvas canvas');
  const box = (await canvas.boundingBox())!;
  const x0 = box.x + 40 + 16;
  await page.mouse.click(x0 + 2 * s.pps, box.y + 10);
  await page.waitForTimeout(100);
  s = await state(page);
  await check('ruler seek to 2 s', Math.abs(s.time - 2) < 0.1, `${s.time.toFixed(2)} s`);

  await page.keyboard.press('s');
  s = await state(page);
  await check('split at playhead', s.main.length === 3);
  await page.keyboard.press('ControlOrMeta+z');
  s = await state(page);
  await check('undo split', s.main.length === 2);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  s = await state(page);
  await check('redo split', s.main.length === 3);

  // Select the first clip and drag its end trim handle 40 px to the left.
  const rowY = box.y + 24 + 4 + 28;
  await page.mouse.click(x0 + 1 * s.pps, rowY);
  s = await state(page);
  await check('click selects clip', s.selected === s.main[0]!.id);
  const before = s.main[0]!.duration;
  const endX = x0 + 2 * s.pps + 5;
  await page.mouse.move(endX, rowY);
  await page.mouse.down();
  await page.mouse.move(endX - 20, rowY, { steps: 4 });
  await page.mouse.move(endX - 40, rowY, { steps: 4 });
  await page.mouse.up();
  s = await state(page);
  const trimmed = (before - s.main[0]!.duration) / 705_600_000;
  await check('trim end handle', trimmed > 0.4 && trimmed < 0.9, `${trimmed.toFixed(2)} s shorter`);

  // Lane header icon toggles the main track's sound.
  await page.mouse.click(box.x + 20, rowY);
  const muted = await page.evaluate(() => (window as any).vuEditor.project.tracks[0].muted);
  await page.mouse.click(box.x + 20, rowY);
  const unmuted = await page.evaluate(() => !(window as any).vuEditor.project.tracks[0].muted);
  await check('lane header mute toggle', muted && unmuted);

  // Add text and type.
  await page.locator('.vu-rail .vu-tool', { hasText: 'Text' }).click();
  await page.locator('.vu-panel .vu-primary', { hasText: 'Add text' }).click();
  await page.waitForTimeout(200);
  s = await state(page);
  const text = s.lanes.find((l) => l.kind === 'text')?.items[0];
  await check('add text', !!text && s.selected === text.id);
  const area = page.locator('.vu-textarea');
  if (await area.isVisible()) {
    await area.fill('Hello there');
    s = await state(page);
    await check(
      'type text',
      s.lanes.find((l) => l.kind === 'text')?.items[0]?.text === 'Hello there',
    );
  } else await check('type text', false, 'no textarea');

  // Drag the text on the stage 60 px right.
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy, { steps: 5 });
  await page.mouse.move(cx + 60, cy, { steps: 5 });
  await page.mouse.up();
  s = await state(page);
  const moved = s.lanes.find((l) => l.kind === 'text')?.items[0]?.x ?? 0.5;
  await check('drag text on stage', moved > 0.55, `x ${moved.toFixed(3)}`);
  await page.keyboard.press('ControlOrMeta+z');
  s = await state(page);
  await check(
    'undo stage drag = one step',
    (s.lanes.find((l) => l.kind === 'text')?.items[0]?.x ?? 0) === 0.5,
  );

  if (shots) await page.screenshot({ path: `${shots}/interact-${name}.png` });

  await page.locator('.vu-stage').click({ position: { x: 5, y: 5 } });
  await page.mouse.click(cx, cy);
  await page.keyboard.press('Delete');
  s = await state(page);
  await check('delete selection', !s.lanes.some((l) => l.kind === 'text'));

  await page.keyboard.press('Home');
  await page.locator('.vu-play').click();
  await page.waitForTimeout(2000);
  await page.locator('.vu-play').click();
  s = await state(page);
  await check('play advances', s.time > 1.5, `${s.time.toFixed(2)} s`);
  const stats = await page.evaluate(() =>
    (window as unknown as { vuEditor: any }).vuEditor.engine.stats(),
  );
  const longTasks = await page.evaluate(
    () => (window as unknown as { longTasks: number[] }).longTasks,
  );

  console.log(`\n===== ${name}`);
  console.log(results.join('\n'));
  console.log(
    `presented ${stats.presented} late ${stats.late} openFrames ${stats.openFrames} · long tasks ${JSON.stringify(longTasks)}`,
  );
  if (errors.length) {
    failures++;
    console.log(`errors:\n  ${errors.slice(0, 8).join('\n  ')}`);
  }
  await browser.close();
}
process.exit(failures ? 1 : 0);
