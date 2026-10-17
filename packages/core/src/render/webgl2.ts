import { placementMatrix, type FramePlacement, type Renderer } from './types';

// Hand-written for Phase 0. From Phase 2 on, GLSL is generated from the WGSL source (DECISIONS #10).
const VERTEX = `#version 300 es
uniform vec4 u_m;
out vec2 v_uv;
const vec2 QUAD[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));
void main() {
  vec2 q = QUAD[gl_VertexID];
  gl_Position = vec4(u_m.x * q.x + u_m.y * q.y, u_m.z * q.x + u_m.w * q.y, 0.0, 1.0);
  v_uv = q * 0.5 + 0.5;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 color;
void main() { color = texture(u_tex, v_uv); }`;

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
 * WebGL2 renderer. Uploads each frame into one reused texture (`texSubImage2D` once the size is
 * known), so it allocates nothing per frame.
 */
export function createWebGL2Renderer(canvas: OffscreenCanvas): Renderer {
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
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`WebGL link error: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
  }
  gl.useProgram(program);
  const uMatrix = gl.getUniformLocation(program, 'u_m');
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0);
  // gl_VertexID needs a bound (empty) vertex array on some drivers.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let texW = 0;
  let texH = 0;
  const matrix = new Float32Array(4);

  return {
    backend: 'webgl2',
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    draw(frame: VideoFrame, placement: FramePlacement) {
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (w !== texW || h !== texH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        texW = w;
        texH = h;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform4fv(uMatrix, placementMatrix(placement, canvas.width, canvas.height, matrix));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy() {
      gl.deleteTexture(texture);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
