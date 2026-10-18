import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] });
const ctx = await b.newContext();
const p = await ctx.newPage();
const rss = () => {
  const rows = execFileSync('ps', ['-A', '-o', 'rss=,command=']).toString().split('\n');
  return rows.filter((l) => /--type=renderer/.test(l) && /enable-unsafe-webgpu|Google Chrome Helper \(Renderer\)/.test(l)).map((l) => Math.round(Number(l.trim().split(/\s+/)[0]) / 1024)).sort((a, b) => b - a).slice(0, 3).join(',');
};
const device = process.argv[2] ?? 'wasm';
await p.goto('http://localhost:3200/lab/captions');
await p.waitForFunction(() => (window as any).captionsReady);
console.log('page loaded      renderer MB:', rss());
// 1 s of silence: loads the model and runs it once.
await p.evaluate(async (dev) => {
  const { createOnDeviceTranscriber } = await import('/_next/static/chunks/never' as string).catch(() => ({} as any));
  return dev;
}, device).catch(() => {});
const r = await p.evaluate(async (dev) => {
  const w = window as any;
  return w.runCaptions({ file: 'speech-en-gb.m4a', model: 'tiny', device: dev, language: 'en', reference: '' });
}, device);
console.log('after 30 s clip  renderer MB:', rss(), r.transcribeMs, 'ms');
await p.waitForTimeout(3000);
console.log('3 s later        renderer MB:', rss());
const heap = await p.evaluate(() => (performance as any).memory?.usedJSHeapSize / 1e6);
console.log('page JS heap MB:', Math.round(heap));
await b.close();
