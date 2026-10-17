'use client';

/**
 * Engine lab: builds a real demo project through the public API (main track of five clips incl.
 * a photo and a rotated portrait video, with a filter, an adjustment and three transitions; a
 * picture-in-picture video, a transparent PNG, a title and an emoji sticker; blurred background)
 * and plays or exports it with the engine worker. scripts/engine-check.ts and
 * scripts/export-check.ts drive it.
 *
 * `?golden=1` instead renders fixed golden frames through both GPU backends for
 * scripts/composite-check.ts. `?bg=color` turns the blurred background off.
 */
import {
  addAsset,
  addToLane,
  createProject,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  detectCapabilities,
  fromSeconds,
  insertMain,
  NO_CROP,
  projectDuration,
  setBackground,
  setTransition,
  toSeconds,
  type ExportOptions,
  type ExportResult,
  type ImageItem,
  type Project,
  type StickerItem,
  type TextItem,
  type VideoItem,
} from '@video-ultra/core';
import {
  assetFromProbe,
  createEngine,
  probeMedia,
  type EngineInternal,
  type EngineStats,
  type ExportRunInfo,
} from '@video-ultra/core/internal';
import { useEffect, useRef, useState } from 'react';

const MAIN: { file: string; seconds: number; from?: number }[] = [
  { file: 'avc-1080p30.mp4', seconds: 4, from: 2 },
  { file: 'photo.jpg', seconds: 3 },
  { file: 'hevc-1080p30.mp4', seconds: 4, from: 1 },
  { file: 'avc-rotated.mp4', seconds: 3 },
  { file: 'bbb-1080p60.mp4', seconds: 3 },
];

type Blobs = Map<string, Blob>;

async function loadAsset(project: Project, blobs: Blobs, file: string): Promise<string> {
  const blob = await (await fetch(`/media/${file}`)).blob();
  const probe = await probeMedia(blob, file);
  if (!probe.ok) throw new Error(probe.message);
  const a = assetFromProbe(probe.media, file, { type: 'url', url: `/media/${file}` });
  if (!project.assets[a.id]) addAsset(project, a);
  blobs.set(a.id, blob);
  return a.id;
}

const look = () => ({
  transform: { ...DEFAULT_TRANSFORM },
  crop: { ...NO_CROP },
  fit: 'fit' as const,
  filter: null,
  adjust: {},
  transitionIn: null,
});

function video(id: string, assetId: string, seconds: number, from = 0): VideoItem {
  return {
    id,
    kind: 'video',
    assetId,
    start: 0,
    duration: fromSeconds(seconds),
    sourceIn: fromSeconds(from),
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    ...look(),
  };
}

function title(id: string, text: string, startS: number, seconds: number): TextItem {
  return {
    id,
    kind: 'text',
    text,
    start: fromSeconds(startS),
    duration: fromSeconds(seconds),
    style: {
      ...DEFAULT_TEXT_STYLE,
      size: 0.05,
      outline: { color: '#2b0b3a', width: 0.06 },
      background: { color: 'rgba(156,71,156,0.85)', padding: 0.3, radius: 0.25 },
    },
    transform: { ...DEFAULT_TRANSFORM, y: 0.12 },
  };
}

function emoji(id: string, char: string, startS: number, seconds: number): StickerItem {
  return {
    id,
    kind: 'sticker',
    assetId: null,
    emoji: char,
    start: fromSeconds(startS),
    duration: fromSeconds(seconds),
    transform: { ...DEFAULT_TRANSFORM, x: 0.8, y: 0.68, scale: 0.3, rotation: -12 },
  };
}

