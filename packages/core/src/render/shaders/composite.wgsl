// Layer compositor shader — the source of truth for both backends. One draw per layer.
// `pnpm shaders` generates the WebGPU variants (zero-copy external texture for video frames, and
// texture_2d for images) and the WebGL2 GLSL (via naga) into generated.ts. Never edit that file.

struct Uniforms {
  // Unit quad q (−1…1, y down) → clip space: clip = mat2(pos) · q + posT.xy  (render/layout.ts)
  pos: vec4f,
  // xy: clip offset · z: opacity · w: 1 = apply the HDR correction
  posT: vec4f,
  // q → texture uv: uv = mat2(uv) · q + uvT.xy
  uv: vec4f,
  uvT: vec4f,
  // HDR colour matrix rows (render/hdr.ts).
  c0: vec4f,
  c1: vec4f,
  c2: vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var frame: texture_2d<f32>; // @frame — external texture for video on WebGPU
@group(0) @binding(3) var curve: texture_2d<f32>; // 256×1, per-channel HDR tone curve

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var quad = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  let q = quad[i];
  var out: VsOut;
  out.pos = vec4f(u.pos.x * q.x + u.pos.y * q.y + u.posT.x, u.pos.z * q.x + u.pos.w * q.y + u.posT.y, 0.0, 1.0);
  out.uv = vec2f(u.uv.x * q.x + u.uv.y * q.y + u.uvT.x, u.uv.z * q.x + u.uv.w * q.y + u.uvT.y);
  return out;
}

fn sampleFrame(uv: vec2f) -> vec4f {
  return textureSample(frame, samp, uv); // @sample-frame
}

// The browser already converted HDR to SDR (too bright, flat). A measured per-channel curve plus a
// 3×3 matrix maps that to the target look (research/HDR.md).
fn correctHdr(c: vec3f) -> vec3f {
  let x = c * (255.0 / 256.0) + vec3f(0.5 / 256.0);
  let r = textureSampleLevel(curve, samp, vec2f(x.r, 0.5), 0.0).r;
  let g = textureSampleLevel(curve, samp, vec2f(x.g, 0.5), 0.0).g;
  let b = textureSampleLevel(curve, samp, vec2f(x.b, 0.5), 0.0).b;
  let v = vec3f(r, g, b);
  return clamp(vec3f(dot(u.c0.xyz, v), dot(u.c1.xyz, v), dot(u.c2.xyz, v)), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let c = sampleFrame(in.uv);
  let rgb = mix(c.rgb, correctHdr(c.rgb), u.posT.w);
  // Straight alpha out; blending is src·α + dst·(1 − α). Images keep their own transparency.
  return vec4f(rgb, c.a * u.posT.z);
}
