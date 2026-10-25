/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Captions (v0.2 A) in a real browser: auto captions through the editor's audio path (a stand-in
 * transcriber, then the real on-device one on a speech clip), styles and word highlight drawn by
 * the engine, editing in the list, import / download of .srt, dragging moves every caption, undo,
 * axe on the panel; the playground's captions service (mocked: 30 s chunks, every language,
 * words timed from the sound); phone: the Captions tool and sheet. Screenshots with --shots.
 * Usage: playground running, then node scripts/captions-check.ts [--shots <dir>] [--no-model]
 *   [--port 3200]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices, webkit, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const shots = arg('shots');
const withModel = !process.argv.includes('--no-model');
const webkitModel = process.argv.includes('--webkit-model');
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const snap = async (page: Page, name: string) => {
  if (!shots) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/${name}.png` });
};
const captions = (page: Page) =>
  page.evaluate(() => {
    const t = (window as any).vuEditor.project.tracks.find((x: any) => x.kind === 'caption');
    return t
      ? {
          look: t.caption,
          items: t.items.map((i: any) => ({
            id: i.id,
            text: i.text,
            start: i.start,
            words: i.words?.length ?? 0,
            y: i.transform.y,
            font: i.style.fontFamily,
          })),
        }
      : null;
  });

async function load(page: Page, query: string, files: string[]) {
  await page.goto(`http://localhost:${port}/editor?autosave=0&${query}`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles(files.map((f) => resolve('test-media/files', f)));
  await page.waitForFunction(
    (n) =>
      (window as any).vuEditor.project.tracks.reduce(
        (s: number, t: any) => s + t.items.length,
        0,
      ) >= n,
    files.length,
    { timeout: 30000 },
  );
}

