/**
 * Writes the VideoUltra / ImageUltra brand files (DECISIONS #215): the mark on light and dark
 * grounds (full and small cut), the app icon, the favicon, PNG icons and the social card.
 * The mark is a plum ball with three flowing streams and two round-ended channels; each product
 * has its own badge at the bottom right (play for VideoUltra, photo for ImageUltra).
 * Usage: node scripts/brand.ts — writes brand/<product>/ and the playground's icon files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';

type Product = 'video' | 'image';
type Ground = 'light' | 'dark' | 'tile';

const ROOT = join(import.meta.dirname, '..');

/** Gradient stops (top → bottom) and the badge colour for each ground. */
const TONES: Record<Ground, { stops: [string, string, string]; badge: string }> = {
  light: { stops: ['#d79ad7', '#b462b4', '#6e2a6e'], badge: '#6e2a6e' },
  dark: { stops: ['#efc3ef', '#d590d5', '#8f408f'], badge: '#d590d5' },
  tile: { stops: ['#ffffff', '#f3d0f3', '#c37ac3'], badge: '#f3d0f3' },
};
const TILE = '#4d194d';

// Shapes, in a 120 × 120 box.
const BALL = '<circle cx="72" cy="60" r="42"/>';
const STREAMS = [
  'M40 40C33 40 30 33 35 29.5C40 26 47 28.5 54 26C61 23.5 66 19 76 18.5L80 46L46 46C43 44 42 41 40 40z',
  'M4 62C14 57 21 50 32 50C42 50 50 52 58 48L64 78C52 76 44 72 34 72C24 72 18 70 12 66C17 66 20 65 22 63.5C16 63 10 62.5 4 62z',
  'M24 92C30 84 38 80 48 80C56 80 60 84 68 84L74 102C62 104 50 102 42 98C36 95 30 93 24 92z',
];
/** Small flame flicks: only in the full cut (48 px and up); they blur at favicon sizes. */
const FLICKS = [
  'M47 24.5C52 18 60 15.5 67 16.5C61 18 55 21 50 25.5z',
  'M14 51C20 45 28 44 34 46.5C28 47 22 48.5 18 51z',
];
const CHANNELS = [
  'M-6 48C8 46 16 41 28 41C40 41 46 46 58 44C64 43 70 41 74 43C78 45 76 51 71 51C66 51 62 52 56 54C46 57 38 52 28 52C16 52 6 55 -6 56z',
  'M-6 76C10 74 20 70 32 72C44 74 50 79 62 76C68 74.5 74 72 78 74.5C82 77 80 83 74 82.5C68 82 64 84 58 85C46 87 38 82 26 82C14 82 4 84 -6 84z',
];
const BADGE_GAP = '<circle cx="100" cy="94" r="20.5" fill="#000"/>';
const BADGE_ICON: Record<Product, string> = {
  video:
    '<path d="M95 86.5V101.5L107 94Z" fill="#000" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/>',
  image:
    '<circle cx="104.5" cy="87.5" r="2.8" fill="#000"/><path d="M89.5 101L95.5 92.5L99.8 97.5L102.3 94.5L108.5 101Z" fill="#000" stroke="#000" stroke-width="2" stroke-linejoin="round"/>',
};

/** The mark's SVG body (no outer `<svg>`). `prefix` keeps ids unique when several are inlined. */
function markBody(product: Product, ground: Ground, full: boolean, prefix: string): string {
  const t = TONES[ground];
  const flicks = full ? FLICKS.map((d) => `<path d="${d}"/>`).join('') : '';
  return (
    `<defs>` +
    `<linearGradient id="${prefix}g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${t.stops[0]}"/><stop offset=".45" stop-color="${t.stops[1]}"/><stop offset="1" stop-color="${t.stops[2]}"/></linearGradient>` +
    `<mask id="${prefix}k"><rect width="120" height="120" fill="#fff"/>${CHANNELS.map((d) => `<path d="${d}" fill="#000"/>`).join('')}${BADGE_GAP}</mask>` +
    `<clipPath id="${prefix}s">${BALL}${STREAMS.map((d) => `<path d="${d}"/>`).join('')}${flicks}</clipPath>` +
    `<mask id="${prefix}b"><rect width="120" height="120" fill="#fff"/>${BADGE_ICON[product]}</mask>` +
    `</defs>` +
    `<g mask="url(#${prefix}k)"><rect width="120" height="120" fill="url(#${prefix}g)" clip-path="url(#${prefix}s)"/></g>` +
    `<circle cx="100" cy="94" r="16" fill="${t.badge}" mask="url(#${prefix}b)"/>`
  );
}

