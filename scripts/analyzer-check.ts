/**
 * Checks the media analyzer (thumbnails, waveforms, probing, cancellation) in each browser and
 * prints timings. Usage: playground running, then
 *   node scripts/analyzer-check.ts [--browsers chrome,webkit,firefox] [--port 3200] [--tier mid]
 *     [--private]   (also the owner's iPhone 4K HEVC file, if present)
 * Exits non-zero if any expectation fails.
 */
import { chromium, firefox, webkit, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const names = (arg('browsers') ?? 'chrome,webkit,firefox').split(',');
const port = arg('port') ?? '3200';
const tier = arg('tier') ?? 'mid';
const launchers = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  webkit: () => webkit.launch(),
  firefox: () => firefox.launch(),
};

const IPHONE_4K = 'private/iphone-4k60-hdr-portrait-28s.mov';
const media = join(import.meta.dirname, '..', 'test-media', 'files');
const STRIPS = [
  'avc-1080p30-60s.mp4', // 60 s 1080p, keyframe every 1 s
  'avc-4k30.mp4', // 4K, long GOP (x264 default)
  'hevc-1080p30.mp4',
  'avc-rotated.mp4',
  ...(process.argv.includes('--private') && existsSync(join(media, IPHONE_4K)) ? [IPHONE_4K] : []),
];
/** Expected max peak per file: ffmpeg volumedetect max_volume (−21.3 / −20.8 / −18.0 dBFS). */
const WAVES: Record<string, number> = {
  'music-3min.mp3': 0.086,
  'avc-1080p30-60s.mp4': 0.091,
  'voice.m4a': 0.126,
};

type Lab = NonNullable<Window['analyzerLab']>;
type Strip = Awaited<ReturnType<Lab['strip']>>;

let failures = 0;
let totalLong = 0;
let maxGap = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`    ✗ ${what}`);
  }
};

async function longTasks(page: Page) {
  return page.evaluate(() => window.analyzerLab!.longTasks());
}

