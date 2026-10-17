'use client';

/**
 * Audio correctness lab: renders a known mix through the real Mixer (the same code as preview and
 * export) and measures it. Video clip with a 440 Hz tone (0–4 s, volume 1) + music lane with a
 * 330 Hz MP3 (44.1 kHz → resampled) at volume 0.5 with a 1 s fade-in, starting at 1 s.
 * scripts/audio-check.ts reads the levels.
 */
import {
  createProject,
  DEFAULT_TRANSFORM,
  fromSeconds,
  insertMain,
  addToLane,
  addAsset,
  NO_CROP,
  type AudioItem,
  type VideoItem,
} from '@video-ultra/core';
import {
  assetFromProbe,
  Mixer,
  probeMedia,
  type AudioTrackSource,
} from '@video-ultra/core/internal';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { useEffect, useState } from 'react';

const RATE = 48000;

/** Level of `freq` in `x` (Goertzel, normalised so a full-scale sine ≈ 1). */
function tone(x: Float32Array, freq: number): number {
  const k = (2 * Math.PI * freq) / RATE;
  const c = 2 * Math.cos(k);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i]! + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - c * s1 * s2;
  return (2 * Math.sqrt(power)) / x.length;
}

export default function AudioLab() {
  const [report, setReport] = useState('Mixing…');
  useEffect(() => {
    (async () => {
      const project = createProject({
        ids: (() => {
          let n = 0;
          return () => `id${++n}`;
        })(),
      });
      const sources = new Map<string, AudioTrackSource>();
      for (const file of ['avc-720p30.mp4', 'music.mp3']) {
        const blob = await (await fetch(`/media/${file}`)).blob();
        const probe = await probeMedia(blob, file);
        if (!probe.ok) throw new Error(probe.message);
        addAsset(project, assetFromProbe(probe.media, file, { type: 'url', url: file }));
        const track = await new Input({
          formats: ALL_FORMATS,
          source: new BlobSource(blob),
        }).getPrimaryAudioTrack();
        sources.set(file, { track: track!, sampleRate: await track!.getSampleRate() });
      }
      const video: VideoItem = {
        id: 'v',
        kind: 'video',
        assetId: 'avc-720p30.mp4',
        start: 0,
        duration: fromSeconds(4),
        sourceIn: 0,
        speed: 1,
        volume: 1,
        muted: false,
        fadeIn: 0,
        fadeOut: 0,
        transform: { ...DEFAULT_TRANSFORM },
        crop: { ...NO_CROP },
        fit: 'fit',
        filter: null,
        adjust: {},
        transitionIn: null,
      };
      insertMain(project, video);
      const music: AudioItem = {
        id: 'm',
        kind: 'audio',
        assetId: 'music.mp3',
        start: fromSeconds(1),
        duration: fromSeconds(5),
        sourceIn: fromSeconds(2),
        speed: 1,
        volume: 0.5,
        muted: false,
        fadeIn: fromSeconds(1),
        fadeOut: 0,
      };
      addToLane(project, music, () => 'lane');
      const mixer = new Mixer(RATE, (id) => sources.get(id) ?? null);
      const seconds = 6;
      const left = new Float32Array(RATE * seconds);
      const right = new Float32Array(RATE * seconds);
      // Render in 2048-frame blocks, like playback does.
      const block = 2048;
      const bl = new Float32Array(block);
      const br = new Float32Array(block);
      for (let f = 0; f < left.length; f += block) {
        const n = Math.min(block, left.length - f);
        await mixer.render(project, fromSeconds(f / RATE), n, bl, br);
        left.set(bl.subarray(0, n), f);
        right.set(br.subarray(0, n), f);
      }
      // Levels in 0.25 s windows.
      const windows = [];
      for (let t = 0; t + 0.25 <= seconds; t += 0.25) {
        const slice = left.subarray(Math.round(t * RATE), Math.round((t + 0.25) * RATE));
        windows.push({
          t,
          tone440: Math.round(tone(slice, 440) * 1000) / 1000,
          tone330: Math.round(tone(slice, 330) * 1000) / 1000,
        });
      }
      let peak = 0;
      for (const v of left) peak = Math.max(peak, Math.abs(v));
      setReport(
        JSON.stringify({
          windows,
          peak,
          lrMatch: left.every((v, i) => Math.abs(v - right[i]!) < 1e-6),
        }),
      );
    })().catch((e: unknown) => setReport(`FAILED: ${String(e)}`));
  }, []);
  return (
    <main className="page">
      <h1>Audio lab</h1>
      <pre id="report">{report}</pre>
    </main>
  );
}
