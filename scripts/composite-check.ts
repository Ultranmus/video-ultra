/**
 * Golden composite check: renders /lab/composite (background, letterboxed video, rotated
 * semi-transparent picture-in-picture, transparent PNG) through WebGPU and WebGL2 in each browser,
 * checks the backends agree and known pixels are right. Needs the playground and `pnpm media`.
 * Usage: node scripts/composite-check.ts [--browsers chrome,webkit]
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shapeCoverage, shapePreset } from '../packages/core/src/effects/shapes.ts';

/** Playground URL (PLAYGROUND=http://localhost:3301 when another dev server uses 3200). */
const BASE = process.env.PLAYGROUND ?? 'http://localhost:3200';

const SIZE = 640;
const arg = process.argv.indexOf('--browsers');
const names = (arg > 0 ? process.argv[arg + 1]! : 'chrome,webkit').split(',');
/** --save <dir>: write the golden engine frames as PNGs (needs ffmpeg). */
const save = process.argv.includes('--save')
  ? process.argv[process.argv.indexOf('--save') + 1]
  : undefined;
const launch = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  webkit: () => webkit.launch(),
  firefox: () => firefox.launch(),
};
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
};
const px = (img: Buffer, x: number, y: number) => [
  ...img.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3),
];

const all: Record<string, Buffer> = {};
for (const name of names) {
  const browser = await launch[name as keyof typeof launch]();
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/composite`);
  await page.waitForFunction(
    () => document.getElementById('report')?.textContent !== 'Rendering…',
    null,
    { timeout: 60000 },
  );
  const r = JSON.parse((await page.locator('#report').textContent())!) as Record<string, string>;
  await browser.close();
  console.log(`== ${name}`);
  for (const [k, v] of Object.entries(r))
    if (k.endsWith('-error')) console.log(`  (${k}: ${v.slice(0, 80)})`);
  const images = Object.fromEntries(
    Object.entries(r)
      .filter(([k]) => !k.endsWith('-error'))
      .map(([k, v]) => [k, Buffer.from(v, 'base64')]),
  );
  for (const [backend, img] of Object.entries(images)) {
    all[`${name}-${backend}`] = img;
    const bg = px(img, 5, 5);
    check(
      Math.abs(bg[0]! - 26) <= 3 && Math.abs(bg[2]! - 77) <= 3,
      `${backend}: letterbox shows the background colour (${bg.join(',')})`,
    );
    // Purple (128, 0, 128) at 90% over the video: 0.9 × 128 + 0.1 × video ≈ 115 for R and B.
    // A double-premultiplied upload gives ~103 (alpha applied twice) — must not happen.
    const purple = px(img, 160, 397);
    const expectRB = Math.round(0.9 * 128);
    check(
      Math.abs(purple[0]! - expectRB) <= 4 &&
        Math.abs(purple[2]! - expectRB) <= 6 &&
        purple[1]! < 45,
      `${backend}: PNG square blended at 90% (${purple.join(',')}, expect R≈B≈${expectRB})`,
    );
  }
  if (images.webgpu && images.webgl2) {
    let sum = 0;
    for (let i = 0; i < images.webgpu.length; i += 4)
      for (let c = 0; c < 3; c++) sum += Math.abs(images.webgpu[i + c]! - images.webgl2[i + c]!);
    const mae = sum / (SIZE * SIZE * 3);
    check(mae < 1.5, `WebGPU and WebGL2 match (mean difference ${mae.toFixed(2)} / 255)`);
  }
}
const keys = Object.keys(all);
if (keys.length > 1) {
  const [a, b] = [all[keys[0]!]!, all[keys[keys.length - 1]!]!];
  let sum = 0;
  for (let i = 0; i < a.length; i += 4)
    for (let c = 0; c < 3; c++) sum += Math.abs(a[i + c]! - b[i + c]!);
  check(
    sum / (SIZE * SIZE * 3) < 2,
    `${keys[0]} and ${keys[keys.length - 1]} match (${(sum / (SIZE * SIZE * 3)).toFixed(2)} / 255)`,
  );
}
// ── Golden engine frames: filters, adjustments, transitions, text, blurred background ──
// /lab/engine?golden=1 renders the same timeline with effects ("fx") and without ("plain")
// through the real engine (engine.capture) on both GPU backends.
type Img = Buffer;
const region = (img: Img, x0: number, y0: number, x1: number, y1: number) => {
  const values: number[][] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) values.push(px(img, x, y));
  return values;
};
const mean = (values: number[][], f: (p: number[]) => number) =>
  values.reduce((s, p) => s + f(p), 0) / values.length;
const luma = (p: number[]) => 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!;
const std = (values: number[][]) => {
  const m = mean(values, luma);
  return Math.sqrt(mean(values, (p) => (luma(p) - m) ** 2));
};
const mae = (a: Img, b: Img, x0 = 0, y0 = 0, x1 = SIZE, y1 = SIZE) => {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      for (let c = 0; c < 3; c++, n++) {
        const i = (y * SIZE + x) * 4 + c;
        sum += Math.abs(a[i]! - b[i]!);
      }
  return sum / n;
};
const goldenAll: Record<string, Record<string, Img>> = {};
for (const name of names) {
  const browser = await launch[name as keyof typeof launch]();
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/engine?golden=1&backend=webgl2`);
  await page.waitForFunction(
    () => /Golden done|FAILED|error/i.test(document.getElementById('status')!.textContent!),
    null,
    { timeout: 120000 },
  );
  const status = await page.locator('#status').innerText();
  const report = (await page.evaluate(() => window.goldenReport ?? {})) as Record<string, string>;
  await browser.close();
  console.log(`== ${name} · golden engine frames (${status})`);
  for (const [k, v] of Object.entries(report))
    if (k.endsWith('-error')) console.log(`  (${k}: ${v.slice(0, 100)})`);
  const g: Record<string, Img> = {};
  for (const [k, v] of Object.entries(report))
    if (!k.endsWith('-error')) g[k] = Buffer.from(v, 'base64');
  goldenAll[name] = g;
  if (save) {
    mkdirSync(save, { recursive: true });
    for (const [k, img] of Object.entries(g)) {
      const raw = join(save, `${name}-${k}.rgba`);
      writeFileSync(raw, img);
      execFileSync('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        `${SIZE}x${SIZE}`,
        '-i',
        raw,
        join(save, `${name}-${k}.png`),
      ]);
      rmSync(raw);
    }
  }
  const backends = ['webgpu', 'webgl2'].filter((b) => g[`fx-${b}-0.6`]);
  check(backends.length > 0, `golden frames rendered (${backends.join(', ') || 'none'})`);
  for (const b of backends) {
    const fx = (t: number) => g[`fx-${b}-${t}`]!;
    const plain = (t: number) => g[`plain-${b}-${t}`]!;
    // Band inside the video, above the title: rows 160–260.
    const band = (img: Img) => region(img, 20, 160, 620, 260);
    const warmFx = mean(band(fx(0.6)), (p) => p[0]! - p[2]!);
    const warmPlain = mean(band(plain(0.6)), (p) => p[0]! - p[2]!);
    check(
      warmFx > warmPlain + 8,
      `${b}: warm filter shifts red−blue (${warmPlain.toFixed(1)} → ${warmFx.toFixed(1)})`,
    );
    const sFx = std(band(fx(3)));
    const sPlain = std(band(plain(3)));
    check(
      sFx > sPlain * 1.1,
      `${b}: contrast adjustment widens the spread (${sPlain.toFixed(1)} → ${sFx.toFixed(1)})`,
    );
    const cornerRatio = (img: Img) =>
      mean(region(img, 4, 146, 60, 190), luma) /
      Math.max(1, mean(region(img, 290, 180, 350, 230), luma));
    check(
      cornerRatio(fx(3)) < cornerRatio(plain(3)) * 0.85,
      `${b}: vignette darkens the corners (${cornerRatio(plain(3)).toFixed(2)} → ${cornerRatio(fx(3)).toFixed(2)})`,
    );
    const dissolve = mae(fx(2), plain(2), 20, 160, 620, 260);
    check(
      dissolve > 4,
      `${b}: dissolve midpoint mixes in the outgoing clip (differs by ${dissolve.toFixed(1)})`,
    );
    const wipeLeft = mae(fx(4), plain(4), 20, 160, 280, 260);
    const wipeRight = mae(fx(4), plain(4), 360, 160, 620, 260);
    check(
      wipeLeft < 6 && wipeRight > wipeLeft + 4,
      `${b}: wipe midpoint shows the new clip on the left only (left ${wipeLeft.toFixed(1)}, right ${wipeRight.toFixed(1)})`,
    );
    const white = (img: Img) =>
      region(img, 200, 280, 440, 360).filter((p) => p[0]! > 235 && p[1]! > 235 && p[2]! > 235)
        .length;
    check(
      white(fx(0.6)) > white(plain(0.6)) + 300,
      `${b}: title text drawn (${white(plain(0.6))} → ${white(fx(0.6))} white px)`,
    );
    const top = (img: Img) => region(img, 0, 0, SIZE, 110);
    check(mean(top(plain(0.6)), luma) < 3, `${b}: plain letterbox is the black background`);
    check(
      mean(top(fx(0.6)), luma) > 12 && std(top(fx(0.6))) > 2,
      `${b}: blurred background fills the letterbox (mean ${mean(top(fx(0.6)), luma).toFixed(1)}, std ${std(top(fx(0.6))).toFixed(1)})`,
    );
  }
  checkTransitions(g, backends);
  checkAnimations(g, backends);
  checkPictureTools(g, backends);
  if (backends.length === 2) {
    // The two backends get slightly different pixels from the browser's own YUV → RGB step (the
    // plain video area already differs by ~2 / 255 on Chrome); effects must not add to that.
    for (const t of [0.6, 2, 3, 4]) {
      const base = mae(g[`plain-webgpu-${t}`]!, g[`plain-webgl2-${t}`]!, 0, 146, SIZE, 494);
      const d = mae(g[`fx-webgpu-${t}`]!, g[`fx-webgl2-${t}`]!);
      const text = mae(g[`fx-webgpu-${t}`]!, g[`fx-webgl2-${t}`]!, 200, 280, 440, 360);
      check(
        d < base + 1 && text < 1.5,
        `fx ${t} s: WebGPU and WebGL2 match (mean difference ${d.toFixed(2)}, decode baseline ${base.toFixed(2)}, text ${text.toFixed(2)} / 255)`,
      );
    }
  }
}
const goldenNames = Object.keys(goldenAll);
if (goldenNames.length > 1) {
  const [a, b] = [goldenAll[goldenNames[0]!]!, goldenAll[goldenNames[goldenNames.length - 1]!]!];
  for (const t of [0.6, 2, 3, 4]) {
    const ka = `fx-${a[`fx-webgpu-${t}`] ? 'webgpu' : 'webgl2'}-${t}`;
    const kb = `fx-webgl2-${t}`;
    if (!a[ka] || !b[kb]) continue;
    const d = mae(a[ka], b[kb]);
    // Different engines decode and scale slightly differently; text antialiasing differs too.
    check(
      d < 4,
      `fx ${t} s: ${goldenNames[0]} and ${goldenNames[goldenNames.length - 1]} agree (${d.toFixed(2)} / 255)`,
    );
  }
}

