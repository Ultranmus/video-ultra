'use client';

/**
 * Golden composite scene, rendered through both GPU backends: background, a letterboxed video,
 * a rotated semi-transparent picture-in-picture and a transparent PNG. scripts/composite-check.ts
 * compares the two backends and checks known pixels.
 */
import {
  createWebGL2Renderer,
  createWebGPURenderer,
  DEFAULT_TRANSFORM,
  layerGeometry,
  NO_CROP,
  type LayerDraw,
  type Renderer,
} from '@video-ultra/core/internal';
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { useEffect, useState } from 'react';

const SIZE = 640;

async function scene(
  make: (c: OffscreenCanvas) => Promise<Renderer>,
  frame: VideoFrame,
  logo: ImageBitmap,
) {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const renderer = await make(canvas);
  const video = {
    width: frame.displayWidth,
    height: frame.displayHeight,
    rotation: 0 as const,
    flip: false,
  };
  const image = { width: logo.width, height: logo.height, rotation: 0 as const, flip: false };
  const look = (t: Partial<typeof DEFAULT_TRANSFORM>) => ({
    transform: { ...DEFAULT_TRANSFORM, ...t },
    crop: NO_CROP,
    fit: 'fit' as const,
  });
  const layers: LayerDraw[] = [
    { source: frame, geometry: layerGeometry(SIZE, SIZE, video, look({})), opacity: 1, hdr: false },
    {
      source: frame,
      geometry: layerGeometry(
        SIZE,
        SIZE,
        video,
        look({ x: 0.72, y: 0.3, scale: 0.4, rotation: 15 }),
      ),
      opacity: 0.5,
      hdr: false,
    },
    {
      source: logo,
      geometry: layerGeometry(SIZE, SIZE, image, look({ x: 0.25, y: 0.62, scale: 0.3 })),
      opacity: 1,
      hdr: false,
    },
  ];
  renderer.render(layers, [0.1, 0.1, 0.3]);
  const bitmap = canvas.transferToImageBitmap();
  const out = new OffscreenCanvas(SIZE, SIZE).getContext('2d')!;
  out.drawImage(bitmap, 0, 0);
  bitmap.close();
  renderer.release(logo);
  renderer.destroy();
  const bytes = new Uint8Array(out.getImageData(0, 0, SIZE, SIZE).data.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export default function CompositeLab() {
  const [report, setReport] = useState('Rendering…');
  useEffect(() => {
    (async () => {
      const blob = await (await fetch('/media/avc-720p30.mp4')).blob();
      const track = await new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(blob),
      }).getPrimaryVideoTrack();
      const sample = await new VideoSampleSink(track!).getSample(2);
      const frame = sample!.toVideoFrame();
      // Straight (non-premultiplied) alpha — the renderer contract (render/types.ts).
      const logo = await createImageBitmap(await (await fetch('/media/logo.png')).blob(), {
        premultiplyAlpha: 'none',
      });
      const images: Record<string, string> = {};
      for (const [name, make] of [
        ['webgpu', (c: OffscreenCanvas) => createWebGPURenderer(c)],
        ['webgl2', (c: OffscreenCanvas) => Promise.resolve(createWebGL2Renderer(c))],
      ] as const) {
        try {
          images[name] = await scene(make, frame, logo);
        } catch (e) {
          images[`${name}-error`] = String(e);
        }
      }
      frame.close();
      sample!.close();
      logo.close();
      setReport(JSON.stringify(images));
    })().catch((e: unknown) => setReport(`FAILED: ${String(e)}`));
  }, []);
  return (
    <main className="page">
      <h1>Composite lab</h1>
      <pre id="report" style={{ maxHeight: 120, overflow: 'auto' }}>
        {report}
      </pre>
    </main>
  );
}
