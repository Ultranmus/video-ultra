/**
 * Accessibility audit of the editor with axe (WCAG 2.2 A/AA rules), at phone and desktop sizes,
 * empty and with media + a selected clip + an open tool. Usage: playground running, then
 * node scripts/a11y-check.ts [--port 3200] [--theme dark|light]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const theme = arg('theme') ?? 'dark';
/** The bits of the playground's `window.vuEditor` (EditorController) this script uses. */
interface Ctl {
  project: { tracks: { items: { id: string; kind: string }[] }[] };
  ui: { getState(): { layout: string } };
  select(id: string | null): void;
  openTool(tool: string | null): void;
}
let total = 0;
const browser = await chromium.launch({ channel: 'chrome' });
for (const [size, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
] as const) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(`http://localhost:${port}/editor?autosave=0&theme=${theme}`);
  await page.waitForSelector('.vu-stage-canvas');
  const audit = async (label: string) => {
    const result = await new AxeBuilder({ page })
      .include('.vu-root')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    total += result.violations.length;
    console.log(`${size} · ${label}: ${result.violations.length} violations`);
    for (const v of result.violations)
      console.log(
        `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join('\n    ')}`,
      );
  };
  await audit('empty');
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles([
      resolve('test-media/files/avc-1080p30.mp4'),
      resolve('test-media/files/music.mp3'),
    ]);
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length >= 2);
  await page.locator('[role="option"]').first().focus();
  await page
    .locator('.vu-toolbar .vu-btn, .vu-inspector .vu-btn', { hasText: /^Mute$|Volume/ })
    .first()
    .click();
  await page.waitForTimeout(300);
  await audit('clip selected + volume tool');
  await page.locator('.vu-topbar .vu-btn', { hasText: 'Export' }).first().click();
  await page.waitForTimeout(200);
  await audit('export dialog');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // v0.2 B. Sound: "Lower under voice" on the music, then the Audio panel with the demo library.
  await page.evaluate(() => {
    const c = (window as unknown as { vuEditor: Ctl }).vuEditor;
    const music = c.project.tracks.flatMap((t) => t.items).find((i) => i.kind === 'audio')!;
    c.select(music.id);
    if (c.ui.getState().layout !== 'desktop') c.openTool('volume');
  });
  await page.locator('.vu-duck-switch').first().click();
  await page.waitForTimeout(300);
  await audit('music selected + lower under voice on');
  await page.evaluate(() => {
    const c = (window as unknown as { vuEditor: Ctl }).vuEditor;
    c.openTool(null);
    c.select(null);
  });
  await page.waitForTimeout(300);
  await page
    .locator('.vu-toolbar .vu-btn, .vu-rail .vu-btn', { hasText: /^Audio$/ })
    .first()
    .click();
  await page.waitForSelector('.vu-audiolib-row', { timeout: 15000 });
  await audit('audio panel + music & sounds library');
  await page.close();
}
await browser.close();
process.exit(total ? 1 : 0);
