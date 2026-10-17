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
  // Colour pipeline (effects/colour.ts, writeEffects).
  gain: vec4f, // rgb multipliers · w: contrast
  lift: vec4f, // rgb offsets · w: saturation
  tone: vec4f, // highlights, shadows, vignette, sharpen
  shadowTint: vec4f, // rgb · w: mono amount
  highTint: vec4f, // rgb · w: output black level
  monoTint: vec4f, // rgb · w: output white level
  fx: vec4f, // xy: blur radius (uv) · zw: texel size (uv)
  wipe: vec4f, // x: 1 = wipe mask on · y: edge (clip x) · z: softness
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var frame: texture_2d<f32>; // @frame — external texture for video on WebGPU
@group(0) @binding(3) var curve: texture_2d<f32>; // 256×1, per-channel HDR tone curve

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  // Quad coordinate (−1…1) for the vignette, clip-space position for the wipe mask.
  @location(1) q: vec2f,
  @location(2) clip: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var quad = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  let q = quad[i];
  var out: VsOut;
  let clip = vec2f(u.pos.x * q.x + u.pos.y * q.y + u.posT.x, u.pos.z * q.x + u.pos.w * q.y + u.posT.y);
  out.pos = vec4f(clip, 0.0, 1.0);
  out.uv = vec2f(u.uv.x * q.x + u.uv.y * q.y + u.uvT.x, u.uv.z * q.x + u.uv.w * q.y + u.uvT.y);
  out.q = q;
  out.clip = clip;
  return out;
}

fn sampleFrame(uv: vec2f) -> vec4f {
  return textureSample(frame, samp, uv); // @sample-frame
}

// The layer's picture at uv: one tap, or a 13-tap disc blur (transitions, blurred background), plus
// an optional 4-tap unsharp mask. Branches depend on uniforms only (uniform control flow).
fn sampleLayer(uv: vec2f) -> vec4f {
  var c = sampleFrame(uv);
  let r = u.fx.xy;
  if (r.x > 0.0 || r.y > 0.0) {
    // Two rings of six taps (rotated against each other) around the centre, weighted towards it.
    var sum = c * 2.0;
    sum += sampleFrame(uv + r * vec2f(0.5, 0.0));
    sum += sampleFrame(uv + r * vec2f(0.25, 0.433));
    sum += sampleFrame(uv + r * vec2f(-0.25, 0.433));
    sum += sampleFrame(uv + r * vec2f(-0.5, 0.0));
    sum += sampleFrame(uv + r * vec2f(-0.25, -0.433));
    sum += sampleFrame(uv + r * vec2f(0.25, -0.433));
    sum += sampleFrame(uv + r * vec2f(0.0, 1.0));
    sum += sampleFrame(uv + r * vec2f(0.866, 0.5));
    sum += sampleFrame(uv + r * vec2f(0.866, -0.5));
    sum += sampleFrame(uv + r * vec2f(0.0, -1.0));
    sum += sampleFrame(uv + r * vec2f(-0.866, -0.5));
    sum += sampleFrame(uv + r * vec2f(-0.866, 0.5));
    c = sum / 14.0;
  }
  let s = u.tone.w;
  if (s != 0.0) {
    let t = u.fx.zw * 1.5;
    let around = sampleFrame(uv + vec2f(t.x, 0.0)) + sampleFrame(uv - vec2f(t.x, 0.0)) +
      sampleFrame(uv + vec2f(0.0, t.y)) + sampleFrame(uv - vec2f(0.0, t.y));
    c = vec4f(c.rgb + (c.rgb - around.rgb * 0.25) * s, c.a);
  }
  return c;
}

// The browser already converted HDR to SDR (too bright, flat). A measured per-channel curve plus a
// 3×3 matrix maps that to the target look (research/HDR.md).
fn correctHdr(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0)) * (255.0 / 256.0) + vec3f(0.5 / 256.0);
  let r = textureSampleLevel(curve, samp, vec2f(x.r, 0.5), 0.0).r;
  let g = textureSampleLevel(curve, samp, vec2f(x.g, 0.5), 0.0).g;
  let b = textureSampleLevel(curve, samp, vec2f(x.b, 0.5), 0.0).b;
  let v = vec3f(r, g, b);
  return clamp(vec3f(dot(u.c0.xyz, v), dot(u.c1.xyz, v), dot(u.c2.xyz, v)), vec3f(0.0), vec3f(1.0));
}

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

// Filters + adjustments (effects/colour.ts). Identity parameters give back `c` exactly.
fn colour(c0: vec3f, q: vec2f) -> vec3f {
  var c = c0 * u.gain.rgb;
  let l0 = luma(c);
  let darks = 1.0 - smoothstep(0.0, 0.6, l0);
  let brights = smoothstep(0.4, 1.0, l0);
  c += vec3f((u.tone.y * darks + u.tone.x * brights) * 0.25);
  c = (c - vec3f(0.5)) * u.gain.w + vec3f(0.5) + u.lift.rgb;
  let l = luma(c);
  c = mix(vec3f(l), c, u.lift.w);
  c += u.shadowTint.rgb * (1.0 - l) + u.highTint.rgb * l;
  c = mix(c, vec3f(l) * u.monoTint.rgb, u.shadowTint.w);
  c = vec3f(u.highTint.w) + c * (u.monoTint.w - u.highTint.w);
  let d = dot(q, q);
  c *= 1.0 - u.tone.z * smoothstep(0.25, 2.0, d);
  return clamp(c, vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let c = sampleLayer(in.uv);
  let rgb = colour(mix(c.rgb, correctHdr(c.rgb), u.posT.w), in.q);
  var a = c.a * u.posT.z;
  if (u.wipe.x > 0.0) {
    a *= 1.0 - smoothstep(u.wipe.y - u.wipe.z, u.wipe.y + u.wipe.z, in.clip.x);
  }
  // Straight alpha out; blending is src·α + dst·(1 − α). Images keep their own transparency.
  return vec4f(rgb, a);
}
