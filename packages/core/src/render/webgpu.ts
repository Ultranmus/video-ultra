import { DEFAULT_TRANSFORM, NO_CROP } from '../model/project';
import {
  browserEngine,
  curvePixels,
  frameIsHdr,
  hdrCalibrationFor,
  LAYER_FLOATS,
  writeLayerUniforms,
} from './hdr';
import { EFFECT_FLOATS, IDENTITY_EFFECTS } from '../effects/colour';
import { backdropSize, footprintRadius, UPSCALE_BLUR_TEXELS } from './backdrop';
import { layerGeometry } from './layout';
import { externalVariant } from './shaders/external';
import { SHADERS } from './shaders/generated';
import type { FramePlacement, LayerDraw, LayerSource, Renderer, RendererOptions } from './types';

/**
 * One layer's uniforms (LAYER_FLOATS × 4 = 416 bytes), rounded up to a multiple of 256 (WebGPU's
 * minUniformBufferOffsetAlignment).
 */
const SLOT_BYTES = 512;

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
  const videoModule = device.createShaderModule({
    code: externalVariant(SHADERS.composite.wgsl2d),
  });
  const imageModule = device.createShaderModule({ code: SHADERS.composite.wgsl2d });
  const makePipeline = (module: GPUShaderModule, target: GPUTextureFormat) =>
    device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: target, blend }] },
      primitive: { topology: 'triangle-strip' },
    });
  const videoPipeline = makePipeline(videoModule, format);
  const imagePipeline = makePipeline(imageModule, format);
  const videoLayout = videoPipeline.getBindGroupLayout(0);
  const imageLayout = imagePipeline.getBindGroupLayout(0);
  // The blurred background's small render target is rgba8unorm; its pipelines are made on first use.
  let smallPipelines: {
    video: GPURenderPipeline;
    image: GPURenderPipeline;
    videoLayout: GPUBindGroupLayout;
    imageLayout: GPUBindGroupLayout;
  } | null = null;
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

  // Frames imported during the current render (the background and a layer can share one).
  const importedFrames: (VideoFrame | null)[] = [];
  const importedTextures: (GPUExternalTexture | null)[] = [];
  let importedCount = 0;
  const external = (frame: VideoFrame): GPUExternalTexture => {
    for (let i = 0; i < importedCount; i++)
      if (importedFrames[i] === frame) return importedTextures[i]!;
    const texture = device.importExternalTexture({ source: frame });
    importedFrames[importedCount] = frame;
    importedTextures[importedCount++] = texture;
    return texture;
  };

  let backdropTarget: { texture: GPUTexture; view: GPUTextureView; w: number; h: number } | null =
    null;
  const fx = new Float32Array(EFFECT_FLOATS);
  const radius: [number, number] = [0, 0];
  // Full-canvas quad showing the render target (WebGPU targets store the top row first).
  const fullscreen = new Float32Array([1, 0, 0, -1, 0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5]);
  const floatsPerSlot = SLOT_BYTES / 4;

  const texelOf = (source: LayerSource, axis: 0 | 1) =>
    source instanceof VideoFrame
      ? 1 / (axis === 0 ? source.displayWidth : source.displayHeight)
      : 1 / (axis === 0 ? source.width : source.height);

  const bindGroupFor = (
    slot: number,
    source: LayerSource | GPUTextureView,
    small: boolean,
  ): { pipeline: GPURenderPipeline; group: GPUBindGroup } => {
    const isVideo = source instanceof VideoFrame;
    const resource: GPUBindingResource = isVideo
      ? external(source)
      : source instanceof GPUTextureView
        ? source
        : imageView(source);
    let pipeline: GPURenderPipeline;
    let layout: GPUBindGroupLayout;
    if (small) {
      if (!smallPipelines) {
        const video = makePipeline(videoModule, 'rgba8unorm');
        const image = makePipeline(imageModule, 'rgba8unorm');
        smallPipelines = {
          video,
          image,
          videoLayout: video.getBindGroupLayout(0),
          imageLayout: image.getBindGroupLayout(0),
        };
      }
      pipeline = isVideo ? smallPipelines.video : smallPipelines.image;
      layout = isVideo ? smallPipelines.videoLayout : smallPipelines.imageLayout;
    } else {
      pipeline = isVideo ? videoPipeline : imagePipeline;
      layout = isVideo ? videoLayout : imageLayout;
    }
    // External textures expire at the end of the task, so video bind groups are per frame.
    const group = device.createBindGroup({
      layout,
      entries: [
        {
          binding: 0,
          resource: { buffer: uniformBuffer!, offset: slot * SLOT_BYTES, size: LAYER_FLOATS * 4 },
        },
        { binding: 1, resource: sampler },
        { binding: 2, resource },
        { binding: 3, resource: curveView },
      ],
    });
    return { pipeline, group };
  };

  const renderer: Renderer = {
    backend: 'webgpu',
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    render(layers, background = [0, 0, 0], backdrop = null) {
      if (destroyed) return;
      const extra = backdrop ? 2 : 0;
      ensureSlots(layers.length + extra);
      importedCount = 0;
      let target = backdropTarget;
      if (backdrop) {
        const size = backdropSize(canvas.width, canvas.height, backdrop.amount);
        if (!target || target.w !== size.width || target.h !== size.height) {
          target?.texture.destroy();
          const texture = device.createTexture({
            size: [size.width, size.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
          });
          target = backdropTarget = {
            texture,
            view: texture.createView(),
            w: size.width,
            h: size.height,
          };
        }
        // Slot 0: the picture drawn small with a texel-sized blur. Slot 1: scaled up, soft blur.
        const hdr =
          correct &&
          backdrop.source instanceof VideoFrame &&
          frameIsHdr(backdrop.source.colorSpace, backdrop.hdr);
        fx.set(backdrop.effects ?? IDENTITY_EFFECTS);
        footprintRadius(backdrop.geometry, target.w, target.h, radius);
        fx[24] = radius[0] * 0.75;
        fx[25] = radius[1] * 0.75;
        fx[11] = 0;
        fx[28] = 0;
        writeLayerUniforms(
          uniforms,
          0,
          backdrop.geometry,
          1,
          hdr,
          calibration,
          fx,
          0,
          0,
          target.w,
          target.h,
        );
        fx.set(IDENTITY_EFFECTS);
        fx[24] = UPSCALE_BLUR_TEXELS / target.w;
        fx[25] = UPSCALE_BLUR_TEXELS / target.h;
        writeLayerUniforms(
          uniforms,
          floatsPerSlot,
          fullscreen,
          1,
          false,
          calibration,
          fx,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      }
      layers.forEach((layer, i) => {
        const hdr =
          correct &&
          layer.source instanceof VideoFrame &&
          frameIsHdr(layer.source.colorSpace, layer.hdr);
        writeLayerUniforms(
          uniforms,
          (i + extra) * floatsPerSlot,
          layer.geometry,
          layer.opacity,
          hdr,
          calibration,
          layer.effects ?? null,
          texelOf(layer.source, 0),
          texelOf(layer.source, 1),
          canvas.width,
          canvas.height,
        );
      });
      const used = layers.length + extra;
      if (used > 0) device.queue.writeBuffer(uniformBuffer!, 0, uniforms, 0, used * floatsPerSlot);

      const encoder = device.createCommandEncoder();
      if (backdrop && target) {
        const small = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: target.view,
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
        const { pipeline, group } = bindGroupFor(0, backdrop.source, true);
        small.setPipeline(pipeline);
        small.setBindGroup(0, group);
        small.draw(4);
        small.end();
      }
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
      if (backdrop && target) {
        const { pipeline, group } = bindGroupFor(1, target.view, false);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(4);
      }
      layers.forEach((layer, i) => {
        const { pipeline, group } = bindGroupFor(i + extra, layer.source, false);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(4);
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
      for (let i = 0; i < importedCount; i++) {
        importedFrames[i] = null;
        importedTextures[i] = null;
      }
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
      backdropTarget?.texture.destroy();
      curve.destroy();
      context.unconfigure();
      device.destroy();
    },
  };
  return renderer;
}
