'use client';

/**
 * Engine lab: builds a real demo project through the public API (main track of five clips incl.
 * a photo and a rotated portrait video, with a filter, an adjustment and three transitions; a
 * picture-in-picture video, a transparent PNG, a title and an emoji sticker; blurred background)
 * and plays or exports it with the engine worker. scripts/engine-check.ts and
 * scripts/export-check.ts drive it.
 *
 * `?golden=1` instead renders fixed golden frames through both GPU backends for
 * scripts/composite-check.ts (filters, adjustments, a sample of every transition family with
 * overlays on lanes, element animations). `?bench=1` measures the GPU draw cost of the heaviest
 * transitions on both backends. `?bg=color` turns the blurred background off.
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
  setAnimation,
  setBackground,
  setTransition,
  toSeconds,
  type Direction,
  type ExportOptions,
  type AudioExportOptions,
  type AudioExportResult,
  type FrameImage,
  type FrameImageOptions,
  type ExportResult,
  type ImageItem,
  type Project,
  type StickerItem,
  type TextItem,
  type VideoItem,
} from '@video-ultra/core';
import {
  assetFromProbe,
  colourParams,
  createEngine,
  createWebGL2Renderer,
  createWebGPURenderer,
  EFFECT_FLOATS,
  fullCanvasGeometry,
  identityColour,
  layerGeometry,
  moveOnCanvas,
  plainLook,
  noOverlay,
  probeMedia,
  transitionLook,
  transitionOverlay,
  writeEffects,
  type EngineInternal,
  type EngineStats,
  type ExportRunInfo,
  type LayerDraw,
  type Renderer,
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
    filter: null,
    adjust: {},
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
    filter: null,
    adjust: {},
  };
}

async function buildDemo(
  blurBackground: boolean,
  repeat = 1,
): Promise<{ project: Project; blobs: Blobs }> {
  const project = createProject({ name: 'Engine demo', width: 1080, height: 1920 });
  const blobs: Blobs = new Map();
  let n = 0;
  const id = () => `item${++n}`;
  const ids: string[] = [];
  // `?repeat=N` makes the main track N times longer (memory checks on long exports).
  for (const clip of Array.from({ length: repeat }, () => MAIN).flat()) {
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
  setTransition(project, ids[2]!, { type: 'light-leak', duration: fromSeconds(0.8) });
  // A v0.1 id (now "Push, left") and a 3D one.
  setTransition(project, ids[3]!, { type: 'slide-left', duration: fromSeconds(0.5) });
  setTransition(project, ids[4]!, { type: 'cube', duration: fromSeconds(0.5), direction: 'left' });
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
  // Element animations: the title types itself, the sticker pops in, wiggles and spins out, the
  // logo slides in, the picture-in-picture flips in.
  const lane = (kind: string) => project.tracks.find((t) => t.items[0]?.kind === kind)!.items[0]!;
  setAnimation(project, lane('text').id, 'in', {
    type: 'typewriter-in',
    duration: fromSeconds(1.5),
  });
  const sticker = lane('sticker').id;
  setAnimation(project, sticker, 'in', { type: 'pop-in', duration: fromSeconds(0.6) });
  setAnimation(project, sticker, 'loop', { type: 'wiggle' });
  setAnimation(project, sticker, 'out', { type: 'spin-out', duration: fromSeconds(0.5) });
  setAnimation(project, logo.id, 'in', { type: 'slide-left-in', duration: fromSeconds(0.6) });
  setAnimation(project, pip.id, 'in', { type: 'flip-in', duration: fromSeconds(0.6) });
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

/** One transition of every family (golden frames at the midpoint, both backends). */
const GOLDEN_TRANSITIONS: { type: string; direction?: Direction }[] = [
  { type: 'dissolve' },
  { type: 'fade' },
  { type: 'push', direction: 'left' },
  { type: 'reveal', direction: 'up' },
  { type: 'whip', direction: 'right' },
  { type: 'wipe-diagonal', direction: 'right' },
  { type: 'circle-open' },
  { type: 'clock' },
  { type: 'blinds' },
  { type: 'checker' },
  { type: 'zigzag' },
  { type: 'zoom' },
  { type: 'zoom-blur' },
  { type: 'spin-zoom', direction: 'right' },
  { type: 'swirl' },
  { type: 'motion-blur', direction: 'left' },
  { type: 'light-leak' },
  { type: 'film-burn' },
  { type: 'rgb-split' },
  { type: 'pixelate' },
  { type: 'vhs' },
  { type: 'noise-dissolve' },
  { type: 'heart' },
  { type: 'star' },
  { type: 'ripple' },
  { type: 'page-curl', direction: 'left' },
  { type: 'squeeze', direction: 'left' },
  { type: 'cube', direction: 'left' },
  { type: 'flip', direction: 'up' },
  { type: 'door', direction: 'right' },
];

