'use client';

/**
 * Audio correctness lab: renders a known mix through the real Mixer (the same code as preview and
 * export) and measures it. Video clip with a 440 Hz tone (0–4 s, volume 1) + music lane with a
 * 330 Hz MP3 (44.1 kHz → resampled) at volume 0.5 with a 1 s fade-in, starting at 1 s.
 * Also a ducking scenario (`duckLab`). scripts/audio-check.ts reads the levels.
 */
import {
  createProject,
  DEFAULT_TRANSFORM,
  FLICKS_PER_SECOND,
  fromSeconds,
  insertMain,
  addToLane,
  addAsset,
  NO_CROP,
  type AudioItem,
  type Project,
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

/** Renders `seconds` of `project` from `fromS` in blocks (sizes cycle through `blocks`), left channel. */
async function renderMix(
  mixer: Mixer,
  project: Project,
  fromS: number,
  seconds: number,
  blocks: number[],
): Promise<Float32Array> {
  const out = new Float32Array(Math.round(seconds * RATE));
  const max = Math.max(...blocks);
  const bl = new Float32Array(max);
  const br = new Float32Array(max);
  const first = Math.round(fromS * RATE);
  for (let f = 0, b = 0; f < out.length;) {
    const n = Math.min(blocks[b++ % blocks.length]!, out.length - f);
    // Timeline time of sample (first + f): exact in flicks at 48 kHz.
    await mixer.render(project, ((first + f) * FLICKS_PER_SECOND) / RATE, n, bl, br);
    out.set(bl.subarray(0, n), f);
    f += n;
  }
  return out;
}

/**
 * Ducking: a "voice" (voice.m4a, 220 Hz) on a lane from 2 to 4 s, music (330 Hz, volume 0.5) from
 * 0 to 7 s set to lower under voice by 75 %. Rendered three ways through the real Mixer: like
 * preview (2048-frame blocks), like export (one 30 fps video frame of sound = 1600 frames at a
 * time, plus odd sizes), and like playback started by a seek to 3 s mid-voice.
 */
async function duckLab(sources: Map<string, AudioTrackSource>, assets: Project['assets']) {
  const project = createProject({
    ids: (() => {
      let n = 0;
      return () => `d${++n}`;
    })(),
  });
  for (const id of ['music.mp3', 'voice.m4a']) addAsset(project, assets[id]!);
  const sound = (id: string, assetId: string, startS: number, seconds: number): AudioItem => ({
    id,
    kind: 'audio',
    assetId,
    start: fromSeconds(startS),
    duration: fromSeconds(seconds),
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
  });
  addToLane(project, sound('voice', 'voice.m4a', 2, 2), () => 'lane-v');
  addToLane(
    project,
    { ...sound('music', 'music.mp3', 0, 7), volume: 0.5, duck: 0.75 },
    () => 'lane-m',
  );
  const seconds = 7;
  const mixer = () => new Mixer(RATE, (id) => sources.get(id) ?? null);
  const t0 = performance.now();
  const preview = await renderMix(mixer(), project, 0, seconds, [2048]);
  const renderMs = performance.now() - t0;
  const exportLike = await renderMix(mixer(), project, 0, seconds, [1600, 1600, 1600, 37, 4096]);
  const seeked = await renderMix(mixer(), project, 3, seconds - 3, [2048]);
  let blockDiff = 0;
  for (let i = 0; i < preview.length; i++)
    blockDiff = Math.max(blockDiff, Math.abs(preview[i]! - exportLike[i]!));
  const level = (x: Float32Array, from: number, to: number, freq: number) =>
    Math.round(tone(x.subarray(Math.round(from * RATE), Math.round(to * RATE)), freq) * 10000) /
    10000;
  const windows = [];
  for (let t = 0; t + 0.1 <= seconds + 1e-9; t += 0.1) {
    const at = Math.round(t * 10) / 10;
    windows.push({
      t: at,
      music: level(preview, at, at + 0.1, 330),
      voice: level(preview, at, at + 0.1, 220),
    });
  }
  // Even with no ducked item the mix must be untouched: same project with ducking off.
  const off = structuredClone(project);
  for (const t of off.tracks) for (const i of t.items) if (i.kind === 'audio') delete i.duck;
  const t1 = performance.now();
  const plain = await renderMix(mixer(), off, 0, seconds, [2048]);
  const plainMs = performance.now() - t1;
  const plainSeeked = await renderMix(mixer(), off, 3, seconds - 3, [2048]);
  // Right after the seek point: how much the duck lowers the music there (the reader's own seek
  // affects both renders the same way), vs the continuous render.
  const seekRatio = level(seeked, 0.02, 0.12, 330) / level(plainSeeked, 0.02, 0.12, 330);
  const continuousRatio = level(preview, 3.02, 3.12, 330) / level(plain, 3.02, 3.12, 330);
  return {
    windows,
    blockDiff,
    seekRatio,
    continuousRatio,
    plainMusicDuringVoice: level(plain, 2.5, 3.5, 330),
    renderMsPerSecond: renderMs / seconds,
    plainMsPerSecond: plainMs / seconds,
  };
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
      for (const file of ['avc-720p30.mp4', 'music.mp3', 'voice.m4a']) {
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
      const duck = await duckLab(sources, project.assets);
      setReport(
        JSON.stringify({
          windows,
          peak,
          lrMatch: left.every((v, i) => Math.abs(v - right[i]!) < 1e-6),
          duck,
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
