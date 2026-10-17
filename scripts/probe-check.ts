/**
 * Checks probeMedia against every file in the test library, in each browser.
 * Usage: playground running, then `node scripts/probe-check.ts [--browsers chrome,webkit,firefox]`.
 * Exits non-zero if any expectation fails.
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FLICKS = 705_600_000;
const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'test-media', 'files', 'manifest.json'), 'utf8'),
) as { file: string; kind: string; expect?: Record<string, unknown> }[];
const browsersArg = process.argv.indexOf('--browsers');
const names = (browsersArg > 0 ? process.argv[browsersArg + 1]! : 'chrome,webkit,firefox').split(
  ',',
);
const launchers = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  webkit: () => webkit.launch(),
  firefox: () => firefox.launch(),
};

type Result = {
  ok: boolean;
  code?: string;
  message?: string;
  ms: number;
  warnings?: { code: string }[];
  media?: Record<string, unknown>;
};
let failures = 0;

for (const name of names) {
  const browser = await launchers[name as keyof typeof launchers]();
  const page = await browser.newPage();
  await page.goto('http://localhost:3200/lab/probe');
  await page.waitForFunction(
    () => document.getElementById('results')?.textContent !== 'Probing…',
    null,
    { timeout: 300_000 },
  );
  const results = JSON.parse((await page.locator('#results').textContent())!) as Record<
    string,
    Result
  >;
  console.log(`\n===== ${name}`);
  for (const entry of manifest) {
    const r = results[entry.file];
    const problems: string[] = [];
    if (!r) problems.push('no result');
    else if (entry.kind === 'broken') {
      // Broken files must either fail clearly or warn that they're incomplete.
      if (r.ok && !r.warnings?.some((w) => w.code === 'incomplete'))
        problems.push('broken file accepted silently');
    } else if (!r.ok) {
      // HEVC is allowed to fail where the browser can't decode it — but with the right code.
      if (!(r.code === 'unsupported-video-codec' || r.code === 'unsupported-image'))
        problems.push(`failed: ${r.code} ${r.message}`);
    } else {
      const m = r.media!;
      if (m.kind !== entry.kind) problems.push(`kind ${String(m.kind)} ≠ ${entry.kind}`);
      for (const [key, want] of Object.entries(entry.expect ?? {})) {
        const got =
          key === 'codec'
            ? m.videoCodec
            : key === 'audio'
              ? m.hasAudio
              : key === 'durationS'
                ? Math.round(Number(m.duration) / FLICKS)
                : key === 'width' || key === 'height'
                  ? m[key]
                  : m[key];
        if (key === 'width' || key === 'height') {
          // Expectations are coded size; rotated files swap display width/height.
          const coded =
            m.rotation === 90 || m.rotation === 270 ? m[key === 'width' ? 'height' : 'width'] : got;
          if (coded !== want) problems.push(`${key} ${String(coded)} ≠ ${String(want)}`);
        } else if (key === 'fps') {
          if (Math.abs(Number(got) - Number(want)) > 0.1)
            problems.push(`fps ${String(got)} ≠ ${String(want)}`);
        } else if (got !== want) problems.push(`${key} ${String(got)} ≠ ${String(want)}`);
      }
    }
    const summary = !r
      ? '-'
      : r.ok
        ? `${String(r.media!.kind)} ${String(r.media!.videoCodec ?? r.media!.audioCodec ?? r.media!.mimeType)} ${String(r.media!.width ?? '')}×${String(r.media!.height ?? '')} rot ${String(r.media!.rotation ?? '-')} hdr ${String(r.media!.hdr ?? '-')} fps ${String(r.media!.fps ?? '-')}${r.media!.vfr ? ' VFR' : ''} audio ${r.media!.hasAudio ? `#${String(r.media!.audioTrack)} ${String(r.media!.channels)}ch` : 'none'} ${r.warnings?.length ? `warn:${r.warnings.map((w) => w.code).join(',')}` : ''}`
        : `ERROR ${r.code}`;
    console.log(
      `${problems.length ? '✗' : '✓'} ${entry.file.padEnd(48)} ${String(r?.ms ?? '').padStart(5)} ms  ${summary}${problems.length ? `\n    → ${problems.join('; ')}` : ''}`,
    );
    failures += problems.length ? 1 : 0;
  }
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exitCode = failures ? 1 : 0;
