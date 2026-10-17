/**
 * Export check: exports the engine lab's demo project (five main clips with a filter, an
 * adjustment and three transitions, PIP video, PNG, a title, an emoji sticker, blurred background)
 * through `engine.export` and verifies every file with ffprobe + a full ffmpeg decode: streams,
 * size, frame count, duration, audio trimmed to the video. Also checks cancelling (AbortError, no
 * file left in OPFS).
 *
 * Usage: playground running, then
 *   node scripts/export-check.ts [--browsers chrome,webkit,firefox] [--formats mp4,webm]
 *     [--backends webgl2,webgpu] [--height 720] [--fps 30] [--save dir]
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.PLAYGROUND ?? 'http://localhost:3200';
const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const browsers = (arg('browsers') ?? 'chrome,webkit').split(',');
const formats = (arg('formats') ?? 'mp4,webm').split(',') as ('mp4' | 'webm')[];
const backends = (arg('backends') ?? 'webgl2').split(',') as ('webgl2' | 'webgpu')[];
const height = Number(arg('height') ?? 720) as 720;
const fps = Number(arg('fps') ?? 30) as 30;
const dir = arg('save') ?? mkdtempSync(join(tmpdir(), 'vu-export-'));
mkdirSync(dir, { recursive: true });

const launch = {
  chrome: () =>
    chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] }),
  webkit: () => webkit.launch(),
  firefox: () => firefox.launch(),
};

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
};

interface Probe {
  streams: {
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    nb_read_frames?: string;
    duration?: string;
    sample_rate?: string;
    channels?: number;
  }[];
  format: { duration: string };
}

const probe = (file: string): Probe =>
  JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-count_frames',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      file,
    ]).toString(),
  ) as Probe;

/** Stream durations as decoded (packet timestamps), seconds. */
const decodedDuration = (file: string, stream: 'v' | 'a'): number => {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    `${stream}:0`,
    '-show_entries',
    'packet=pts_time,duration_time',
    '-of',
    'csv=p=0',
    file,
  ])
    .toString()
    .trim()
    .split('\n')
    .map((l) => l.split(',').map(Number));
  let end = 0;
  for (const [pts, dur] of out) if (pts! + (dur || 0) > end) end = pts! + (dur || 0);
  return end;
};

