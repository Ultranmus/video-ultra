/**
 * Opens the editor (/editor) at phone and desktop sizes, imports real test media through the file
 * input, selects a clip, plays, and reports page errors and main-thread long tasks. Screenshots go
 * to --shots <dir>.
 * Usage: playground running, then node scripts/editor-check.ts [--browsers chrome,webkit,firefox]
 *   [--sizes phone,desktop] [--shots dir] [--files a.mp4,b.jpg]
 */
import { chromium, firefox, webkit, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const browsers = (arg('browsers') ?? 'chrome').split(',');
const sizes = (arg('sizes') ?? 'phone,desktop').split(',');
const shots = arg('shots');
const files = (arg('files') ?? 'avc-1080p30.mp4,photo.jpg,hevc-1080p30.mp4,music.mp3')
  .split(',')
  .map((f) => resolve('test-media/files', f));
const port = arg('port') ?? '3200';

const launch = {
  chrome: () =>
    chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] }),
  webkit: () => webkit.launch(),
  firefox: () => firefox.launch(),
};
const viewports = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  tablet: { width: 820, height: 1180, isMobile: false, hasTouch: true },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
} as const;

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

let failed = false;
for (const name of browsers) {
  for (const size of sizes) {
    const browser = await launch[name as keyof typeof launch]();
    const vp = viewports[size as keyof typeof viewports];
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ...(name !== 'firefox' ? { isMobile: vp.isMobile } : {}),
      hasTouch: vp.hasTouch,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await page.addInitScript(() => {
      const w = window as unknown as {
        longTasks: { start: number; ms: number }[];
        audioStarts: { start: number; end: number }[];
      };
      w.longTasks = [];
      w.audioStarts = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries())
            w.longTasks.push({ start: e.startTime, ms: Math.round(e.duration) });
        }).observe({ type: 'longtask', buffered: true });
      } catch {
        /* not supported */
      }
      // The first AudioContext starts the browser's audio service (~120 ms in Chrome, on the main
      // thread, unavoidable): the one accepted long task (PERF.md "Startup main-thread tasks").
      const Native = window.AudioContext;
      if (Native)
        window.AudioContext = class extends Native {
          constructor(options?: AudioContextOptions) {
            const start = performance.now();
            super(options);
            w.audioStarts.push({ start, end: performance.now() });
          }
        };
    });
    const tag = `${name}-${size}`;
    const t0 = Date.now();
    await page.goto(`http://localhost:${port}/editor?autosave=0`);
    await page.waitForSelector('.vu-stage-canvas', { timeout: 30000 });
    const ready = Date.now() - t0;
    await page.waitForTimeout(500);
    await shot(page, `${tag}-0-empty`);

    await page.locator('.vu-root input[type=file][accept^="video"]').setInputFiles(files);
    await page.waitForFunction(
      () => !document.querySelector('.vu-import[data-status="working"]'),
      null,
      {
        timeout: 60000,
      },
    );
    await page.waitForTimeout(1500);
    const importErrors = await page.locator('.vu-import[data-status="error"]').allInnerTexts();
    await shot(page, `${tag}-1-imported`);

    // Select the first clip through the accessible timeline layer, open a tool.
    await page.locator('[role="option"]').first().focus();
    await page.waitForTimeout(400);
    await shot(page, `${tag}-2-selected`);
    const tool = page.locator('.vu-toolbar .vu-btn', { hasText: 'Speed' }).first();
    if (await tool.isVisible()) await tool.click();
    await page.waitForTimeout(400);
    await shot(page, `${tag}-3-tool`);

    // Play for 3 s.
    await page.keyboard.press('Escape');
    await page.locator('.vu-play').click();
    await page.waitForTimeout(3000);
    await page.locator('.vu-play').click();
    await shot(page, `${tag}-4-played`);
    const timecode = await page.locator('.vu-timecode').innerText();
    const { audio, other } = await page.evaluate(() => {
      const w = window as unknown as {
        longTasks: { start: number; ms: number }[];
        audioStarts: { start: number; end: number }[];
      };
      const isAudio = (t: { start: number; ms: number }) =>
        w.audioStarts.some((a) => a.start < t.start + t.ms && a.end > t.start);
      return {
        audio: w.longTasks.filter(isAudio).map((t) => t.ms),
        other: w.longTasks.filter((t) => !isAudio(t)).map((t) => t.ms),
      };
    });
    const clips = await page.locator('[role="option"]').count();

    console.log(
      `${tag}: ready ${ready} ms · clips ${clips} · timecode ${timecode.replace(/\s+/g, ' ')} · long tasks ${JSON.stringify(other)} (+ audio service start ${JSON.stringify(audio)}, accepted)`,
    );
    if (other.length) {
      failed = true;
      console.log(`  main-thread tasks over 50 ms (PERF.md: none): ${other.join(', ')} ms`);
    }
    if (importErrors.length) console.log(`  import errors: ${importErrors.join(' | ')}`);
    if (errors.length) {
      failed = true;
      console.log(`  errors:\n    ${errors.slice(0, 10).join('\n    ')}`);
    }
    await browser.close();
  }
}
process.exit(failed ? 1 : 0);