async function buildDemo(blurBackground: boolean): Promise<{ project: Project; blobs: Blobs }> {
  const project = createProject({ name: 'Engine demo', width: 1080, height: 1920 });
  const blobs: Blobs = new Map();
  let n = 0;
  const id = () => `item${++n}`;
  const ids: string[] = [];
  for (const clip of MAIN) {
    // Firefox can't decode HEVC: it gets the VP9 file instead (same length).
    const assetId = await loadAsset(project, blobs, clip.file).catch((error: unknown) => {
      if (!clip.file.startsWith('hevc')) throw error;
      return loadAsset(project, blobs, 'vp9-1080p30.webm');
    });
    const itemId = id();
    ids.push(itemId);
    if (project.assets[assetId]!.kind === 'image') {
      const item: ImageItem = {
        id: itemId,
        kind: 'image',
        assetId,
        start: 0,
        duration: fromSeconds(clip.seconds),
        ...look(),
      };
      insertMain(project, item);
    } else {
      insertMain(project, video(itemId, assetId, clip.seconds, clip.from));
    }
  }
  // Effects: a filter, an adjustment, three transitions.
  const main = project.tracks[0]!.items;
  const first = main[0]!;
  if ('filter' in first) first.filter = { id: 'vivid', intensity: 0.8 };
  const third = main[2]!;
  if ('adjust' in third) third.adjust = { warmth: 0.4, vignette: 0.5, contrast: 0.2 };
  setTransition(project, ids[1]!, { type: 'dissolve', duration: fromSeconds(0.6) });
  setTransition(project, ids[3]!, { type: 'slide-left', duration: fromSeconds(0.5) });
  setTransition(project, ids[4]!, { type: 'wipe', duration: fromSeconds(0.5) });
  if (blurBackground) setBackground(project, { type: 'blur', amount: 0.5 });

  const pipAsset = await loadAsset(project, blobs, 'avc-720p30.mp4');
  const pip = video(id(), pipAsset, 7);
  pip.start = fromSeconds(2);
  pip.transform = { ...DEFAULT_TRANSFORM, x: 0.7, y: 0.18, scale: 0.42, rotation: 8, opacity: 0.9 };
  addToLane(project, pip, id);
  const logoAsset = await loadAsset(project, blobs, 'logo.png');
  const logo: ImageItem = {
    id: id(),
    kind: 'image',
    assetId: logoAsset,
    start: fromSeconds(1),
    duration: fromSeconds(5),
    ...look(),
    transform: { ...DEFAULT_TRANSFORM, x: 0.3, y: 0.84, scale: 0.35 },
  };
  addToLane(project, logo, id);
  addToLane(project, title(id(), 'Made with\nvideo-ultra', 0.5, 9), id);
  addToLane(project, emoji(id(), '🎉', 0.5, 6), id);
  return { project, blobs };
}

/**
 * Golden scene for composite-check: 640×640 canvas, three 720p clips (warm filter on the first,
 * adjustments on the second; dissolve then wipe), a title, a blurred background. `plain` = the
 * same timeline without any effect, for comparison.
 */
async function buildGolden(plain: boolean): Promise<{ project: Project; blobs: Blobs }> {
  const project = createProject({ name: 'Golden', width: 640, height: 640 });
  const blobs: Blobs = new Map();
  const asset = await loadAsset(project, blobs, 'avc-720p30.mp4');
  const a = video('a', asset, 2, 1);
  const b = video('b', asset, 2, 4);
  const c = video('c', asset, 2, 7);
  if (!plain) {
    a.filter = { id: 'warm', intensity: 1 };
    b.adjust = { contrast: 0.6, saturation: 0.5, vignette: 0.6 };
  }
  insertMain(project, a);
  insertMain(project, b);
  insertMain(project, c);
  if (!plain) {
    setTransition(project, 'b', { type: 'dissolve', duration: fromSeconds(1) });
    setTransition(project, 'c', { type: 'wipe', duration: fromSeconds(1) });
    setBackground(project, { type: 'blur', amount: 0.6 });
    const t = title('t', 'Golden', 0, 6);
    t.transform.y = 0.5;
    t.style = { ...t.style, size: 0.1, color: '#ffffff', shadow: null };
    let n = 0;
    addToLane(project, t, () => `g${++n}`);
  }
  return { project, blobs };
}

/** Golden capture times (s): filter, transition midpoint (dissolve), adjustments, wipe midpoint. */
const GOLDEN_TIMES = [0.6, 2, 3, 4];

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function bitmapPixels(bitmap: ImageBitmap): Promise<string> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return toBase64(new Uint8Array(data.buffer));
}

async function runGolden(engine: EngineInternal): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const plain of [false, true]) {
    const { project, blobs } = await buildGolden(plain);
    await engine.setProject(project);
    for (const [assetId, blob] of blobs) await engine.addMedia(assetId, blob);
    for (const backend of ['webgpu', 'webgl2'] as const) {
      for (const t of GOLDEN_TIMES) {
        const key = `${plain ? 'plain' : 'fx'}-${backend}-${t}`;
        try {
          const bitmap = await engine.capture(fromSeconds(t), { width: 640, height: 640, backend });
          out[key] = await bitmapPixels(bitmap);
        } catch (error) {
          out[`${key}-error`] = String(error);
        }
      }
    }
  }
  return out;
}

