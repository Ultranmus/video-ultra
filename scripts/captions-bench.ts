/**
 * Captions speed / accuracy / memory (v0.2 A0): runs the speech clips (scripts/speech-media.ts)
 * through the on-device transcriber in a real browser, per model and runtime, and prints a table
 * plus the browser's peak memory (all its processes, sampled every 250 ms).
 * Usage: playground running, then node scripts/captions-bench.ts
 *   [--browser chrome|webkit|firefox] [--models tiny,base] [--devices webgpu,wasm]
 *   [--files speech-en-gb.m4a,...] [--language auto] [--throttle 4] [--port 3200]
 */
import { chromium, firefox, webkit, type Browser } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const browserName = arg('browser') ?? 'chrome';
const models = (arg('models') ?? 'tiny,base').split(',');
const devices = (arg('devices') ?? 'webgpu,wasm').split(',');
const files = (
  arg('files') ?? 'speech-en-gb.m4a,speech-en-in.m4a,speech-hi.m4a,speech-en-music.m4a'
).split(',');
const forced = arg('language');
const throttle = Number(arg('throttle') ?? 1);
const debug = arg('debug') ? (JSON.parse(arg('debug')!) as Record<string, unknown>) : undefined;
const manifest = JSON.parse(
  readFileSync(resolve('test-media/files/speech.json'), 'utf8'),
) as Record<string, { text: string; language: string; seconds: number }>;

async function launch(): Promise<Browser> {
  if (browserName === 'webkit') return webkit.launch();
  if (browserName === 'firefox') return firefox.launch();
  return chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] });
}

/** Resident memory of every process of the browser we launched (MB). */
function browserMemoryMB(rootPid: number): number {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='])
    .toString()
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number) as [number, number, number]);
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const rss = new Map(rows.map(([pid, , kb]) => [pid, kb]));
  let total = 0;
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop()!;
    total += rss.get(pid) ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return Math.round(total / 1024);
}

/** The biggest processes of the tree (MB and a short name), for where memory goes. */
function topProcesses(rootPid: number): string {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='])
    .toString()
    .trim()
    .split('\n')
    .map((l) => {
      const [pid, ppid, kb, ...cmd] = l.trim().split(/\s+/);
      const type = /--type=([a-z-]+)/.exec(cmd.join(' '))?.[1] ?? 'browser';
      const util = /--utility-sub-type=([a-z.]+)/.exec(cmd.join(' '))?.[1];
      return { pid: Number(pid), ppid: Number(ppid), mb: Number(kb) / 1024, name: util ?? type };
    });
  const inTree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows)
      if (!inTree.has(r.pid) && inTree.has(r.ppid)) {
        inTree.add(r.pid);
        grew = true;
      }
  }
  return rows
    .filter((r) => inTree.has(r.pid))
    .sort((a, b) => b.mb - a.mb)
    .slice(0, 4)
    .map((r) => `${r.name} ${Math.round(r.mb)}`)
    .join(', ');
}

/** The browser's main process: the newest process tree started after `since` with our flags. */
function findBrowserPid(): number | null {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,command=']).toString().split('\n');
  const mine = out.filter((l) =>
    browserName === 'chrome'
      ? /Google Chrome(?! Helper).*--enable-unsafe-webgpu/.test(l)
      : browserName === 'webkit'
        ? /pw_run\.sh|Playwright\.app|MiniBrowser/.test(l)
        : /firefox.*-juggler/.test(l),
  );
  const pid = Number(mine.at(-1)?.trim().split(/\s+/)[0]);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

const browser = await launch();
const context = await browser.newContext();
const pid = findBrowserPid();
const rows: string[] = [];
const repeat = Number(arg('repeat') ?? 1);
for (const model of models.flatMap((m) => Array<string>(repeat).fill(m))) {
  for (const device of devices) {
    const page = await context.newPage();
    if (throttle > 1 && browserName === 'chrome') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    }
    await page.goto(`http://localhost:${port}/lab/captions`);
    await page.waitForFunction(
      () => (window as unknown as { captionsReady?: boolean }).captionsReady,
    );
    const base = pid ? browserMemoryMB(pid) : 0;
    let peak = base;
    let peakTop = '';
    const sampler = setInterval(() => {
      if (!pid) return;
      const now = browserMemoryMB(pid);
      if (now > peak) {
        peak = now;
        peakTop = topProcesses(pid);
      }
    }, 250);
    for (const file of files) {
      // Files without a reference (test-media/files/real/, private/): word counts only.
      const ref = manifest[file.replace(/\.m4a$/, '')] ?? {
        text: '',
        language: forced ?? 'auto',
        seconds: 0,
      };
      const result = await page.evaluate(
        (config) =>
          (
            window as unknown as { runCaptions: (c: unknown) => Promise<Record<string, unknown>> }
          ).runCaptions(config),
        { file, model, device, language: forced ?? ref.language, reference: ref.text, debug },
      );
      rows.push(
        [
          model,
          device,
          file,
          `load ${result.loadMs} ms`,
          `${result.transcribeMs} ms`,
          `${result.realtime}× real time`,
          `WER ${result.wer}`,
          `${result.words} words`,
          `${result.firstWordStart}–${result.lastWordEnd} s`,
          result.error ? `ERROR ${result.error}` : `"${String(result.firstWords).slice(0, 50)}"`,
        ].join(' | '),
      );
      console.log(rows.at(-1));
    }
    clearInterval(sampler);
    rows.push(
      `${model} ${device}: browser memory ${base} → peak ${peak} MB (+${peak - base}); top: ${peakTop}`,
    );
    console.log(rows.at(-1));
    await page.close();
  }
}
await browser.close();
