import { DEFAULT_TRANSFORM, NO_CROP } from '../model/project';
import {
  browserEngine,
  curvePixels,
  frameIsHdr,
  hdrCalibrationFor,
  LAYER_FLOATS,
  writeLayerUniforms,
} from './hdr';
import { layerGeometry } from './layout';
import { SHADERS } from './shaders/generated';
import type { FramePlacement, LayerDraw, Renderer, RendererOptions } from './types';

/** Uniform slots are 256-byte aligned (WebGPU's minUniformBufferOffsetAlignment). */
const SLOT_BYTES = 256;

/**
 * WebGPU compositor. Video frames are imported with `importExternalTexture` — handed to the GPU
 * without a copy (the main reason WebGPU is our first choice). Images upload once and are cached
 * until `release()`. One render pass per frame, one draw per layer, alpha blending.
 */
export async function createWebGPURenderer(
  canvas: OffscreenCanvas,
  options: RendererOptions = {},
): Promise<Renderer> {
  const correct = options.hdrCorrection ?? true;
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) throw new Error('WebGPU is not available');
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Could not create a WebGPU canvas context');
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const blend: GPUBlendState = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  };
  const makePipeline = (code: string) => {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-strip' },
    });
  };
  const videoPipeline = makePipeline(SHADERS.composite.wgsl);
  const imagePipeline = makePipeline(SHADERS.composite.wgsl2d);
  const videoLayout = videoPipeline.getBindGroupLayout(0);
  const imageLayout = imagePipeline.getBindGroupLayout(0);
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const { calibration } = hdrCalibrationFor(browserEngine(), 'webgpu');
  const curve = device.createTexture({
    size: [256, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: curve },
    curvePixels(calibration),
    { bytesPerRow: 256 * 4 },
    [256, 1],
  );
  const curveView = curve.createView();

  // Uniform slots, grown on demand. The CPU-side mirror is reused every frame (no per-frame allocation).
  let slots = 0;
  let uniformBuffer: GPUBuffer | null = null;
  let uniforms = new Float32Array(0);
  const ensureSlots = (count: number) => {
    if (count <= slots) return;
    slots = Math.max(8, 2 ** Math.ceil(Math.log2(count)));
    uniformBuffer?.destroy();
    uniformBuffer = device.createBuffer({
      size: slots * SLOT_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    uniforms = new Float32Array((slots * SLOT_BYTES) / 4);
  };

  // Images (photos, stickers, text canvases) upload once.
  const images = new Map<
    ImageBitmap | OffscreenCanvas,
    { texture: GPUTexture; view: GPUTextureView }
  >();
  const imageView = (source: ImageBitmap | OffscreenCanvas) => {
    let entry = images.get(source);
    if (!entry) {
      const texture = device.createTexture({
        size: [source.width, source.height],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      device.queue.copyExternalImageToTexture({ source }, { texture }, [
        source.width,
        source.height,
      ]);
      entry = { texture, view: texture.createView() };
      images.set(source, entry);
    }
    return entry.view;
  };

  let destroyed = false;
  const single: LayerDraw = {
    source: null as unknown as VideoFrame,
    geometry: new Float32Array(12),
    opacity: 1,
    hdr: false,
  };
  const singleList = [single];

  const renderer: Renderer = {
    backend: 'webgpu',
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    render(layers, background = [0, 0, 0]) {
      if (destroyed) return;
      ensureSlots(layers.length);
      const floatsPerSlot = SLOT_BYTES / 4;
      layers.forEach((layer, i) => {
        const hdr =
          correct &&
          layer.source instanceof VideoFrame &&
          (layer.hdr || frameIsHdr(layer.source.colorSpace));
        writeLayerUniforms(
          uniforms,
          i * floatsPerSlot,
          layer.geometry,
          layer.opacity,
          hdr,
          calibration,
        );
      });
      if (layers.length > 0) {
        device.queue.writeBuffer(uniformBuffer!, 0, uniforms, 0, layers.length * floatsPerSlot);
      }

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: background[0], g: background[1], b: background[2], a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      layers.forEach((layer, i) => {
        const isVideo = layer.source instanceof VideoFrame;
        const resource: GPUBindingResource = isVideo
          ? device.importExternalTexture({ source: layer.source as VideoFrame })
          : imageView(layer.source as ImageBitmap | OffscreenCanvas);
        // External textures expire at the end of the task, so video bind groups are per frame.
        const bindGroup = device.createBindGroup({
          layout: isVideo ? videoLayout : imageLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: uniformBuffer!, offset: i * SLOT_BYTES, size: LAYER_FLOATS * 4 },
            },
            { binding: 1, resource: sampler },
            { binding: 2, resource },
            { binding: 3, resource: curveView },
          ],
        });
        pass.setPipeline(isVideo ? videoPipeline : imagePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(4);
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    draw(frame: VideoFrame, placement: FramePlacement) {
      layerGeometry(
        canvas.width,
        canvas.height,
        {
          width: placement.width,
          height: placement.height,
          rotation: placement.rotation,
          flip: placement.flip,
        },
        { transform: DEFAULT_TRANSFORM, crop: NO_CROP, fit: 'fit' },
        single.geometry,
      );
      single.source = frame;
      single.hdr = placement.hdr ?? false;
      renderer.render(singleList);
    },
    release(source) {
      const entry = images.get(source);
      if (!entry) return;
      entry.texture.destroy();
      images.delete(source);
    },
    destroy() {
      destroyed = true;
      for (const entry of images.values()) entry.texture.destroy();
      images.clear();
      uniformBuffer?.destroy();
      curve.destroy();
      context.unconfigure();
      device.destroy();
    },
  };
  return renderer;
}