async function blobBase64(blob: Blob): Promise<string> {
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

declare global {
  interface Window {
    engineLab?: {
      play(): Promise<void>;
      pause(): Promise<void>;
      seek(s: number): Promise<void>;
      stats(): Promise<EngineStats>;
      exportVideo(
        options: ExportOptions,
        backend?: 'webgpu' | 'webgl2',
      ): Promise<{ result: Omit<ExportResult, 'blob'>; info: ExportRunInfo; base64: string }>;
      cancelAfter(ms: number, options: ExportOptions): Promise<string>;
      duration: number;
      ended: boolean;
      time: number;
    };
    /** `?golden=1`: base64 RGBA images by `fx|plain-backend-time` (composite-check reads it). */
    goldenReport?: Record<string, string>;
  }
}

export default function EngineLab() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Building the demo project…');
  const [time, setTime] = useState(0);
  const [progress, setProgress] = useState('');
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [golden, setGolden] = useState<string | null>(null);
  const exportAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    let engine: EngineInternal | null = null;
    // React (dev, strict mode) runs this effect twice; the first run's async setup must not leave a
    // zombie engine behind once it has been cleaned up.
    let disposed = false;
    const stage = stageRef.current!;
    const canvas = document.createElement('canvas');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(stage.clientWidth * dpr);
    canvas.height = Math.round(stage.clientHeight * dpr);
    stage.appendChild(canvas);
    const params = new URLSearchParams(location.search);
    (async () => {
      const caps = await detectCapabilities();
      const backend = (params.get('backend') ?? 'auto') as 'auto' | 'webgpu' | 'webgl2';
      const created = await createEngine(canvas, { tier: caps.tier, backend });
      if (disposed) {
        created.destroy();
        return;
      }
      engine = created;
      engine.onError = (message) => {
        console.error(`[engine] ${message}`);
        setStatus(`Engine error: ${message}`);
      };
      if (params.get('golden')) {
        setStatus('Rendering golden frames…');
        const report = await runGolden(engine);
        if (disposed) return;
        window.goldenReport = report;
        setGolden(`${Object.keys(report).length} images`);
        setStatus('Golden done');
        return;
      }
      const { project, blobs } = await buildDemo(params.get('bg') !== 'color');
      if (disposed) return;
      const lab = {
        duration: toSeconds(projectDuration(project)),
        ended: false,
        time: 0,
      } as NonNullable<Window['engineLab']>;
      engine.onTime = (t) => {
        lab.time = toSeconds(t);
        setTime(lab.time);
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
        pause: () => e.pause(),
        stats: () => e.stats(),
        async exportVideo(options: ExportOptions, exportBackend?: 'webgpu' | 'webgl2') {
          const { result, info } = await e.exportWithInfo(
            options,
            (p) => setProgress(`${Math.round(p.fraction * 100)} %`),
            undefined,
            exportBackend,
          );
          const { blob, ...rest } = result;
          return { result: rest, info, base64: await blobBase64(blob) };
        },
        async cancelAfter(ms: number, options: ExportOptions) {
          const controller = new AbortController();
          setTimeout(() => controller.abort(), ms);
          try {
            await e.export(options, undefined, controller.signal);
            return 'finished';
          } catch (error) {
            return error instanceof DOMException ? error.name : String(error);
          }
        },
      });
      setStatus(`Ready · ${engine.backend} · tier ${caps.tier} · ${lab.duration.toFixed(1)} s`);
    })().catch((err: unknown) => setStatus(`FAILED: ${String(err)}`));
    return () => {
      disposed = true;
      engine?.destroy();
      canvas.remove();
    };
  }, []);

  const startExport = async () => {
    const lab = window.engineLab;
    if (!lab) return;
    exportAbort.current?.abort();
    const controller = new AbortController();
    exportAbort.current = controller;
    setDownload(null);
    setProgress('Starting…');
    try {
      const { result, base64 } = await lab.exportVideo({
        format,
        height: 720,
        fps: 30,
        quality: 'medium',
      });
      const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      setDownload({ url, name: `engine-demo.${result.extension}` });
      setProgress(
        `Done · ${result.width}×${result.height} · ${result.elapsedSeconds.toFixed(1)} s · ${result.storage}${result.warnings.length ? ` · ${result.warnings.join(' ')}` : ''}`,
      );
    } catch (error) {
      setProgress(`Export failed: ${String(error)}`);
    }
  };

  return (
    <main className="page">
      <h1>Engine lab</h1>
      <p id="status" className="status">
        {status}
      </p>
      <p>{time.toFixed(2)} s</p>
      <div className="row">
        <button onClick={() => void window.engineLab?.play()}>Play</button>
        <button onClick={() => void window.engineLab?.pause()}>Pause</button>
        <button onClick={() => void window.engineLab?.seek(0)}>Start</button>
        <select value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}>
          <option value="mp4">MP4</option>
          <option value="webm">WebM</option>
        </select>
        <button onClick={() => void startExport()}>Export 720p</button>
        <span id="export-progress">{progress}</span>
        {download && (
          <a href={download.url} download={download.name}>
            Download
          </a>
        )}
      </div>
      <div ref={stageRef} style={{ width: 360, height: 640, background: '#000' }} />
      {golden !== null && (
        <pre id="golden" style={{ maxHeight: 80, overflow: 'auto' }}>
          {golden}
        </pre>
      )}
    </main>
  );
}
