/**
 * Checks autosave + crash recovery in real browsers: edits, then (a) a reload without any explicit
 * flush, (b) a tab killed mid-burst (Chrome: renderer crash; others: page closed); then recovers
 * and compares with the exact expected state. Also media copies into OPFS and a 500-item snapshot.
 * Usage: playground running, then
 *   node scripts/storage-check.ts [--browsers chrome,webkit,firefox] [--port 3200] [--media file]
 * Exits non-zero if any expectation fails.
 */
import { chromium, firefox, webkit, type BrowserContext, type Page } from '@playwright/test';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const names = (arg('browsers') ?? 'chrome,webkit,firefox').split(',');
const port = arg('port') ?? '3200';
const mediaFile = arg('media') ?? 'avc-1080p30-60s.mp4';
const launchers = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  webkit: () => webkit.launch(),
  firefox: () => firefox.launch(),
};
const url = `http://localhost:${port}/lab/storage`;

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`    ✗ ${what}`);
  }
};

async function open(context: BrowserContext, progress?: { at: number; edits: number }[]) {
  const page = await context.newPage();
  page.on('console', (m) => {
    const match = /^edits (\d+)$/.exec(m.text());
    if (match && progress) progress.push({ at: Date.now(), edits: Number(match[1]) });
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
      console.log(`    (console) ${m.text()}`);
  });
  await page.goto(url);
  await page.waitForFunction(() => window.storageLab?.ready === true, null, { timeout: 60_000 });
  return page;
}

const lab = <T>(page: Page, fn: (l: NonNullable<Window['storageLab']>) => T | Promise<T>) =>
  page.evaluate(`(${fn.toString()})(window.storageLab)`) as Promise<T>;

for (const name of names) {
  const browser = await launchers[name as keyof typeof launchers]();
  // One context: OPFS is per context (profile), and the "reopened" tab must see the same data.
  const context = await browser.newContext();
  let page = await open(context);
  const kind = await lab(page, (l) => l.kind);
  const initMs = await lab(page, (l) => l.initMs);
  const status = await lab(page, (l) => l.status());
  console.log(
    `\n===== ${name} · ${kind} (opened in ${initMs.toFixed(0)} ms) · persistent ${status.persistent} · usage ${status.usage ?? '-'} / quota ${status.quota ?? '-'}`,
  );
  await lab(page, (l) => l.reset());
  await lab(page, (l) => l.resetLongTasks());
  let longTasks = 0;
  let maxGap = 0;
  const collect = async () => {
    const lt = await lab(page, (l) => l.longTasks());
    longTasks += lt.count;
    maxGap = Math.max(maxGap, lt.maxRafGap);
  };

  // (a) Reload without an explicit flush: the ~250 ms batch timer must have written everything.
  await lab(page, (l) => l.start());
  await lab(page, (l) => l.burst(40, 0));
  await page.waitForTimeout(1000);
  await collect();
  if (kind === 'memory') {
    const r = await lab(page, (l) => l.recover());
    console.log(
      `  memory storage (no OPFS here): in-page recovery edits ${r.edits}, exact ${r.matches}; nothing survives a reload`,
    );
    check(r.found && r.edits === 40 && r.matches, 'in-page recovery from memory storage');
    await browser.close();
    continue;
  }
  await page.reload();
  await page.waitForFunction(() => window.storageLab?.ready === true);
  let r = await lab(page, (l) => l.recover());
  console.log(
    `  reload after 40 edits: recovered ${r.edits} edits, exact ${r.matches}, ${r.warnings.length} warnings, load ${r.ms.toFixed(1)} ms`,
  );
  check(r.found && r.edits === 40 && r.matches && r.warnings.length === 0, 'reload recovery');

  // (b) Kill the tab mid-burst (an edit every 5 ms) after a random 1.5–2.5 s.
  const progress: { at: number; edits: number }[] = [];
  page.on('console', (m) => {
    const match = /^edits (\d+)$/.exec(m.text());
    if (match) progress.push({ at: Date.now(), edits: Number(match[1]) });
  });
  await lab(page, (l) => l.start());
  await lab(page, (l) => void l.burst(1000, 5));
  await page.waitForTimeout(1500 + Math.random() * 1000);
  const killedAt = Date.now();
  if (name === 'chrome') {
    const cdp = await context.newCDPSession(page);
    // Never resolves (the renderer is gone): fire and give it a moment.
    void cdp.send('Page.crash').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } else {
    await page.close({ runBeforeUnload: false });
  }
  // Edits logged at least a second before the kill must have been written (timer 250 ms).
  const durable = Math.max(
    0,
    ...progress.filter((p) => p.at <= killedAt - 1000).map((p) => p.edits),
  );
  const lastSeen = Math.max(0, ...progress.map((p) => p.edits));
  await page.close().catch(() => undefined);
  page = await open(context);
  r = await lab(page, (l) => l.recover());
  console.log(
    `  killed tab (${name === 'chrome' ? 'renderer crash' : 'closed'}) after ~${lastSeen} edits: recovered ${r.edits} (≥ ${durable} required), exact ${r.matches}, warnings [${r.warnings.join('; ')}], load ${r.ms.toFixed(1)} ms`,
  );
  check(r.found && r.matches, 'recovered state is not exactly a saved state');
  check(r.edits >= durable, `lost edits that were flushed (${r.edits} < ${durable})`);
  check(r.edits <= lastSeen + 10, 'recovered more edits than were made');

  // Media copy into OPFS (streamed in the storage worker).
  await lab(page, (l) => l.resetLongTasks());
  const m = await page.evaluate((f) => window.storageLab!.media(f), mediaFile);
  console.log(
    `  media: ${mediaFile} ${(m.bytes / 2 ** 20).toFixed(0)} MB copied in ${m.ms.toFixed(0)} ms (${(m.bytes / 2 ** 20 / (m.ms / 1000)).toFixed(0)} MB/s), round trip ${m.roundTrip}`,
  );
  check(m.roundTrip, 'media bytes differ after the round trip');
  const w = await page.evaluate((f) => window.storageLab!.writableCopy(f), mediaFile);
  console.log(
    `  for comparison, main-thread createWritable copy: ${w ? `${w.ms.toFixed(0)} ms (${(w.bytes / 2 ** 20 / (w.ms / 1000)).toFixed(0)} MB/s)` : 'not available'}`,
  );
  const big = await lab(page, (l) => l.bigSnapshot(500));
  console.log(
    `  500-item project: ${(big.bytes / 1024).toFixed(0)} KB, JSON.stringify ${big.stringifyMs.toFixed(1)} ms, attach + edit + flush ${big.saveMs.toFixed(0)} ms`,
  );
  check(big.stringifyMs < 50, 'stringify of a 500-item project took ≥ 50 ms');
  await collect();
  console.log(`  main thread: ${longTasks} long tasks, max rAF gap ${maxGap.toFixed(0)} ms`);
  check(longTasks === 0, `${longTasks} main-thread long tasks`);
  await lab(page, (l) => l.reset());
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exitCode = failures ? 1 : 0;
