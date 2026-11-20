/**
 * See-through export check (DECISIONS #196): the engine lab's transparent-background scene
 * (`/lab/engine?alpha=1`: an opaque orange square, a blue one at 50 % half over it, nothing else)
 * through both GPU backends —
 *  - golden frames (`capture` with `alpha`): see-through corner, opaque orange, straight-alpha blue
 *    at 50 % (not darkened twice), the overlap opaque; both backends agree; without `alpha` the
 *    background is black and opaque as before;
 *  - WebM export: VP9 with alpha, decoded by ffmpeg's libvpx (an outside decoder) to the same
 *    pixels; MP4 export of the same project: black and opaque; no frame left open;
 *  - PNG frame with alpha; JPEG black;
 *  - real footage (`?alpha=video`, WebGL2): the bands around the fitted video see-through, the
 *    video opaque, in the frame and in the WebM file.
 * Needs the playground, `pnpm media` and ffmpeg (with libvpx).
 * Usage: PLAYGROUND=http://localhost:3301 node scripts/alpha-check.ts [--browsers chrome]
 *   [--backends webgl2,webgpu] [--save dir]
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.PLAYGROUND ?? 'http://localhost:3200';
const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const browsers = (arg('browsers') ?? 'chrome').split(',');
const backends = (arg('backends') ?? 'webgl2,webgpu').split(',') as ('webgl2' | 'webgpu')[];
const dir = arg('save') ?? mkdtempSync(join(tmpdir(), 'vu-alpha-'));
mkdirSync(dir, { recursive: true });

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

type Px = [number, number, number, number];
/** Pixel (x, y) of a `size`-wide RGBA image. */
const px = (img: Buffer, size: number, x: number, y: number): Px => {
  const i = (Math.round(y) * size + Math.round(x)) * 4;
  return [img[i]!, img[i + 1]!, img[i + 2]!, img[i + 3]!];
};
const near = (p: Px, want: Px, tol: number) => p.every((v, i) => Math.abs(v - want[i]!) <= tol);
const show = (p: Px) => p.join(',');

const ORANGE: Px = [200, 120, 40, 255];
/** 50 % blue, straight alpha: the colour stays (40, 80, 220); premultiplied twice it'd be half. */
const BLUE_HALF: Px = [40, 80, 220, 128];
/** 50 % blue over the opaque orange. */
const OVERLAP: Px = [120, 100, 130, 255];

/**
 * Checks one see-through frame of the scene (640-wide coordinates, scaled to `size`). `tol` is
 * wider for lossy video.
 */
function checkScene(img: Buffer, size: number, label: string, tol: number): void {
  const k = size / 640;
  const at = (x: number, y: number) => px(img, size, x * k, y * k);
  const corner = at(20, 20);
  check(corner[3] <= 2, `${label}: background is see-through (${show(corner)})`);
  const orange = at(150, 320);
  check(near(orange, ORANGE, tol), `${label}: opaque layer keeps colour (${show(orange)})`);
  const blue = at(400, 320);
  check(
    near(blue, BLUE_HALF, tol + 4),
    `${label}: 50 % layer is half see-through, colour not darkened (${show(blue)}, expect ≈${show(BLUE_HALF)})`,
  );
  const overlap = at(264, 320);
  check(near(overlap, OVERLAP, tol + 2), `${label}: 50 % over opaque is opaque (${show(overlap)})`);
}

