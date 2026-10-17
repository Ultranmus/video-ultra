// Layer compositor shader — the source of truth for both backends. One draw per layer.
// `pnpm shaders` validates it and generates the WebGL2 GLSL (via naga) into generated.ts (never
// edit that file); WebGPU uses it as is for images and derives the zero-copy external-texture
// variant for video frames at load time (shaders/external.ts).
//
// Every effect is a uniform-driven family (effects/colour.ts, effects/transitions.ts,
// effects/animations.ts): colour pipeline, blurs, RGB split, masks, warps, colour mix and a 3D
// turn. Branches depend on uniforms only, so identity layers pay a few compares.
//
// "Screen" coordinates: canvas height = 2, y down, x in ±aspect (aspect-correct shapes).

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
  fx: vec4f, // xy: disc blur radius (uv) / strength · zw: texel size (uv)
  look: vec4f, // grain, grain seed, hue (radians), vibrance
  blur: vec4f, // x: mode (0 disc · 1 line · 2 radial · 3 spin) · yz: line direction (screen) · w: RGB split (screen)
  mask: vec4f, // x: shape (0 none) · y: progress · z: softness · w: 1 invert + 2 local
  maskP: vec4f, // direction xy · count · polar shape   (text: top, line height, line, rtl)
  maskQ: vec4f, // centre xy · edge shade · shade width (text: cut A, cut B, fade B, lines)
  warp: vec4f, // x: kind · y: amount · z: frequency · w: phase
  warpP: vec4f, // direction xy · centre xy
  flash: vec4f, // rgb · w: mix amount
  rot: vec4f, // x: axis (0 none · 1 vertical · 2 horizontal) · y: cos · z: sin · w: camera distance
  pivot: vec4f, // xyz: turn pivot (screen units, z away from the viewer) · w: 1 = half the blur taps
  inv: vec4f, // inverse of mat2(pos): clip offset → q offset (written by the renderer)
  canvas: vec4f, // x: canvas aspect · y: layer box aspect · zw: canvas size in px (renderer)
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var frame: texture_2d<f32>; // @frame — external texture for video on WebGPU
@group(0) @binding(3) var curve: texture_2d<f32>; // 256×1, per-channel HDR tone curve

