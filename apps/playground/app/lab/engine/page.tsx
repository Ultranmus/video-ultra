'use client';

/**
 * Engine lab: builds a real demo project through the public API (main track of five clips incl.
 * a photo and a rotated portrait video, a picture-in-picture video, a transparent PNG) and plays it
 * with the engine worker. scripts/engine-check.ts drives it and reads the stats.
 */
import {
  addAsset,
  addToLane,
  createProject,
  DEFAULT_TRANSFORM,
  detectCapabilities,
  fromSeconds,
  insertMain,
  NO_CROP,
  projectDuration,
  toSeconds,
  type ImageItem,
  type Project,
  type VideoItem,
} from '@video-ultra/core';
import {
  assetFromProbe,
  createEngine,
  probeMedia,
  type Engine,
  type EngineStats,
} from '@video-ultra/core/internal';
import { useEffect, useRef, useState } from 'react';

const MAIN: { file: string; seconds: number; from?: number }[] = [
  { file: 'avc-1080p30.mp4', seconds: 4, from: 2 },
  { file: 'photo.jpg', seconds: 3 },
  { file: 'hevc-1080p30.mp4', seconds: 4, from: 1 },
  { file: 'avc-rotated.mp4', seconds: 3 },
  { file: 'bbb-1080p60.mp4', seconds: 3 },
];

async function buildDemo(): Promise<{ project: Project; blobs: Map<string, Blob> }> {
  const project = createProject({ name: 'Engine demo', width: 1080, height: 1920 });
  const blobs = new Map<string, Blob>();
  const asset = async (file: string) => {
    const blob = await (await fetch(`/media/${file}`)).blob();
    const probe = await probeMedia(blob, file);
    if (!probe.ok) throw new Error(probe.message);
    const a = assetFromProbe(probe.media, file, { type: 'url', url: `/media/${file}` });
    if (!project.assets[a.id]) addAsset(project, a);
    blobs.set(a.id, blob);
    return a.id;
  };
  let n = 0;
  const id = () => `item${++n}`;
  for (const clip of MAIN) {
    const assetId = await asset(clip.file);
    const look = {
      transform: { ...DEFAULT_TRANSFORM },
      crop: { ...NO_CROP },
      fit: 'fit' as const,
      filter: null,
      adjust: {},
      transitionIn: null,
    };
    if (project.assets[assetId]!.kind === 'image') {
      const item: ImageItem = {
        id: id(),
        kind: 'image',
        assetId,
        start: 0,
        duration: fromSeconds(clip.seconds),
        ...look,
      };
      insertMain(project, item);
    } else {
      const item: VideoItem = {
        id: id(),
        kind: 'video',
        assetId,
        start: 0,
        duration: fromSeconds(clip.seconds),
        sourceIn: fromSeconds(clip.from ?? 0),
        speed: 1,
        volume: 1,
        muted: false,
        fadeIn: 0,
        fadeOut: 0,
        ...look,
      };
      insertMain(project, item);
    }
  }
  const pipAsset = await asset('avc-720p30.mp4');
  const pip: VideoItem = {
    id: id(),
    kind: 'video',
    assetId: pipAsset,
    start: fromSeconds(2),
    duration: fromSeconds(7),
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM, x: 0.7, y: 0.18, scale: 0.42, rotation: 8, opacity: 0.9 },
    crop: { ...NO_CROP },
    fit: 'fit',
    filter: null,
    adjust: {},
    transitionIn: null,
  };
  addToLane(project, pip, id);
  const logoAsset = await asset('logo.png');
  const logo: ImageItem = {
    id: id(),
    kind: 'image',
    assetId: logoAsset,
    start: fromSeconds(1),
    duration: fromSeconds(5),
    transform: { ...DEFAULT_TRANSFORM, x: 0.3, y: 0.84, scale: 0.35 },
    crop: { ...NO_CROP },
    fit: 'fit',
    filter: null,
    adjust: {},
    transitionIn: null,
  };
  addToLane(project, logo, id);
  return { project, blobs };
}

declare global {
  interface Window {
    engineLab?: {
      play(): Promise<void>;
      seek(s: number): Promise<void>;
      stats(): Promise<EngineStats>;
      duration: number;
      ended: boolean;
      time: number;
    };
  }
}

export default function EngineLab() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Building the demo project…');
  const [time, setTime] = useState(0);
  useEffect(() => {
    let engine: Engine | null = null;
    // React (dev, strict mode) runs this effect twice; the first run's async setup must not leave a
    // zombie engine behind once it has been cleaned up.
    let disposed = false;
    const stage = stageRef.current!;
    const canvas = document.createElement('canvas');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(stage.clientWidth * dpr);
    canvas.height = Math.round(stage.clientHeight * dpr);
    stage.appendChild(canvas);
    (async () => {
      const { project, blobs } = await buildDemo();
      const caps = await detectCapabilities();
      const backend = (new URLSearchParams(location.search).get('backend') ?? 'auto') as
        'auto' | 'webgpu' | 'webgl2';
      const created = await createEngine(canvas, { tier: caps.tier, backend });
      if (disposed) {
        created.destroy();
        return;
      }
      engine = created;
      const lab = {
        duration: toSeconds(projectDuration(project)),
        ended: false,
        time: 0,
      } as NonNullable<Window['engineLab']>;
      engine.onTime = (t) => {
        lab.time = toSeconds(t);
        setTime(lab.time);
      };
      engine.onError = (message) => {
        console.error(`[engine] ${message}`);
        setStatus(`Engine error: ${message}`);
      };
      engine.onEnded = () => {
        lab.ended = true;
        setStatus('Ended');
      };
      await engine.setProject(project);
      for (const [assetId, blob] of blobs) await engine.addMedia(assetId, blob);
      const e = engine;
      window.engineLab = Object.assign(lab, {
        play: () => {
          lab.ended = false;
          return e.play();
        },
        seek: (s: number) => e.seek(fromSeconds(s)),
        stats: () => e.stats(),
      });
      setStatus(`Ready · ${engine.backend} · tier ${caps.tier} · ${lab.duration.toFixed(1)} s`);
    })().catch((err: unknown) => setStatus(`FAILED: ${String(err)}`));
    return () => {
      disposed = true;
      engine?.destroy();
      canvas.remove();
    };
  }, []);
  return (
    <main className="page">
      <h1>Engine lab</h1>
      <p id="status" className="status">
        {status}
      </p>
      <p>{time.toFixed(2)} s</p>
      <div className="row">
        <button onClick={() => void window.engineLab?.play()}>Play</button>
        <button onClick={() => void window.engineLab?.seek(0)}>Start</button>
      </div>
      <div ref={stageRef} style={{ width: 360, height: 640, background: '#000' }} />
    </main>
  );
}
