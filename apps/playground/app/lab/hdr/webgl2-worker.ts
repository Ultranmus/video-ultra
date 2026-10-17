/// <reference lib="webworker" />
// HDR research: the browser's WebGL2 HDR → SDR conversion *inside a worker* (where the engine runs).
// Receives a VideoFrame, draws it with a plain pass-through shader, returns RGBA8 pixels (top-down).

self.onmessage = (event: MessageEvent<{ frame: VideoFrame; w: number; h: number }>) => {
  const { frame, w, h } = event.data;
  const canvas = new OffscreenCanvas(w, h);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })!;
  const program = gl.createProgram();
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(
    vs,
    `#version 300 es
    out vec2 uv; const vec2 Q[4] = vec2[4](vec2(-1,-1), vec2(1,-1), vec2(-1,1), vec2(1,1));
    void main() { vec2 q = Q[gl_VertexID]; gl_Position = vec4(q, 0, 1); uv = vec2(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5); }`,
  );
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(
    fs,
    `#version 300 es
    precision highp float; uniform sampler2D t; in vec2 uv; out vec4 c; void main() { c = texture(t, uv); }`,
  );
  gl.compileShader(fs);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Same upload as the engine's renderer (RGBA8).
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  frame.close();
  gl.viewport(0, 0, w, h);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const flipped = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    flipped.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  (self as DedicatedWorkerGlobalScope).postMessage(flipped, [flipped.buffer]);
};
