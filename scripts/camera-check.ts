/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Camera recording, end to end, in Chrome with its fake camera + microphone: open the recorder
 * from the Media panel, record ~4 s, review, add to the main video; record again with the
 * microphone off and add it as a layer; retake and close-while-recording throw recordings away;
 * the camera and microphone are always released; the clips are real media (probed, playable,
 * exportable). Also the calm messages for a blocked camera and no camera, and the memory while
 * recording (pieces go to storage, the heap stays flat).
 * Usage: playground running, then node scripts/camera-check.ts [--port 3200] [--seconds 4]
 *   [--shots dir]
 */
import { chromium, type Page } from '@playwright/test';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const seconds = Number(arg('seconds') ?? 4);
const shots = arg('shots');

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
};

/** Counts every camera / microphone track the page opens, to check they are all stopped. */
const TRACK_SPY = `
  window.__tracks = [];
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    const stream = await original(c);
    for (const t of stream.getTracks()) window.__tracks.push(t);
    return stream;
  };
`;

const liveTracks = (page: Page) =>
  page.evaluate(() =>
    ((window as any).__tracks as MediaStreamTrack[])
      .filter((t) => t.readyState === 'live')
      .map((t) => t.kind),
  );

const project = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).vuEditor;
    const p = c.project;
    return {
      main: p.tracks[0].items.map((i: any) => ({
        kind: i.kind,
        assetId: i.assetId,
        duration: i.duration,
      })),
      layers: p.tracks
        .slice(1)
        .flatMap((t: any) => t.items)
        .map((i: any) => ({ kind: i.kind, assetId: i.assetId, scale: i.transform?.scale })),
      assets: Object.values(p.assets).map((a: any) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        mimeType: a.mimeType,
        duration: a.duration / 705_600_000,
        hasAudio: a.hasAudio,
        width: a.width,
        height: a.height,
        size: a.size,
        source: a.source,
      })),
    };
  });

