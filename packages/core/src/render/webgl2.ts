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
import { SHADERS } from './shaders/generated';
import type {
  Backdrop,
  FramePlacement,
  LayerDraw,
  LayerSource,
  Renderer,
  RendererOptions,
} from './types';

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
 * until `release()`. Alpha blending, one draw per layer; the blurred background is two small extra
 * draws through a reused render target.
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

  // Video layers: one texture per distinct frame in a render, re-specified only on size changes.
  const videoSlots: { texture: WebGLTexture; w: number; h: number }[] = [];
  // Frames uploaded during the current render (the background and a layer can share one).
  const usedFrames: (VideoFrame | null)[] = [];
  let usedCount = 0;
  // Images: uploaded once.
  const images = new Map<ImageBitmap | OffscreenCanvas, WebGLTexture>();

  // Blurred background: a small render target, reallocated only when its size changes.
  let backdropTarget: {
    texture: WebGLTexture;
    fbo: WebGLFramebuffer;
    w: number;
    h: number;
  } | null = null;
  const fx = new Float32Array(EFFECT_FLOATS);
  const radius: [number, number] = [0, 0];
  // Full-canvas quad showing the render target. GL render targets are stored bottom row first,
  // so v is flipped compared with uploaded pictures.
  const fullscreen = new Float32Array([1, 0, 0, -1, 0, 0, 0.5, 0, 0, -0.5, 0.5, 0.5]);

  /** Binds `source`'s texture on unit 0 (uploading it if needed) and says whether it is HDR. */
  const bindSource = (source: LayerSource, trackHdr: boolean): boolean => {
    if (source instanceof VideoFrame) {
      const hdr = frameIsHdr(source.colorSpace, trackHdr);
      for (let i = 0; i < usedCount; i++) {
        if (usedFrames[i] === source) {
          gl.bindTexture(gl.TEXTURE_2D, videoSlots[i]!.texture);
          return hdr;
        }
      }
      const slot = (videoSlots[usedCount] ??= { texture: newTexture(gl), w: 0, h: 0 });
      usedFrames[usedCount++] = source;
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
      return hdr;
    }
    let texture = images.get(source);
    if (!texture) {
      texture = newTexture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      images.set(source, texture);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    return false;
  };

  const drawQuad = (
    geometry: Float32Array,
    opacity: number,
    hdr: boolean,
    effects: Readonly<Float32Array> | null,
    texelW: number,
    texelH: number,
  ) => {
    writeLayerUniforms(uniforms, 0, geometry, opacity, hdr, calibration, effects, texelW, texelH);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const drawBackdrop = (backdrop: Backdrop) => {
    const size = backdropSize(canvas.width, canvas.height, backdrop.amount);
    if (!backdropTarget || backdropTarget.w !== size.width || backdropTarget.h !== size.height) {
      if (backdropTarget) {
        gl.deleteFramebuffer(backdropTarget.fbo);
        gl.deleteTexture(backdropTarget.texture);
      }
      const texture = newTexture(gl);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        size.width,
        size.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      backdropTarget = { texture, fbo, w: size.width, h: size.height };
    }
    const target = backdropTarget;
    // Pass 1: the picture, small, with a blur the size of one small texel (anti-aliased downscale).
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    const hdr = bindSource(backdrop.source, backdrop.hdr);
    fx.set(backdrop.effects ?? IDENTITY_EFFECTS);
    footprintRadius(backdrop.geometry, target.w, target.h, radius);
    fx[24] = radius[0] * 0.75;
    fx[25] = radius[1] * 0.75;
    fx[11] = 0; // no sharpening on a blurred picture
    drawQuad(backdrop.geometry, 1, correct && hdr, fx, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Pass 2: scaled up over the canvas with a second soft blur.
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    fx.set(IDENTITY_EFFECTS);
    fx[24] = UPSCALE_BLUR_TEXELS / target.w;
    fx[25] = UPSCALE_BLUR_TEXELS / target.h;
    drawQuad(fullscreen, 1, false, fx, 0, 0);
  };

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
    render(layers, background = [0, 0, 0], backdrop = null) {
      usedCount = 0;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(background[0], background[1], background[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      if (backdrop) drawBackdrop(backdrop);
      for (const layer of layers) {
        const source = layer.source;
        const hdr = bindSource(source, layer.hdr);
        const w = source instanceof VideoFrame ? source.displayWidth : source.width;
        const h = source instanceof VideoFrame ? source.displayHeight : source.height;
        drawQuad(
          layer.geometry,
          layer.opacity,
          correct && hdr,
          layer.effects ?? null,
          1 / w,
          1 / h,
        );
      }
      // Don't keep (soon closed) frames referenced between renders.
      for (let i = 0; i < usedCount; i++) usedFrames[i] = null;
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
      if (backdropTarget) {
        gl.deleteFramebuffer(backdropTarget.fbo);
        gl.deleteTexture(backdropTarget.texture);
      }
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
