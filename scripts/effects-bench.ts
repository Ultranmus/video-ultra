/**
 * GPU draw cost of the heaviest transitions (and two baselines): /lab/engine?bench=1 draws each
 * at its midpoint on a 1080×1920 canvas (two full-screen photo layers + overlay) in batches timed
 * to a forced read-back, per backend, and this prints ms per frame.
 * Usage: playground running, then node scripts/effects-bench.ts [--browsers chrome,webkit,firefox]
 *   [--frames 60]
 */
import { chromium, firefox, webkit } from '@playwright/test';

const BASE = process.env.PLAYGROUND ?? 'http://localhost:3200';
const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const names = (arg('browsers') ?? 'chrome,webkit,firefox').split(',');
const frames = Number(arg('frames') ?? 60);
const launch = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  webkit: () => webkit.launch(),
  firefox: () => firefox.launch(),
};

const columns: Record<string, Record<string, number>> = {};
for (const name of names) {
  const browser = await launch[name as keyof typeof launch]();
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/engine?bench=1&frames=${frames}`);
  await page.waitForFunction(
    () => /Bench done|FAILED|error/i.test(document.getElementById('status')!.textContent!),
    null,
    { timeout: 300000 },
  );
  const report = (await page.evaluate(() => window.benchReport ?? {})) as Record<
    string,
    Record<string, number>
  >;
  await browser.close();
  for (const [backend, row] of Object.entries(report)) columns[`${name} ${backend}`] = row;
}
const keys = Object.keys(columns);
const cases = Object.keys(columns[keys[0]!] ?? {});
console.log(`ms per 1080×1920 frame (${frames}-frame batches, best of 3)\n`);
console.log(`| case | ${keys.join(' | ')} |`);
console.log(`| --- | ${keys.map(() => '---:').join(' | ')} |`);
for (const c of cases)
  console.log(`| ${c} | ${keys.map((k) => columns[k]![c]?.toFixed(2) ?? '–').join(' | ')} |`);
