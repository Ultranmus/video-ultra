/**
 * Audio correctness: renders /lab/audio's known mix through the real Mixer and checks tone levels
 * over time — mixing, resampling (44.1 → 48 kHz), volume and the fade-in curve.
 * Usage: playground running, then node scripts/audio-check.ts
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:3200/lab/audio');
await page.waitForFunction(
  () => document.getElementById('report')?.textContent !== 'Mixing…',
  null,
  { timeout: 60000 },
);
const text = (await page.locator('#report').textContent())!;
await browser.close();
if (text.startsWith('FAILED')) throw new Error(text);
const r = JSON.parse(text) as {
  windows: { t: number; tone440: number; tone330: number }[];
  peak: number;
};
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
};
const at = (t: number) => r.windows.find((w) => Math.abs(w.t - t) < 1e-9)!;
const ref440 = at(0.25).tone440; // the video's tone alone at full volume
console.log('t(s)   440 Hz   330 Hz');
for (const w of r.windows)
  console.log(
    `${w.t.toFixed(2).padStart(4)}  ${w.tone440.toFixed(3).padStart(6)}  ${w.tone330.toFixed(3).padStart(6)}`,
  );
// Both test tones are generated at the same amplitude (ffmpeg's sine is 1/8 of full scale).
check(ref440 > 0.05, `video tone present (${ref440})`);
check(at(0.5).tone330 < 0.01, 'no music before it starts (0.5 s)');
const steady330 = at(3).tone330;
// Music at volume 0.5 (after resampling 44.1 → 48 kHz) must be half the video tone at volume 1.
check(
  Math.abs(steady330 / ref440 - 0.5) < 0.05,
  `music at volume 0.5 is half the level (${(steady330 / ref440).toFixed(3)})`,
);
// Fade-in 1–2 s: level grows ~linearly (window centres 1.125 / 1.375 / 1.625 / 1.875 → ⅛ ⅜ ⅝ ⅞).
const fade = [1, 1.25, 1.5, 1.75].map((t) => at(t).tone330 / steady330);
check(
  fade.every((v, i) => Math.abs(v - (i * 2 + 1) / 8) < 0.06),
  `fade-in is linear (${fade.map((v) => v.toFixed(2)).join(' → ')})`,
);
check(Math.abs(at(4.5).tone330 - steady330) < 0.01, 'music level steady after the fade');
check(at(4.5).tone440 < 0.01, 'video tone stops when the clip ends (4 s)');
check(r.peak <= 1, `no clipping (peak ${r.peak.toFixed(3)})`);
console.log(failures ? `\n${failures} check(s) failed` : '\nAll audio checks passed');
process.exitCode = failures ? 1 : 0;