for (const prefix of ['tx-', 'anim-', 'pic-']) {
  if (goldenNames.length < 2) break;
  const [a, b] = [goldenAll[goldenNames[0]!]!, goldenAll[goldenNames[goldenNames.length - 1]!]!];
  let worst = 0;
  let worstKey = '';
  for (const key of Object.keys(b)) {
    if (!key.startsWith(prefix) || !key.includes('webgl2')) continue;
    const other = a[key.replace('webgl2', 'webgpu')] ?? a[key];
    if (!other) continue;
    const d = mae(other, b[key]!);
    if (d > worst) [worst, worstKey] = [d, key];
  }
  // Different engines decode and scale the footage slightly differently (bbb: up to ~5 / 255).
  check(
    worst < 6,
    `${prefix}* frames: ${goldenNames[0]} and ${goldenNames[goldenNames.length - 1]} agree (worst ${worst.toFixed(2)} / 255 at ${worstKey})`,
  );
}

/**
 * Transition golden frames (`tx-<type>-<backend>`, 30 % into a 1 s window, /lab/engine): both
 * backends agree, lane overlays (an opaque magenta title box, an emoji) are untouched, and every
 * transition changes the main picture.
 */
function checkTransitions(g: Record<string, Img>, backends: string[]): void {
  const types = [
    ...new Set(
      Object.keys(g)
        .filter((k) => k.startsWith('tx-') && !k.startsWith('tx-none'))
        .map((k) => k.replace(/^tx-/, '').replace(/-(webgpu|webgl2)$/, '')),
    ),
  ];
  check(types.length >= 20, `transition golden frames: ${types.length} families`);
  for (const b of backends) {
    const none = g[`tx-none-${b}`];
    if (!none) continue;
    // The magenta title box, found in the plain frame.
    let [x0, y0, x1, y1] = [SIZE, SIZE, 0, 0];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const [r, gg, bb] = px(none, x, y);
        if (r! > 235 && gg! < 25 && bb! > 235) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    check(x1 > x0 + 40 && y1 > y0 + 10, `${b}: overlay title box found (${x0},${y0}–${x1},${y1})`);
    const lane = (img: Img) => mae(img, none, x0 + 3, y0 + 3, x1 - 2, y1 - 2);
    // The emoji's opaque middle (sticker at 0.8, 0.68, scale 0.3 → 192 px square).
    const star = (img: Img) => mae(img, none, 497, 420, 527, 450);
    const moved: string[] = [];
    const same: string[] = [];
    for (const t of types) {
      const img = g[`tx-${t}-${b}`];
      if (!img) continue;
      if (lane(img) > 1.5 || star(img) > 3)
        moved.push(`${t} (${lane(img).toFixed(1)}, ${star(img).toFixed(1)})`);
      // The main picture outside the overlays.
      const d = mae(img, none, 0, 0, SIZE, 400);
      if (d < 1.5) same.push(`${t} (${d.toFixed(1)})`);
    }
    check(
      moved.length === 0,
      `${b}: lane overlays untouched by every transition${moved.length ? ` — moved: ${moved.join(', ')}` : ''}`,
    );
    check(
      same.length === 0,
      `${b}: every transition changes the picture${same.length ? ` — unchanged: ${same.join(', ')}` : ''}`,
    );
  }
  if (backends.length === 2) {
    const base = mae(g['tx-none-webgpu']!, g['tx-none-webgl2']!);
    const off: string[] = [];
    let worst = 0;
    for (const t of types) {
      const [a, c] = [g[`tx-${t}-webgpu`], g[`tx-${t}-webgl2`]];
      if (!a || !c) continue;
      const d = mae(a, c);
      worst = Math.max(worst, d);
      if (d > base + 1.5) off.push(`${t} ${d.toFixed(2)}`);
    }
    check(
      off.length === 0,
      `transitions: WebGPU and WebGL2 match (worst ${worst.toFixed(2)}, decode baseline ${base.toFixed(2)} / 255)${off.length ? ` — off: ${off.join(', ')}` : ''}`,
    );
  }
}