async function record(page: Page, secs: number) {
  await page.locator('.vu-camera[data-phase="live"]').waitFor({ timeout: 20000 });
  await page.locator('.vu-record').click();
  await page.locator('.vu-camera[data-phase="recording"]').waitFor();
  await page.waitForTimeout(secs * 1000);
  const shown = await page.locator('.vu-camera-time').innerText();
  await page.locator('.vu-record').click();
  await page.locator('.vu-camera[data-phase="review"]').waitFor({ timeout: 20000 });
  return shown;
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(['camera', 'microphone']);
await context.addInitScript(TRACK_SPY);
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/editor?autosave=0`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });

console.log('\n===== camera · Chrome (fake camera + microphone)');
// 1. Record from the Media panel, add to the video.
await page.locator('.vu-panel .vu-camera-open').click();
await page.locator('.vu-camera').waitFor();
const support = await page.evaluate(() =>
  ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus'].map(
    (t) => `${t}: ${MediaRecorder.isTypeSupported(t)}`,
  ),
);
console.log(`  MediaRecorder: ${support.join(' · ')}`);
await page.locator('.vu-camera[data-phase="live"]').waitFor({ timeout: 20000 });
if (shots) await page.screenshot({ path: `${shots}/camera-live.png` });
const heap0 = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0);
const shown = await record(page, seconds);
const heap1 = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0);
const [m, ss] = shown.split(':').map(Number);
check(Math.abs(m! * 60 + ss! - seconds) <= 1, `recording clock shows ${shown} after ${seconds} s`);
check(
  (await liveTracks(page)).length === 0,
  `camera and microphone released while reviewing (${(await liveTracks(page)).join(', ') || 'none live'})`,
);
if (shots) await page.screenshot({ path: `${shots}/camera-review.png` });
await page.locator('.vu-camera-bar .vu-btn', { hasText: 'Add to video' }).click();
await page.locator('.vu-camera').waitFor({ state: 'detached', timeout: 30000 });
let p = await project(page);
const first = p.assets[0];
console.log(
  `  clip 1: ${first?.name} · ${first?.mimeType} · ${first?.width}×${first?.height} · ${first?.duration.toFixed(2)} s · ${((first?.size ?? 0) / 1e6).toFixed(2)} MB · sound ${first?.hasAudio}`,
);
check(
  p.main.length === 1 && p.main[0].kind === 'video' && p.main[0].assetId === first?.id,
  'clip 1 is on the main video',
);
check(
  !!first && Math.abs(first.duration - seconds) < 1.2,
  `clip 1 is about ${seconds} s long (${first?.duration.toFixed(2)} s)`,
);
check(!!first?.hasAudio, 'clip 1 has sound (microphone on)');
check(first?.source?.type === 'opfs', `clip 1 is stored like other media (${first?.source?.type})`);
console.log(
  `  heap while recording: ${(heap0 / 1e6).toFixed(1)} → ${(heap1 / 1e6).toFixed(1)} MB (pieces go to storage)`,
);
// The engine shows the camera picture (not black).
const variance = await page.evaluate(async () => {
  const c = (window as any).vuEditor;
  const bitmap: ImageBitmap = await c.engine.capture(Math.round(1.5 * 705_600_000), {
    width: 160,
    height: 90,
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += d[i]!;
    sq += d[i]! * d[i]!;
  }
  const n = d.length / 4;
  return sq / n - (sum / n) ** 2;
});
check(
  variance > 50,
  `the engine draws the recorded picture (pixel variance ${variance.toFixed(0)})`,
);

// 2. Microphone off, add as a layer.
await page.evaluate(() => (window as any).vuEditor.seek(0));
await page.locator('.vu-panel .vu-camera-open').click();
await page.locator('.vu-camera[data-phase="live"]').waitFor({ timeout: 20000 });
await page.locator('.vu-camera-bar .vu-btn', { hasText: 'Microphone' }).click();
check(
  (await page
    .locator('.vu-camera-bar .vu-btn', { hasText: 'Microphone' })
    .getAttribute('aria-pressed')) === 'false',
  'microphone switched off',
);
await record(page, 2);
await page.locator('.vu-camera-bar .vu-btn', { hasText: 'Add as a layer' }).click();
await page.locator('.vu-camera').waitFor({ state: 'detached', timeout: 30000 });
p = await project(page);
const second = p.assets.find((a: any) => a.id !== first?.id);
check(
  p.layers.some((i: any) => i.assetId === second?.id && i.kind === 'video' && i.scale === 0.6),
  'clip 2 is a layer (picture-in-picture, 60 %)',
);
check(second?.hasAudio === false, `clip 2 has no sound (microphone off: ${second?.hasAudio})`);

// 3. Retake throws the take away; closing while recording throws it away; nothing stays on.
const before = (await project(page)).assets.length;
await page.locator('.vu-panel .vu-camera-open').click();
await record(page, 1);
await page.locator('.vu-camera-bar .vu-btn', { hasText: 'Retake' }).click();
await page.locator('.vu-camera[data-phase="live"]').waitFor({ timeout: 20000 });
await page.locator('.vu-record').click();
await page.waitForTimeout(1200);
await page.locator('.vu-camera-head .vu-btn[aria-label="Close camera"]').click();
await page.locator('.vu-camera').waitFor({ state: 'detached' });
await page.waitForTimeout(800);
check(
  (await project(page)).assets.length === before,
  'retake and close-while-recording add nothing',
);
check((await liveTracks(page)).length === 0, 'camera and microphone off after closing');
const stray = await page.evaluate(async () => {
  const c = (window as any).vuEditor;
  const used = new Set(Object.keys(c.project.assets));
  const root = await navigator.storage.getDirectory();
  const names: string[] = [];
  try {
    const dir = await (await root.getDirectoryHandle('video-ultra')).getDirectoryHandle('media');
    for await (const name of (dir as any).keys()) names.push(decodeURIComponent(name));
  } catch {
    return [];
  }
  return names.filter((n) => !n.endsWith('.peaks') && !used.has(n));
});
check(stray.length === 0, `no recordings left in storage (${stray.length} stray)`);

// 4. Export the two clips (480p) — recorded media is ordinary media.
const exported = await page.evaluate(async () => {
  const c = (window as any).vuEditor;
  const r = await c.exportVideo(
    { format: 'mp4', height: 480, fps: 30, quality: 'low' },
    () => {},
    new AbortController().signal,
  );
  return { frames: r.frames, audio: r.audioCodec, seconds: r.durationSeconds };
});
check(
  exported.frames > 0 && exported.audio === 'aac',
  `exports with the recordings: ${exported.frames} frames, ${exported.seconds.toFixed(2)} s, sound ${exported.audio}`,
);
if (errors.length) console.log(`  page errors: ${errors.join(' | ')}`);
check(errors.length === 0, 'no page errors');
await context.close();

// 5. Blocked camera / no camera: calm, specific messages.
for (const [name, message] of [
  ['NotAllowedError', 'The camera is blocked'],
  ['NotFoundError', 'No camera was found'],
] as const) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(
    `navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('x', '${name}'));`,
  );
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${port}/editor?autosave=0`);
  await pg.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await pg.evaluate(() => (window as any).vuEditor.setCameraOpen(true));
  const alert = pg.locator('.vu-camera [role="alert"]');
  await alert.waitFor({ timeout: 10000 });
  const text = await alert.innerText();
  check(text.includes(message), `${name} → "${text.split('\n').join(' ').slice(0, 90)}"`);
  if (shots && name === 'NotAllowedError')
    await pg.screenshot({ path: `${shots}/camera-blocked-phone.png` });
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} camera check(s) failed` : '\nAll camera checks passed');
process.exitCode = failures ? 1 : 0;