struct VsOut {
  @builtin(position) pos: vec4f,
  // Quad coordinate (−1…1), perspective-correct under a 3D turn.
  @location(0) q: vec2f,
  // Clip position before the perspective divide and its w: screen = xy / z, linear on screen.
  @location(1) clip: vec3f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var quad = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  let q = quad[i];
  var clip = vec2f(u.pos.x * q.x + u.pos.y * q.y + u.posT.x, u.pos.z * q.x + u.pos.w * q.y + u.posT.y);
  var w = 1.0;
  if (u.rot.x > 0.5) {
    // Turn the layer in 3D about the pivot, then project with a camera `rot.w` in front.
    let a = u.canvas.x;
    var p = vec3f(clip.x * a, -clip.y, 0.0) - u.pivot.xyz;
    let c = u.rot.y;
    let s = u.rot.z;
    if (u.rot.x < 1.5) {
      p = vec3f(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
    } else {
      p = vec3f(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
    }
    p += u.pivot.xyz;
    w = max(0.05, (u.rot.w + p.z) / u.rot.w);
    clip = vec2f(p.x / a, -p.y);
  }
  var out: VsOut;
  out.pos = vec4f(clip, 0.0, w);
  out.q = q;
  out.clip = vec3f(clip, w);
  return out;
}

fn sampleFrame(uv: vec2f) -> vec4f {
  return textureSample(frame, samp, uv); // @sample-frame
}

// Screen offset → texture uv offset (through the layer's geometry).
fn screenToUv(d: vec2f) -> vec2f {
  let c = vec2f(d.x / u.canvas.x, -d.y);
  let dq = vec2f(u.inv.x * c.x + u.inv.y * c.y, u.inv.z * c.x + u.inv.w * c.y);
  return vec2f(u.uv.x * dq.x + u.uv.y * dq.y, u.uv.z * dq.x + u.uv.w * dq.y);
}

fn tapOffset(k: i32) -> vec2f {
  // Two rings of six taps (rotated against each other) around the centre.
  var taps = array<vec2f, 12>(
    vec2f(0.5, 0.0), vec2f(0.25, 0.433), vec2f(-0.25, 0.433), vec2f(-0.5, 0.0),
    vec2f(-0.25, -0.433), vec2f(0.25, -0.433), vec2f(0.0, 1.0), vec2f(0.866, 0.5),
    vec2f(0.866, -0.5), vec2f(0.0, -1.0), vec2f(-0.866, -0.5), vec2f(-0.866, 0.5));
  return taps[k];
}

// One tap, with the RGB split when it's on.
fn sampleTap(uv: vec2f, split: vec2f) -> vec4f {
  var c = sampleFrame(uv);
  if (u.blur.w != 0.0) {
    let r = sampleFrame(uv + split);
    let b = sampleFrame(uv - split);
    c = vec4f(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
  }
  return c;
}

// The layer's picture at uv: one tap, or 13 taps (disc, line, radial or spin blur), plus an
// optional 4-tap unsharp mask.
fn sampleLayer(uv: vec2f, s: vec2f) -> vec4f {
  let split = screenToUv(vec2f(u.blur.w, 0.0));
  var c = sampleTap(uv, split);
  let mode = u.blur.x;
  if (mode < 0.5) {
    let r = u.fx.xy;
    if (r.x > 0.0 || r.y > 0.0) {
      // Low-tier preview: the outer ring only (7 taps instead of 13).
      let first = select(0, 6, u.pivot.w > 0.5);
      var sum = c * 2.0;
      for (var k = first; k < 12; k++) {
        sum += sampleTap(uv + r * tapOffset(k), split);
      }
      c = sum / f32(14 - first);
    }
  } else if (u.fx.x != 0.0) {
    // Directional blurs: 13 taps spread along a screen-space path through this pixel.
    var step = vec2f(0.0);
    var spin = 0.0;
    if (mode < 1.5) {
      step = screenToUv(u.blur.yz * u.fx.x) / 12.0;
    } else if (mode < 2.5) {
      step = screenToUv(-s * u.fx.x) / 12.0;
    } else {
      spin = u.fx.x / 12.0;
    }
    // Low-tier preview: every other tap (7 instead of 13), spread over the same path.
    let stride = select(1, 2, u.pivot.w > 0.5);
    var sum = c;
    var count = 1.0;
    for (var k = 1; k < 13; k += stride) {
      count += 1.0;
      let t = f32(k) - 6.5;
      var off = step * t;
      if (mode > 2.5) {
        let a = spin * t;
        let rs = vec2f(s.x * cos(a) - s.y * sin(a), s.x * sin(a) + s.y * cos(a));
        off = screenToUv(rs - s);
      }
      sum += sampleTap(uv + off, split);
    }
    c = sum / count;
  }
  let sh = u.tone.w;
  if (sh != 0.0) {
    let t = u.fx.zw * 1.5;
    let around = sampleFrame(uv + vec2f(t.x, 0.0)) + sampleFrame(uv - vec2f(t.x, 0.0)) +
      sampleFrame(uv + vec2f(0.0, t.y)) + sampleFrame(uv - vec2f(0.0, t.y));
    c = vec4f(c.rgb + (c.rgb - around.rgb * 0.25) * sh, c.a);
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

// Integer hash → 0…1 (identical on every GPU: no sin, no float precision games).
fn hash2(p: vec2f) -> f32 {
  var v = (bitcast<u32>(i32(floor(p.x))) * 1597334677u) ^ (bitcast<u32>(i32(floor(p.y))) * 3812015801u);
  v = v * 747796405u + 2891336453u;
  v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  v = (v >> 22u) ^ v;
  return f32(v & 16777215u) / 16777216.0;
}

// Filters + adjustments (effects/colour.ts). Identity parameters give back `c` exactly.
fn colour(c0: vec3f, q: vec2f, px: vec2f) -> vec3f {
  var c = c0 * u.gain.rgb;
  let l0 = luma(c);
  let darks = 1.0 - smoothstep(0.0, 0.6, l0);
  let brights = smoothstep(0.4, 1.0, l0);
  c += vec3f((u.tone.y * darks + u.tone.x * brights) * 0.25);
  c = (c - vec3f(0.5)) * u.gain.w + vec3f(0.5) + u.lift.rgb;
  var l = luma(c);
  c = mix(vec3f(l), c, u.lift.w);
  if (u.look.w != 0.0) {
    // Vibrance: more colour where there is little.
    let sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    c = mix(vec3f(l), c, 1.0 + u.look.w * (1.0 - clamp(sat * 1.5, 0.0, 1.0)));
  }
  if (u.look.z != 0.0) {
    // Hue: rotate the chroma (YIQ) around the grey axis.
    let ch = cos(u.look.z);
    let sh = sin(u.look.z);
    let yi = vec3f(dot(c, vec3f(0.299, 0.587, 0.114)), dot(c, vec3f(0.596, -0.274, -0.322)),
      dot(c, vec3f(0.211, -0.523, 0.312)));
    let i = yi.y * ch - yi.z * sh;
    let qq = yi.y * sh + yi.z * ch;
    c = vec3f(yi.x + 0.956 * i + 0.621 * qq, yi.x - 0.272 * i - 0.647 * qq, yi.x - 1.106 * i + 1.703 * qq);
    l = luma(c);
  }
  c += u.shadowTint.rgb * (1.0 - l) + u.highTint.rgb * l;
  c = mix(c, vec3f(l) * u.monoTint.rgb, u.shadowTint.w);
  c = vec3f(u.highTint.w) + c * (u.monoTint.w - u.highTint.w);
  if (u.look.x > 0.0) {
    // Grain: per-pixel noise, new every frame, strongest in the mid-tones.
    let n = hash2(px + vec2f(u.look.y * 131.0, u.look.y * 71.0)) - 0.5;
    let m = clamp(luma(c), 0.0, 1.0);
    c += vec3f(n * u.look.x * 0.22 * (0.4 + 2.4 * m * (1.0 - m)));
  }
  let d = dot(q, q);
  c *= 1.0 - u.tone.z * smoothstep(0.25, 2.0, d);
  return clamp(c, vec3f(0.0), vec3f(1.0));
}

// Where this screen pixel samples the layer from (ripples, waves, swirls, mosaics, glitches).
fn warp(s: vec2f) -> vec2f {
  let kind = u.warp.x;
  let amount = u.warp.y;
  let freq = u.warp.z;
  let phase = u.warp.w;
  let d = s - u.warpP.zw;
  if (kind < 1.5) {
    let r = length(d);
    return s + d / max(r, 1e-4) * sin(r * freq - phase) * amount;
  }
  if (kind < 2.5) {
    let dir = u.warpP.xy;
    let across = dot(s, vec2f(-dir.y, dir.x));
    return s + dir * sin(across * freq + phase) * amount;
  }
  if (kind < 3.5) {
    let r = length(d);
    let k = 1.0 - smoothstep(0.0, freq, r);
    let a = amount * k * k;
    return u.warpP.zw + vec2f(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
  }
  if (kind < 4.5) {
    let cell = max(amount, 1e-3);
    return (floor(s / cell) + vec2f(0.5)) * cell;
  }
  if (kind < 5.5) {
    let band = floor((s.y + 1.0) * freq * 0.5);
    let h = hash2(vec2f(band, phase));
    let on = step(0.55, hash2(vec2f(band + 37.0, phase)));
    return vec2f(s.x + (h - 0.5) * 2.0 * amount * on, s.y);
  }
  // Bulge: magnify the middle.
  let r = length(d) / max(freq, 1e-3);
  return u.warpP.zw + d * (1.0 - amount * (1.0 - smoothstep(0.0, 1.0, r)) * 0.6);
}

// Star, flower, hexagon, triangle, circle: boundary radius at angle a (from 12 o'clock), max 1.
fn polar(a: f32, shape: f32) -> f32 {
  let tau = 6.2831853;
  if (shape < 0.5) {
    return 0.45 + 0.55 * abs(1.0 - 2.0 * fract(a * 5.0 / tau));
  }
  if (shape < 1.5) {
    return 0.62 + 0.38 * abs(cos(a * 3.0));
  }
  if (shape < 3.5) {
    // Regular polygon with a corner at the top: hexagon (inradius 0.866) or triangle (0.5).
    let n = select(3.0, 6.0, shape < 2.5);
    let seg = tau / n;
    let x = a - seg * floor(a / seg) - seg * 0.5;
    return cos(3.1415927 / n) / cos(x);
  }
  return 1.0;
}

// How much of this layer shows at screen / box position `s0` (half width `a`, half height 1).
// Each shape is a field f (0 = revealed first … 1 = last) swept by the progress with a soft edge.
fn maskAlpha(s0: vec2f, a: f32, c: vec3f) -> f32 {
  let shape = u.mask.x;
  let p = u.mask.y;
  let k = max(u.mask.z, 1e-4);
  let invert = fract(u.mask.w * 0.5) > 0.25;
  // Shapes with a centre (maskQ.xy); the others use maskQ for their own parameters.
  let centred = (shape > 1.5 && shape < 5.5) || (shape > 7.5 && shape < 8.5) ||
    (shape > 9.5 && shape < 11.5) || (shape > 13.5 && shape < 14.5);
  let s = s0 - select(vec2f(0.0), u.maskQ.xy, centred);
  let far = length(vec2f(a + abs(u.maskQ.x), 1.0 + abs(u.maskQ.y)));
  let dir = u.maskP.xy;
  let ext = abs(dir.x) * a + abs(dir.y);
  var f = 0.0;
  if (shape < 1.5) {
    f = (dot(s, dir) + ext) / (2.0 * ext);
  } else if (shape < 2.5) {
    let t = fract(atan2(s.x, -s.y) / 6.2831853 + 1.0);
    f = select(t, 1.0 - t, dir.x < 0.0);
  } else if (shape < 3.5) {
    f = length(s) / far;
  } else if (shape < 4.5) {
    f = (abs(s.x) + abs(s.y)) / (a + 1.0 + abs(u.maskQ.x) + abs(u.maskQ.y));
  } else if (shape < 5.5) {
    f = max(abs(s.x) / a, abs(s.y));
  } else if (shape < 6.5) {
    f = fract((dot(s, dir) + ext) / (2.0 * ext) * u.maskP.z);
  } else if (shape < 7.5) {
    let g = (s + vec2f(a, 1.0)) * u.maskP.z * 0.5;
    let cell = floor(g);
    let parity = cell.x + cell.y - 2.0 * floor((cell.x + cell.y) * 0.5);
    let along = clamp(dot(g - cell - vec2f(0.5), dir) + 0.5, 0.0, 1.0);
    f = (along + parity) * 0.5;
  } else if (shape < 8.5) {
    f = abs(dot(s, dir)) / (ext + abs(dot(u.maskQ.xy, dir)));
  } else if (shape < 9.5) {
    let amp = select(u.maskQ.x, 0.08, u.maskQ.x == 0.0);
    let across = dot(s, vec2f(-dir.y, dir.x)) * u.maskP.z;
    var teeth = abs(fract(across) * 2.0 - 1.0);
    if (u.maskP.w > 0.5) {
      teeth = 0.5 + 0.5 * sin(across * 6.2831853 + u.maskQ.y);
    }
    f = (dot(s, dir) + ext + amp * teeth) / (2.0 * ext + amp);
  } else if (shape < 10.5) {
    let shapeId = u.maskP.w;
    let smallest = select(select(select(select(1.0, 0.5, shapeId < 3.5), 0.866, shapeId < 2.5),
      0.62, shapeId < 1.5), 0.45, shapeId < 0.5);
    f = length(s) * smallest / (max(polar(atan2(s.x, -s.y), shapeId), 1e-3) * far);
  } else if (shape < 11.5) {
    // Heart (implicit curve), grown until it covers the screen.
    let size = max(p * (1.0 + k) * 1.9 * far, 1e-4);
    let h = vec2f(s.x, 0.12 * size - s.y) / size;
    let r2 = dot(h, h) - 1.0;
    let v = r2 * r2 * r2 - h.x * h.x * h.y * h.y * h.y;
    let alpha = 1.0 - smoothstep(-k * 3.0, k * 3.0, v);
    return select(alpha, 1.0 - alpha, invert);
  } else if (shape < 12.5) {
    let cells = max(u.maskP.z, 1.0);
    let n = hash2(floor((s + vec2f(a, 1.0)) * cells * 0.5) + vec2f(u.maskQ.y * 17.0, 3.0));
    f = n * (1.0 - k) + k * 0.5;
  } else if (shape < 13.5) {
    f = clamp(luma(c), 0.0, 1.0);
  } else if (shape < 14.5) {
    f = abs(atan2(s.x, -s.y)) / 3.1415927;
  }
  let e = p * (1.0 + k);
  let alpha = 1.0 - smoothstep(e - k, e, f);
  return select(alpha, 1.0 - alpha, invert);
}

// Edge shading for masks with `maskQ.z` (page-turn highlight): how near the edge this pixel is.
fn maskEdge(s0: vec2f, a: f32) -> f32 {
  let dir = u.maskP.xy;
  let ext = abs(dir.x) * a + abs(dir.y);
  let f = (dot(s0, dir) + ext) / (2.0 * ext);
  let k = max(u.mask.z, 1e-4);
  let e = u.mask.y * (1.0 + k) - k;
  let inside = e - f;
  return (1.0 - smoothstep(0.0, max(u.maskQ.w, 1e-3), inside)) * step(0.0, inside);
}

// Typewriter / word reveal in a text raster (q = box coordinate).
fn textAlpha(q: vec2f) -> f32 {
  var x = q.x * 0.5 + 0.5;
  let y = q.y * 0.5 + 0.5;
  if (u.maskP.w > 0.5) {
    x = 1.0 - x;
  }
  let line = clamp(floor((y - u.maskP.x) / max(u.maskP.y, 1e-4)), 0.0, max(u.maskQ.w - 1.0, 0.0));
  if (line < u.maskP.z) {
    return 1.0;
  }
  if (line > u.maskP.z) {
    return 0.0;
  }
  if (x < u.maskQ.x) {
    return 1.0;
  }
  if (x < u.maskQ.y) {
    return u.maskQ.z;
  }
  return 0.0;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let screen = in.clip.xy / in.clip.z;
  let aspect = u.canvas.x;
  let s = vec2f(screen.x * aspect, -screen.y);
  var q = in.q;
  var inside = 1.0;
  if (u.warp.x > 0.5) {
    // Sample from the warped screen position, mapped back into the layer's quad.
    let ws = warp(s);
    let d = vec2f(ws.x / aspect, -ws.y) - u.posT.xy;
    q = vec2f(u.inv.x * d.x + u.inv.y * d.y, u.inv.z * d.x + u.inv.w * d.y);
    inside = step(abs(q.x), 1.0001) * step(abs(q.y), 1.0001);
  }
  let uv = vec2f(u.uv.x * q.x + u.uv.y * q.y + u.uvT.x, u.uv.z * q.x + u.uv.w * q.y + u.uvT.y);
  let c = sampleLayer(uv, s);
  let px = (screen * vec2f(0.5, -0.5) + vec2f(0.5)) * u.canvas.zw;
  var rgb = colour(mix(c.rgb, correctHdr(c.rgb), u.posT.w), in.q, px);
  var a = c.a * u.posT.z * inside;
  if (u.mask.x > 0.5) {
    if (u.mask.x > 19.5) {
      a *= textAlpha(in.q);
    } else {
      let local = u.mask.w > 1.5;
      let ms = select(s, vec2f(in.q.x * u.canvas.y, in.q.y), local);
      let ma = select(aspect, u.canvas.y, local);
      a *= maskAlpha(ms, ma, rgb);
      if (u.maskQ.z != 0.0) {
        let near = maskEdge(ms, ma);
        rgb = mix(rgb, vec3f(select(0.0, 1.0, u.maskQ.z < 0.0)), abs(u.maskQ.z) * near);
      }
    }
  }
  rgb = mix(rgb, u.flash.rgb, u.flash.w);
  // Straight alpha out; blending is src·α + dst·(1 − α). Images keep their own transparency.
  return vec4f(rgb, a);
}
