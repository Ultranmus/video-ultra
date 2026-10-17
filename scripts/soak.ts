/**
 * Soak test: plays the engine lab's demo project on a loop for N minutes in the installed Chrome and
 * samples, after every pass, the engine's counters and the memory (RSS) of every process of that
 * Chrome (page, engine worker, GPU) as the OS reports it. Memory must stay flat.
 * Usage: playground running, then node scripts/soak.ts [--minutes 10]
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const minutesArg = process.argv.indexOf('--minutes');
const minutes = minutesArg > 0 ? Number(process.argv[minutesArg + 1]) : 10;

/** Total RSS (MB) of the Chrome processes Playwright started (they share a temporary profile). */
function chromeRssMb(): number {
  const out = execFileSync('ps', ['-ax', '-o', 'rss=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let kb = 0;
  for (const line of out.split('\n')) {
    if (!line.includes('playwright_chromiumdev_profile') && !line.includes('playwright-chromium'))
      continue;
    kb += Number(line.trim().split(/\s+/, 1)[0]) || 0;
  }
  return Math.round(kb / 1024);
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 600, height: 900 } });
await page.goto('http://localhost:3200/lab/engine');
await page.waitForFunction(
  () => /^Ready/.test(document.getElementById('status')!.textContent!),
  null,
  { timeout: 60000 },
);
const samples: {
  pass: number;
  rss: number;
  held: number;
  decoders: number;
  late: number;
  underruns: number;
  av95: number;
}[] = [];
const end = Date.now() + minutes * 60_000;
let pass = 0;
console.log('pass  min   RSS MB  held  decoders  late  underruns  A/V p95');
while (Date.now() < end) {
  pass++;
  // Every third pass starts mid-project (a seek), the others from the start.
  await page.evaluate((at) => window.engineLab!.seek(at), pass % 3 === 0 ? 5 : 0);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForFunction(() => window.engineLab!.ended, null, { timeout: 120_000 });
  await page.evaluate(() => {
    window.engineLab!.ended = false;
  });
  const s = await page.evaluate(() => window.engineLab!.stats());
  const sample = {
    pass,
    rss: chromeRssMb(),
    held: s.openFrames,
    decoders: s.decoders,
    late: s.late,
    underruns: s.underruns,
    av95: s.avOffsetMs?.p95 ?? -1,
  };
  samples.push(sample);
  const elapsed = ((minutes * 60_000 - (end - Date.now())) / 60_000).toFixed(1);
  console.log(
    `${String(pass).padStart(4)}  ${elapsed.padStart(4)}  ${String(sample.rss).padStart(7)}  ${String(sample.held).padStart(4)}  ${String(sample.decoders).padStart(8)}  ${String(sample.late).padStart(4)}  ${String(sample.underruns).padStart(9)}  ${sample.av95}`,
  );
}
await browser.close();
// Flat = the last third isn't meaningfully above the first third (after warm-up).
const third = Math.max(1, Math.floor(samples.length / 3));
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const early = avg(samples.slice(1, 1 + third).map((s) => s.rss));
const late = avg(samples.slice(-third).map((s) => s.rss));
console.log(
  `\nRSS: first third ${early.toFixed(0)} MB → last third ${late.toFixed(0)} MB (${(((late - early) / early) * 100).toFixed(1)}%)`,
);
console.log(
  `Totals: late frames ${samples.reduce((a, s) => a + s.late, 0)}, underruns ${samples.reduce((a, s) => a + s.underruns, 0)}, max held frames ${Math.max(...samples.map((s) => s.held))}`,
);
