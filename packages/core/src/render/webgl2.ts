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
import { SHADERS } from './shaders/generated';
import type {
  Backdrop,
  FramePlacement,
  LayerDraw,
  LayerSource,
  Renderer,
  RendererOptions,
  RenderTarget,
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
  const alpha = options.alpha ?? false;
  const gl = canvas.getContext('webgl2', {
    alpha,
    antialias: false,
    depth: false,
    stencil: false,
    // Opaque: never matters. See-through (DECISIONS #196): the drawing buffer is premultiplied
    // (straight-alpha blending over a transparent clear), so tell the browser it is.
    premultipliedAlpha: alpha,
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
  // Generated sampler names: _group_<g>_binding_<b>_fs. Layer → unit 0, HDR curve → unit 1,
  // pixels under the layer (blend modes) → unit 2, 3D LUT → unit 3.
  gl.uniform1i(gl.getUniformLocation(program, '_group_0_binding_2_fs'), 0);
  gl.uniform1i(gl.getUniformLocation(program, '_group_0_binding_3_fs'), 1);
  gl.uniform1i(gl.getUniformLocation(program, '_group_0_binding_4_fs'), 2);
  gl.uniform1i(gl.getUniformLocation(program, '_group_0_binding_5_fs'), 3);

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

  // Copy of the pixels under a layer (blend modes, blurred areas): grows to the largest rectangle
  // needed (one texture, re-specified rarely). Starts as a 1×1 stand-in.
  gl.activeTexture(gl.TEXTURE2);
  // copyTexSubImage2D needs a format the canvas can fill: an opaque canvas (alpha: false) gives
  // an RGB copy (sampled alpha reads as 1); a see-through one an RGBA copy.
  const grabRgb = !gl.getParameter(gl.ALPHA_BITS);
  const grabFormat = grabRgb ? gl.RGB8 : gl.RGBA8;
  const grabLayout = grabRgb ? gl.RGB : gl.RGBA;
  const grab = { texture: newTexture(gl), w: 1, h: 1 };
  gl.texImage2D(gl.TEXTURE_2D, 0, grabFormat, 1, 1, 0, grabLayout, gl.UNSIGNED_BYTE, null);
  // 3D LUTs: uploaded once per LUT; a 1×1×1 stand-in for layers without one.
  gl.activeTexture(gl.TEXTURE3);
  const newLut = (size: number, data: Uint8Array<ArrayBuffer>): WebGLTexture => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return texture;
  };
  const noLut = newLut(1, new Uint8Array([255, 255, 255, 255]));
  const luts = new Map<CubeLut, WebGLTexture>();
  let boundLut: WebGLTexture = noLut;
  /** Binds `lut`'s 3D texture on unit 3 (uploading it once), leaving unit 0 active. */
  const bindLut = (lut: CubeLut | null | undefined) => {
    let texture = lut ? luts.get(lut) : noLut;
    gl.activeTexture(gl.TEXTURE3);
    if (!texture) {
      texture = newLut(lut!.size, lut!.data);
      luts.set(lut!, texture);
    } else if (texture !== boundLut) {
      gl.bindTexture(gl.TEXTURE_3D, texture);
    }
    boundLut = texture;
    gl.activeTexture(gl.TEXTURE0);
  };
  gl.activeTexture(gl.TEXTURE0);

  // Video layers: one texture per distinct frame in a render, re-specified only on size changes.
  const videoSlots: { texture: WebGLTexture; w: number; h: number }[] = [];
  // Frames uploaded during the current render (the background and a layer can share one).
  const usedFrames: (VideoFrame | null)[] = [];
  let usedCount = 0;
  // Images: uploaded once.
  const images = new Map<ImageBitmap | OffscreenCanvas, WebGLTexture>();

  /**
   * Render targets (combined clips): an RGBA8 texture with its framebuffer. GL stores them bottom
   * row first, so as a layer source their v is flipped (see drawQuad).
   */
  interface Target extends RenderTarget {
    readonly texture: WebGLTexture;
    readonly fbo: WebGLFramebuffer;
  }
  const makeTarget = (width: number, height: number): Target => {
    const texture = newTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
    gl.activeTexture(gl.TEXTURE0);
    return { width, height, texture, fbo };
  };
  const targets = new Set<Target>();
  const isTarget = (x: unknown): x is Target => targets.has(x as Target);
  /** Where the render in progress draws (null: the canvas) and its size. */
  let outFbo: WebGLFramebuffer | null = null;
  let outW = 1;
  let outH = 1;

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
    if (isTarget(source)) {
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      return false;
    }
    const image = source as ImageBitmap | OffscreenCanvas;
    let texture = images.get(image);
    if (!texture) {
      texture = newTexture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      images.set(image, texture);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    return false;
  };

  // Size of the target being drawn into (canvas, or the blurred background's small target).
  let targetW = 1;
  let targetH = 1;
  const drawQuad = (
    geometry: Float32Array,
    opacity: number,
    hdr: boolean,
    effects: Readonly<Float32Array> | null,
    texelW: number,
    texelH: number,
    under: Int32Array | null = null,
    fromTarget = false,
  ) => {
    writeLayerUniforms(
      uniforms,
      0,
      geometry,
      opacity,
      hdr,
      calibration,
      effects,
      texelW,
      texelH,
      targetW,
      targetH,
    );
    // The copy underneath is bottom row first: texel y = y1 − pixel y.
    if (under) writeBackMapping(uniforms, 0, under[0]!, under[3]!, 1, -1);
    if (fromTarget) {
      // A render target: bottom row first (flip v) and premultiplied (the shader divides it out).
      uniforms[10] = -uniforms[10]!;
      uniforms[11] = -uniforms[11]!;
      uniforms[13] = 1 - uniforms[13]!;
      uniforms[14] = 1;
    }
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const drawBackdrop = (backdrop: Backdrop) => {
    const size = backdropSize(outW, outH, backdrop.amount);
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
    targetW = target.w;
    targetH = target.h;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    const hdr = bindSource(backdrop.source, backdrop.hdr);
    fx.set(backdrop.effects ?? IDENTITY_EFFECTS);
    footprintRadius(backdrop.geometry, target.w, target.h, radius);
    fx[24] = radius[0] * 0.75;
    fx[25] = radius[1] * 0.75;
    fx[11] = 0; // no sharpening on a blurred picture
    fx[28] = 0; // nor grain
    drawQuad(backdrop.geometry, 1, correct && hdr, fx, 0, 0, null, isTarget(backdrop.source));
    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
    gl.viewport(0, 0, outW, outH);
    targetW = outW;
    targetH = outH;
    // Pass 2: scaled up over the canvas with a second soft blur.
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    fx.set(IDENTITY_EFFECTS);
    fx[24] = UPSCALE_BLUR_TEXELS / target.w;
    fx[25] = UPSCALE_BLUR_TEXELS / target.h;
    drawQuad(fullscreen, 1, false, fx, 0, 0);
  };

  /** Copies canvas pixels `[x0, y0, x1, y1)` (y down) into the grab texture (bottom row first). */
  const copyUnder = (b: Int32Array) => {
    const w = b[2]! - b[0]!;
    const h = b[3]! - b[1]!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, grab.texture);
    if (w > grab.w || h > grab.h) {
      // Grow in 256-px steps so a moving layer doesn't re-specify the texture every frame.
      grab.w = Math.max(grab.w, Math.ceil(w / 256) * 256);
      grab.h = Math.max(grab.h, Math.ceil(h / 256) * 256);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        grabFormat,
        grab.w,
        grab.h,
        0,
        grabLayout,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, b[0]!, outH - b[3]!, w, h);
    gl.activeTexture(gl.TEXTURE0);
  };

  // Blurred areas: the copy drawn small through a reused render target (grows, never shrinks).
  let regionTarget: { texture: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number } | null =
    null;
  const bounds = new Int32Array(4);
  const small = new Int32Array(2);
  const downGeometry = new Float32Array(12);
  const regionFx = new Float32Array(EFFECT_FLOATS);

  /** A blurred / pixelated area: copy what's under it, shrink it, draw it back inside the box. */
  const drawRegion = (layer: LayerDraw) => {
    const region = layer.region!;
    const texel = regionTexel(region.amount, region.pixelate, outH);
    const pad = regionPad(texel, region.pixelate);
    if (!layerBounds(layer.geometry, outW, outH, pad, bounds)) return;
    const w = bounds[2]! - bounds[0]!;
    const h = bounds[3]! - bounds[1]!;
    copyUnder(bounds);
    regionSmallSize(w, h, texel, small);
    const sw = small[0]!;
    const sh = small[1]!;
    if (!regionTarget || regionTarget.w < sw || regionTarget.h < sh) {
      const rw = Math.max(sw, regionTarget?.w ?? 0, 64);
      const rh = Math.max(sh, regionTarget?.h ?? 0, 64);
      if (regionTarget) {
        gl.deleteFramebuffer(regionTarget.fbo);
        gl.deleteTexture(regionTarget.texture);
      }
      const texture = newTexture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
      regionTarget = { texture, fbo, w: rw, h: rh };
    }
    const target = regionTarget;
    // Pass 1: the copy (bottom row first) into the target's corner, small, averaged.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, sw, sh);
    targetW = sw;
    targetH = sh;
    const ku = w / grab.w;
    const kv = h / grab.h;
    const g = downGeometry;
    g[0] = 1;
    g[1] = 0;
    g[2] = 0;
    g[3] = 1;
    g[4] = 0;
    g[5] = 0;
    g[6] = ku / 2;
    g[7] = 0;
    g[8] = 0;
    g[9] = kv / 2;
    g[10] = ku / 2;
    g[11] = kv / 2;
    const down = regionDownRadius(region.pixelate);
    fx.set(IDENTITY_EFFECTS);
    fx[24] = (down * ku) / sw;
    fx[25] = (down * kv) / sh;
    fx[93] = (w - 0.5) / grab.w;
    fx[94] = (h - 0.5) / grab.h;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, grab.texture);
    gl.disable(gl.BLEND);
    drawQuad(g, 1, false, fx, 1 / grab.w, 1 / grab.h);
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
    gl.viewport(0, 0, outW, outH);
    targetW = outW;
    targetH = outH;
    // Pass 2: inside the box, the small copy by position (bottom row first, so v runs up).
    regionFx.set(layer.effects ?? IDENTITY_EFFECTS);
    if (!region.pixelate) {
      regionFx[24] = UPSCALE_BLUR_TEXELS / target.w;
      regionFx[25] = UPSCALE_BLUR_TEXELS / target.h;
    }
    regionFx[93] = (sw - 0.5) / target.w;
    regionFx[94] = (sh - 0.5) / target.h;
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    writeLayerUniforms(
      uniforms,
      0,
      layer.geometry,
      layer.opacity,
      false,
      calibration,
      regionFx,
      1 / target.w,
      1 / target.h,
      targetW,
      targetH,
    );
    writeBackMapping(uniforms, 0, bounds[0]!, bounds[3]!, sw / w / target.w, -sh / h / target.h);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
    render(layers, background = [0, 0, 0], backdrop = null, into = null) {
      usedCount = 0;
      const out = isTarget(into) ? into : null;
      outFbo = out ? out.fbo : null;
      outW = out ? out.width : canvas.width;
      outH = out ? out.height : canvas.height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
      gl.viewport(0, 0, outW, outH);
      targetW = outW;
      targetH = outH;
      if (background) gl.clearColor(background[0], background[1], background[2], 1);
      else gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      if (backdrop) drawBackdrop(backdrop);
      for (const layer of layers) {
        if (layer.region) {
          drawRegion(layer);
          continue;
        }
        // Blend modes read the pixels under the layer: copy them first.
        let under: Int32Array | null = null;
        if (layer.blend) {
          if (!layerBounds(layer.geometry, outW, outH, 1, bounds)) continue;
          copyUnder(bounds);
          under = bounds;
        }
        bindLut(layer.lut);
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
          under,
          isTarget(source),
        );
      }
      // Don't keep (soon closed) frames referenced between renders.
      for (let i = 0; i < usedCount; i++) usedFrames[i] = null;
      if (outFbo) {
        outFbo = null;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    },
    createTarget(width, height) {
      const target = makeTarget(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
      targets.add(target);
      return target;
    },
    destroyTarget(target) {
      if (!isTarget(target) || !targets.delete(target)) return;
      gl.deleteFramebuffer(target.fbo);
      gl.deleteTexture(target.texture);
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
      if (regionTarget) {
        gl.deleteFramebuffer(regionTarget.fbo);
        gl.deleteTexture(regionTarget.texture);
      }
      for (const texture of luts.values()) gl.deleteTexture(texture);
      luts.clear();
      for (const t of targets) {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.texture);
      }
      targets.clear();
      gl.deleteTexture(noLut);
      gl.deleteTexture(grab.texture);
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