/**
 * Transition golden scene: 640×640, two 720p clips cut at 2 s with a 1 s transition (none when
 * `type` is null), plus lane overlays that must stay untouched: an opaque magenta title box and an
 * emoji sticker.
 */
async function buildTransitionScene(
  t: { type: string; direction?: Direction } | null,
): Promise<{ project: Project; blobs: Blobs }> {
  const project = createProject({ name: 'Transition', width: 640, height: 640 });
  const blobs: Blobs = new Map();
  // Two different pictures: natural footage out, colour bars in.
  insertMain(project, video('a', await loadAsset(project, blobs, 'bbb-1080p60.mp4'), 2, 3));
  insertMain(project, video('b', await loadAsset(project, blobs, 'avc-720p30.mp4'), 2, 6));
  if (t)
    setTransition(project, 'b', {
      type: t.type,
      duration: fromSeconds(1),
      ...(t.direction ? { direction: t.direction } : {}),
    });
  const box = title('t', 'Overlay', 0, 4);
  box.transform = { ...DEFAULT_TRANSFORM, y: 0.86 };
  box.style = {
    ...box.style,
    color: '#ffffff',
    outline: null,
    shadow: null,
    background: { color: '#ff00ff', padding: 0.4, radius: 0 },
  };
  let n = 0;
  addToLane(project, box, () => `l${++n}`);
  addToLane(project, emoji('s', '⭐', 0, 4), () => `l${++n}`);
  return { project, blobs };
}

/**
 * Animation golden scene: a title typing itself in (0–1 s), an emoji popping in (0–0.6 s) and
 * spinning slowly (loop), a photo sliding in from the left (0–0.8 s). `plain` = no animations.
 */
async function buildAnimationScene(plain: boolean): Promise<{ project: Project; blobs: Blobs }> {
  const project = createProject({ name: 'Animation', width: 640, height: 640 });
  const blobs: Blobs = new Map();
  const asset = await loadAsset(project, blobs, 'avc-720p30.mp4');
  insertMain(project, video('a', asset, 4, 1));
  const text = title('t', 'Typewriter text', 0, 4);
  text.transform = { ...DEFAULT_TRANSFORM, y: 0.2 };
  text.style = {
    ...text.style,
    size: 0.08,
    color: '#ffffff',
    outline: null,
    shadow: null,
    background: null,
  };
  let n = 0;
  const ids = () => `l${++n}`;
  addToLane(project, text, ids);
  addToLane(
    project,
    {
      ...emoji('s', '⭐', 0, 4),
      transform: { ...DEFAULT_TRANSFORM, x: 0.5, y: 0.55, scale: 0.35 },
    },
    ids,
  );
  const photoAsset = await loadAsset(project, blobs, 'photo.jpg');
  const photo: ImageItem = {
    id: 'p',
    kind: 'image',
    assetId: photoAsset,
    start: 0,
    duration: fromSeconds(4),
    ...look(),
    transform: { ...DEFAULT_TRANSFORM, x: 0.25, y: 0.85, scale: 0.3 },
  };
  addToLane(project, photo, ids);
  if (!plain) {
    setAnimation(project, 't', 'in', { type: 'typewriter-in', duration: fromSeconds(1) });
    setAnimation(project, 's', 'in', { type: 'pop-in', duration: fromSeconds(0.6) });
    setAnimation(project, 's', 'loop', { type: 'spin', speed: 1 });
    setAnimation(project, 'p', 'in', { type: 'slide-left-in', duration: fromSeconds(0.8) });
  }
  return { project, blobs };
}

/** Animation golden times (s): mid entrance, end of entrance, mid loop (a quarter turn). */
const ANIMATION_TIMES = [0.3, 0.5, 1.5, 2.25];

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

async function captureAll(
  engine: EngineInternal,
  build: () => Promise<{ project: Project; blobs: Blobs }>,
  times: number[],
  key: (backend: string, t: number) => string,
  out: Record<string, string>,
): Promise<void> {
  const { project, blobs } = await build();
  await engine.setProject(project);
  for (const [assetId, blob] of blobs) await engine.addMedia(assetId, blob);
  for (const backend of ['webgpu', 'webgl2'] as const) {
    for (const t of times) {
      const k = key(backend, t);
      try {
        const bitmap = await engine.capture(fromSeconds(t), { width: 640, height: 640, backend });
        out[k] = await bitmapPixels(bitmap);
      } catch (error) {
        out[`${k}-error`] = String(error);
      }
    }
  }
}

