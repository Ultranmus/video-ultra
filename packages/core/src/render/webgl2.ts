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

function newTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/**
 * WebGL2 compositor, running GLSL generated from the same WGSL as the WebGPU one (naga). Video
 * layers upload into per-slot textures reused frame to frame; images upload once and are cached
 * until `release()`. Alpha blending, one draw per layer.
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
  const uniforms = new Float32Array(LAYER_FLOATS);
  const ubo = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
  gl.bufferData(gl.UNIFORM_BUFFER, uniforms.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
  for (const block of ['Uniforms_block_0Vertex', 'Uniforms_block_0Fragment']) {
    const index = gl.getUniformBlockIndex(program, block);
    if (index !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, index, 0);
  }
  // Generated sampler names: _group_<g>_binding_<b>_fs. Layer → unit 0, HDR curve → unit 1.
  gl.uniform1i(gl.getUniformLocation(program, '_group_0_binding_2_fs'), 0);
  gl.uniform1i(gl.getUniformLocation(program, '_group_0_binding_3_fs'), 1);

  // gl_VertexID needs a bound (empty) vertex array on some drivers.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const { calibration } = hdrCalibrationFor(browserEngine(), 'webgl2');
  gl.activeTexture(gl.TEXTURE1);
  const curve = newTexture(gl);
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

  // Video layers: one texture per layer slot, re-specified only when the size changes.
  const videoSlots: { texture: WebGLTexture; w: number; h: number }[] = [];
  // Images: uploaded once.
  const images = new Map<ImageBitmap | OffscreenCanvas, WebGLTexture>();

  const single: LayerDraw = {
    source: null as unknown as VideoFrame,
    geometry: new Float32Array(12),
    opacity: 1,
    hdr: false,
  };
  const singleList = [single];

  const renderer: Renderer = {
    backend: 'webgl2',
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    render(layers, background = [0, 0, 0]) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(background[0], background[1], background[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      let videoIndex = 0;
      for (const layer of layers) {
        const source = layer.source;
        let hdr = false;
        if (source instanceof VideoFrame) {
          hdr = frameIsHdr(source.colorSpace, layer.hdr);
          const slot = (videoSlots[videoIndex] ??= { texture: newTexture(gl), w: 0, h: 0 });
          videoIndex++;
          gl.bindTexture(gl.TEXTURE_2D, slot.texture);
          const w = source.displayWidth;
          const h = source.displayHeight;
          // Chrome converts HDR frames differently in texSubImage2D than in texImage2D (brighter,
          // part of its HDR → SDR step skipped); WebKit doesn't. The calibration matches
          // texImage2D, so HDR frames always re-specify the texture (DECISIONS #36).
          if (hdr || w !== slot.w || h !== slot.h) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            slot.w = w;
            slot.h = h;
          } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
          }
        } else {
          let texture = images.get(source);
          if (!texture) {
            texture = newTexture(gl);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            images.set(source, texture);
          } else {
            gl.bindTexture(gl.TEXTURE_2D, texture);
          }
        }
        writeLayerUniforms(uniforms, 0, layer.geometry, layer.opacity, correct && hdr, calibration);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
      const texture = images.get(source);
      if (!texture) return;
      gl.deleteTexture(texture);
      images.delete(source);
    },
    destroy() {
      for (const texture of images.values()) gl.deleteTexture(texture);
      images.clear();
      for (const slot of videoSlots) gl.deleteTexture(slot.texture);
      gl.deleteTexture(curve);
      gl.deleteBuffer(ubo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
  return renderer;
}