for (const name of browsers) {
  for (const backend of backends) {
    if (backend === 'webgpu' && name !== 'chrome') continue;
    const browser = await launch[name as keyof typeof launch]();
    const page = await browser.newPage({ viewport: { width: 600, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on(
      'console',
      (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()),
    );
    await page.goto(`${BASE}/lab/engine`);
    await page.waitForFunction(
      () => /^Ready|FAILED/.test(document.getElementById('status')!.textContent!),
      null,
      { timeout: 90000 },
    );
    const status = await page.locator('#status').innerText();
    console.log(`\n===== ${name} · export renderer ${backend} · ${status}`);
    if (status.startsWith('FAILED')) {
      failures++;
      await browser.close();
      continue;
    }
    const duration = await page.evaluate(() => window.engineLab!.duration);
    for (const format of formats) {
      const options = { format, height, fps, quality: 'medium' as const };
      let out: Awaited<ReturnType<NonNullable<Window['engineLab']>['exportVideo']>>;
      try {
        out = await page.evaluate(([o, b]) => window.engineLab!.exportVideo(o, b), [
          options,
          backend,
        ] as const);
      } catch (error) {
        check(false, `${format}: export failed — ${String(error).slice(0, 300)}`);
        continue;
      }
      const { result, info } = out;
      const file = join(dir, `${name}-${backend}-${format}.${result.extension}`);
      writeFileSync(file, Buffer.from(out.base64, 'base64'));
      const speed = duration / result.elapsedSeconds;
      console.log(
        `  ${format}: ${result.width}×${result.height} · ${result.videoCodec}+${result.audioCodec ?? '-'} · ${(Buffer.byteLength(out.base64, 'base64') / 1e6).toFixed(1)} MB · ${result.elapsedSeconds.toFixed(1)} s = ${speed.toFixed(2)}× real time · ${result.storage} · renderer ${info.backend}`,
      );
      console.log(
        `    per frame: compose ${(info.composeMs / result.frames).toFixed(1)} ms, encoder wait ${(info.encodeWaitMs / result.frames).toFixed(1)} ms, audio ${(info.audioMs / result.frames).toFixed(1)} ms${result.warnings.length ? ` · warnings: ${result.warnings.join(' ')}` : ''}`,
      );
      const expectedFrames = Math.round(duration * fps);
      check(
        result.frames === expectedFrames,
        `${format}: ${result.frames} frames reported (expect ${expectedFrames})`,
      );
      check(
        info.openFramesAfter === 0 && info.missingLayers === 0,
        `${format}: no open frames (${info.openFramesAfter}), no missing layers (${info.missingLayers})`,
      );
      const p = probe(file);
      const v = p.streams.find((s) => s.codec_type === 'video');
      const a = p.streams.find((s) => s.codec_type === 'audio');
      const wantV = format === 'mp4' ? ['h264'] : ['vp9', 'vp8'];
      check(!!v && wantV.includes(v.codec_name), `${format}: video stream ${v?.codec_name}`);
      check(
        v?.width === result.width &&
          v.height === result.height &&
          result.width === 720 &&
          result.height === 1280,
        `${format}: ${v?.width}×${v?.height} (720p = shorter side for 9:16)`,
      );
      check(
        Number(v?.nb_read_frames) === expectedFrames,
        `${format}: ${v?.nb_read_frames} frames decoded by ffprobe`,
      );
      if (result.audioCodec) {
        const wantA = format === 'mp4' ? 'aac' : 'opus';
        check(
          a?.codec_name === wantA && a.channels === 2 && a.sample_rate === '48000',
          `${format}: audio ${a?.codec_name} ${a?.sample_rate} Hz ×${a?.channels}`,
        );
        const vd = decodedDuration(file, 'v');
        const ad = decodedDuration(file, 'a');
        // Audio packets come in 1024 (AAC) / 960 (Opus) sample frames: at most one frame over.
        check(
          Math.abs(ad - vd) <= 0.03,
          `${format}: audio ${ad.toFixed(3)} s vs video ${vd.toFixed(3)} s (trimmed)`,
        );
      } else {
        check(format === 'webm', `${format}: has audio`);
      }
      check(
        Math.abs(Number(p.format.duration) - duration) < 0.06,
        `${format}: container duration ${Number(p.format.duration).toFixed(3)} s (expect ${duration.toFixed(3)})`,
      );
      const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], {
        encoding: 'utf8',
      });
      const decodeErrors = `${decode.stderr ?? ''}${decode.status ? ` exit ${decode.status}` : ''}`;
      check(
        decodeErrors.trim() === '',
        `${format}: full ffmpeg decode clean${decodeErrors ? ` (${decodeErrors.slice(0, 200)})` : ''}`,
      );
      if (result.audioCodec) {
        // Lip sync: the demo's sound stops at the 14 s cut (the last clip is silent).
        const silence = spawnSync(
          'ffmpeg',
          ['-v', 'info', '-i', file, '-af', 'silencedetect=n=-50dB:d=0.2', '-f', 'null', '-'],
          { encoding: 'utf8' },
        );
        const starts = [...silence.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) =>
          Number(m[1]),
        );
        const cut = starts.find((s) => s > 13 && s < 15);
        // MP4 must be exact; WebM/Opus timing comes from the browser's encoder timestamps (Playwright
        // WebKit jitters them by ~13 ms) — fail only past the ~40 ms where lip sync shows.
        const limit = format === 'mp4' ? 0.012 : 0.04;
        check(
          cut !== undefined && Math.abs(cut - 14) < limit,
          `${format}: sound stops at the 14 s cut at ${cut?.toFixed(3)} s (A/V offset ${cut !== undefined ? ((cut - 14) * 1000).toFixed(1) : '?'} ms; encoder delay ${info.audioDelaySamples} samples compensated)`,
        );
      }
    }
    // Cancel: AbortError, and nothing left behind in OPFS.
    const cancelled = await page.evaluate(() =>
      window.engineLab!.cancelAfter(1200, { format: 'mp4', height: 720, fps: 30, quality: 'low' }),
    );
    check(cancelled === 'AbortError', `cancel → ${cancelled}`);
    const left = await page.evaluate(async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const names: string[] = [];
        for await (const key of (root as unknown as { keys(): AsyncIterable<string> }).keys())
          names.push(key);
        return names.filter((n) => n.startsWith('video-ultra-export-'));
      } catch {
        return [];
      }
    });
    check(
      left.length === 0,
      `OPFS has no export files after cancel (${left.join(', ') || 'none'})`,
    );
    const stats = await page.evaluate(() => window.engineLab!.stats());
    check(!stats.exporting, `preview resumed after export (exporting = ${stats.exporting})`);
    if (errors.length) console.log(`  page errors: ${errors.slice(0, 5).join(' | ')}`);
    await browser.close();
  }
}
console.log(`\nFiles in ${dir}`);
console.log(failures ? `${failures} check(s) failed` : 'All export checks passed');
process.exitCode = failures ? 1 : 0;
