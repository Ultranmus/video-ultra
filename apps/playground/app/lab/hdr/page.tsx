'use client';

/**
 * HDR probe: decodes one frame of an HDR video and renders the WHOLE frame (scaled to 640 px)
 * through each GPU import path, returning PNGs so they can be compared with a reference rendering
 * (Apple's own HDR → SDR conversion). Decides how we tone-map HDR.
 * Usage: /lab/hdr?file=private/iphone-1080p2997-hdr-landscape-mono.mov&t=3
 */
import {
  createWebGL2Renderer,
  createWebGPURenderer,
  type Renderer,
} from '@video-ultra/core/internal';
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { useEffect, useState } from 'react';

const OUT_W = 640;

const QUAD = `
  struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f };
  @vertex fn vs(@builtin(vertex_index) i: u32) -> O {
    var q = array<vec2f,4>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1));
    var o: O; o.p = vec4f(q[i], 0, 1); o.uv = vec2f(q[i].x * 0.5 + 0.5, 0.5 - q[i].y * 0.5); return o;
  }`;

async function toPng(rgba: Uint8ClampedArray, w: number, h: number): Promise<string> {
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Renders `bind` (texture + sampler at bindings 0/1) through `fs` into an RGBA8 image. */
async function renderToPixels(
  device: GPUDevice,
  fragment: string,
  entries: (layout: GPUBindGroupLayout) => GPUBindGroup,
  w: number,
  h: number,
): Promise<Uint8ClampedArray> {
  const module = device.createShaderModule({ code: QUAD + fragment });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-strip' },
  });
  const target = device.createTexture({
    size: [w, h],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * h,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({
    colorAttachments: [
      { view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, entries(pipeline.getBindGroupLayout(0)));
  pass.draw(4);
  pass.end();
  enc.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [w, h]);
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const out = new Uint8ClampedArray(w * h * 4);
  const raw = new Uint8Array(buffer.getMappedRange());
  for (let y = 0; y < h; y++)
    out.set(raw.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
  buffer.unmap();
  return out;
}

async function webgpuPaths(
  frame: VideoFrame,
  w: number,
  h: number,
): Promise<Record<string, string>> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) return {};
  const device = await adapter.requestDevice();
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const out: Record<string, string> = {};

  const external = device.importExternalTexture({ source: frame });
  out['webgpu-external'] = await toPng(
    await renderToPixels(
      device,
      `@group(0) @binding(0) var s: sampler; @group(0) @binding(1) var t: texture_external;
       @fragment fn fs(i: O) -> @location(0) vec4f { return textureSampleBaseClampToEdge(t, s, i.uv); }`,
      (layout) =>
        device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: external },
          ],
        }),
      w,
      h,
    ),
    w,
    h,
  );

  const copied = device.createTexture({
    size: [frame.displayWidth, frame.displayHeight],
    format: 'rgba16float',
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source: frame },
    { texture: copied, colorSpace: 'srgb' },
    [frame.displayWidth, frame.displayHeight],
  );
  out['webgpu-copyExternal'] = await toPng(
    await renderToPixels(
      device,
      `@group(0) @binding(0) var s: sampler; @group(0) @binding(1) var t: texture_2d<f32>;
       @fragment fn fs(i: O) -> @location(0) vec4f { return textureSample(t, s, i.uv); }`,
      (layout) =>
        device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: copied.createView() },
          ],
        }),
      w,
      h,
    ),
    w,
    h,
  );
  device.destroy();
  return out;
}

async function webgl2Path(
  frame: VideoFrame,
  w: number,
  h: number,
): Promise<Record<string, string>> {
  const canvas = new OffscreenCanvas(w, h);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (!gl) return {};
  const program = gl.createProgram();
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(
    vs,
    `#version 300 es
    out vec2 uv; const vec2 Q[4] = vec2[4](vec2(-1,-1), vec2(1,-1), vec2(-1,1), vec2(1,1));
    void main() { vec2 q = Q[gl_VertexID]; gl_Position = vec4(q, 0, 1); uv = vec2(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5); }`,
  );
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(
    fs,
    `#version 300 es
    precision highp float; uniform sampler2D t; in vec2 uv; out vec4 c; void main() { c = texture(t, uv); }`,
  );
  gl.compileShader(fs);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    frame.displayWidth,
    frame.displayHeight,
    0,
    gl.RGBA,
    gl.HALF_FLOAT,
    frame,
  );
  gl.viewport(0, 0, w, h);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // readPixels is bottom-up; flip to top-down.
  const flipped = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    flipped.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  return { webgl2: await toPng(flipped, w, h) };
}

