/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Fine trims and markers (v0.4) in a real browser: on the desktop timeline, Alt-drag a cut
 * (roll: the video keeps its length), Alt-drag a clip (slip: same place, other media),
 * Alt+Shift-drag a middle clip (slide); the Fine trim tool's buttons do the same a frame at a
 * time; M adds a marker (M again removes it), `,` / `.` jump between markers.
 * Usage: playground running, then node scripts/protrim-check.ts [--port 3200]
 */
import { chromium, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const main = (page: Page) =>
  page.evaluate(() =>
    (window as any).vuEditor.project.tracks[0].items.map((i: any) => ({
      id: i.id,
      start: +(i.start / 705_600_000).toFixed(3),
      dur: +(i.duration / 705_600_000).toFixed(3),
      src: i.sourceIn === undefined ? null : +(i.sourceIn / 705_600_000).toFixed(3),
    })),
  );
const total = (page: Page) =>
  page.evaluate(() =>
    (window as any).vuEditor.project.tracks[0].items.reduce(
      (n: number, i: any) => n + i.duration,
      0,
    ),
  );

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/editor?autosave=0`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
// Three 6 s clips trimmed to 3 s each (from 1 s of their files): room to roll, slip and slide.
await page
  .locator('.vu-root input[type=file][accept^="video"]')
  .setInputFiles(
    ['avc-noaudio.mp4', 'avc-noaudio.mp4', 'avc-noaudio.mp4'].map((f) =>
      resolve('test-media/files', f),
    ),
  );
await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 3);
await page.evaluate(() => {
  const c = (window as any).vuEditor;
  for (const it of [...c.project.tracks[0].items]) {
    c.run('t', (d: any) => {
      const i = d.tracks[0].items.find((x: any) => x.id === it.id);
      i.sourceIn = 705_600_000;
      i.duration = 3 * 705_600_000;
    });
  }
  c.run('layout', (d: any) => {
    let t = 0;
    for (const i of d.tracks[0].items) {
      i.start = t;
      t += i.duration;
    }
  });
});
await page.waitForTimeout(500);
const before = await main(page);
const len = await total(page);

// Timeline geometry (as editor-interact): header + 16 px lead-in, main row under the ruler.
const canvas = (await page.locator('.vu-timeline-canvas canvas').boundingBox())!;
const header = await page.evaluate(() =>
  parseFloat(
    getComputedStyle(document.querySelector('.vu-root')!).getPropertyValue(
      '--vu-size-timeline-header',
    ),
  ),
);
const pps = await page.evaluate(() => (window as any).vuEditor.ui.getState().pxPerSecond as number);
const xAt = (seconds: number) => canvas.x + header + 16 + seconds * pps;
const rowY = canvas.y + 24 + 6 + 28;
const altDrag = async (fromS: number, byS: number, shift = false, edge = false) => {
  await page.keyboard.down('Alt');
  if (shift) await page.keyboard.down('Shift');
  // The end trim handle sits just outside the clip's right edge.
  const x = xAt(fromS) + (edge ? 5 : 0);
  await page.mouse.move(x, rowY);
  await page.mouse.down();
  await page.mouse.move(x + byS * pps, rowY, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await page.waitForTimeout(200);
};
// The trim handles show on the selected clip.
await page.mouse.click(xAt(1.5), rowY);
// Roll: Alt-drag the cut between clips 1 and 2 (at 3 s) by +1 s.
await altDrag(3, 1, false, true);
let now = await main(page);
check(
  'Alt-drag a cut rolls it (clip 1 longer, clip 2 shorter, same length)',
  now[0].dur > 3.5 && now[1].dur < 2.5 && (await total(page)) === len,
  JSON.stringify(now.map((c: any) => [c.dur, c.src])),
);
// Slip: Alt-drag the middle of clip 3 (7.5 s) left by 1 s → its media starts later.
await altDrag(7.5, -1);
const slipped = await main(page);
check(
  'Alt-drag a clip slips its media (same place and length)',
  slipped[2].src > now[2].src + 0.5 &&
    slipped[2].start === now[2].start &&
    slipped[2].dur === now[2].dur,
  `${now[2].src} → ${slipped[2].src}`,
);
// Slide: Alt+Shift-drag the middle clip (≈5 s) right by 0.5 s.
now = slipped;
await altDrag(now[1].start + now[1].dur / 2, 0.5, true);
const slid = await main(page);
check(
  'Alt+Shift-drag slides the middle clip (neighbours change, it doesn’t)',
  slid[1].dur === now[1].dur && slid[1].start > now[1].start && (await total(page)) === len,
  JSON.stringify(slid.map((c: any) => [c.start, c.dur])),
);
const ids = before.map((c: any) => c.id);

// Fine trim tool: one frame of roll.
await page.evaluate((id) => (window as any).vuEditor.select(id), ids[0]);
await page.locator('.vu-section-toggle', { hasText: 'Fine trim' }).click();
const a0 = (await main(page))[0].dur;
await page.locator('.vu-protrim-row', { hasText: 'Move cut' }).locator('button').nth(1).click();
const a1 = (await main(page))[0].dur;
check(
  'Fine trim › Move cut ▶ adds one frame to the clip',
  Math.abs(a1 - a0 - 1 / 30) < 0.002,
  `${a0} → ${a1}`,
);

// Markers.
await page.evaluate(() => (window as any).vuEditor.seek(2 * 705_600_000));
await page.locator('.vu-stage').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('m');
await page.evaluate(() => (window as any).vuEditor.seek(5 * 705_600_000));
await page.keyboard.press('m');
let markers = await page.evaluate(() =>
  ((window as any).vuEditor.project.markers ?? []).map((m: any) => m.time / 705_600_000),
);
check(
  'M adds markers at the playhead',
  JSON.stringify(markers) === '[2,5]',
  JSON.stringify(markers),
);
await page.keyboard.press(',');
const back = await page.evaluate(() => (window as any).vuEditor.playhead.time / 705_600_000);
await page.evaluate(() => (window as any).vuEditor.seek(0));
await page.keyboard.press('.');
const fwd = await page.evaluate(() => (window as any).vuEditor.playhead.time / 705_600_000);
check(', and . jump between markers', back === 2 && fwd === 2, `${back}, ${fwd}`);
await page.keyboard.press('m');
markers = await page.evaluate(() =>
  ((window as any).vuEditor.project.markers ?? []).map((m: any) => m.time / 705_600_000),
);
check('M on a marker removes it', JSON.stringify(markers) === '[5]', JSON.stringify(markers));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
