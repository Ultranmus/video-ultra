/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Combined clips (DECISIONS #155) through the engine, in a real browser: frames before and after
 * combining match on both GPU backends (the inside drawn into a render target, then shown as a
 * picture); a combined clip at 2× shows the inside twice as fast; its sound matches the pieces';
 * a filter and opacity apply to it as one; separating gives the original frames back.
 * Usage: playground running, then node scripts/compound-check.ts [--shots <dir>] [--browser chrome|webkit]
 */
import { chromium, webkit, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const shots = arg('shots');
const browserName = arg('browser') ?? 'chrome';
const F = 705_600_000;

let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

/** RGBA pixels of one exact frame (`time` s) from the given backend, at 270 × 480. */
async function frame(page: Page, time: number, backend: string): Promise<number[]> {
  return page.evaluate(
    async ({ t, b }) => {
      const c = (window as any).vuEditor;
      const bitmap: ImageBitmap = await c.engine.capture(Math.round(t * 705_600_000), {
        width: 270,
        height: 480,
        backend: b,
      });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    },
    { t: time, b: backend },
  );
}

/** Mean and 99th-percentile absolute difference per channel (0…255). */
function diff(a: number[], b: number[]): { mean: number; p99: number } {
  const d: number[] = [];
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue;
    const v = Math.abs(a[i]! - b[i]!);
    d.push(v);
    sum += v;
  }
  d.sort((x, y) => x - y);
  return { mean: sum / d.length, p99: d[Math.floor(d.length * 0.99)]! };
}

/** The project's sound 0…`seconds` (mono, 16 kHz). */
const sound = (page: Page, seconds: number) =>
  page.evaluate(async (s) => {
    const c = (window as any).vuEditor;
    const out: number[] = [];
    for await (const pcm of c.engine.listen(
      c.project,
      0,
      Math.round(s * 705_600_000),
      16000,
      new AbortController().signal,
    ))
      for (let i = 0; i < pcm.length; i += 4) out.push(pcm[i]);
    return out;
  }, seconds);

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

const browser =
  browserName === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/editor?autosave=0`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
await page
  .locator('.vu-root input[type=file][accept^="video"]')
  .setInputFiles(['avc-1080p30.mp4', 'photo.jpg'].map((f) => resolve('test-media/files', f)));
await page.waitForFunction(
  () => (window as any).vuEditor.project.tracks[0].items.length === 2,
  null,
  {
    timeout: 30000,
  },
);
const ids = await page.evaluate(() => {
  const c = (window as any).vuEditor;
  c.seek(0);
  const lane: string[] = [];
  c.addLaneItem('Add text', (id: string, start: number) => {
    lane.push(id);
    return {
      kind: 'text',
      id,
      start,
      text: 'Inside',
      duration: 3 * 705_600_000,
      style: {
        fontFamily: 'system-ui',
        fontWeight: 700,
        italic: false,
        size: 0.09,
        color: '#ffffff',
        align: 'center',
        lineHeight: 1.2,
        letterSpacing: 0,
        outline: null,
        shadow: { color: '#000000', blur: 8, x: 0, y: 4 },
        background: { color: '#7a3cff', padding: 0.3, radius: 0.2 },
      },
      filter: null,
      adjust: {},
      transform: {
        x: 0.5,
        y: 0.3,
        scale: 1,
        rotation: 6,
        opacity: 0.8,
        flipX: false,
        flipY: false,
      },
    };
  });
  c.addLaneItem('Add sticker', (id: string, start: number) => {
    lane.push(id);
    return {
      kind: 'sticker',
      id,
      start: start + 705_600_000,
      duration: 3 * 705_600_000,
      emoji: '🎉',
      assetId: null,
      filter: null,
      adjust: {},
      transform: {
        x: 0.7,
        y: 0.7,
        scale: 0.3,
        rotation: 0,
        opacity: 1,
        flipX: false,
        flipY: false,
      },
    };
  });
  return [...c.project.tracks[0].items.map((i: any) => i.id), ...lane] as string[];
});
const times = [0.5, 2.0, 11.0];
const backends = browserName === 'webkit' ? ['webgl2'] : ['webgpu', 'webgl2'];
const before = new Map<string, number[]>();
for (const b of backends) for (const t of times) before.set(`${b}@${t}`, await frame(page, t, b));
const soundBefore = await sound(page, 6);

await page.evaluate((list) => {
  const c = (window as any).vuEditor;
  c.select(list[0], { only: true });
  for (const id of list.slice(1)) c.select(id, { add: true });
  c.combineSelected();
}, ids);
await page.waitForTimeout(500);
const state = await page.evaluate(() => {
  const c = (window as any).vuEditor;
  const items = c.project.tracks.flatMap((t: any) => t.items);
  const clip = items[0];
  return {
    count: items.length,
    id: clip.id,
    kind: c.project.assets[clip.assetId]?.kind,
    duration: clip.duration / 705_600_000,
  };
});
check(
  'Combine makes one clip on the timeline',
  state.count === 1 && state.kind === 'compound',
  JSON.stringify(state),
);
check('…as long as the pieces', Math.abs(state.duration - 13) < 0.05, `${state.duration} s`);

for (const b of backends) {
  for (const t of times) {
    const after = await frame(page, t, b);
    const d = diff(before.get(`${b}@${t}`)!, after);
    check(
      `${b} ${t} s: the combined clip looks like its pieces`,
      d.mean < 0.6 && d.p99 <= 6,
      `mean ${d.mean.toFixed(2)}, p99 ${d.p99}`,
    );
    if (shots && t === 0.5) {
      const png = await page.evaluate(
        async ({ px }) => {
          const canvas = new OffscreenCanvas(270, 480);
          canvas
            .getContext('2d')!
            .putImageData(new ImageData(new Uint8ClampedArray(px), 270, 480), 0, 0);
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        },
        { px: after },
      );
      writeFileSync(`${shots}/${b}-combined.png`, Buffer.from(png));
    }
  }
}
const soundAfter = await sound(page, 6);
const corr = correlation(soundBefore, soundAfter);
check('its sound is the pieces’ sound', corr > 0.98, corr.toFixed(4));

// 2×: the frame at 1 s is the inside at 2 s.
await page.evaluate((id) => {
  const c = (window as any).vuEditor;
  c.select(id);
  c.run('Speed', (d: any) => {
    const item = d.tracks[0].items[0];
    item.speed = 2;
    item.duration = Math.floor(item.duration / 2 / 23520000) * 23520000;
  });
}, state.id);
await page.waitForTimeout(400);
for (const b of backends) {
  const d = diff(before.get(`${b}@2`)!, await frame(page, 1.0, b));
  check(`${b} 2×: 1 s shows what was at 2 s`, d.mean < 1.5, `mean ${d.mean.toFixed(2)}`);
}
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
await page.evaluate(() => (window as any).vuEditor.undo());
await page.waitForTimeout(200);

// A look on the whole clip: opacity halves it against the black background.
await page.evaluate(() => {
  const c = (window as any).vuEditor;
  c.run('Opacity', (d: any) => (d.tracks[0].items[0].transform.opacity = 0.5));
});
await page.waitForTimeout(400);
for (const b of backends) {
  const a = before.get(`${b}@0.5`)!;
  const half = await frame(page, 0.5, b);
  let ratio = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4)
    if (a[i]! > 120) {
      ratio += half[i]! / a[i]!;
      n++;
    }
  check(
    `${b}: opacity applies to the clip as one`,
    n > 0 && Math.abs(ratio / n - 0.5) < 0.08,
    (ratio / n).toFixed(3),
  );
}
await page.evaluate(() => (window as any).vuEditor.undo());
await page.waitForTimeout(200);

// Separate: back to the pieces, the same frames.
await page.evaluate((id) => {
  const c = (window as any).vuEditor;
  c.select(id);
  c.separateSelected();
}, state.id);
await page.waitForTimeout(500);
const count = await page.evaluate(() =>
  (window as any).vuEditor.project.tracks.reduce((n: number, t: any) => n + t.items.length, 0),
);
check('Separate puts the four pieces back', count === 4, String(count));
for (const b of backends) {
  const d = diff(before.get(`${b}@2`)!, await frame(page, 2.0, b));
  check(`${b}: after Separate the frame is as before`, d.mean < 0.3, `mean ${d.mean.toFixed(2)}`);
}
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
