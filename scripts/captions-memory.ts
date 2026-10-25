/* eslint-disable @typescript-eslint/no-explicit-any -- reads the lab page through window */
/**
 * Captions memory over time (v0.2 A0): the test browser's own processes only (renderer = page +
 * speech worker), sampled every 200 ms through two runs and 3 s after.
 * Usage: playground running, then node scripts/captions-memory.ts [wasm|webgpu] [tiny|base]
 *   [file] [session-options-json] [files-json, e.g. {"encoder":"encoder_model_q4.onnx",…}]
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const device = process.argv[2] ?? 'wasm';
const model = process.argv[3] ?? 'tiny';
const file = process.argv[4] ?? 'speech-en-gb.m4a';
const session = process.argv[5] ? JSON.parse(process.argv[5]) : undefined;
const files = process.argv[6] ? JSON.parse(process.argv[6]) : undefined;
const speech = JSON.parse(readFileSync('test-media/files/speech.json', 'utf8'));
const reference: string = speech[file.replace(/\.m4a$/, '')]?.text ?? '';
const b = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-unsafe-webgpu', '--vu-mem-probe'],
});
const p = await (await b.newContext()).newPage();
const tree = () => {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='])
    .toString()
    .trim()
    .split('\n')
    .map((l) => {
      const [pid, ppid, kb, ...c] = l.trim().split(/\s+/);
      return { pid: +pid!, ppid: +ppid!, mb: +kb! / 1024, cmd: c.join(' ') };
    });
  const root = rows.find((r) => r.cmd.includes('--vu-mem-probe') && !r.cmd.includes('--type='));
  const inTree = new Set([root?.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows)
      if (!inTree.has(r.pid) && inTree.has(r.ppid)) {
        inTree.add(r.pid);
        grew = true;
      }
  }
  const mine = rows.filter((r) => inTree.has(r.pid));
  const renderer = Math.max(
    ...mine.filter((r) => r.cmd.includes('--type=renderer')).map((r) => r.mb),
  );
  const gpu = mine.filter((r) => r.cmd.includes('--type=gpu')).reduce((s, r) => s + r.mb, 0);
  return {
    renderer: Math.round(renderer),
    gpu: Math.round(gpu),
    total: Math.round(mine.reduce((s, r) => s + r.mb, 0)),
  };
};
await p.goto('http://localhost:3200/lab/captions');
await p.waitForFunction(() => (window as any).captionsReady);
const samples: [number, ReturnType<typeof tree>][] = [];
const t0 = Date.now();
const timer = setInterval(() => samples.push([Date.now() - t0, tree()]), 200);
for (let i = 0; i < 2; i++) {
  const r = await p.evaluate(
    ([f, dev, m, s, fs, ref]) =>
      (window as any).runCaptions({
        file: f,
        model: m,
        device: dev,
        language: 'en',
        reference: ref,
        ...(s || fs
          ? { debug: { ...(s ? { session: s } : {}), ...(fs ? { files: fs } : {}) } }
          : {}),
      }),
    [file, device, model, session, files, reference] as const,
  );
  console.log(
    `run ${i}: load ${r.loadMs} ms, transcribe ${r.transcribeMs} ms, ${r.words} words, WER ${(r.wer * 100).toFixed(0)} % @ ${Date.now() - t0} ${r.error ?? ''}`,
  );
}
await p.waitForTimeout(3000);
clearInterval(timer);
const peak = samples.reduce((a, s) => (s[1].renderer > a[1].renderer ? s : a));
console.log(
  'start',
  JSON.stringify(samples[0]![1]),
  'peak',
  JSON.stringify(peak[1]),
  '@',
  peak[0],
  'end',
  JSON.stringify(samples.at(-1)![1]),
);
for (let i = 0; i < samples.length; i += 10)
  console.log(samples[i]![0], JSON.stringify(samples[i]![1]));
await b.close();
