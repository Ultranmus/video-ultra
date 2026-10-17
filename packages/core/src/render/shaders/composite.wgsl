// Single-layer compositor shader — the source of truth for both backends.
// `pnpm shaders` generates the WebGPU variant (zero-copy external texture) and the WebGL2 GLSL
// (via naga) into generated.ts. Edit this file, never the generated one.

struct Uniforms {
  // Placement: unit quad (−1…1, y down) → clip space. ndc = (m.x·q.x + m.y·q.y, m.z·q.x + m.w·q.y)
  m: vec4f,
  // x: 1 = apply the HDR correction (browser's own HDR → SDR conversion → our target look).
  hdr: vec4f,
  // HDR colour matrix rows.
  c0: vec4f,
  c1: vec4f,
  c2: vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var frame: texture_2d<f32>; // @frame — external texture on WebGPU
@group(0) @binding(3) var curve: texture_2d<f32>; // 256×1, per-channel tone curve

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var quad = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  let q = quad[i];
  var out: VsOut;
  out.pos = vec4f(u.m.x * q.x + u.m.y * q.y, u.m.z * q.x + u.m.w * q.y, 0.0, 1.0);
  out.uv = q * 0.5 + 0.5;
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
  let corrected = correctHdr(c.rgb);
  return vec4f(mix(c.rgb, corrected, u.hdr.x), 1.0);
}