/**
 * Animation golden frames (`anim[plain]-<backend>-<t>`): a title typing in over 0–1 s, an emoji
 * popping in (0–0.6 s) then spinning (loop), a photo sliding in from the left (0–0.8 s).
 */
function checkAnimations(g: Record<string, Img>, backends: string[]): void {
  for (const b of backends) {
    const at = (t: number, plain = false) => g[`anim${plain ? 'plain' : ''}-${b}-${t}`];
    if (!at(0.3) || !at(1.5, true)) continue;
    const white = (img: Img) =>
      region(img, 40, 100, 600, 160).filter((p) => p[0]! > 235 && p[1]! > 235 && p[2]! > 235)
        .length;
    const full = white(at(1.5, true)!);
    const w03 = white(at(0.3)!);
    const w05 = white(at(0.5)!);
    const w15 = white(at(1.5)!);
    check(
      w03 > 0 && w03 < w05 && w05 < full * 0.75 && Math.abs(w15 - full) <= full * 0.02,
      `${b}: typewriter reveals the title over time (${w03} → ${w05} → ${w15} of ${full} white px)`,
    );
    const starRegion = [250, 290, 390, 420] as const;
    const star = (t: number) => mae(at(t)!, at(t, true)!, ...starRegion);
    check(star(0.3) > 4, `${b}: emoji pops in (mid entrance differs by ${star(0.3).toFixed(1)})`);
    check(star(2.25) > 4, `${b}: emoji spins (mid loop differs by ${star(2.25).toFixed(1)})`);
    const photo = (t: number) => mae(at(t)!, at(t, true)!, 0, 480, 320, SIZE);
    check(
      photo(0.3) > 4 && photo(1.5) < 1,
      `${b}: photo slides in and settles (differs by ${photo(0.3).toFixed(1)} mid entrance, ${photo(1.5).toFixed(2)} after)`,
    );
    const title = mae(at(1.5)!, at(1.5, true)!, 0, 90, SIZE, 170);
    check(title < 1, `${b}: settled title equals the unanimated one (${title.toFixed(2)})`);
  }
  if (backends.length === 2) {
    let worst = 0;
    for (const t of [0.3, 0.5, 1.5, 2.25]) {
      const a = g[`anim-webgpu-${t}`];
      const c = g[`anim-webgl2-${t}`];
      if (!a || !c) continue;
      const base = mae(g[`animplain-webgpu-${t}`]!, g[`animplain-webgl2-${t}`]!);
      worst = Math.max(worst, mae(a, c) - base);
    }
    check(
      worst < 1.5,
      `animations: WebGPU and WebGL2 match (worst ${worst.toFixed(2)} / 255 above decode baseline)`,
    );
  }
}

