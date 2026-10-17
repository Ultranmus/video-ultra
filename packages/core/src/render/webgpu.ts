import {
  browserEngine,
  curvePixels,
  hdrCalibrationFor,
  needsHdrCorrection,
  UNIFORM_FLOATS,
  writeHdrUniforms,
} from './hdr';
import { SHADERS } from './shaders/generated';
import { placementMatrix, type FramePlacement, type Renderer } from './types';

/**
 * WebGPU renderer. Frames are imported with `importExternalTexture`, which hands the decoded
 * frame to the GPU without a copy (the main reason WebGPU is our first choice). HDR frames get the
 * measured correction for this browser (render/hdr.ts).
 */
export async function createWebGPURenderer(canvas: OffscreenCanvas): Promise<Renderer> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) throw new Error('WebGPU is not available');
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Could not create a WebGPU canvas context');
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const module = device.createShaderModule({ code: SHADERS.composite.wgsl });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-strip' },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const uniforms = new Float32Array(UNIFORM_FLOATS);
  const uniformBuffer = device.createBuffer({
    size: uniforms.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

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
  const layout = pipeline.getBindGroupLayout(0);
  let destroyed = false;

  return {
    backend: 'webgpu',
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    draw(frame: VideoFrame, placement: FramePlacement) {
      if (destroyed) return;
      placementMatrix(placement, canvas.width, canvas.height, uniforms);
      writeHdrUniforms(uniforms, calibration, needsHdrCorrection(frame.colorSpace));
      device.queue.writeBuffer(uniformBuffer, 0, uniforms);
      // External textures expire at the end of the task, so the bind group is per frame.
      const external = device.importExternalTexture({ source: frame });
      const bindGroup = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: external },
          { binding: 3, resource: curveView },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(4);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    destroy() {
      destroyed = true;
      uniformBuffer.destroy();
      curve.destroy();
      context.unconfigure();
      device.destroy();
    },
  };
}
