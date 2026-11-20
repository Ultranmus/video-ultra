/**
 * The docs site in a real browser: the home page, every docs page and every API reference page
 * load with no errors, pass axe (WCAG 2 A/AA) and have no horizontal page scroll at phone width (a
 * long declaration scrolls inside its own code box). The API search finds exports, and the old
 * generated API URL (/api/index.html) redirects to /docs/api. The home page's demo button loads the
 * editor in place (desktop) or opens it (phone).
 * Usage: playground running (and `pnpm docs:api` run), then
 *   node scripts/docs-check.ts [--port 3200 | --base http://host:port] [--shots <dir>]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices } from '@playwright/test';
import { PAGES as DOCS } from '../apps/playground/app/docs/nav.ts';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const base = (arg('base') ?? `http://localhost:${arg('port') ?? '3200'}`).replace(/\/$/, '');
const shots = arg('shots');
/** The API reference: the overview (in DOCS) and one page per package. */
const API_PACKAGES = ['react', 'core', 'captions', 'ai'];
const PATHS = [
  '/',
  '/playground',
  '/bench',
  ...DOCS.map((p) => p.href),
  ...API_PACKAGES.map((p) => `/docs/api/${p}`),
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
  for (const path of PATHS) {
    const response = await page.goto(`${base}${path}`);
    const name = path === '/' ? 'home' : path.slice(1).replaceAll('/', '-');
    check(`${kind} ${path}: loads`, response?.ok() ?? false, String(response?.status()));
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    check(
      `${kind} ${path}: axe`,
      axe.violations.length === 0,
      axe.violations.map((v) => `${v.id}×${v.nodes.length}`).join(','),
    );
    // Every dropdown uses the site's chevron with room for it (never the browser's own arrow).
    const plain = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLSelectElement>('.site select')]
          .filter((el) => !el.closest('.vu-root'))
          .filter((el) => {
            const c = getComputedStyle(el);
            return c.appearance !== 'none' || !c.backgroundImage.startsWith('url');
          }).length,
    );
    check(`${kind} ${path}: dropdowns use the site chevron`, plain === 0, `${plain} plain`);
    if (kind === 'phone') {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      check(`phone ${path}: no sideways scroll`, !wide);
      if (path === '/docs/api/react') {
        // VideoEditorProps has lines wider than a phone: they scroll in the code box instead.
        const boxed = await page
          .locator('#VideoEditorProps pre')
          .evaluate((pre) => pre.scrollWidth > pre.clientWidth);
        check('phone /docs/api/react: a long declaration scrolls in its own box', boxed);
      }
    }
    if (shots) await page.screenshot({ path: `${shots}/${kind}-${name}.png`, fullPage: false });
  }
  // The home page's editor window: on a desktop the real editor loads when it scrolls into view
  // (not before), and the Phone tab narrows it; on a phone a picture opens the full-screen editor.
  await page.goto(`${base}/`);
  const demo = page.locator('.home-window');
  if (kind === 'desktop') {
    const early = await demo.locator('.vu-root').count();
    check('desktop /: the editor is not loaded before it is scrolled to', early === 0);
    await demo.scrollIntoViewIfNeeded();
    const shown = await demo
      .locator('.vu-root')
      .waitFor({ timeout: 30_000 })
      .then(
        () => true,
        () => false,
      );
    check('desktop /: the editor loads in its window when scrolled to', shown);
    await demo.getByRole('button', { name: 'Phone' }).click();
    const width = await demo.locator('.home-window-frame').evaluate((el) => el.clientWidth);
    check('desktop /: the Phone tab shows it at phone width', width <= 395, `${width}px`);
  } else {
    await demo.getByRole('link', { name: 'Open the editor' }).click();
    const opened = await page.waitForURL('**/editor', { timeout: 30_000 }).then(
      () => true,
      () => false,
    );
    check('phone /: "Open the editor" opens the editor', opened);
  }
  check(`${kind}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
}
// The API reference: search finds an export and links to it; old generated URLs redirect.
const api = await (await browser.newContext()).newPage();
await api.goto(`${base}/docs/api`);
await api.getByLabel('Search the API').fill('splitItem');
const hit = api.locator('a[href="/docs/api/core#splitItem"]');
check(
  'API search finds splitItem',
  await hit.waitFor({ timeout: 5000 }).then(
    () => true,
    () => false,
  ),
);
check(
  'API search announces the count',
  /export(s)? match/.test((await api.locator('.api-search-status').textContent()) ?? ''),
);
await hit.click();
check(
  'API search result opens the export',
  // The core page is large: wait for it rather than looking at once.
  await api
    .locator('#splitItem')
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(
      () => true,
      () => false,
    ),
);
const old = await api.request.get(`${base}/api/index.html`, { maxRedirects: 0 });
check(
  'old /api/index.html redirects to /docs/api',
  old.status() === 308 && (old.headers().location ?? '').endsWith('/docs/api'),
  `${old.status()} ${old.headers().location ?? ''}`,
);
const react = await api.goto(`${base}/docs/api/react`);
check(
  'API reference lists the editor',
  (react?.ok() ?? false) && (await api.locator('#VideoEditor').count()) === 1,
);
await browser.close();
console.log(results.filter((x) => x.startsWith('FAIL')).join('\n') || '(no failures)');
console.log(`${results.length} checks`);
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
