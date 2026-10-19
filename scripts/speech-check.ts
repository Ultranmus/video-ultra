/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Text to speech (v0.4) in a real browser: the Audio panel's "Text to speech" sends the text,
 * voice and speed to the host's voice service (mocked here, answering with a real recorded
 * voice) and adds the answer as a sound clip at the playhead; a text's "Read aloud" adds it
 * where the text starts; a failing service says so and adds nothing; without a server key the
 * playground's demo voice answers; axe on the panel.
 * Usage: playground running, then node scripts/speech-check.ts [--port 3200]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
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
const F = 705_600_000;
const voiceBytes = readFileSync(resolve('test-media/files/voice.m4a'));

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
let sent: any = null;
let fail = false;
await page.route('**/api/speech', async (route) => {
  sent = JSON.parse(route.request().postData() ?? '{}');
  if (fail) return route.fulfill({ status: 500, body: 'boom' });
  return route.fulfill({ contentType: 'audio/mp4', body: voiceBytes });
});
await page.goto(`http://localhost:${port}/editor?autosave=0`);
await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
await page
  .locator('.vu-root input[type=file][accept^="video"]')
  .setInputFiles([resolve('test-media/files/avc-720p30.mp4')]);
await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 1);
const sounds = (p: Page) =>
  p.evaluate(() =>
    (window as any).vuEditor.project.tracks
      .flatMap((t: any) => t.items)
      .filter((i: any) => i.kind === 'audio')
      .map((i: any) => ({
        start: i.start / 705_600_000,
        duration: i.duration / 705_600_000,
        name: (window as any).vuEditor.project.assets[i.assetId].name,
      })),
  );

// 1. Audio panel → Text to speech, at the playhead (2 s).
await page.evaluate((t) => (window as any).vuEditor.seek(t), 2 * F);
await page.locator('.vu-rail button', { hasText: 'Audio' }).click();
const axe = await new AxeBuilder({ page }).include('.vu-panel').analyze();
check(
  'Audio panel with Text to speech passes axe',
  axe.violations.length === 0,
  axe.violations.map((v) => v.id).join(', '),
);
await page.locator('.vu-tts textarea').fill('Welcome to my trip.');
await page.locator('.vu-tts .vu-chip', { hasText: 'Nova' }).click();
await page.locator('.vu-tts .vu-btn', { hasText: 'Add voice' }).click();
await page.waitForFunction(
  () =>
    (window as any).vuEditor.project.tracks.some((t: any) =>
      t.items.some((i: any) => i.kind === 'audio'),
    ),
  null,
  { timeout: 20000 },
);
let list = await sounds(page);
check(
  'the voice is added as a sound clip at the playhead',
  list.length === 1 &&
    Math.abs(list[0].start - 2) < 0.05 &&
    list[0].duration > 5 &&
    /^Voice · Welcome/.test(list[0].name),
  JSON.stringify(list),
);
check(
  'the service got the text, the chosen voice and the speed',
  sent?.input === 'Welcome to my trip.' && sent?.voice === 'nova' && sent?.speed === 1,
  JSON.stringify(sent),
);

// 2. Read aloud on a text: added where the text starts.
await page.evaluate(() => {
  const c = (window as any).vuEditor;
  c.run('t', (d: any) => {
    d.tracks.push({
      id: 'tl',
      kind: 'overlay',
      muted: false,
      hidden: false,
      locked: false,
      items: [
        {
          id: 'title',
          kind: 'text',
          start: 6 * 705_600_000,
          duration: 2 * 705_600_000,
          text: 'The end',
          style: {
            fontFamily: 'system-ui',
            fontWeight: 700,
            italic: false,
            size: 0.06,
            color: '#ffffff',
            align: 'center',
            lineHeight: 1.2,
            letterSpacing: 0,
            outline: null,
            shadow: null,
            background: null,
          },
          transform: {
            x: 0.5,
            y: 0.5,
            scale: 1,
            rotation: 0,
            opacity: 1,
            flipX: false,
            flipY: false,
          },
          filter: null,
          adjust: {},
        },
      ],
    });
  });
  c.select('title');
});
await page.locator('.vu-section-toggle', { hasText: 'Read aloud' }).click();
await page.locator('.vu-inspector .vu-btn', { hasText: 'Read aloud' }).click();
await page.waitForFunction(
  () =>
    (window as any).vuEditor.project.tracks
      .flatMap((t: any) => t.items)
      .filter((i: any) => i.kind === 'audio').length === 2,
  null,
  { timeout: 20000 },
);
list = await sounds(page);
check(
  'Read aloud adds the voice where the text starts',
  list.some((s: any) => Math.abs(s.start - 6) < 0.05),
  JSON.stringify(list),
);
check('…with the text’s words', sent?.input === 'The end');

// 3. A failing service: says so, adds nothing.
fail = true;
const before = list.length;
const ok = await page.evaluate(() => (window as any).vuEditor.speak('This will fail'));
const toast = await page
  .locator('.vu-toast')
  .last()
  .innerText()
  .catch(() => '');
check(
  'a failing voice service says so and adds nothing',
  ok === false && (await sounds(page)).length === before && /Couldn't make the voice/.test(toast),
  toast,
);

// 4. No server key: the demo voice.
await page.unroute('**/api/speech');
const demo = await page.evaluate(() =>
  (window as any).vuEditor.speak('Hello there, this is the demo voice'),
);
check(
  'without a server key the demo voice is added',
  demo === true && (await sounds(page)).length === before + 1,
);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