// ── desktop, stand-in transcriber ────────────────────────────────────────
{
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, 'transcriber=fake', ['avc-1080p30.mp4']);
  await page.locator('.vu-rail .vu-btn', { hasText: 'Captions' }).click();
  await page.waitForTimeout(400);
  await snap(page, 'c1-panel-empty');
  await page.locator('.vu-panel .vu-btn', { hasText: 'Make captions' }).click();
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption'),
    null,
    { timeout: 60000 },
  );
  let caps = await captions(page);
  check(
    'auto captions fill the caption row',
    !!caps && caps.items.length >= 2,
    `${caps?.items.length}`,
  );
  check('captions carry word times', !!caps && caps.items.every((i) => i.words > 0));
  await snap(page, 'c2-made');

  // Style: a preset with word highlight, then the engine draws it.
  await page.locator('.vu-caption-preset', { hasText: 'Karaoke' }).click();
  caps = await captions(page);
  check(
    'a preset restyles every caption',
    caps!.look.preset === 'karaoke' && caps!.look.highlight === 'fill',
  );
  const first = caps!.items[0]!;
  await page.evaluate((t) => (window as any).vuEditor.seek(t + 705_600_000 * 0.6), first.start);
  await page.waitForTimeout(600);
  await snap(page, 'c3-karaoke');
  for (const mode of ['Colour', 'Box', 'Word by word', 'Letter by letter']) {
    await page
      .locator('.vu-panel .vu-chip, .vu-panel button', { hasText: new RegExp(`^${mode}$`) })
      .first()
      .click();
    await page.waitForTimeout(250);
    // Halfway into the second word of the first caption.
    await page.evaluate((t) => (window as any).vuEditor.seek(t + 705_600_000 * 0.7), first.start);
    await page.waitForTimeout(500);
    if (shots)
      await page
        .locator('.vu-stage-frame')
        .screenshot({ path: `${shots}/c3-${mode.replace(/ /g, '-').toLowerCase()}.png` });
  }
  caps = await captions(page);
  check('highlight modes switch', caps!.look.highlight === 'type');
  await page.locator('.vu-panel button', { hasText: /^Top$/ }).first().click();
  caps = await captions(page);
  check(
    'position moves every caption',
    caps!.items.every((i) => i.y < 0.3),
  );

  // Edit in the list.
  const box = page.locator('.vu-caption-text').first();
  await box.fill('Edited first caption');
  await box.press('Enter');
  caps = await captions(page);
  check('editing a caption in the list', caps!.items[0]!.text === 'Edited first caption');

  // Drag a caption on the stage: all move.
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  await page.evaluate((t) => (window as any).vuEditor.seek(t + 7_056_000), caps!.items[0]!.start);
  await page.waitForTimeout(300);
  const y0 = caps!.items[0]!.y;
  const sx = frame.x + frame.width / 2;
  const sy = frame.y + y0 * frame.height;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(sx, sy + i * 20);
  await page.mouse.up();
  caps = await captions(page);
  check(
    'dragging one caption moves them all',
    caps!.items.every((i) => Math.abs(i.y - caps!.items[0]!.y) < 1e-9) && caps!.items[0]!.y > y0,
    `${y0.toFixed(3)} → ${caps!.items[0]!.y.toFixed(3)}`,
  );

  // Download .srt.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.vu-panel .vu-btn', { hasText: /^\.srt$/ }).click(),
  ]);
  const srtPath = join(mkdtempSync(join(tmpdir(), 'vu-cap-')), 'out.srt');
  await download.saveAs(srtPath);
  const srt = readFileSync(srtPath, 'utf8');
  check(
    'downloaded .srt lists every caption',
    srt.includes('Edited first caption') && srt.includes('-->'),
  );

  // Import .srt (replaces).
  const srtIn = join(mkdtempSync(join(tmpdir(), 'vu-cap-')), 'in.srt');
  writeFileSync(
    srtIn,
    '1\n00:00:00,500 --> 00:00:02,000\nImported one\n\n2\n00:00:02,500 --> 00:00:04,000\nImported two\n',
  );
  await page.locator('.vu-panel input[type=file][accept^=".srt"]').setInputFiles(srtIn);
  await page.waitForTimeout(300);
  caps = await captions(page);
  check(
    'importing .srt replaces the captions',
    caps!.items.map((i) => i.text).join('|') === 'Imported one|Imported two',
  );
  await snap(page, 'c4-imported');
  const a11y = await new AxeBuilder({ page })
    .include('.vu-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  check(
    'Captions panel passes axe',
    a11y.violations.length === 0,
    a11y.violations.map((v) => v.id).join(','),
  );
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  caps = await captions(page);
  check('undo brings the earlier captions back', caps!.items[0]!.text === 'Edited first caption');
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── desktop, the real on-device model on a speech clip ─────────────────
if (withModel) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, 'transcriber=device', ['avc-1080p30.mp4', 'speech-en-gb.m4a']);
  // Put the speech under the video and lower nothing.
  await page.locator('.vu-rail .vu-btn', { hasText: 'Captions' }).click();
  check(
    'on the device: English only, no language to choose',
    (await page.locator('.vu-panel .vu-captions').innerText()).includes(
      'Spoken language: English',
    ) && (await page.locator('.vu-panel button', { hasText: /^Hindi$|^Detect$/ }).count()) === 0,
  );
  const t0 = Date.now();
  await page.locator('.vu-panel .vu-btn', { hasText: 'Make captions' }).click();
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption'),
    null,
    { timeout: 300000 },
  );
  const caps = await captions(page);
  const text = caps!.items.map((i) => i.text).join(' ');
  check(
    'the on-device model captions real speech',
    /welcome back to the channel/i.test(text) && /rice/i.test(text),
    `${caps!.items.length} captions in ${((Date.now() - t0) / 1000).toFixed(1)} s: "${text.slice(0, 60)}…"`,
  );
  await page.evaluate((t) => (window as any).vuEditor.seek(t + 300_000_000), caps!.items[1]!.start);
  await snap(page, 'c5-real');
  check('no page errors (model)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── the real model in WebKit (Safari's engine: its call-argument limit once broke this) ────