/** W3C separable blend modes (0…1), the CPU reference for the shader's `blendColour`. */
function blendRef(mode: string, b: number, s: number): number {
  switch (mode) {
    case 'multiply':
      return b * s;
    case 'screen':
      return b + s - b * s;
    case 'overlay':
      return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'soft-light': {
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b);
    }
    case 'add':
      return Math.min(1, b + s);
    case 'lighten':
      return Math.max(b, s);
    case 'darken':
      return Math.min(b, s);
    case 'difference':
      return Math.abs(b - s);
    default:
      return s;
  }
}

/**
 * Picture tools golden frames (`pic-<variant>-<backend>`, /lab/engine): green screen, LUT,
 * blurred / pixelated areas and every blend mode, checked against the plain footage and CPU
 * references on each backend; the two backends must agree (checked with the other `pic-` frames).
 */
function checkPictureTools(g: Record<string, Img>, backends: string[]): void {
  for (const b of backends) {
    const at = (v: string) => g[`pic-${v}-${b}`];
    const plain = at('plain');
    if (!plain) {
      check(false, `${b}: picture tool frames rendered`);
      continue;
    }
    // Green screen: a 320 px layer at x 32–352, y 160–480 with a magenta disc at (192, 320).
    const keyOff = at('key-off')!;
    const key = at('key')!;
    const greenOff = mean(region(keyOff, 40, 170, 100, 230), (p) => p[1]! - p[0]!);
    const screen = mae(key, plain, 40, 170, 100, 230);
    const shade = mae(key, plain, 40, 420, 100, 470);
    check(
      greenOff > 80 && screen < 3 && shade < 4,
      `${b}: green screen removes the screen, shaded part too (green ${greenOff.toFixed(0)} → differs from footage by ${screen.toFixed(2)}, shade ${shade.toFixed(2)})`,
    );
    const disc = region(key, 180, 300, 204, 340);
    const magenta = mean(disc, (p) => (p[0]! > 200 && p[1]! < 70 && p[2]! > 200 ? 1 : 0));
    check(
      magenta > 0.95,
      `${b}: green screen keeps the subject (${(magenta * 100).toFixed(0)}% magenta)`,
    );
    // LUT: an inverting 33-point LUT on the footage band (y 140–500).
    const lut = at('lut')!;
    let err = 0;
    let n = 0;
    for (let y = 160; y < 480; y += 2)
      for (let x = 20; x < 620; x += 2) {
        const p = px(plain, x, y);
        const q = px(lut, x, y);
        for (let c = 0; c < 3; c++, n++) err += Math.abs(q[c]! - (255 - p[c]!));
      }
    check(err / n < 3, `${b}: LUT inverts the footage (mean error ${(err / n).toFixed(2)} / 255)`);
    check(mean(region(lut, 0, 0, SIZE, 100), luma) < 3, `${b}: LUT leaves the background alone`);
    // Blurred rectangle 256 × 192 at the centre (x 192–448, y 224–416); detail = neighbour steps.
    const detail = (img: Img, x0: number, y0: number, x1: number, y1: number) => {
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1 - 1; x++, count++)
          sum += Math.abs(luma(px(img, x, y)) - luma(px(img, x + 1, y)));
      return sum / count;
    };
    const blur = at('blur')!;
    const dIn = detail(blur, 200, 232, 440, 408);
    const dPlain = detail(plain, 200, 232, 440, 408);
    const outside = mae(blur, plain, 20, 160, 170, 480);
    check(
      dIn < dPlain * 0.35 && outside < 0.5,
      `${b}: blurred area softens only inside (detail ${dPlain.toFixed(2)} → ${dIn.toFixed(2)}, outside differs by ${outside.toFixed(2)})`,
    );
    // Pixelated oval: big flat cells inside, corners of its box untouched.
    const pix = at('pixelate')!;
    let same = 0;
    let pairs = 0;
    for (let y = 280; y < 360; y++)
      for (let x = 260; x < 380; x++, pairs++) {
        const p = px(pix, x, y);
        const q = px(pix, x + 1, y);
        if (Math.abs(p[0]! - q[0]!) + Math.abs(p[1]! - q[1]!) + Math.abs(p[2]! - q[2]!) <= 3)
          same++;
      }
    const corner = mae(pix, plain, 194, 226, 214, 246);
    check(
      same / pairs > 0.85 && corner < 0.5 && mae(pix, plain, 260, 280, 380, 360) > 3,
      `${b}: pixelated oval is a mosaic inside, untouched in its box's corners (${((same / pairs) * 100).toFixed(0)}% flat, corner differs by ${corner.toFixed(2)})`,
    );
    // Blend modes: an orange (200, 120, 40) photo at 80% over x 160–480, y 160–480.
    const orange = [200, 120, 40].map((v) => v / 255);
    const off: string[] = [];
    let worst = 0;
    for (const mode of [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'soft-light',
      'add',
      'lighten',
      'darken',
      'difference',
    ]) {
      const img = at(`blend-${mode}`);
      if (!img) {
        off.push(`${mode} missing`);
        continue;
      }
      let e = 0;
      let k = 0;
      for (let y = 176; y < 464; y += 3)
        for (let x = 176; x < 464; x += 3) {
          const under = px(plain, x, y);
          const got = px(img, x, y);
          for (let c = 0; c < 3; c++, k++) {
            const bb = under[c]! / 255;
            const want = 0.8 * blendRef(mode, bb, orange[c]!) + 0.2 * bb;
            e += Math.abs(got[c]! - want * 255);
          }
        }
      const m = e / k;
      worst = Math.max(worst, m);
      if (m > 2.5) off.push(`${mode} ${m.toFixed(2)}`);
    }
    check(
      off.length === 0,
      `${b}: 9 blend modes match the reference maths (worst ${worst.toFixed(2)} / 255)${off.length ? ` — off: ${off.join(', ')}` : ''}`,
    );
  }
  // Shape masks: each pixel against the CPU reference (effects/shapes.ts `shapeCoverage`).
  for (const b of backends) {
    const at = (v: string) => g[`pic-${v}-${b}`];
    const plain = at('plain');
    if (!plain) continue;
    const orange = [200, 120, 40];
    const masked = (
      variant: string,
      shape: string,
      box: [number, number, number, number],
      feather: number,
      invert: boolean,
      inside: (x: number, y: number) => number[],
      outside: (x: number, y: number) => number[],
    ) => {
      const img = at(variant);
      if (!img) return check(false, `${b}: ${variant} rendered`);
      const p = shapePreset(shape)!;
      const [x0, y0, x1, y1] = box;
      const hw = (x1 - x0) / 2;
      const hh = (y1 - y0) / 2;
      let e = 0;
      let k = 0;
      let edgeMiss = 0;
      for (let y = 0; y < SIZE; y += 2)
        for (let x = 0; x < SIZE; x += 2) {
          const qx = (x + 0.5 - (x0 + hw)) / hw;
          const qy = (y + 0.5 - (y0 + hh)) / hh;
          const cov =
            Math.abs(qx) <= 1 && Math.abs(qy) <= 1
              ? shapeCoverage(p, qx, qy, hw / hh, 1 / Math.min(hw, hh), feather * 0.5, invert)
              : 0;
          const a = inside(x, y);
          const o = outside(x, y);
          const got = px(img, x, y);
          let d = 0;
          for (let c = 0; c < 3; c++) d += Math.abs(got[c]! - (cov * a[c]! + (1 - cov) * o[c]!));
          // Edge pixels may differ by the anti-aliasing; count only clear misses there.
          if (cov > 0.02 && cov < 0.98) edgeMiss += d / 3 > 40 ? 1 : 0;
          else {
            e += d / 3;
            k++;
          }
        }
      check(
        e / k < 3 && edgeMiss < 20,
        `${b}: ${variant} matches the reference shape (mean error ${(e / k).toFixed(2)} / 255, ${edgeMiss} edge misses)`,
      );
    };
    const footage = (x: number, y: number) => px(plain, x, y);
    masked('mask-circle', 'circle', [160, 160, 480, 480], 0, false, () => orange, footage);
    masked('mask-star-invert', 'star-5', [160, 160, 480, 480], 0, true, () => orange, footage);
    // The footage band: 640 × 360 at y 140–500; outside the heart the black background shows.
    masked('mask-heart-main', 'heart', [0, 140, 640, 500], 0.3, false, footage, () => [0, 0, 0]);
  }
  if (backends.length === 2) {
    const base = mae(g['pic-plain-webgpu']!, g['pic-plain-webgl2']!);
    let worst = 0;
    let worstKey = '';
    for (const key of Object.keys(g)) {
      if (!key.startsWith('pic-') || !key.endsWith('-webgpu')) continue;
      const other = g[key.replace(/-webgpu$/, '-webgl2')];
      if (!other) continue;
      const d = mae(g[key]!, other);
      if (d > worst) [worst, worstKey] = [d, key];
    }
    check(
      worst < base + 1,
      `picture tools: WebGPU and WebGL2 match (worst ${worst.toFixed(2)} at ${worstKey}, decode baseline ${base.toFixed(2)} / 255)`,
    );
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll composite checks passed');
process.exitCode = failures ? 1 : 0;
