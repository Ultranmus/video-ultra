/**
 * Runs the playground's /bench page in several browsers and prints each browser's Markdown report.
 * Usage: start the playground (`pnpm --filter playground dev`), then
 *   node scripts/bench.ts [--browsers chrome,chromium,webkit,firefox] [--files avc-1080p30.mp4,...]
 *                         [--backends auto,webgl2] [--play seconds] [--save dir] [--headed]
 *
 * `chrome` is the installed Google Chrome (real GPU + hardware decoding) — the closest to what
 * users run. `chromium`, `webkit` and `firefox` are Playwright's builds (WebKit ≈ Safari's engine).
 */
import { chromium, firefox, webkit, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]!;
  if (key === '--headed') args.set('headed', '1');
  else if (key.startsWith('--')) args.set(key.slice(2), process.argv[++i] ?? '');
}
const base = args.get('url') ?? 'http://localhost:3200';
const browsers = (args.get('browsers') ?? 'chrome,webkit,firefox').split(',');
const files = (args.get('files') ?? 'avc-1080p30.mp4').split(',');
const backends = (args.get('backends') ?? 'auto').split(',');
const headless = !args.has('headed');
/** Directory to save each exported file into (to check it with ffprobe). */
const saveDir = args.get('save');

async function launch(name: string): Promise<Browser> {
  switch (name) {
    case 'chrome':
      return chromium.launch({ channel: 'chrome', headless, args: ['--enable-unsafe-webgpu'] });
    case 'chromium':
      return chromium.launch({ headless, args: ['--enable-unsafe-webgpu'] });
    case 'webkit':
      return webkit.launch({ headless });
    case 'firefox':
      return firefox.launch({ headless });
    default:
      throw new Error(`Unknown browser ${name}`);
  }
}

async function runOne(page: Page, file: string, backend: string): Promise<string> {
  await page.goto(`${base}/bench${args.has('play') ? `?play=${args.get('play')}` : ''}`);
  await page.waitForFunction(() => /Engine ready|failed/.test(document.body.innerText), null, {
    timeout: 30_000,
  });
  if (backend !== 'auto') {
    await page.locator('select').first().selectOption(backend);
    await page.waitForFunction(
      (b) =>
        document.body.innerText.includes(`renderer: ${b}`) ||
        /failed/.test(document.body.innerText),
      backend,
      { timeout: 30_000 },
    );
  }
  const engineError = await page.locator('.error').allInnerTexts();
  if (engineError.length) return `ENGINE ERROR: ${engineError.join(' | ')}`;
  await page.locator('select').nth(1).selectOption(file);
  await page.getByRole('button', { name: 'Run all' }).click();
  // Done when the export block appears or an error shows up.
  await page.waitForFunction(
    () =>
      /### Export/.test(document.querySelector('pre')?.textContent ?? '') ||
      document.querySelector('.error'),
    null,
    { timeout: 180_000 + Number(args.get('play') ?? 0) * 1500 },
  );
  const report =
    (await page
      .locator('pre')
      .textContent()
      .catch(() => '')) ?? '';
  if (saveDir && (await page.locator('video').count())) {
    const base64 = await page.evaluate(async () => {
      const src = document.querySelector('video')!.src;
      const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    });
    mkdirSync(saveDir, { recursive: true });
    const name = `${page.context().browser()?.browserType().name()}-${backend}-${file.replace(/\.[^.]+$/, '').replace(/[\/]/g, '_')}.mp4`;
    writeFileSync(join(saveDir, name), Buffer.from(base64, 'base64'));
  }
  const errors = await page.locator('.error').allInnerTexts();
  const caps = await page.locator('table').first().innerText();
  return [
    errors.length ? `ERRORS: ${errors.join(' | ')}` : '',
    '#### Capabilities',
    caps.replace(/\t/g, ': '),
    report,
  ]
    .filter(Boolean)
    .join('\n');
}

for (const name of browsers) {
  let browser: Browser;
  try {
    browser = await launch(name);
  } catch (error) {
    console.log(`\n===== ${name}: could not launch (${String(error).split('\n')[0]})`);
    continue;
  }
  for (const backend of backends) {
    for (const file of files) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const logs: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
      });
      page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
      console.log(`\n===== ${name} · ${backend} · ${file}`);
      try {
        console.log(await runOne(page, file, backend));
      } catch (error) {
        console.log(`RUN FAILED: ${String(error).split('\n')[0]}`);
        console.log(
          (
            await page
              .locator('body')
              .innerText()
              .catch(() => '')
          ).slice(0, 1500),
        );
      }
      if (logs.length) console.log('Console:\n' + logs.slice(0, 15).join('\n'));
      await page.close();
    }
  }
  await browser.close();
}