async function runGolden(engine: EngineInternal): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // 30 % into the window (1.5 s … 2.5 s): every family shows both clips or its shape.
  await captureAll(
    engine,
    () => buildTransitionScene(null),
    [1.8],
    (b) => `tx-none-${b}`,
    out,
  );
  for (const t of GOLDEN_TRANSITIONS) {
    await captureAll(
      engine,
      () => buildTransitionScene(t),
      [1.8],
      (b) => `tx-${t.type}-${b}`,
      out,
    );
  }
  for (const plain of [false, true]) {
    await captureAll(
      engine,
      () => buildAnimationScene(plain),
      ANIMATION_TIMES,
      (b, t) => `anim${plain ? 'plain' : ''}-${b}-${t}`,
      out,
    );
  }
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

/** Draw-cost bench cases: the heaviest transitions (and two baselines) at their midpoint. */
const BENCH_CASES: { type: string; direction?: Direction; cheap?: boolean }[] = [
  { type: 'none' },
  { type: 'dissolve' },
  { type: 'blur' },
  { type: 'zoom-blur' },
  { type: 'spin-zoom' },
  { type: 'spin-blur' },
  { type: 'motion-blur' },
  { type: 'whip' },
  { type: 'stretch' },
  { type: 'swirl' },
  { type: 'ripple' },
  { type: 'lens' },
  { type: 'vhs' },
  { type: 'glitch' },
  { type: 'rgb-split' },
  { type: 'pixelate' },
  { type: 'heart' },
  { type: 'star' },
  { type: 'checker' },
  { type: 'noise-dissolve' },
  { type: 'page-curl' },
  { type: 'cube' },
  { type: 'light-leak' },
  { type: 'film-burn' },
  { type: 'static' },
  { type: 'anim-blur' },
  // Low-tier preview: blurs take half the taps.
  { type: 'blur', cheap: true },
  { type: 'spin-blur', cheap: true },
  { type: 'motion-blur', cheap: true },
];

/**
 * GPU cost per frame of each case on a 1080×1920 canvas (two full-screen photo layers + overlay),
 * per backend: frames are queued in batches and the batch is timed to a forced read-back, minus
 * nothing (the "none" row is one plain layer). Main thread; lab only.
 */
