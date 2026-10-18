/**
 * Export check: exports the engine lab's demo project (five main clips with a filter, an
 * adjustment and three transitions, PIP video, PNG, a title, an emoji sticker, blurred background)
 * through `engine.export` and verifies every file with ffprobe + a full ffmpeg decode: streams,
 * size, frame count, duration, audio trimmed to the video. Also checks cancelling (AbortError, no
 * file left in OPFS). Then the v0.2 extras: a range export, a preset, sound-only exports (M4A, Ogg,
 * WAV — in sync with the video export's mix) and a frame saved as PNG / JPEG.
 *
 * Usage: playground running, then
 *   node scripts/export-check.ts [--browsers chrome,webkit,firefox] [--formats mp4,webm]
 *     [--backends webgl2,webgpu] [--height 720] [--fps 30] [--save dir] [--no-extras]
 */
import { chromium, firefox, webkit, type Browser, type Page } from '@playwright/test';
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
const memory = process.argv.includes('--memory');
const repeat = Number(arg('repeat') ?? 1);
const skipExtras = process.argv.includes('--no-extras');
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

/** Total RSS (MB) of the processes using Chrome profile `profile`. */
function rssMb(profile: string): number {
  const out = execFileSync('ps', ['-ax', '-o', 'rss=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let kb = 0;
  for (const line of out.split('\n'))
    if (line.includes(profile)) kb += Number(line.trim().split(/\s+/, 1)[0]) || 0;
  return Math.round(kb / 1024);
}

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
/** Moments of the demo checked against the preview: animations, a light leak, a cube turn. */
const MATCH_TIMES: [number, string][] = [
  [0.8, 'sticker popping in, title typing'],
  [1.3, 'logo sliding in'],
  [7.0, 'light leak'],
  [14.0, 'cube'],
];

/** Frame `n` of a video file as RGBA (ffmpeg). */
function frameAt(file: string, n: number, width: number, height: number): Buffer {
  return execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      `select=eq(n\\,${n})`,
      '-vframes',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${width}x${height}`,
      '-',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

/** Mean absolute RGB difference of two RGBA images (0…255). */
function rgbMae(a: Buffer, b: Buffer): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 3 < Math.min(a.length, b.length); i += 4)
    for (let c = 0; c < 3; c++, count++) sum += Math.abs(a[i + c]! - b[i + c]!);
  return a.length === b.length ? sum / count : 255;
}

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

/** Mono 48 kHz float PCM of a file's sound (ffmpeg mixes the channels down). */
function pcm(file: string): Float32Array {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
}

/**
 * How many samples later `x` plays the sound `ref` has at `refStart` (normalised
 * cross-correlation over `len` samples, lags within ±`maxLag`). 0 = in sync.
 */
function lagOf(
  ref: Float32Array,
  refStart: number,
  x: Float32Array,
  xStart: number,
  len: number,
  maxLag = 960,
): { lag: number; corr: number } {
  let best = { lag: 0, corr: -1 };
  let refEnergy = 0;
  for (let i = 0; i < len; i++) refEnergy += ref[refStart + i]! ** 2;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < len; i++) {
      const v = x[xStart + i + lag] ?? 0;
      dot += ref[refStart + i]! * v;
      energy += v * v;
    }
    const corr = dot / Math.sqrt(refEnergy * energy || 1);
    if (corr > best.corr) best = { lag, corr };
  }
  return best;
}

/**
 * v0.2 export extras on the demo: a range export (video + sound in sync, the edges exactly the
 * timeline's frames), a preset (vertical 1080p), sound-only exports in M4A / Ogg / WAV (format,
 * length, and lined up with the video export's mix), and a frame saved as PNG / JPEG at the
 * project's size, matching the compositor.
 */
async function checkExtras(page: Page, name: string, duration: number) {
  const save = (base: string, ext: string, base64: string) => {
    const file = join(dir, `${name}-${base}.${ext}`);
    writeFileSync(file, Buffer.from(base64, 'base64'));
    return file;
  };
  const S = 705_600_000;
  const captureAt = async (sec: number, w: number, h: number) =>
    Buffer.from(
      await page.evaluate(([x, ww, hh]) => window.engineLab!.captureFrame(x, ww, hh, 'webgl2'), [
        sec,
        w,
        h,
      ] as const),
      'base64',
    );

  // Sound only: WAV first (lossless — the reference for every other comparison).
  const audioFiles: Partial<Record<'wav' | 'm4a' | 'ogg', string>> = {};
  for (const format of ['wav', 'm4a', 'ogg'] as const) {
    let out: Awaited<ReturnType<NonNullable<Window['engineLab']>['exportAudio']>>;
    try {
      out = await page.evaluate(
        (f) => window.engineLab!.exportAudio({ format: f, quality: 'medium' }),
        format,
      );
    } catch (error) {
      const message = String(error);
      if (format === 'ogg' && /can't encode Opus/.test(message)) {
        console.log(`  - audio ogg: no Opus encoder here (clear message shown): skipped`);
        continue;
      }
      check(false, `audio ${format}: export failed — ${message.slice(0, 300)}`);
      continue;
    }
    const file = save('audio', format, out.base64);
    audioFiles[format] = file;
    const p = probe(file);
    const a = p.streams.find((s) => s.codec_type === 'audio');
    const want = { wav: 'pcm_s16le', m4a: 'aac', ogg: 'opus' }[format];
    console.log(
      `  audio ${format}: ${a?.codec_name} ${a?.sample_rate} Hz ×${a?.channels} · ${(Buffer.byteLength(out.base64, 'base64') / 1e6).toFixed(2)} MB · ${out.result.elapsedSeconds.toFixed(2)} s = ${(duration / out.result.elapsedSeconds).toFixed(1)}× real time · ${out.result.storage}`,
    );
    check(
      a?.codec_name === want &&
        a.sample_rate === '48000' &&
        a.channels === 2 &&
        !p.streams.some((s) => s.codec_type === 'video'),
      `audio ${format}: ${a?.codec_name}, ${a?.sample_rate} Hz, ${a?.channels} channels, no video`,
    );
    const got = decodedDuration(file, 'a') || Number(p.format.duration);
    // WAV is exact; AAC / Opus packets are 1024 / 960 samples (at most one over).
    const tolerance = format === 'wav' ? 0.001 : 0.03;
    check(
      Math.abs(got - duration) <= tolerance,
      `audio ${format}: ${got.toFixed(4)} s long (video ${duration.toFixed(4)} s)`,
    );
  }
  const reference = audioFiles.wav ? pcm(audioFiles.wav) : null;
  // Lined up with the video export's sound: sample lag at 2–3 s, and the same mix (correlation).
  const video = join(dir, `${name}-webgl2-mp4.mp4`);
  const compare = (label: string, file: string, at = 2, fileAt = at, limit = 48) => {
    if (!reference) return;
    const x = pcm(file);
    const { lag, corr } = lagOf(reference, at * 48000, x, Math.round(fileAt * 48000), 48000);
    check(
      Math.abs(lag) <= limit && corr > 0.9,
      `${label}: in sync with the WAV mix (lag ${lag} samples = ${(lag / 48).toFixed(2)} ms, correlation ${corr.toFixed(3)})`,
    );
  };
  if (formats.includes('mp4')) compare('video export mp4 sound', video);
  if (audioFiles.m4a) compare('audio m4a', audioFiles.m4a);
  if (audioFiles.ogg) compare('audio ogg', audioFiles.ogg);

  // A range: 6.9 → 9.9 s (starts inside the light-leak transition at the 7 s cut).
  const range = { start: Math.round(6.9 * S), end: Math.round(9.9 * S) };
  try {
    const out = await page.evaluate(
      (r) =>
        window.engineLab!.exportVideo({
          format: 'mp4',
          height: 720,
          fps: 30,
          quality: 'medium',
          range: r,
        }),
      range,
    );
    const file = save('range', 'mp4', out.base64);
    const p = probe(file);
    const v = p.streams.find((s) => s.codec_type === 'video');
    console.log(
      `  range 6.9–9.9 s: ${out.result.frames} frames · ${out.result.elapsedSeconds.toFixed(1)} s`,
    );
    check(
      out.result.frames === 90 && Number(v?.nb_read_frames) === 90,
      `range: 90 frames (reported ${out.result.frames}, decoded ${v?.nb_read_frames})`,
    );
    check(
      Math.abs(Number(p.format.duration) - 3) < 0.06,
      `range: ${Number(p.format.duration).toFixed(3)} s long`,
    );
    const vd = decodedDuration(file, 'v');
    const ad = decodedDuration(file, 'a');
    check(Math.abs(ad - vd) <= 0.03, `range: audio ${ad.toFixed(3)} s vs video ${vd.toFixed(3)} s`);
    for (const [n, what] of [
      [0, 'first frame, mid-transition'],
      [3, 'light leak'],
      [89, 'last frame'],
    ] as const) {
      const decoded = frameAt(file, n, out.result.width, out.result.height);
      const sec = 6.9 + n / 30;
      const same = rgbMae(decoded, await captureAt(sec, out.result.width, out.result.height));
      const other = rgbMae(
        decoded,
        await captureAt(sec + (n === 89 ? -0.25 : 0.25), out.result.width, out.result.height),
      );
      check(
        same < 6 && same < other * 0.6,
        `range: frame ${n} (${what}) = timeline ${sec.toFixed(3)} s (${same.toFixed(2)} / 255; 0.25 s off: ${other.toFixed(2)})`,
      );
    }
    // The range's sound is the timeline's sound from 6.9 s.
    compare('range sound', file, 7.4, 0.5);
  } catch (error) {
    check(false, `range export failed — ${String(error).slice(0, 300)}`);
  }
  // Range, sound only: exactly the WAV mix from 6.9 s.
  try {
    const out = await page.evaluate(
      (r) => window.engineLab!.exportAudio({ format: 'wav', quality: 'medium', range: r }),
      range,
    );
    const file = save('range-audio', 'wav', out.base64);
    const got = decodedDuration(file, 'a') || Number(probe(file).format.duration);
    check(Math.abs(got - 3) <= 0.001, `range audio wav: ${got.toFixed(4)} s long`);
    compare('range audio wav', file, 7.4, 0.5, 1);
  } catch (error) {
    check(false, `range audio export failed — ${String(error).slice(0, 300)}`);
  }

  // Preset: vertical 9:16, 1080p, 30 fps MP4 (first 2 s to keep the check quick).
  try {
    const out = await page.evaluate(() =>
      window.engineLab!.exportVideo({
        format: 'mp4',
        height: 1080,
        fps: 30,
        quality: 'medium',
        range: { start: 0, end: 2 * 705_600_000 },
      }),
    );
    const file = save('preset-vertical', 'mp4', out.base64);
    const v = probe(file).streams.find((s) => s.codec_type === 'video');
    check(
      v?.codec_name === 'h264' &&
        v.width === 1080 &&
        v.height === 1920 &&
        Number(v.nb_read_frames) === 60,
      `preset vertical: ${v?.codec_name} ${v?.width}×${v?.height}, ${v?.nb_read_frames} frames (expect h264 1080×1920, 60)`,
    );
  } catch (error) {
    check(false, `preset export failed — ${String(error).slice(0, 300)}`);
  }

  // A frame as a picture: the project's own size (1080 × 1920), = the compositor's frame.
  for (const format of ['png', 'jpeg'] as const) {
    try {
      const out = await page.evaluate(
        (f) => window.engineLab!.captureImage(7.0, { format: f, quality: 0.9 }),
        format,
      );
      const file = save('frame', out.image.extension, out.base64);
      const v = probe(file).streams[0];
      check(
        v?.width === 1080 && v.height === 1920 && out.image.width === 1080,
        `frame ${format}: ${v?.codec_name} ${v?.width}×${v?.height} (project size 1080×1920)`,
      );
      const decoded = frameAt(file, 0, 1080, 1920);
      const mae = rgbMae(decoded, await captureAt(7.0, 1080, 1920));
      check(
        mae < (format === 'png' ? 1 : 4),
        `frame ${format}: matches the compositor (${mae.toFixed(2)} / 255) · ${(Buffer.byteLength(out.base64, 'base64') / 1e6).toFixed(2)} MB`,
      );
    } catch (error) {
      check(false, `frame ${format} failed — ${String(error).slice(0, 300)}`);
    }
  }
}

for (const name of browsers) {
  for (const backend of backends) {
    if (backend === 'webgpu' && name !== 'chrome') continue;
    // --memory: Chrome with its own profile dir, so its processes' RSS can be sampled.
    const profile = memory && name === 'chrome' ? mkdtempSync(join(tmpdir(), 'vu-expmem-')) : null;
    const context = profile
      ? await chromium.launchPersistentContext(profile, {
          channel: 'chrome',
          viewport: { width: 600, height: 900 },
        })
      : null;
    const browser = context ?? (await launch[name as keyof typeof launch]());
    const page = context
      ? (context.pages()[0] ?? (await context.newPage()))
      : await (browser as Browser).newPage({ viewport: { width: 600, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on(
      'console',
      (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()),
    );
    await page.goto(`${BASE}/lab/engine${repeat > 1 ? `?repeat=${repeat}` : ''}`);
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
      const rss: number[] = [];
      const sampler = profile ? setInterval(() => rss.push(rssMb(profile)), 500) : null;
      try {
        out = await page.evaluate(([o, b]) => window.engineLab!.exportVideo(o, b), [
          options,
          backend,
        ] as const);
      } catch (error) {
        check(false, `${format}: export failed — ${String(error).slice(0, 300)}`);
        continue;
      }
      if (sampler) clearInterval(sampler);
      if (rss.length > 6) {
        const third = Math.max(1, Math.floor(rss.length / 3));
        const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
        const early = avg(rss.slice(0, third));
        const late = avg(rss.slice(-third));
        console.log(
          `    memory (RSS of this Chrome): first third ${early} MB, last third ${late} MB, max ${Math.max(...rss)} MB`,
        );
        check(late - early < 150, `${format}: memory flat during export (+${late - early} MB)`);
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
          result.width === height &&
          result.height === Math.round((height * 16) / 9 / 2) * 2,
        `${format}: ${v?.width}×${v?.height} (${height}p = shorter side for 9:16)`,
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
      // Export = preview: frames at a transition and during element animations, decoded from the
      // file, against the engine's own exact capture of the same moment (and of a moment 0.25 s
      // later, to show the comparison can tell frames apart).
      for (const [t, what] of MATCH_TIMES) {
        const n = Math.round(t * fps);
        const decoded = frameAt(file, n, result.width, result.height);
        const capture = async (sec: number) =>
          Buffer.from(
            await page.evaluate(([x, w, h, b]) => window.engineLab!.captureFrame(x, w, h, b), [
              sec,
              result.width,
              result.height,
              backend,
            ] as const),
            'base64',
          );
        const same = rgbMae(decoded, await capture(n / fps));
        const other = rgbMae(decoded, await capture(n / fps + 0.25));
        // VP9 at "medium" loses more detail in WebKit / Firefox (~5–8 / 255) than H.264 (~1–3).
        const limit = format === 'mp4' ? 6 : 10;
        check(
          same < limit && same < other * 0.6,
          `${format}: frame ${n} (${what}) matches the preview (${same.toFixed(2)} / 255; 0.25 s later: ${other.toFixed(2)})`,
        );
      }
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
        // The 14 s cut has a 0.5 s cube transition, and sound crossfades with it (DECISIONS #113):
        // the outgoing clip's tone runs 0.25 s past the cut, fading out on a cosine from 13.75 s.
        // silencedetect fires when the faded tone drops below −50 dB, so the exact expected time
        // follows from the tone's peak level just before the fade — still a millisecond-level
        // lip-sync check.
        const stats = spawnSync(
          'ffmpeg',
          ['-v', 'info', '-i', file, '-af', 'atrim=13.3:13.7,astats=metadata=0', '-f', 'null', '-'],
          { encoding: 'utf8' },
        );
        const peakDb = Number(/Peak level dB:\s*(-?[\d.]+)/.exec(stats.stderr)?.[1] ?? 'NaN');
        const g = 10 ** (-50 / 20) / 10 ** (peakDb / 20);
        const expected = 13.75 + ((Math.acos(Math.min(1, g)) * 2) / Math.PI) * 0.5;
        // MP4 must be exact; WebM/Opus timing comes from the browser's encoder timestamps (Playwright
        // WebKit jitters them by ~13 ms) — fail only past the ~40 ms where lip sync shows.
        const limit = format === 'mp4' ? 0.012 : 0.04;
        check(
          cut !== undefined && Number.isFinite(expected) && Math.abs(cut - expected) < limit,
          `${format}: sound fades out through the 14 s transition and is silent at ${cut?.toFixed(3)} s, expected ${expected.toFixed(3)} s (A/V offset ${cut !== undefined ? ((cut - expected) * 1000).toFixed(1) : '?'} ms; encoder delay ${info.audioDelaySamples} samples compensated)`,
        );
      }
    }
    if (backend === 'webgl2' && !skipExtras) await checkExtras(page, name, duration);
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
