/**
 * Golden composite check: renders /lab/composite (background, letterboxed video, rotated
 * semi-transparent picture-in-picture, transparent PNG) through WebGPU and WebGL2 in each browser,
 * checks the backends agree and known pixels are right. Needs the playground and `pnpm media`.
 * Usage: node scripts/composite-check.ts [--browsers chrome,webkit]
 */
import { chromium, webkit } from '@playwright/test';

const SIZE = 640;
const arg = process.argv.indexOf('--browsers');
const names = (arg > 0 ? process.argv[arg + 1]! : 'chrome,webkit').split(',');
const launch = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  webkit: () => webkit.launch(),
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
  await page.goto('http://localhost:3200/lab/composite');
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
console.log(failures ? `\n${failures} check(s) failed` : '\nAll composite checks passed');
process.exitCode = failures ? 1 : 0;
