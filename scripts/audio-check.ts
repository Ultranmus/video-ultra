/**
 * Audio correctness: renders /lab/audio's known mix through the real Mixer and checks tone levels
 * over time — mixing, resampling (44.1 → 48 kHz), volume and the fade-in curve.
 * Also ducking: the music dips under a voice by the set amount with smooth attack / hold /
 * release, the same for preview-sized and export-sized blocks, and already ducked after a seek.
 * Usage: playground running, then node scripts/audio-check.ts [PLAYGROUND=http://localhost:3200]
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto(`${process.env.PLAYGROUND ?? 'http://localhost:3200'}/lab/audio`);
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
  duck: {
    windows: { t: number; music: number; voice: number }[];
    blockDiff: number;
    seekRatio: number;
    continuousRatio: number;
    plainMusicDuringVoice: number;
    renderMsPerSecond: number;
    plainMsPerSecond: number;
  };
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

// ── Ducking: voice 2–4 s, music (volume 0.5) lowered by 75 % under it ──
const d = r.duck;
console.log('\nDucking — t(s)  music 330 Hz  voice 220 Hz');
for (const w of d.windows)
  if (w.t >= 1.5 && w.t <= 6)
    console.log(
      `        ${w.t.toFixed(1).padStart(4)}  ${w.music.toFixed(4).padStart(8)}  ${w.voice.toFixed(4).padStart(8)}`,
    );
const dAt = (t: number) => d.windows.find((w) => Math.abs(w.t - t) < 1e-6)!;
const avg = (from: number, to: number, key: 'music' | 'voice') => {
  const ws = d.windows.filter((w) => w.t >= from - 1e-6 && w.t < to - 1e-6);
  return ws.reduce((s, w) => s + w[key], 0) / ws.length;
};
const full = avg(0.5, 1.9, 'music');
const ducked = avg(2.3, 3.9, 'music');
const dB = (x: number) => 20 * Math.log10(x);
check(full > 0.02, `music plays at its level before the voice (${full.toFixed(4)})`);
check(
  Math.abs(ducked / full - 0.25) < 0.02,
  `music under the voice is 25 % of its level (${((ducked / full) * 100).toFixed(1)} %, ${dB(ducked / full).toFixed(1)} dB; expected −12.0 dB)`,
);
// The voice itself is untouched by the duck.
check(
  dAt(2.5).voice > 0.05 && Math.abs(dAt(2.5).voice - dAt(3.5).voice) < 0.002,
  `voice level steady (${dAt(2.5).voice.toFixed(4)} / ${dAt(3.5).voice.toFixed(4)})`,
);
// Attack: most of the way down within 0.1 s of the voice starting; never below the floor.
const attackWindow = dAt(2.1).music / full;
check(
  attackWindow < 0.32,
  `fast attack: 2.1–2.2 s at ${(attackWindow * 100).toFixed(0)} % (target 25 %)`,
);
// Hold: still down 0.2 s after the voice ends; release: back up by 5.5 s, and rising in between.
check(
  dAt(4.1).music / full < 0.3,
  `hold: still lowered at 4.1–4.2 s (${((dAt(4.1).music / full) * 100).toFixed(0)} %)`,
);
const release = [4.4, 4.6, 4.8, 5.0].map((t) => dAt(t).music / full);
check(
  release.every((v, i) => i === 0 || v > release[i - 1]!) && release[0]! < 0.9,
  `release is gradual (${release.map((v) => `${(v * 100).toFixed(0)} %`).join(' → ')})`,
);
check(
  avg(5.6, 6.9, 'music') / full > 0.97,
  `music back to full after the release (${((avg(5.6, 6.9, 'music') / full) * 100).toFixed(1)} %)`,
);
check(
  d.blockDiff < 1e-6,
  `preview (2048-frame blocks) and export (1600-frame + odd blocks) mix identically (max sample diff ${d.blockDiff.toExponential(1)})`,
);
check(
  Math.abs(d.seekRatio - d.continuousRatio) < 0.02,
  `play from a seek mid-voice is already lowered (${(d.seekRatio * 100).toFixed(1)} % vs ${(d.continuousRatio * 100).toFixed(1)} % when played through)`,
);
check(
  Math.abs(d.plainMusicDuringVoice / full - 1) < 0.02,
  `with ducking off the music stays at full level under the voice (${((d.plainMusicDuringVoice / full) * 100).toFixed(1)} %)`,
);
console.log(
  `  mixing cost (decode included): ${d.renderMsPerSecond.toFixed(1)} ms per second of sound with ducking, ${d.plainMsPerSecond.toFixed(1)} ms without`,
);
console.log(failures ? `\n${failures} check(s) failed` : '\nAll audio checks passed');
process.exitCode = failures ? 1 : 0;
