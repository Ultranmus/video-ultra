/**
 * The docs site in a real browser: the home page and every docs page load with no errors, pass
 * axe (WCAG 2 A/AA), have no horizontal scroll at phone width, and the API reference is served.
 * The home page's demo button loads the editor in place (desktop) or opens it (phone).
 * Usage: playground running (and `pnpm docs:api` run), then node scripts/docs-check.ts [--shots <dir>]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices } from '@playwright/test';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
const shots = arg('shots');
const PAGES = [
  '',
  'getting-started',
  'nextjs',
  'vite',
  'saving',
  'options',
  'events',
  'customize',
  'theming',
  'captions',
  'ai',
  'performance',
];

let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
for (const [kind, context] of [
  ['desktop', { viewport: { width: 1280, height: 860 } }],
  ['phone', { ...devices['iPhone 13'] }],
] as const) {
  const page = await (await browser.newContext(context)).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  for (const path of ['/', ...PAGES.map((p) => `/docs${p ? `/${p}` : ''}`)]) {
    const response = await page.goto(`http://localhost:${port}${path}`);
    const name = path === '/' ? 'home' : path.split('/').pop() || 'intro';
    check(`${kind} ${path}: loads`, response?.ok() ?? false, String(response?.status()));
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    check(
      `${kind} ${path}: axe`,
      axe.violations.length === 0,
      axe.violations.map((v) => `${v.id}×${v.nodes.length}`).join(','),
    );
    if (kind === 'phone') {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      check(`phone ${path}: no sideways scroll`, !wide);
    }
    if (shots) await page.screenshot({ path: `${shots}/${kind}-${name}.png`, fullPage: false });
  }
  // The home page's demo: the real editor in place on a desktop, the full-screen editor on a phone.
  await page.goto(`http://localhost:${port}/`);
  await page
    .getByRole('button', { name: kind === 'desktop' ? 'Try it here' : 'Open the editor' })
    .click();
  if (kind === 'desktop') {
    const frame = page.frameLocator('iframe[title="VideoUltra live editor"]');
    const shown = await frame
      .locator('.vu-root')
      .waitFor({ timeout: 30_000 })
      .then(
        () => true,
        () => false,
      );
    check('desktop /: "Try it here" loads the editor in place', shown);
  } else {
    const opened = await page.waitForURL('**/editor', { timeout: 30_000 }).then(
      () => true,
      () => false,
    );
    check('phone /: "Open the editor" opens the editor', opened);
  }
  check(`${kind}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
}
const api = await (await browser.newContext()).newPage();
const r = await api.goto(`http://localhost:${port}/api/index.html`);
check('API reference is served', r?.ok() ?? false, String(r?.status()));
check('API reference lists the editor', (await api.content()).includes('@video-ultra/react'));
await browser.close();
console.log(results.filter((x) => x.startsWith('FAIL')).join('\n') || '(no failures)');
console.log(`${results.length} checks`);
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
