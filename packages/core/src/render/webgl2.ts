import {
  browserEngine,
  curvePixels,
  hdrCalibrationFor,
  frameIsHdr,
  UNIFORM_FLOATS,
  writeHdrUniforms,
} from './hdr';
import { SHADERS } from './shaders/generated';
import { placementMatrix, type FramePlacement, type Renderer, type RendererOptions } from './types';

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create a WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`WebGL shader error: ${gl.getShaderInfoLog(shader) ?? 'unknown'}`);
  }
  return shader;
}

/**
 * WebGL2 renderer, running GLSL generated from the same WGSL as the WebGPU one (naga). Uploads each
 * frame into one reused texture (`texSubImage2D` once the size is known), so it allocates nothing
 * per frame. HDR frames get the measured correction for this browser (render/hdr.ts).
 */
export function createWebGL2Renderer(
  canvas: OffscreenCanvas,
  options: RendererOptions = {},
): Renderer {
  const correct = options.hdrCorrection ?? true;
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available');

  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, SHADERS.composite.glslVertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, SHADERS.composite.glslFragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`WebGL link error: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
  }
  gl.useProgram(program);

  // naga emits one uniform block per stage for the same WGSL struct; both read binding point 0.
  const uniforms = new Float32Array(UNIFORM_FLOATS);
  const ubo = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
  gl.bufferData(gl.UNIFORM_BUFFER, uniforms.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
  for (const block of ['Uniforms_block_0Vertex', 'Uniforms_block_0Fragment']) {
    const index = gl.getUniformBlockIndex(program, block);
    if (index !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, index, 0);
  }
  // Generated sampler names: _group_<g>_binding_<b>_fs. Frame → unit 0, curve → unit 1.
  gl.uniform1i(gl.getUniformLocation(program, '_group_0_binding_2_fs'), 0);
  gl.uniform1i(gl.getUniformLocation(program, '_group_0_binding_3_fs'), 1);

  // gl_VertexID needs a bound (empty) vertex array on some drivers.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const { calibration } = hdrCalibrationFor(browserEngine(), 'webgl2');
  const curve = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, curve);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    256,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    curvePixels(calibration),
  );

  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let texW = 0;
  let texH = 0;

  return {
    backend: 'webgl2',
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    draw(frame: VideoFrame, placement: FramePlacement) {
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      const hdr = frameIsHdr(frame.colorSpace, placement.hdr);
      gl.activeTexture(gl.TEXTURE0);
      // Chrome converts HDR frames differently in texSubImage2D than in texImage2D (brighter, part
      // of its HDR → SDR step skipped); WebKit doesn't. The calibration matches texImage2D, so HDR
      // frames always re-specify the texture. SDR frames update in place (no allocation).
      if (hdr || w !== texW || h !== texH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        texW = w;
        texH = h;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      }
      placementMatrix(placement, canvas.width, canvas.height, uniforms);
      writeHdrUniforms(uniforms, calibration, correct && hdr);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy() {
      gl.deleteTexture(texture);
      gl.deleteTexture(curve);
      gl.deleteBuffer(ubo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