async function runBench(frames: number): Promise<Record<string, Record<string, number>>> {
  const blob = await (await fetch('/media/photo.jpg')).blob();
  const a = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const b = await createImageBitmap(blob, { premultiplyAlpha: 'none', imageOrientation: 'flipY' });
  const solid = new OffscreenCanvas(2, 2);
  const sctx = solid.getContext('2d')!;
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, 2, 2);
  const W = 1080;
  const H = 1920;
  const probe = new OffscreenCanvas(1, 1).getContext('2d')!;
  const out: Record<string, Record<string, number>> = {};
  for (const backend of ['webgl2', 'webgpu'] as const) {
    const canvas = new OffscreenCanvas(W, H);
    let renderer: Renderer;
    try {
      renderer =
        backend === 'webgpu' ? await createWebGPURenderer(canvas) : createWebGL2Renderer(canvas);
    } catch {
      continue;
    }
    const sync = () => {
      const bitmap = canvas.transferToImageBitmap();
      probe.drawImage(bitmap, 0, 0, 1, 1);
      probe.getImageData(0, 0, 1, 1);
      bitmap.close();
    };
    const row: Record<string, number> = {};
    for (const c of BENCH_CASES) {
      const draws: LayerDraw[] = [];
      const options = { aspect: W / H, ...(c.direction ? { direction: c.direction } : {}) };
      const place = (img: ImageBitmap) =>
        layerGeometry(
          W,
          H,
          { width: img.width, height: img.height, rotation: 0, flip: false },
          {
            transform: { ...DEFAULT_TRANSFORM },
            crop: { ...NO_CROP },
            fit: 'fill',
          },
        );
      if (c.type === 'none' || c.type === 'anim-blur') {
        const effects = new Float32Array(EFFECT_FLOATS);
        const fx = plainLook().fx;
        if (c.type === 'anim-blur') fx.blurX = fx.blurY = 0.03;
        writeEffects(effects, 0, identityColour(), fx);
        draws.push({ source: a, geometry: place(a), opacity: 1, hdr: false, effects });
      } else {
        let onTop = false;
        for (const [role, img] of [
          ['out', a],
          ['in', b],
        ] as const) {
          const look = transitionLook(c.type, 0.5, role, plainLook(), options);
          const geometry = place(img);
          moveOnCanvas(geometry, W, H, look);
          const effects = new Float32Array(EFFECT_FLOATS);
          look.fx.cheapBlur = c.cheap ?? false;
          writeEffects(effects, 0, colourParams(null, {}), look.fx);
          if (role === 'out') onTop = look.onTop;
          if (look.visible)
            draws.push({ source: img, geometry, opacity: look.opacity, hdr: false, effects });
        }
        if (onTop && draws.length === 2) draws.reverse();
        const overlay = transitionOverlay(c.type, 0.5, noOverlay(), options);
        if (overlay.opacity > 0) {
          const colour = identityColour();
          colour.gainR = overlay.r;
          colour.gainG = overlay.g;
          colour.gainB = overlay.b;
          const effects = new Float32Array(EFFECT_FLOATS);
          writeEffects(effects, 0, colour, overlay.fx);
          draws.push({
            source: solid,
            geometry: fullCanvasGeometry(),
            opacity: overlay.opacity,
            hdr: false,
            effects,
          });
        }
      }
      for (let i = 0; i < 5; i++) renderer.render(draws);
      sync();
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) renderer.render(draws);
        sync();
        best = Math.min(best, (performance.now() - t0) / frames);
      }
      row[c.cheap ? `${c.type} (low tier)` : c.type] = Math.round(best * 1000) / 1000;
    }
    renderer.destroy();
    out[backend] = row;
  }
  a.close();
  b.close();
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
      /** Sound only (M4A / Ogg / WAV), as base64. */
      exportAudio(
        options: AudioExportOptions,
      ): Promise<{ result: Omit<AudioExportResult, 'blob'>; base64: string }>;
      /** One frame saved as a picture (PNG / JPEG), as base64. */
      captureImage(
        s: number,
        options: FrameImageOptions,
      ): Promise<{ image: Omit<FrameImage, 'blob'>; base64: string }>;
      /** One exact frame (the export's compositor path) as base64 RGBA. */
      captureFrame(
        s: number,
        width: number,
        height: number,
        backend?: 'webgpu' | 'webgl2',
      ): Promise<string>;
      duration: number;
      ended: boolean;
      time: number;
    };
    /** `?golden=1`: base64 RGBA images by `fx|plain-backend-time` (composite-check reads it). */
    goldenReport?: Record<string, string>;
    /** `?bench=1`: ms per frame by backend and case. */
    benchReport?: Record<string, Record<string, number>>;
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
      // `?tier=low` imitates a budget phone's budgets (decoders, preview size, raster cache).
      const tier = (params.get('tier') ?? caps.tier) as typeof caps.tier;
      const created = await createEngine(canvas, { tier, backend });
      if (disposed) {
        created.destroy();
        return;
      }
      engine = created;
      engine.onError = (message) => {
        console.error(`[engine] ${message}`);
        setStatus(`Engine error: ${message}`);
      };
      if (params.get('bench')) {
        setStatus('Measuring draw cost…');
        created.destroy();
        engine = null;
        const report = await runBench(Number(params.get('frames') ?? 60));
        if (disposed) return;
        window.benchReport = report;
        setStatus('Bench done');
        return;
      }
      if (params.get('golden')) {
        setStatus('Rendering golden frames…');
        const report = await runGolden(engine);
        if (disposed) return;
        window.goldenReport = report;
        setGolden(`${Object.keys(report).length} images`);
        setStatus('Golden done');
        return;
      }
      const { project, blobs } = await buildDemo(
        params.get('bg') !== 'color',
        Math.max(1, Number(params.get('repeat') ?? 1)),
      );
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
        async captureFrame(
          sec: number,
          width: number,
          height: number,
          backend?: 'webgpu' | 'webgl2',
        ) {
          const bitmap = await e.capture(fromSeconds(sec), {
            width,
            height,
            backend: backend ?? 'webgl2',
          });
          return bitmapPixels(bitmap);
        },
        async exportAudio(options: AudioExportOptions) {
          const { blob, ...rest } = await e.exportAudio(options, (p) =>
            setProgress(`${Math.round(p.fraction * 100)} %`),
          );
          return { result: rest, base64: await blobBase64(blob) };
        },
        async captureImage(sec: number, options: FrameImageOptions) {
          const { blob, ...rest } = await e.captureImage(fromSeconds(sec), options);
          return { image: rest, base64: await blobBase64(blob) };
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
      setStatus(`Ready · ${engine.backend} · tier ${tier} · ${lab.duration.toFixed(1)} s`);
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