const NAME: Record<Product, string> = { video: 'VideoUltra', image: 'ImageUltra' };
const svg = (title: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

function mark(product: Product, ground: 'light' | 'dark', full: boolean): string {
  return svg(NAME[product], markBody(product, ground, full, 'vu'));
}
/** `square`: no rounded corners (iOS rounds home-screen icons itself). */
function appIcon(product: Product, full: boolean, square = false): string {
  return svg(
    NAME[product],
    `<rect width="120" height="120" rx="${square ? 0 : 28}" fill="${TILE}"/><g transform="translate(12 12) scale(.8)">${markBody(product, 'tile', full, 'vu')}</g>`,
  );
}

function write(path: string, data: string | Buffer) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  console.log('wrote', path);
}

const TAGLINE: Record<Product, string> = {
  video: 'A free, fast, fully typed video editor for React and Next.js.',
  image: 'A free, fully typed image editor for React and Next.js.',
};

/** The 1200 × 630 card shown when a link is shared. */
function socialHtml(product: Product): string {
  const name = NAME[product];
  const head = name.replace('Ultra', '');
  return `<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#0b0b0d;display:flex;align-items:center;justify-content:center;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="display:flex;flex-direction:column;align-items:center;gap:28px">
    <svg viewBox="0 0 120 120" width="240" height="240">${markBody(product, 'dark', true, 's')}</svg>
    <div style="font-size:88px;font-weight:700;letter-spacing:-2px;color:#f4f4f5">${head}<span style="color:#e0a8e0">Ultra</span></div>
    <div style="font-size:32px;color:#a1a1aa">${TAGLINE[product]}</div>
  </div></body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(html: string, width: number, height: number): Promise<Buffer> {
  await page.setViewportSize({ width, height });
  await page.setContent(html);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } });
}
const iconHtml = (s: string, size: number) =>
  `<!doctype html><html><body style="margin:0;background:transparent">${s.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;

for (const product of ['video', 'image'] as const) {
  const dir = `brand/${product}-ultra`;
  write(`${dir}/mark-light.svg`, mark(product, 'light', true));
  write(`${dir}/mark-dark.svg`, mark(product, 'dark', true));
  write(`${dir}/mark-small-light.svg`, mark(product, 'light', false));
  write(`${dir}/mark-small-dark.svg`, mark(product, 'dark', false));
  write(`${dir}/app-icon.svg`, appIcon(product, true));
  write(`${dir}/favicon.svg`, appIcon(product, false));
  write(`${dir}/app-icon-512.png`, await png(iconHtml(appIcon(product, true), 512), 512, 512));
  write(
    `${dir}/apple-touch-icon.png`,
    await png(iconHtml(appIcon(product, true, true), 180), 180, 180),
  );
  write(`${dir}/social.png`, await png(socialHtml(product), 1200, 630));
}

// The playground (docs + demo site) uses VideoUltra's files.
write('apps/playground/app/icon.svg', appIcon('video', false));
write(
  'apps/playground/app/apple-icon.png',
  await png(iconHtml(appIcon('video', true, true), 180), 180, 180),
);
write('apps/playground/app/opengraph-image.png', await png(socialHtml('video'), 1200, 630));
write('apps/playground/public/brand/mark-light.svg', mark('video', 'light', true));
write('apps/playground/public/brand/mark-dark.svg', mark('video', 'dark', true));

await browser.close();