/** The browser's WebGL2 conversion inside a worker — where the engine actually runs. */
async function webgl2WorkerPath(
  frame: VideoFrame,
  w: number,
  h: number,
): Promise<Record<string, string>> {
  const worker = new Worker(new URL('./webgl2-worker.ts', import.meta.url), { type: 'module' });
  try {
    const clone = frame.clone();
    const pixels = await new Promise<Uint8ClampedArray>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<Uint8ClampedArray>) => resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ frame: clone, w, h }, [clone]);
    });
    return { 'webgl2-worker': await toPng(pixels, w, h) };
  } finally {
    worker.terminate();
  }
}

/** Our own renderers (with the HDR correction), read back as PNG. */
async function ourPaths(frame: VideoFrame, w: number, h: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const placement = {
    rotation: 0 as const,
    flip: false,
    width: frame.displayWidth,
    height: frame.displayHeight,
  };
  for (const [name, make] of [
    ['ours-webgpu', (c: OffscreenCanvas) => createWebGPURenderer(c)],
    ['ours-webgl2', (c: OffscreenCanvas) => Promise.resolve(createWebGL2Renderer(c))],
  ] as const) {
    let renderer: Renderer | null = null;
    try {
      const canvas = new OffscreenCanvas(w, h);
      renderer = await make(canvas);
      renderer.draw(frame, placement);
      // Second draw of the same frame: WebGL2 now updates the texture in place (texSubImage2D),
      // like every frame after the first one during playback/export.
      if (new URLSearchParams(location.search).has('twice')) renderer.draw(frame, placement);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out[name] = btoa(binary);
    } catch (e) {
      out[`${name}-error`] = btoa(String(e));
    } finally {
      renderer?.destroy();
    }
  }
  return out;
}

export default function HdrProbe() {
  const [report, setReport] = useState('Probing…');
  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(location.search);
      const file = params.get('file') ?? 'private/iphone-1080p2997-hdr-landscape-mono.mov';
      const t = Number(params.get('t') ?? 3);
      // ?raw=<path>&w=&h= builds a synthetic HLG frame from raw I420P10 data instead of decoding
      // (does the browser convert synthetic frames like hardware-decoded ones?).
      const raw = params.get('raw');
      let sample: { close(): void } | null = null;
      let frame: VideoFrame;
      if (raw) {
        const data = await (await fetch(`/media/${raw}`)).arrayBuffer();
        frame = new VideoFrame(data, {
          // Supported by browsers but missing from the DOM lib's VideoPixelFormat.
          format: 'I420P10' as VideoPixelFormat,
          codedWidth: Number(params.get('w') ?? 1920),
          codedHeight: Number(params.get('h') ?? 1080),
          timestamp: 0,
          colorSpace: {
            primaries: 'bt2020',
            transfer: 'hlg',
            matrix: 'bt2020-ncl',
            fullRange: false,
          } as unknown as VideoColorSpaceInit, // 'hlg' is missing from the DOM lib's transfer list
        });
      } else {
        const blob = await (await fetch(`/media/${file}`)).blob();
        const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('no video');
        const decoded = await new VideoSampleSink(track).getSample(t);
        if (!decoded) throw new Error('no frame');
        sample = decoded;
        frame = decoded.toVideoFrame();
      }
      const w = OUT_W;
      const h = Math.round((OUT_W * frame.displayHeight) / frame.displayWidth);
      const images = {
        ...(await webgpuPaths(frame, w, h).catch(() => ({}))),
        ...(await webgl2Path(frame, w, h)),
        ...(await webgl2WorkerPath(frame, w, h).catch(() => ({}))),
        ...(await ourPaths(frame, w, h)),
      };
      const result = { file, t, size: [w, h], colorSpace: frame.colorSpace.toJSON(), images };
      frame.close();
      sample?.close();
      setReport(JSON.stringify(result));
    })().catch((e: unknown) => setReport(`FAILED: ${String(e)}`));
  }, []);
  return (
    <main className="page">
      <h1>HDR probe</h1>
      <pre id="report" style={{ maxHeight: 200, overflow: 'auto' }}>
        {report}
      </pre>
    </main>
  );
}
