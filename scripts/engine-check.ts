/**
 * Plays the engine lab's demo project (5 main clips incl. photo + rotated portrait, PIP video,
 * transparent PNG; 9:16) start to end and reports the engine's stats and main-thread long tasks.
 * Usage: playground running, then node scripts/engine-check.ts [--browsers chrome,webkit] [--shots dir]
 */
import { chromium, webkit } from '@playwright/test';

/** Playground URL (PLAYGROUND=http://localhost:3301 when another dev server uses 3200). */
const BASE = process.env.PLAYGROUND ?? 'http://localhost:3200';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const names = (arg('browsers') ?? 'chrome,webkit').split(',');
const shots = arg('shots');
/** CPU slowdown factor (Chrome only) to imitate a budget phone, e.g. --throttle 6. */
const throttle = Number(arg('throttle') ?? 1);
const launch = {
  chrome: () =>
    chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] }),
  webkit: () => webkit.launch(),
};

for (const name of names) {
  for (const backend of name === 'chrome' ? ['webgpu', 'webgl2'] : ['webgl2']) {
    const browser = await launch[name as keyof typeof launch]();
    const page = await browser.newPage({ viewport: { width: 600, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    if (throttle > 1 && name === 'chrome') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    }
    await page.goto(`${BASE}/lab/engine?backend=${backend}`);
    await page.waitForFunction(
      () => /^Ready|FAILED/.test(document.getElementById('status')!.textContent!),
      null,
      { timeout: 60000 },
    );
    const status = await page.locator('#status').innerText();
    console.log(`\n===== ${name} · ${status}`);
    if (status.startsWith('FAILED')) {
      console.log(errors.join('\n'));
      await browser.close();
      continue;
    }
    if (shots) {
      await page.evaluate(() => window.engineLab!.seek(3));
      await page.waitForTimeout(1500);
      await page
        .locator('canvas')
        .screenshot({ path: `${shots}/engine-${name}-${backend}-3s.png` });
    }
    await page
      .evaluate(() => {
        (window as unknown as { longTasks: number[] }).longTasks = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries())
            (window as unknown as { longTasks: number[] }).longTasks.push(e.duration);
        }).observe({ type: 'longtask' });
      })
      .catch(() => undefined);
    await page.evaluate(() => window.engineLab!.seek(0));
    // Play with a real click: sound may only start inside a user gesture (as on phones).
    await page.getByRole('button', { name: 'Play' }).click();
    const duration = await page.evaluate(() => window.engineLab!.duration);
    const t0 = Date.now();
    await page.waitForFunction(() => window.engineLab!.ended, null, {
      timeout: (duration + 20) * 1000,
    });
    const wall = (Date.now() - t0) / 1000;
    const stats = await page.evaluate(() => window.engineLab!.stats());
    const longTasks = await page.evaluate(
      () => (window as unknown as { longTasks?: number[] }).longTasks ?? [],
    );
    const expected = Math.round(duration * 30);
    console.log(
      `  played ${duration.toFixed(1)} s in ${wall.toFixed(1)} s · frames ${stats.presented}/${expected} · late ${stats.late} · skipped ${stats.skipped}${stats.lateAt.length ? ` (${stats.lateAt.join(', ')} s)` : ''}`,
    );
    console.log(
      `  last frame: gather ${stats.gatherMs.toFixed(1)} ms, draw ${stats.drawMs.toFixed(2)} ms · decoders ${stats.decoders}/${stats.decoderBudget} · held frames ${stats.openFrames} · preview ${stats.previewWidth}×${stats.previewHeight} (quality ${stats.previewQuality}, ${stats.qualityChanges} changes)`,
    );
    console.log(
      `  audio: ${stats.audio ? `on · underruns ${stats.underruns} · A/V offset p50 ${stats.avOffsetMs?.p50 ?? '-'} / p95 ${stats.avOffsetMs?.p95 ?? '-'} / max ${stats.avOffsetMs?.max ?? '-'} ms` : 'off'}`,
    );
    console.log(
      `  main thread long tasks: ${longTasks.length}${longTasks.length ? ` (max ${Math.round(Math.max(...longTasks))} ms)` : ''}${errors.length ? `\n  errors: ${errors.slice(0, 5).join(' | ')}` : ''}`,
    );
    await browser.close();
  }
}
