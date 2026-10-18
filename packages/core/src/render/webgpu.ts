import { DEFAULT_TRANSFORM, NO_CROP } from '../model/project';
import {
  browserEngine,
  curvePixels,
  frameIsHdr,
  hdrCalibrationFor,
  LAYER_FLOATS,
  writeBackMapping,
  writeLayerUniforms,
} from './hdr';
import { EFFECT_FLOATS, IDENTITY_EFFECTS } from '../effects/colour';
import { backdropSize, footprintRadius, UPSCALE_BLUR_TEXELS } from './backdrop';
import type { CubeLut } from '../effects/lut';
import { layerBounds, regionDownRadius, regionPad, regionSmallSize, regionTexel } from './grab';
import { layerGeometry } from './layout';
import { externalVariant } from './shaders/external';
import { SHADERS } from './shaders/generated';
import type { FramePlacement, LayerDraw, LayerSource, Renderer, RendererOptions } from './types';

/**
 * One layer's uniforms (LAYER_FLOATS × 4 = 528 bytes), rounded up to a multiple of 256 (WebGPU's
 * minUniformBufferOffsetAlignment).
 */
const SLOT_BYTES = 768;

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
  // COPY_SRC: blend modes and blurred areas copy the pixels under a layer mid-frame.
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

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

  // Stand-ins for layers that don't read the pixels underneath or have no LUT.
  const noUnder = device.createTexture({
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const noUnderView = noUnder.createView();
  const makeLut = (size: number, data: Uint8Array<ArrayBuffer>) => {
    const texture = device.createTexture({
      size: [size, size, size],
      dimension: '3d',
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture }, data, { bytesPerRow: size * 4, rowsPerImage: size }, [
      size,
      size,
      size,
    ]);
    return { texture, view: texture.createView({ dimension: '3d' }) };
  };
  const noLut = makeLut(1, new Uint8Array([255, 255, 255, 255]));
  const luts = new Map<CubeLut, { texture: GPUTexture; view: GPUTextureView }>();
  const lutView = (lut: CubeLut | null | undefined): GPUTextureView => {
    if (!lut) return noLut.view;
    let entry = luts.get(lut);
    if (!entry) {
      entry = makeLut(lut.size, lut.data);
      luts.set(lut, entry);
    }
    return entry.view;
  };

  // Copy of the pixels under a layer (canvas format, grows in 256-px steps, never shrinks) and
  // the small target blurred areas are drawn through (grows, never shrinks).
  let grab: { texture: GPUTexture; view: GPUTextureView; w: number; h: number } | null = null;
  const ensureGrab = (w: number, h: number) => {
    if (grab && grab.w >= w && grab.h >= h) return grab;
    const gw = Math.max(grab?.w ?? 0, Math.ceil(w / 256) * 256);
    const gh = Math.max(grab?.h ?? 0, Math.ceil(h / 256) * 256);
    grab?.texture.destroy();
    const texture = device.createTexture({
      size: [gw, gh],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    grab = { texture, view: texture.createView(), w: gw, h: gh };
    return grab;
  };
  let regionTarget: { texture: GPUTexture; view: GPUTextureView; w: number; h: number } | null =
    null;
  const ensureRegionTarget = (w: number, h: number) => {
    if (regionTarget && regionTarget.w >= w && regionTarget.h >= h) return regionTarget;
    const rw = Math.max(regionTarget?.w ?? 0, w, 64);
    const rh = Math.max(regionTarget?.h ?? 0, h, 64);
    regionTarget?.texture.destroy();
    const texture = device.createTexture({
      size: [rw, rh],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    regionTarget = { texture, view: texture.createView(), w: rw, h: rh };
    return regionTarget;
  };
  // Per-frame plan (reused): each layer's first uniform slot, its copied rectangle and small size.
  let planSlot = new Int32Array(16);
  let planBounds = new Int32Array(64);
  let planSmall = new Int32Array(32);
  const ensurePlan = (n: number) => {
    if (planSlot.length >= n) return;
    const size = 2 ** Math.ceil(Math.log2(n));
    planSlot = new Int32Array(size);
    planBounds = new Int32Array(size * 4);
    planSmall = new Int32Array(size * 2);
  };
  const small = new Int32Array(2);
  const downGeometry = new Float32Array(12);
  const regionFx = new Float32Array(EFFECT_FLOATS);

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
    under: GPUTextureView = noUnderView,
    lut: GPUTextureView = noLut.view,
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
        { binding: 4, resource: under },
        { binding: 5, resource: lut },
      ],
    });
    return { pipeline, group };
  };

  /**
   * A blurred area's two slots: shrink the copy into the small target (top row first, like the
   * canvas), then draw it back inside the box by position.
   */
  const writeRegionUniforms = (
    layer: LayerDraw,
    slot: number,
    b: Int32Array,
    sw: number,
    sh: number,
  ) => {
    const region = layer.region!;
    const g = grab!;
    const target = regionTarget!;
    const w = b[2]! - b[0]!;
    const h = b[3]! - b[1]!;
    const ku = w / g.w;
    const kv = h / g.h;
    const d = downGeometry;
    d[0] = 1;
    d[1] = 0;
    d[2] = 0;
    d[3] = -1;
    d[4] = 0;
    d[5] = 0;
    d[6] = ku / 2;
    d[7] = 0;
    d[8] = 0;
    d[9] = kv / 2;
    d[10] = ku / 2;
    d[11] = kv / 2;
    const down = regionDownRadius(region.pixelate);
    fx.set(IDENTITY_EFFECTS);
    fx[24] = (down * ku) / sw;
    fx[25] = (down * kv) / sh;
    fx[93] = (w - 0.5) / g.w;
    fx[94] = (h - 0.5) / g.h;
    writeLayerUniforms(
      uniforms,
      slot * floatsPerSlot,
      d,
      1,
      false,
      calibration,
      fx,
      1 / g.w,
      1 / g.h,
      sw,
      sh,
    );
    regionFx.set(layer.effects ?? IDENTITY_EFFECTS);
    if (!region.pixelate) {
      regionFx[24] = UPSCALE_BLUR_TEXELS / target.w;
      regionFx[25] = UPSCALE_BLUR_TEXELS / target.h;
    }
    regionFx[93] = (sw - 0.5) / target.w;
    regionFx[94] = (sh - 0.5) / target.h;
    const o = (slot + 1) * floatsPerSlot;
    writeLayerUniforms(
      uniforms,
      o,
      layer.geometry,
      layer.opacity,
      false,
      calibration,
      regionFx,
      1 / target.w,
      1 / target.h,
      canvas.width,
      canvas.height,
    );
    writeBackMapping(uniforms, o, b[0]!, b[1]!, sw / w / target.w, sh / h / target.h);
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
      // Plan: uniform slots (a blurred area takes two: shrink, then draw back), rectangles to copy.
      ensurePlan(layers.length);
      let used = extra;
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]!;
        planSlot[i] = -1;
        const b = planBounds.subarray(i * 4, i * 4 + 4);
        if (layer.region) {
          const texel = regionTexel(layer.region.amount, layer.region.pixelate, canvas.height);
          const pad = regionPad(texel, layer.region.pixelate);
          if (!layerBounds(layer.geometry, canvas.width, canvas.height, pad, b)) continue;
          const w = b[2]! - b[0]!;
          const h = b[3]! - b[1]!;
          regionSmallSize(w, h, texel, small);
          planSmall[i * 2] = small[0]!;
          planSmall[i * 2 + 1] = small[1]!;
          ensureGrab(w, h);
          ensureRegionTarget(small[0]!, small[1]!);
          planSlot[i] = used;
          used += 2;
        } else {
          if (layer.blend) {
            if (!layerBounds(layer.geometry, canvas.width, canvas.height, 1, b)) continue;
            ensureGrab(b[2]! - b[0]!, b[3]! - b[1]!);
          }
          planSlot[i] = used;
          used += 1;
        }
      }
      ensureSlots(used);
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
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]!;
        const slot = planSlot[i]!;
        if (slot < 0) continue;
        const b = planBounds.subarray(i * 4, i * 4 + 4);
        if (layer.region) {
          writeRegionUniforms(layer, slot, b, planSmall[i * 2]!, planSmall[i * 2 + 1]!);
          continue;
        }
        const hdr =
          correct &&
          layer.source instanceof VideoFrame &&
          frameIsHdr(layer.source.colorSpace, layer.hdr);
        writeLayerUniforms(
          uniforms,
          slot * floatsPerSlot,
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
        // The copy underneath is top row first, like the canvas: texel = pixel − origin.
        if (layer.blend) writeBackMapping(uniforms, slot * floatsPerSlot, b[0]!, b[1]!, 1, 1);
      }
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
      const canvasTexture = context.getCurrentTexture();
      const canvasView = canvasTexture.createView();
      let pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: canvasView,
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
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]!;
        const slot = planSlot[i]!;
        if (slot < 0) continue;
        if (layer.region || layer.blend) {
          // Copy what's under the layer: end the pass, copy, carry on drawing over the canvas.
          pass.end();
          const b = planBounds.subarray(i * 4, i * 4 + 4);
          encoder.copyTextureToTexture(
            { texture: canvasTexture, origin: [b[0]!, b[1]!] },
            { texture: grab!.texture },
            [b[2]! - b[0]!, b[3]! - b[1]!],
          );
          if (layer.region) {
            const shrink = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: regionTarget!.view,
                  clearValue: { r: 0, g: 0, b: 0, a: 1 },
                  loadOp: 'clear',
                  storeOp: 'store',
                },
              ],
            });
            shrink.setViewport(0, 0, planSmall[i * 2]!, planSmall[i * 2 + 1]!, 0, 1);
            const { pipeline, group } = bindGroupFor(slot, grab!.view, true);
            shrink.setPipeline(pipeline);
            shrink.setBindGroup(0, group);
            shrink.draw(4);
            shrink.end();
          }
          pass = encoder.beginRenderPass({
            colorAttachments: [{ view: canvasView, loadOp: 'load', storeOp: 'store' }],
          });
        }
        const { pipeline, group } = layer.region
          ? bindGroupFor(slot + 1, regionTarget!.view, false)
          : bindGroupFor(
              slot,
              layer.source,
              false,
              layer.blend ? grab!.view : noUnderView,
              lutView(layer.lut),
            );
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(4);
      }
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
      grab?.texture.destroy();
      regionTarget?.texture.destroy();
      for (const entry of luts.values()) entry.texture.destroy();
      luts.clear();
      noLut.texture.destroy();
      noUnder.destroy();
      curve.destroy();
      context.unconfigure();
      device.destroy();
    },
  };
  return renderer;
}
