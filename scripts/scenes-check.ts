/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Scene detection + auto-split (v0.4) in a real browser: real footage cut at 3 s, 6 s and 8 s
 * splits into exactly those 4 clips (one undo step), also at 2× speed and trimmed; a real trailer
 * (52 s, many shots) splits where the shots change and a continuous clip doesn't split; Cancel
 * stops it; no decoded frame is left open, no long task on the main thread; axe on the section;
 * the phone toolbar has the tool.
 * Usage: playground running, then node scripts/scenes-check.ts [--port 3200]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const clips = (page: Page) =>
  page.evaluate(() =>
    (window as any).vuEditor.project.tracks[0].items.map(
      (i: any) => +(i.start / 705_600_000).toFixed(3),
    ),
  );

async function load(page: Page, file: string) {
  await page.goto(`http://localhost:${port}/editor?autosave=0`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles([resolve('test-media/files', file)]);
  await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);
  await page.evaluate(() => {
    (window as any).longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as any).longTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask' });
  });
}

const split = async (page: Page, sensitivity?: string) => {
  const t0 = Date.now();
  await page.evaluate(
    (s) =>
      (window as any).vuEditor.splitAtScenes(
        (window as any).vuEditor.project.tracks[0].items[0].id,
        s,
      ),
    sensitivity,
  );
  return (Date.now() - t0) / 1000;
};

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

// 1. Known cuts, through the inspector's button.
await load(page, 'scenes-cuts.mp4');
await page.evaluate(() => {
  const c = (window as any).vuEditor;
  c.select(c.project.tracks[0].items[0].id);
});
await page.locator('.vu-section-toggle', { hasText: 'Split at scenes' }).click();
const axe = await new AxeBuilder({ page }).include('.vu-inspector').analyze();
check(
  'Split at scenes section passes axe',
  axe.violations.length === 0,
  axe.violations.map((v) => v.id).join(', '),
);
const t0 = Date.now();
await page.locator('.vu-inspector .vu-btn', { hasText: 'Split at scenes' }).click();
await page.waitForFunction(
  () => (window as any).vuEditor.project.tracks[0].items.length > 1,
  null,
  {
    timeout: 60000,
  },
);
const took = (Date.now() - t0) / 1000;
check(
  'real footage cut at 3, 6, 8 s splits there exactly',
  JSON.stringify(await clips(page)) === '[0,3,6,8]',
  `${JSON.stringify(await clips(page))} in ${took.toFixed(1)} s`,
);
await page.evaluate(() => (window as any).vuEditor.undo());
check('one undo step brings the clip back', (await clips(page)).length === 1);

// 2. At 2× speed and trimmed to start at 1 s of the media: cuts at (3-1)/2, (6-1)/2, (8-1)/2.
await page.evaluate(() => {
  const c = (window as any).vuEditor;
  c.run('t', (d: any) => {
    const i = d.tracks[0].items[0];
    i.speed = 2;
    i.sourceIn = 705_600_000;
    i.duration = 4.5 * 705_600_000;
  });
});
await split(page);
check(
  '2× speed, trimmed: cuts land where the clip shows them',
  JSON.stringify(await clips(page)) === '[0,1,2.5,3.5]',
  JSON.stringify(await clips(page)),
);

// 3. Cancel.
await page.evaluate(() => (window as any).vuEditor.undo());
const cancelled = await page.evaluate(async () => {
  const c = (window as any).vuEditor;
  const run = c.splitAtScenes(c.project.tracks[0].items[0].id);
  await new Promise((r) => setTimeout(r, 30));
  c.cancelSceneDetection();
  return {
    result: await run,
    clips: c.project.tracks[0].items.length,
    job: c.ui.getState().sceneJob,
  };
});
check(
  'Cancel stops it, nothing changes',
  cancelled.result === null && cancelled.clips === 1 && cancelled.job === null,
  JSON.stringify(cancelled),
);

const stats = async () => {
  await page.waitForTimeout(300);
  return page.evaluate(() => (window as any).vuEditor.analyzer.stats());
};
let s = await stats();
check(
  'no decoded frame left open',
  s.openFrames === 0,
  `${s.openFrames} open, ${s.framesDecoded} decoded`,
);

// 4. A real trailer with many shots.
await load(page, 'sintel-trailer-480p.mp4');
const trailerTook = await split(page);
const trailer = await clips(page);
// Reference (ffmpeg scene filter + a look at the frames): 16.5, 17.5, 23.8, 25.9, 27.4, 28.0.
const want = [16.5, 17.5, 23.792, 25.875, 27.417, 28];
const found = trailer.slice(1);
const hits = want.filter((w) => found.some((f: number) => Math.abs(f - w) < 0.05)).length;
check(
  'Sintel trailer: splits at the shot changes',
  hits === want.length && found.length <= want.length + 1,
  `${JSON.stringify(found)} in ${trailerTook.toFixed(1)} s (52 s of video)`,
);
const longTasks: number[] = await page.evaluate(() => (window as any).longTasks);
check(
  'no main-thread task over 50 ms while it runs',
  longTasks.every((t) => t <= 50),
  JSON.stringify(longTasks),
);

// 5. A continuous real clip: no cut.
await load(page, 'bbb-1080p60.mp4');
const parts = await page.evaluate(() => {
  const c = (window as any).vuEditor;
  return c.splitAtScenes(c.project.tracks[0].items[0].id, 'high');
});
check(
  'one continuous shot (1080p60) isn’t split, even on "small changes too"',
  parts === 1,
  String(parts),
);
s = await stats();
check('no decoded frame left open after all', s.openFrames === 0, `${s.sceneRuns} runs`);
check('no page errors', errors.length === 0, errors.join(' | '));

// 6. Phone: the tool is in the clip's toolbar.
{
  const iphone: Record<string, unknown> = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  const phone = await (await browser.newContext(iphone)).newPage();
  await load(phone, 'scenes-cuts.mp4');
  await phone.evaluate(() => {
    const c = (window as any).vuEditor;
    c.select(c.project.tracks[0].items[0].id);
  });
  await phone.locator('.vu-toolbar button', { hasText: 'Split at scenes' }).first().tap();
  await phone.locator('.vu-btn[data-variant=primary]', { hasText: 'Split at scenes' }).tap();
  await phone.waitForFunction(
    () => (window as any).vuEditor.project.tracks[0].items.length === 4,
    null,
    {
      timeout: 60000,
    },
  );
  check('phone: Split at scenes from the toolbar', true);
}
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