/** Decodes frame `index` of a video or a picture to RGBA with ffmpeg (libvpx keeps alpha). */
function decode(file: string, size: number, opts: { vpx?: boolean; at?: number } = {}): Buffer {
  return execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      ...(opts.vpx ? ['-c:v', 'libvpx-vp9'] : []),
      '-i',
      file,
      ...(opts.at !== undefined ? ['-ss', String(opts.at)] : []),
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${size}x${size}`,
      '-',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

for (const name of browsers) {
  const browser = await launch[name as keyof typeof launch]();
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [console] ${m.text().slice(0, 200)}`);
  });
  await page.goto(`${BASE}/lab/engine?alpha=1&backend=webgl2`);
  await page.waitForFunction(
    () => /Ready|FAILED|error/i.test(document.getElementById('status')!.textContent!),
    null,
    { timeout: 120000 },
  );
  console.log(`== ${name} · ${await page.locator('#status').innerText()}`);

  // Golden frames, both backends.
  const golden: Record<string, Buffer> = {};
  for (const backend of backends) {
    for (const alpha of [true, false]) {
      try {
        const b64 = await page.evaluate(
          ([b, a]) => window.engineLab!.captureFrame(1, 640, 640, b, a),
          [backend, alpha] as const,
        );
        const img = Buffer.from(b64, 'base64');
        if (alpha) {
          golden[backend] = img;
          checkScene(img, 640, `${backend} frame`, 2);
        } else {
          const corner = px(img, 640, 20, 20);
          check(
            near(corner, [0, 0, 0, 255], 1),
            `${backend} frame without alpha: black and opaque as before (${show(corner)})`,
          );
        }
      } catch (error) {
        check(false, `${backend} frame (alpha ${alpha}): ${String(error).slice(0, 160)}`);
      }
    }
  }
  if (golden.webgl2 && golden.webgpu) {
    let sum = 0;
    for (let i = 0; i < golden.webgl2.length; i++)
      sum += Math.abs(golden.webgl2[i]! - golden.webgpu[i]!);
    const mae = sum / golden.webgl2.length;
    check(mae < 0.5, `WebGPU and WebGL2 agree, alpha included (${mae.toFixed(3)} / 255)`);
  }

  // Exports.
  for (const backend of backends) {
    for (const format of ['webm', 'mp4'] as const) {
      try {
        const out = await page.evaluate(
          ([f, b]) =>
            window.engineLab!.exportVideo({ format: f, height: 480, fps: 30, quality: 'high' }, b),
          [format, backend] as const,
        );
        const file = join(dir, `${name}-${backend}.${out.result.extension}`);
        writeFileSync(file, Buffer.from(out.base64, 'base64'));
        console.log(
          `  ${format} (${backend} → ${out.info.backend}): ${out.result.width}×${out.result.height} · ${out.result.videoCodec} · ${(Buffer.byteLength(out.base64, 'base64') / 1e3).toFixed(0)} kB · ${out.result.elapsedSeconds.toFixed(1)} s · transparent ${out.result.transparent}`,
        );
        check(
          out.info.openFramesAfter === 0,
          `${format} ${backend}: every frame closed (${out.info.openFramesAfter} open)`,
        );
        if (format === 'webm') {
          check(out.result.transparent, `webm ${backend}: reported see-through`);
          const probe = execFileSync(
            'ffprobe',
            ['-v', 'error', '-show_streams', '-show_format', file],
            { encoding: 'utf8' },
          );
          check(/alpha_mode=1/i.test(probe), `webm ${backend}: the file is marked as having alpha`);
          for (const at of [0, 1, 2.5])
            checkScene(decode(file, 480, { vpx: true, at }), 480, `webm ${backend} @${at}s`, 8);
        } else {
          check(!out.result.transparent, `mp4 ${backend}: not see-through (MP4 has no alpha)`);
          const img = decode(file, 480, { at: 1 });
          const corner = px(img, 480, 15, 15);
          check(near(corner, [0, 0, 0, 255], 4), `mp4 ${backend}: black there (${show(corner)})`);
        }
      } catch (error) {
        check(false, `${format} export (${backend}): ${String(error).slice(0, 200)}`);
      }
    }
  }

  // Pictures (the export renderer, project size 640).
  for (const format of ['png', 'jpeg'] as const) {
    try {
      const out = await page.evaluate(
        (f) => window.engineLab!.captureImage(1, { format: f }),
        format,
      );
      const file = join(dir, `${name}-frame.${out.image.extension}`);
      writeFileSync(file, Buffer.from(out.base64, 'base64'));
      const img = decode(file, 640);
      if (format === 'png') checkScene(img, 640, 'png', 2);
      else {
        const corner = px(img, 640, 20, 20);
        check(near(corner, [0, 0, 0, 255], 4), `jpeg: black there (${show(corner)})`);
      }
    } catch (error) {
      check(false, `${format} picture: ${String(error).slice(0, 200)}`);
    }
  }
  await browser.close();
}

// Real footage (WebGL2: headless WebGPU can't import video textures): the video is opaque, the
// bands around the fitted 16:9 picture stay see-through, in the frame and in the WebM file.
for (const name of browsers) {
  const browser = await launch[name as keyof typeof launch]();
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/engine?alpha=video&backend=webgl2`);
  await page.waitForFunction(
    () => /Ready|FAILED|error/i.test(document.getElementById('status')!.textContent!),
    null,
    { timeout: 120000 },
  );
  console.log(`== ${name} · footage · ${await page.locator('#status').innerText()}`);
  const bands = (img: Buffer, size: number, label: string) => {
    const k = size / 640;
    const top = px(img, size, 20 * k, 20 * k);
    const bottom = px(img, size, 600 * k, 600 * k);
    const footage = px(img, size, 320 * k, 320 * k);
    check(
      top[3] <= 2 && bottom[3] <= 2 && footage[3] >= 253,
      `${label}: bands see-through, footage opaque (alpha ${top[3]} / ${bottom[3]} / ${footage[3]})`,
    );
  };
  try {
    const b64 = await page.evaluate(() =>
      window.engineLab!.captureFrame(1, 640, 640, 'webgl2', true),
    );
    bands(Buffer.from(b64, 'base64'), 640, 'webgl2 footage frame');
    const out = await page.evaluate(() =>
      window.engineLab!.exportVideo(
        { format: 'webm', height: 480, fps: 30, quality: 'medium' },
        'webgl2',
      ),
    );
    const file = join(dir, `${name}-footage.webm`);
    writeFileSync(file, Buffer.from(out.base64, 'base64'));
    console.log(
      `  webm: ${out.result.videoCodec} · ${(Buffer.byteLength(out.base64, 'base64') / 1e6).toFixed(2)} MB · ${out.result.elapsedSeconds.toFixed(1)} s for ${out.result.durationSeconds.toFixed(1)} s`,
    );
    check(out.info.openFramesAfter === 0, `footage webm: every frame closed`);
    for (const at of [0.5, 2])
      bands(decode(file, 480, { vpx: true, at }), 480, `footage webm @${at}s`);
  } catch (error) {
    check(false, `footage: ${String(error).slice(0, 200)}`);
  }
  await browser.close();
}

console.log(`\nFiles in ${dir}`);
console.log(failures ? `\n${failures} check(s) failed` : '\nAll see-through checks passed');
process.exit(failures ? 1 : 0);
