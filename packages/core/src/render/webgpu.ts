import { placementMatrix, type FramePlacement, type Renderer } from './types';

const SHADER = /* wgsl */ `
struct Uniforms { m: vec4f };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_external;

struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var quad = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  let q = quad[i];
  var out: VsOut;
  out.pos = vec4f(u.m.x * q.x + u.m.y * q.y, u.m.z * q.x + u.m.w * q.y, 0.0, 1.0);
  out.uv = q * 0.5 + 0.5;
  return out;
}

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(tex, samp, in.uv);
}
`;

/**
 * WebGPU renderer. Frames are imported with `importExternalTexture`, which hands the decoded
 * frame to the GPU without a copy (the main reason WebGPU is our first choice).
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

  const module = device.createShaderModule({ code: SHADER });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-strip' },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const uniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const matrix = new Float32Array(4);
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
      placementMatrix(placement, canvas.width, canvas.height, matrix);
      device.queue.writeBuffer(uniformBuffer, 0, matrix);
      // External textures expire at the end of the task, so the bind group is per frame.
      const external = device.importExternalTexture({ source: frame });
      const bindGroup = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: external },
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
      context.unconfigure();
      device.destroy();
    },
  };
}