for (const name of names) {
  const browser = await launchers[name as keyof typeof launchers]();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // 404s are reported with their URL below (the dev server has no favicon).
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
      errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico'))
      errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`http://localhost:${port}/lab/analyzer?tier=${tier}`);
  await page.waitForFunction(() => window.analyzerLab?.ready === true, null, { timeout: 60_000 });
  console.log(`\n===== ${name} (tier ${tier})`);

  // Warm up (first worker start + codec init) so the numbers below are steady-state.
  await page.evaluate(() => window.analyzerLab!.strip('avc-720p30.mp4', 'keyframe', 4, 64));
  await page.evaluate(() => window.analyzerLab!.resetLongTasks());

  console.log(
    `  ${'thumbnails (20 × 96 px)'.padEnd(46)} ${'mode'.padEnd(8)} ${'probe'.padStart(6)} ${'first'.padStart(6)} ${'all 20'.padStart(7)} ${'cached'.padStart(7)}  size     decoded`,
  );
  for (const file of STRIPS) {
    for (const mode of ['keyframe', 'exact'] as const) {
      await page.evaluate(() => window.analyzerLab!.resetLongTasks());
      const r: Strip = await page.evaluate(
        ([f, m]) => window.analyzerLab!.strip(f, m as 'keyframe' | 'exact'),
        [file, mode] as const,
      );
      if (r.error) {
        console.log(`  ${file.padEnd(46)} ${mode.padEnd(8)} skipped — ${r.error.slice(0, 60)}`);
        // Only acceptable reason: the browser can't decode the codec (Firefox + HEVC).
        check(r.error.startsWith('unsupported-video-codec'), `${file}: ${r.error}`);
        continue;
      }
      console.log(
        `  ${file.padEnd(46)} ${mode.padEnd(8)} ${r.probeMs.toFixed(0).padStart(4)} ms ${r.firstMs.toFixed(0).padStart(4)} ms ${r.allMs.toFixed(0).padStart(5)} ms ${r.againMs.toFixed(0).padStart(5)} ms  ${`${r.width}×${r.height}`.padEnd(8)} ${r.stats.framesDecoded} frames, peak ${r.stats.peakJobs}/${r.stats.jobBudget} jobs`,
      );
      const lt = await longTasks(page);
      totalLong += lt.count;
      maxGap = Math.max(maxGap, lt.maxRafGap);
      if (lt.count) console.log(`    ! ${lt.count} long task(s), max ${lt.max.toFixed(0)} ms`);
      check(r.nulls === 0, `${file} [${mode}]: ${r.nulls} thumbnails missing`);
      check(r.stats.openFrames === 0, `${file} [${mode}]: ${r.stats.openFrames} frames left open`);
      check(r.stats.peakJobs <= r.stats.jobBudget, `${file}: decode budget exceeded`);
      check(r.stats.cacheHits >= 20, `${file}: second strip not served from the cache`);
      check(r.stats.watchdogResets === 0, `${file}: watchdog fired`);
      if (file === 'avc-rotated.mp4')
        check(r.height > 0 && r.width < r.height, 'rotated video thumbnail not portrait');
    }
  }

  await page.evaluate(() => window.analyzerLab!.resetLongTasks());
  console.log(`  ${'waveforms'.padEnd(46)} ${'time'.padStart(8)}  peaks      envelope (tenths)`);
  for (const [file, expectedMax] of Object.entries(WAVES)) {
    const r = await page.evaluate((f) => window.analyzerLab!.waveform(f), file);
    console.log(
      `  ${file.padEnd(46)} ${r.ms.toFixed(0).padStart(5)} ms  ${String(r.peaks).padEnd(7)} @${r.peaksPerSecond}/s  max ${r.max.toFixed(2)}  [${r.envelope.join(' ')}]  cached ${r.againMs.toFixed(1)} ms`,
    );
    check(
      Math.abs(r.duration * r.peaksPerSecond - r.peaks) <= 2,
      `${file}: peaks don't cover the duration`,
    );
    check(
      Math.abs(r.max - expectedMax) < expectedMax * 0.1,
      `${file}: peak ${r.max.toFixed(3)} ≠ ${expectedMax} (ffmpeg)`,
    );
    if (file !== 'music-3min.mp3')
      check(
        r.envelope.every((e) => e > expectedMax * 0.8),
        `${file}: dip in a steady tone`,
      );
    if (file === 'music-3min.mp3') {
      // 0.5 + 0.5·sin(t) volume envelope: the samples must differ clearly.
      check(Math.max(...r.envelope) - Math.min(...r.envelope) > 0.03, 'music envelope is flat');
    }
  }

  const a = await page.evaluate(() => window.analyzerLab!.abortTest('avc-1080p30-60s.mp4'));
  console.log(
    `  abort: 30 of 40 aborted → ${a.abortedResolvedNull} resolved null, ${a.delivered} delivered in ${a.ms.toFixed(0)} ms, skipped ${a.stats.skipped}, decoded ${a.stats.framesDecoded}, open frames ${a.stats.openFrames}`,
  );
  check(a.abortedResolvedNull === 30, 'aborted thumbnails did not resolve null');
  check(a.delivered === 10, `expected 10 delivered, got ${a.delivered}`);
  check(a.stats.framesDecoded < 40, 'aborted thumbnails were decoded anyway');
  check(a.stats.openFrames === 0, 'frames left open after abort');

  const c = await page.evaluate(() =>
    window.analyzerLab!.concurrent('music-3min.mp3', 'avc-1080p30-60s.mp4'),
  );
  console.log(
    `  thumbnails during a waveform: 20 in ${c.thumbsMs.toFixed(0)} ms while the 3-min waveform took ${c.waveMs.toFixed(0)} ms (budget ${c.stats.jobBudget})`,
  );
  check(c.thumbs === 20, 'thumbnails missing while a waveform decodes');
  check(c.thumbsMs < c.waveMs, 'thumbnails waited for the whole waveform');
  check(c.stats.peakJobs <= c.stats.jobBudget, 'decode budget exceeded (concurrent)');

  const img = await page.evaluate(() => window.analyzerLab!.image('photo.jpg'));
  console.log(
    `  image: photo.jpg → ${img ? `${img.width}×${img.height} in ${img.ms.toFixed(0)} ms` : 'null'}`,
  );
  check(
    img !== null && img.height === 96 && Math.abs(img.width - 128) <= 1,
    'photo thumbnail size',
  );

  const lt = await longTasks(page);
  totalLong += lt.count;
  maxGap = Math.max(maxGap, lt.maxRafGap);
  // Browsers without the longtask API (WebKit, Firefox) only have the rAF gap to go by.
  console.log(
    `  main thread: ${totalLong} long tasks, max rAF gap ${maxGap.toFixed(0)} ms (headless rAF is coarse)`,
  );
  check(totalLong === 0, `${totalLong} main-thread long tasks`);
  totalLong = 0;
  maxGap = 0;
  check(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exitCode = failures ? 1 : 0;
