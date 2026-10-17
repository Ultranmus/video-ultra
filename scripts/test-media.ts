/**
 * Builds the test media library in test-media/files (git-ignored) and writes manifest.json.
 * Run: `pnpm media`. Needs ffmpeg on PATH. Idempotent: existing files are kept.
 *
 * Every file is either generated here (synthetic, no licence concerns) or downloaded from a
 * source with a free licence (listed in test-media/README.md). The owner's own phone files go in
 * test-media/private (also git-ignored) and are never published.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-media');
const out = join(root, 'files');
mkdirSync(out, { recursive: true });

type Kind = 'video' | 'audio' | 'image' | 'broken';
interface Entry {
  file: string;
  label: string;
  kind: Kind;
  /** What a correct probe must report — used by tests later. */
  expect?: Record<string, string | number | boolean>;
}

const entries: Entry[] = [];

function ffmpeg(args: string[]): void {
  // SVT_LOG=1: the AV1 encoder ignores -loglevel and prints its config otherwise.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
    env: { ...process.env, SVT_LOG: '1' },
  });
}

function make(entry: Entry, build: (path: string) => void): void {
  const path = join(out, entry.file);
  if (existsSync(path) && statSync(path).size > 0) {
    console.log(`  ✓ ${entry.file} (exists)`);
  } else {
    process.stdout.write(`  … ${entry.file}`);
    const t0 = Date.now();
    try {
      build(path);
      console.log(`\r  ✓ ${entry.file} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (error) {
      console.log(`\r  ✗ ${entry.file}: ${String(error)}`);
      return;
    }
  }
  entries.push(entry);
}

// Synthetic picture with film-like grain so the encoder works about as hard as on camera footage.
const picture = (size: string, rate: number, seconds: number) => [
  '-f',
  'lavfi',
  '-i',
  `testsrc2=size=${size}:rate=${rate}:duration=${seconds}`,
];
const grain = ['-vf', 'noise=alls=12:allf=t+u'];
const tone = (seconds: number, layout = 'stereo', rate = 48000) => [
  '-f',
  'lavfi',
  '-i',
  `sine=frequency=440:sample_rate=${rate}:duration=${seconds},aformat=channel_layouts=${layout}`,
];
const x264 = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-profile:v',
  'high',
  '-pix_fmt',
  'yuv420p',
  '-crf',
  '20',
];
const aac = ['-c:a', 'aac', '-b:a', '160k'];
const faststart = ['-movflags', '+faststart'];

console.log(`Building test media in ${out}`);

make(
  {
    file: 'avc-1080p30.mp4',
    label: 'H.264 1080p30 + AAC (10 s) — main bench',
    kind: 'video',
    expect: { codec: 'avc', width: 1920, height: 1080, rotation: 0, hdr: false },
  },
  (p) =>
    ffmpeg([
      ...picture('1920x1080', 30, 10),
      ...tone(10),
      ...grain,
      ...x264,
      ...aac,
      ...faststart,
      '-shortest',
      p,
    ]),
);
make(
  {
    file: 'avc-720p30.mp4',
    label: 'H.264 720p30 + AAC (10 s)',
    kind: 'video',
    expect: { codec: 'avc', width: 1280, height: 720 },
  },
  (p) =>
    ffmpeg([
      ...picture('1280x720', 30, 10),
      ...tone(10),
      ...grain,
      ...x264,
      ...aac,
      ...faststart,
      '-shortest',
      p,
    ]),
);
make(
  {
    file: 'avc-1080p60.mp4',
    label: 'H.264 1080p60 + AAC (10 s)',
    kind: 'video',
    expect: { codec: 'avc', fps: 60 },
  },
  (p) =>
    ffmpeg([
      ...picture('1920x1080', 60, 10),
      ...tone(10),
      ...grain,
      ...x264,
      ...aac,
      ...faststart,
      '-shortest',
      p,
    ]),
);
// Phone 4K30 is ~50–60 Mbps; cap the bitrate so the decode load is realistic, not a torture test.
make(
  {
    file: 'avc-4k30.mp4',
    label: 'H.264 4K30 + AAC (10 s, ~55 Mbps) — heavy',
    kind: 'video',
    expect: { codec: 'avc', width: 3840, height: 2160 },
  },
  (p) =>
    ffmpeg([
      ...picture('3840x2160', 30, 10),
      ...tone(10),
      ...grain,
      ...x264,
      '-maxrate',
      '55M',
      '-bufsize',
      '110M',
      '-level',
      '5.1',
      ...aac,
      ...faststart,
      '-shortest',
      p,
    ]),
);
make(
  {
    file: 'hevc-1080p30.mp4',
    label: 'HEVC 1080p30 + AAC (10 s)',
    kind: 'video',
    expect: { codec: 'hevc' },
  },
  (p) =>
    ffmpeg([
      ...picture('1920x1080', 30, 10),
      ...tone(10),
      ...grain,
      '-c:v',
      'libx265',
      '-preset',
      'fast',
      '-crf',
      '24',
      '-tag:v',
      'hvc1',
      '-pix_fmt',
      'yuv420p',
      '-x265-params',
      'log-level=error',
      ...aac,
      ...faststart,
      '-shortest',
      p,
    ]),
);
make(
  {
    file: 'hevc-hlg-10bit.mov',
    label: 'HEVC 10-bit HLG HDR .mov (iPhone-like)',
    kind: 'video',
    expect: { codec: 'hevc', hdr: true },
  },
  (p) =>
    ffmpeg([
      ...picture('1920x1080', 30, 6),
      ...tone(6),
      ...grain,
      '-c:v',
      'libx265',
      '-preset',
      'fast',
      '-crf',
      '24',
      '-tag:v',
      'hvc1',
      '-pix_fmt',
      'yuv420p10le',
      '-x265-params',
      'log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
      '-color_primaries',
      'bt2020',
      '-color_trc',
      'arib-std-b67',
      '-colorspace',
      'bt2020nc',
      ...aac,
      '-shortest',
      p,
    ]),
);
make(
  {
    file: 'vp9-1080p30.webm',
    label: 'VP9 1080p30 + Opus WebM (10 s)',
    kind: 'video',
    expect: { codec: 'vp9' },
  },
  (p) =>
    ffmpeg([
      ...picture('1920x1080', 30, 10),
      ...tone(10),
      ...grain,
      '-c:v',
      'libvpx-vp9',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-row-mt',
      '1',
      '-b:v',
      '6M',
      '-c:a',
      'libopus',
      '-b:a',
      '128k',
      '-shortest',
      p,
    ]),
);
make(
  {
    file: 'av1-1080p30.webm',
    label: 'AV1 1080p30 + Opus WebM (10 s)',
    kind: 'video',
    expect: { codec: 'av1' },
  },
  (p) =>
    ffmpeg([
      ...picture('1920x1080', 30, 10),
      ...tone(10),
      ...grain,
      '-c:v',
      'libsvtav1',
      '-preset',
      '10',
      '-crf',
      '35',
      '-svtav1-params',
      'loglevel=0',
      '-c:a',
      'libopus',
      '-b:a',
      '128k',
      '-shortest',
      p,
    ]),
);
make(
  {
    file: 'avc-rotated.mp4',
    label: 'H.264 phone portrait (rotation metadata)',
    kind: 'video',
    expect: { codec: 'avc', rotation: 90 },
  },
  (p) => {
    const tmp = `${p}.tmp.mp4`;
    ffmpeg([
      ...picture('1920x1080', 30, 6),
      ...tone(6),
      ...grain,
      ...x264,
      ...aac,
      '-shortest',
      tmp,
    ]);
    // display_rotation is counter-clockwise; -90 = 90° clockwise, which is what phones write.
    ffmpeg(['-display_rotation', '-90', '-i', tmp, '-c', 'copy', ...faststart, p]);
    execFileSync('rm', [tmp]);
  },
);
make(
  {
    file: 'avc-vfr.mp4',
    label: 'H.264 variable frame rate (screen-recording-like)',
    kind: 'video',
    expect: { codec: 'avc', vfr: true },
  },
  (p) =>
    ffmpeg([
      ...picture('1280x720', 30, 8),
      ...tone(8),
      '-vf',
      "select='not(eq(mod(n\\,4)\\,1))'",
      '-fps_mode',
      'vfr',
      ...x264,
      ...aac,
      ...faststart,
      '-shortest',
      p,
    ]),
);
make(
  {
    file: 'avc-noaudio.mp4',
    label: 'H.264 without audio',
    kind: 'video',
    expect: { audio: false },
  },
  (p) => ffmpeg([...picture('1280x720', 30, 6), ...grain, ...x264, ...faststart, p]),
);
make(
  {
    file: 'avc-mono-22k.mp4',
    label: 'H.264 + mono 22.05 kHz audio',
    kind: 'video',
    expect: { channels: 1, sampleRate: 22050 },
  },
  (p) =>
    ffmpeg([
      ...picture('1280x720', 30, 6),
      ...tone(6, 'mono', 22050),
      ...x264,
      ...aac,
      ...faststart,
      '-shortest',
      p,
    ]),
);
make(
  {
    file: 'avc-long-360p.mp4',
    label: 'H.264 360p, 10 minutes (soak test)',
    kind: 'video',
    expect: { durationS: 600 },
  },
  (p) =>
    ffmpeg([
      ...picture('640x360', 30, 600),
      ...tone(600),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '30',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      ...faststart,
      '-shortest',
      p,
    ]),
);
make(
  {
    file: 'broken-truncated.mp4',
    label: 'Broken: truncated MP4 (must fail clearly)',
    kind: 'broken',
  },
  (p) => {
    const source = join(out, 'avc-720p30.mp4');
    const bytes = readFileSync(source);
    writeFileSync(p, bytes.subarray(0, Math.floor(bytes.length / 3)));
  },
);
make({ file: 'broken-not-video.mp4', label: 'Broken: text file named .mp4', kind: 'broken' }, (p) =>
  writeFileSync(p, 'This is not a video file.\n'),
);

// Audio
make({ file: 'music.mp3', label: 'MP3 stereo 44.1 kHz (30 s)', kind: 'audio' }, (p) =>
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:sample_rate=44100:duration=30',
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '192k',
    p,
  ]),
);
make({ file: 'voice.m4a', label: 'AAC mono 48 kHz .m4a (20 s)', kind: 'audio' }, (p) =>
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:sample_rate=48000:duration=20',
    '-ac',
    '1',
    ...aac,
    p,
  ]),
);
make({ file: 'sfx.wav', label: 'WAV 16-bit stereo (2 s)', kind: 'audio' }, (p) =>
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=48000:duration=2',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    p,
  ]),
);

// Images
make({ file: 'photo.jpg', label: 'JPEG 4032×3024 (12 MP, phone-sized)', kind: 'image' }, (p) =>
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=4032x3024:duration=1',
    '-frames:v',
    '1',
    '-q:v',
    '3',
    p,
  ]),
);
make({ file: 'logo.png', label: 'PNG with transparency', kind: 'image' }, (p) =>
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=red@0.0:size=512x512,format=rgba,drawbox=x=128:y=128:w=256:h=256:color=purple@0.9:t=fill',
    '-frames:v',
    '1',
    p,
  ]),
);
make({ file: 'sticker.gif', label: 'Animated GIF', kind: 'image' }, (p) =>
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=240x240:rate=10:duration=2', p]),
);

// Real camera-style footage (free licence). Optional: skipped when offline.
make(
  {
    file: 'bbb-1080p60.mp4',
    label: 'Real footage: Big Buck Bunny 1080p60 (10 s, CC BY 3.0)',
    kind: 'video',
    expect: { codec: 'avc' },
  },
  (p) =>
    execFileSync('curl', [
      '-fsSL',
      '--max-time',
      '120',
      '-o',
      p,
      'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_5MB.mp4',
    ]),
);

// The owner's own phone files (test-media/private, git-ignored) are served at /media/private/.
const privateDir = join(root, 'private');
if (existsSync(privateDir)) {
  const link = join(out, 'private');
  if (!existsSync(link) && !lstatExists(link)) symlinkSync('../private', link);
  for (const name of readdirSync(privateDir).sort()) {
    if (name.startsWith('.') || !statSync(join(privateDir, name)).isFile()) continue;
    const kind: Kind = /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(name)
      ? 'image'
      : /\.(mp3|m4a|wav|aac)$/i.test(name)
        ? 'audio'
        : 'video';
    entries.push({ file: `private/${name}`, label: `Owner: ${name}`, kind });
    console.log(`  ✓ private/${name}`);
  }
}

writeFileSync(join(out, 'manifest.json'), JSON.stringify(entries, null, 2) + '\n');

// Apps serve the library at /media (links are git-ignored: in CI the library doesn't exist).
for (const app of ['apps/playground', 'apps/examples/vite']) {
  const publicDir = join(root, '..', app, 'public');
  mkdirSync(publicDir, { recursive: true });
  const link = join(publicDir, 'media');
  if (!lstatExists(link)) symlinkSync(relative(publicDir, out), link);
}
console.log(`Done: ${entries.length} files, manifest.json written.`);

function lstatExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