if (webkitModel) {
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, 'transcriber=device', ['speech-en-gb.m4a']);
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Captions' }).first().tap();
  const t0 = Date.now();
  await page.locator('.vu-dock .vu-btn', { hasText: 'Make captions' }).tap();
  const outcome = await page
    .waitForFunction(
      () =>
        (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption') ||
        document.querySelector('.vu-toast[data-tone="error"]')?.textContent,
      null,
      { timeout: 600000 },
    )
    .then((h) => h.jsonValue());
  const caps = await captions(page);
  const text = caps?.items.map((i) => i.text).join(' ') ?? String(outcome);
  check(
    'WebKit: the on-device model captions real speech',
    /welcome back to the channel/i.test(text),
    `${((Date.now() - t0) / 1000).toFixed(1)} s: "${text.slice(0, 70)}"`,
  );
  check('no page errors (WebKit model)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── the playground's captions service (mocked: any language; times come from the sound) ──
{
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const sent: { language: string; seconds: number }[] = [];
  await page.route('**/api/captions**', async (route) => {
    const url = new URL(route.request().url());
    const bytes = route.request().postDataBuffer()?.length ?? 0;
    const language = url.searchParams.get('language') ?? '';
    sent.push({ language, seconds: bytes / 4 / 16000 });
    // Hindi speech: any other language chosen hears no words, and says it heard Hindi.
    const said = 'नमस्ते दोस्तों, आज हम चावल बनाएंगे। पहले चावल धो लीजिए।'.split(' ');
    await route.fulfill({
      json: { words: language === 'hi' || language === 'auto' ? said : [], language: 'hi' },
    });
  });
  await load(page, 'transcriber=server', ['speech-en-gb.m4a']);
  await page.locator('.vu-rail .vu-btn', { hasText: 'Captions' }).click();
  const panel = await page.locator('.vu-panel .vu-captions').innerText();
  check(
    'service: every language and Detect offered, made by the service',
    /Hindi/.test(panel) && /Detect/.test(panel) && /captions service/.test(panel),
  );
  const chips = await page
    .locator('.vu-panel .vu-captions [role=radio], .vu-panel .vu-captions .vu-chip')
    .allInnerTexts();
  check(
    'service: Detect is the third choice, Hinglish the fourth',
    chips[2]?.trim() === 'Detect' && chips[3]?.trim() === 'Hinglish',
    chips.join(' · '),
  );
  // Hindi speech with French chosen: says which language it heard.
  await page.locator('.vu-panel button', { hasText: /More languages/ }).click();
  await page
    .locator('.vu-panel button', { hasText: /^French$/ })
    .first()
    .click();
  await page.locator('.vu-panel .vu-btn', { hasText: 'Make captions' }).click();
  const toast = page.locator('.vu-toast', { hasText: 'sounds like Hindi' });
  await toast.waitFor({ timeout: 30000 }).catch(() => undefined);
  check(
    'service: another language than the one spoken says which to choose',
    (await toast.count()) > 0 &&
      (await toast.first().innerText()).includes('not French') &&
      !(await captions(page)),
    await toast
      .first()
      .innerText()
      .catch(() => 'no toast'),
  );
  sent.length = 0;
  await page
    .locator('.vu-panel button', { hasText: /^Hindi$/ })
    .first()
    .click();
  await page.locator('.vu-panel .vu-btn', { hasText: 'Make captions' }).click();
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption'),
    null,
    { timeout: 60000 },
  );
  const caps = await captions(page);
  const timed = await page.evaluate(() => {
    const t = (window as any).vuEditor.project.tracks.find((x: any) => x.kind === 'caption');
    const words = t.items.flatMap((i: any) =>
      (i.words ?? []).map((w: any) => (i.start + w.start) / 705_600_000),
    );
    return {
      first: words[0],
      ordered: words.every((w: number, k: number) => !k || w >= words[k - 1]),
    };
  });
  check(
    'service: 30 s chunks (a short tail joins the last), in the chosen language',
    sent.length === 1 && sent[0]!.seconds > 30 && sent.every((r) => r.language === 'hi'),
    JSON.stringify(sent),
  );
  check(
    'service: the words become captions, timed from the sound (in order, from the start)',
    !!caps && caps.items.some((i) => i.text.includes('नमस्ते')) && timed.ordered && timed.first < 1,
    `${caps?.items.length} captions, first word at ${timed.first?.toFixed(2)} s`,
  );
  check('no page errors (service)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── check marks, names & words, Hinglish, hear again (mocked service, DECISIONS #167) ──
{
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const asked: { seconds: number; vocabulary: string | null; language: string | null }[] = [];
  // Hinglish is the service's work: it answers in Latin letters when asked for `hi-Latn`.
  await page.route('**/api/captions**', async (route) => {
    const url = new URL(route.request().url());
    asked.push({
      seconds: (route.request().postDataBuffer()?.length ?? 0) / 4 / 16000,
      vocabulary: url.searchParams.get('vocabulary'),
      language: url.searchParams.get('language'),
    });
    await route.fulfill({
      json: {
        words: [
          { text: 'Namaste', start: 0.3, end: 0.8, confidence: 0.9 },
          { text: 'dosto.', start: 0.9, end: 1.5, confidence: 0.9 },
          { text: 'Aaj', start: 3, end: 3.4, confidence: 0.4 },
          { text: 'hum.', start: 3.5, end: 4, confidence: 0.45 },
        ],
        language: 'hi-Latn',
      },
    });
  });
  await load(page, 'transcriber=server', ['speech-en-gb.m4a']);
  await page.locator('.vu-rail .vu-btn', { hasText: 'Captions' }).click();
  await page
    .locator('.vu-panel button', { hasText: /^Hinglish$/ })
    .first()
    .click();
  await page.locator('.vu-panel .vu-text-field input').fill('Priya, Goa');
  await page.locator('.vu-panel .vu-btn', { hasText: 'Make captions' }).click();
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption'),
    null,
    { timeout: 60000 },
  );
  const made = await page.evaluate(() =>
    (window as any).vuEditor.project.tracks
      .find((x: any) => x.kind === 'caption')
      .items.map((i: any) => ({ text: i.text, unsure: !!i.unsure })),
  );
  check(
    'Hinglish: a language of its own, asked of the service as hi-Latn',
    asked[0]?.language === 'hi-Latn' && made[0]?.text === 'Namaste dosto.',
    JSON.stringify({ asked: asked[0]?.language, made }),
  );
  check(
    'names & words reach the service',
    asked[0]?.vocabulary === 'Priya, Goa',
    JSON.stringify(asked[0]),
  );
  check(
    'a caption heard with little confidence is marked to check',
    made.map((m: { unsure: boolean }) => m.unsure).join() === 'false,true' &&
      (await page.locator('.vu-caption-check').innerText()).includes('1 caption to check'),
  );
  await page.locator('.vu-caption-check .vu-btn', { hasText: 'Next to check' }).click();
  const picked = await page.evaluate(() => {
    const ctl = (window as any).vuEditor;
    const t = ctl.project.tracks.find((x: any) => x.kind === 'caption');
    return ctl.ui.getState().selectedId === t.items[1].id;
  });
  check('Next to check selects it', picked);
  await page.locator('.vu-caption-row[data-unsure] button[aria-label="Looks right"]').click();
  check(
    'Looks right takes the mark away',
    (await page.locator('.vu-caption-row[data-unsure]').count()) === 0 &&
      (await page.locator('.vu-caption-check').count()) === 0,
  );
  const before = asked.length;
  await page.locator('.vu-caption-row').first().locator('.vu-caption-time').click();
  await page
    .locator('.vu-caption-row')
    .first()
    .locator('button[aria-label="Hear this part again"]')
    .click();
  await page.waitForFunction(
    () => (window as any).vuEditor.ui.getState().captionJob === null,
    null,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(300);
  check(
    'Hear again asks for just that part, and keeps the other captions',
    asked.length === before + 1 &&
      asked[before]!.seconds < 4 &&
      (await page.evaluate(
        () =>
          (window as any).vuEditor.project.tracks.find((x: any) => x.kind === 'caption').items
            .length,
      )) >= 2,
    JSON.stringify(asked.slice(before)),
  );
  await snap(page, 'c8-check');
  // The panel with Hinglish, Names & words and check marks on screen.
  const panelAxe = await new AxeBuilder({ page }).include('.vu-panel').analyze();
  check(
    'Captions panel with the new controls passes axe',
    panelAxe.violations.length === 0,
    panelAxe.violations.map((v) => v.id).join(', '),
  );
  check('no page errors (check marks)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── a speech-to-text service with word times, in Chinese (no spaces between words) ──
{
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/captions**', (route) =>
    route.fulfill({
      json: {
        words: [
          { text: '大家好，', start: 0.3, end: 1.0 },
          { text: '欢迎', start: 1.1, end: 1.5 },
          { text: '回到', start: 1.5, end: 1.9 },
          { text: 'iPhone', start: 1.9, end: 2.4 },
          { text: '频道。', start: 2.4, end: 3.0 },
        ],
        language: 'zh',
      },
    }),
  );
  await load(page, 'transcriber=server', ['speech-en-gb.m4a']);
  await page.locator('.vu-rail .vu-btn', { hasText: 'Captions' }).click();
  await page.locator('.vu-panel button', { hasText: /More languages/ }).click();
  await page
    .locator('.vu-panel button', { hasText: /^Chinese$/ })
    .first()
    .click();
  await page.locator('.vu-panel .vu-btn', { hasText: 'Make captions' }).click();
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption'),
    null,
    { timeout: 60000 },
  );
  const zh = await page.evaluate(() => {
    const t = (window as any).vuEditor.project.tracks.find((x: any) => x.kind === 'caption');
    const first = t.items[0];
    return {
      texts: t.items.map((i: any) => i.text),
      words: first.words.map((w: any) => w.text),
      start: first.start / 705_600_000,
    };
  });
  check(
    'Chinese: words joined without spaces, one highlight word per character, times as given',
    zh.texts.join('|') === '大家好，欢迎回到iPhone频道。' &&
      zh.words.join(' ') === '大 家 好， 欢 迎 回 到 iPhone 频 道。' &&
      Math.abs(zh.start - 0.3) < 0.02,
    JSON.stringify(zh),
  );
  // The word highlight draws on it without errors (Karaoke look: word by word).
  await page.evaluate(() => (window as any).vuEditor.seek(Math.round(1.3 * 705_600_000)));
  await page.waitForTimeout(500);
  await snap(page, 'c7-chinese');
  check('no page errors (Chinese)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ── phone ───────────────────────────────────────────────────────────────
{
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, 'transcriber=fake', ['avc-1080p30.mp4']);
  await page.locator('.vu-toolbar .vu-btn', { hasText: 'Captions' }).tap();
  check(
    'phone: Captions opens in the sheet',
    await page.locator('.vu-dock .vu-captions').isVisible(),
  );
  // A host's own service with no language list: the panel offers its languages (Hindi too).
  await page
    .locator('.vu-dock button', { hasText: /^Hindi$/ })
    .first()
    .tap();
  await page.waitForTimeout(300);
  const make = page.locator('.vu-dock .vu-btn', { hasText: 'Make captions' });
  check(
    'phone: a host service can caption Hindi',
    (await make.getAttribute('aria-disabled')) !== 'true',
  );
  await page
    .locator('.vu-dock button', { hasText: /^English$/ })
    .first()
    .tap();
  // The sheet scrolls to its end while half open.
  const scrolls = await page.evaluate(() => {
    const body = document.querySelector('.vu-dock-body') as HTMLElement;
    body.scrollTop = body.scrollHeight;
    const last = body.querySelector('.vu-caption-sources') as HTMLElement;
    const r = last.getBoundingClientRect();
    const bar = document.querySelector('.vu-toolbar')!.getBoundingClientRect();
    return r.bottom <= bar.top + 1;
  });
  check('phone: the half-open sheet scrolls to its last control', scrolls);
  await page.locator('.vu-dock .vu-btn', { hasText: 'Make captions' }).tap();
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks.some((t: any) => t.kind === 'caption'),
    null,
    { timeout: 60000 },
  );
  await snap(page, 'p1-captions-sheet');
  const caps = await captions(page);
  await page.evaluate((id) => (window as any).vuEditor.select(id), caps!.items[0]!.id);
  await page
    .locator('.vu-done')
    .tap()
    .catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate((id) => (window as any).vuEditor.select(id), caps!.items[0]!.id);
  check(
    'phone: a selected caption shows caption tools',
    await page.locator('.vu-toolbar .vu-btn', { hasText: 'Join with next' }).isVisible(),
  );
  await snap(page, 'p2-caption-tools');
  check('no page errors (phone)', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
