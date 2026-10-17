# Pending: effects library (transitions, element animations, filters)

Work from the effects-library track (2026-10-17), to be folded into DECISIONS / PERF / BACKLOG /
PROGRESS by whoever merges it. Nothing in `docs/internal/*.md` was edited.

## What was built

- **Transitions:** 76 presets in 10 categories, 161 styles with directions (`TRANSITION_PRESETS`,
  `TRANSITION_CATEGORIES`, `findTransitionPreset`). `Transition` gained optional `direction`
  (`left | right | up | down`) and `ease` (`linear | smooth | snappy | bounce`).
- **Element animations** for lane items (text, stickers, picture-in-picture video / photo):
  30 entrances, 27 exits, 13 loops (`ANIMATION_PRESETS`, `ANIMATION_CATEGORIES`,
  `findAnimationPreset`), schema field `animation?: { in?, out?, loop? }`, edit op
  `setAnimation(project, itemId, slot, value | null)`.
- **Filters:** 115 presets in 15 categories (`FILTER_PRESETS` entries gained `category`;
  `FILTER_CATEGORIES`). The 16 v0.1 ids keep their exact numbers.
- **Bug fix (owner report: "Zoom" also zoomed stickers/text):** the compositor now applies a
  transition only to layers on the main track (`compose.ts` gather: `layer.track.kind === 'main'`),
  and a golden check proves lanes are untouched by 30 transition families on both backends. At
  HEAD the core did not reproduce the bug (lane layers never carried a transition), so if the
  owner still sees it, the cause is outside the compositor (deployed build older than the
  transition code? UI stage overlay?) — ask for a screen recording.

## Proposed DECISIONS (next free numbers after #75)

76. **Transitions are presets over a handful of shader families, all in the one compositor
    shader** (2026-10-17). A preset is a small TypeScript function from progress to a "look" per
    clip (`effects/transitions.ts`): geometry moves (scale, per-axis squeeze, rotation, shift
    around a pivot, outgoing-on-top), and uniform-driven families in `composite.wgsl` — masks
    (linear, clock, circle, diamond, box, blinds, checker, split, zigzag/wave, polar
    star/flower/hexagon/triangle, implicit heart, noise cells, luma, fan), warps (ripple, wave,
    swirl, pixelate, row glitch, bulge), blurs (disc, line, radial, spin — 13 taps), RGB split,
    a colour mix (dips, flashes, 3D shading) and a 3D turn (perspective in the vertex shader,
    perspective-correct varyings). Plus one optional full-canvas overlay layer above the main
    track and below every lane (dips, light leaks, film burn, flares, static). One pipeline per
    backend, no per-preset shaders, no extra render targets, nothing allocated per frame.
    Rejected: rendering both clips into two full-size targets and mixing them in a transition
    shader (2 × canvas-size textures = +16 MB at 1080p on phones and two extra passes); one shader
    per preset (pipeline count × 2 backends, compile stalls). Cost: the uniform block grew from 60
    to 104 floats (WebGPU slot 256 → 512 bytes) and the shader is longer; identity layers pay a few
    uniform compares.
77. **Transition options: `direction` and `ease` are optional, the file stays version 1**
    (2026-10-17). Old projects are valid as they are; a missing value = the preset's own default
    (its first `directions` entry / its `ease`). v0.1 ids `slide-left` / `slide-up` became the
    `push` preset with that direction (alias, still stored as written). `setTransition` keeps the
    existing direction/ease when the same preset is set again without them (a duration slider
    needn't repeat them), drops them when the preset changes, and clears them when passed
    `undefined` explicitly.
78. **Every transition starts on the untouched outgoing clip and ends on the untouched incoming
    one** (2026-10-17), tested for every preset and direction (no pop at the window edges), and no
    overlay is visible at either end. Pairs whose motion hides the switch swap with a short
    crossfade around the cut.
79. **Element animations are a state evaluated from the item's own time** (2026-10-17):
    `animationState(animation, localTime, duration, isText)` returns a move in the item's own box
    (scale / squash around a box pivot, rotation, shift), opacity, blur, local masks (wipe,
    circle), colour mix, RGB split and 3D turns, applied by the compositor in preview, capture and
    export alike. Exits are entrances played backwards (each exit names the entrance it mirrors),
    so they always match. Loops run from the item's start at `speed` 0.25–4 and stack under
    entrances/exits. Lane items only (main-track clips have transitions). Animated scale is
    geometry, never `transform.scale`, so text/emoji are not re-rasterised per frame.
80. **Entrance and exit lengths are clamped to the item; the slot being set wins** (2026-10-17).
    `setAnimation` snaps to frames, clamps to the item and shortens the other slot so they never
    overlap; trims and speed changes re-clamp (`clampFades`), and a split keeps the entrance on
    the first part and the exit on the second (both keep the loop). Playback clamps again
    defensively (`animationSpans`). Preset ids are unique across slots (`fade-in`, `fade-out`,
    `pulse`).
81. **Typewriter / word-by-word reveal is a mask over one raster** (2026-10-17). The text is
    rasterised once with a reveal layout (each character's and word's x per line, measured with
    the rasteriser's own maths); per frame the compositor turns the reveal fraction into "lines
    above L, and on line L everything left of cut A (+ the next word fading in up to cut B)"
    uniforms. Right-to-left text fills from the right. No per-frame rasterising; the background
    box reveals with the text.
82. **Filters: 115 parameter sets, 15 categories, three new pipeline stages** (2026-10-17):
    vibrance, hue rotation (YIQ) and film grain (per-pixel integer hash seeded by the frame
    number, so export grain matches preview). Same rules as #61 (identity skipped, intensity
    blends linearly). The 16 v0.1 filters keep their exact parameters.
83. **GPU hashing uses integers, not `sin`** (2026-10-17): noise masks, glitch bands and grain use
    a u32 hash so WebGPU and WebGL2 (and every GPU) produce the same pixels. Tint (Chrome WebGPU)
    is stricter than naga: e.g. `a * b ^ c` needs parentheses — naga validation alone isn't
    enough; the golden check catches it (WebGPU frames render black).
84. **The WebGPU video variant is derived at load time** (2026-10-17): `generated.ts` ships the
    WGSL once plus naga's GLSL; `render/shaders/external.ts` swaps in `texture_external` (two
    lines). Saves ~17 KB of the four-variant 82 KB.
85. **Low-tier preview blurs take half the taps** (2026-10-17): `Composer.cheapEffects` (preview
    composer on `tier: 'low'`) makes disc blurs use the outer ring (7 taps) and line / radial /
    spin blurs every other tap. ~30–35 % cheaper; export and capture always draw full quality
    (degrade quality, never smoothness).
86. **Catalogues are data only; the engine's tables are keyed by id** (2026-10-17). `presets.ts`
    holds ids, labels, categories, directions and default curves (what the UI needs); the filter
    numbers (`filters.ts`), transition looks (`transitions.ts`) and animation motion
    (`animations.ts`) live in engine-side modules keyed by those ids, with tests that every
    catalogue id has an implementation and vice versa (same order). Keeps the UI bundle's share at
    4.1 KB gzip instead of 11 KB.

## PERF (measurements, Mac M4, 2026-10-17)

**GPU draw cost per frame**, `node scripts/effects-bench.ts` (new; `/lab/engine?bench=1`): each
case at its midpoint on a 1080 × 1920 canvas — two full-screen photo layers + overlay, 60-frame
batches timed to a forced read-back, best of 3.

| case                        | Chrome WebGL2 | Chrome WebGPU | WebKit WebGL2 |
| --------------------------- | ------------: | ------------: | ------------: |
| one plain layer             |          0.42 |          0.24 |          0.30 |
| dissolve (2 layers)         |          0.55 |          0.47 |          0.55 |
| blur (disc, 13 taps × 2)    |          1.76 |          1.41 |          1.75 |
| zoom-blur (radial)          |          1.60 |          1.32 |          1.60 |
| spin-zoom                   |          1.98 |          1.77 |          1.98 |
| **spin-blur (heaviest)**    |      **2.12** |      **1.90** |      **2.12** |
| motion-blur / whip (line)   |     1.80–1.85 |          1.43 |     1.78–1.80 |
| swirl / ripple / lens       |     0.68–0.74 |     0.52–0.56 |     0.63–0.70 |
| vhs / glitch / rgb-split    |     0.33–0.79 |     0.25–0.63 |     0.30–0.75 |
| heart / star / checker      |     0.71–0.78 |     0.55–0.60 |     0.67–0.73 |
| noise / page-curl / cube    |     0.58–0.79 |     0.48–0.61 |     0.53–0.73 |
| light-leak / film-burn      |          0.90 |          0.72 |     0.83–0.87 |
| static (overlay + noise)    |          1.06 |          0.81 |          1.00 |
| animation blur, full screen |          0.91 |          0.69 |          0.87 |
| blur, low tier              |          1.23 |          0.95 |          1.18 |
| spin-blur, low tier         |          1.43 |          1.22 |          1.38 |
| motion-blur, low tier       |          1.21 |          0.99 |          1.17 |

(Firefox numbers came out lower than its 'none' baseline for some rows — its read-back doesn't
seem to wait for the GPU; not used.) The heaviest families are the 13-tap blurs (≈ 3–4 × a
dissolve); everything else costs ≤ 2 × a dissolve. A budget phone GPU is maybe 10–20 × slower
than the M4 but previews at ≤ 960 px (¼ of these pixels) with half-tap blurs: est. 5–8 ms for the
worst frame of a blur transition — **to be confirmed on a real low-end Android** (BACKLOG).

**Preview with the new demo** (`engine-check`, demo now has a light leak, a v0.1 slide, a cube,
a typewriter title, a popping / wiggling / spinning-out sticker, a sliding logo and a flipping
PIP): Chrome WebGPU and WebGL2 509/510 frames, 0 late, 0 skipped, draw 0.3 / 0.6 ms, 0 long
tasks; tier low the same (1 late at 0.03 s on WebGPU); Firefox 509/510, 0–9 late (one run had a
cluster at 0.5–0.7 s when the title and sticker first appear, the next run had none); Playwright
WebKit 498–509/510 with 8–9 late at the light-leak and slide cuts (two videos uploading — the
known test-build upload cost), one run with 22 audio underruns (the next had 0).

**Export** (`export-check`, 720p, same demo): Chrome MP4 3.65–3.72 ×, WebM 9.2 ×; WebKit 2.5 ×;
Firefox MP4 3.2 ×, WebM 0.74 × (known, BACKLOG). All ffprobe / full-decode / duration / lip-sync
checks pass. **Export = preview:** frames decoded from the files at a sticker pop-in + typewriter,
a logo slide-in, the light leak and the cube match the engine's own capture of that moment
(MP4 1.1–3.0 / 255 in all three browsers, WebM 1.7–7.7 / 255) against 8–44 / 255 for the
frame 0.25 s later.

**Golden frames** (`composite-check`, 3 browsers): 30 transition families at 30 % of the window
with lane overlays: overlays untouched on both backends; every transition changes the picture;
WebGPU vs WebGL2 worst 5.32 / 255 against a 4.18 decode baseline (bbb footage); Chrome vs
Firefox worst 4.99 / 255. Animations (typewriter, pop-in, spin loop, slide-in) at 0.3 / 0.5 /
1.5 / 2.25 s: WebGPU = WebGL2 (0.00 above baseline), typewriter monotonic, settled frames equal
the unanimated ones.

**Bundle:** shader source 22 → 65 KB raw in `generated.ts` (engine worker chunk; 82 KB before
deriving the WebGPU variant at load time). The catalogues the UI imports (`presets.ts`, minified +
gzip): 1.0 KB (v0.1) → 4.1 KB (115 filters, 76 transitions, 70 animations; 11 KB before the
data/engine split, #86).

## BACKLOG (new)

- [ ] Real-device pass of the effects library: iPhone (WebGPU) and a low-end Android (WebGL2):
      play the blur family (spin-blur, motion-blur, zoom-blur), the 3D family and a typewriter
      title; watch late frames and preview-quality drops. Tune `cheapEffects` / tap counts.
- [ ] The UI asks `filterPreviews` for every filter id (now 115 + none): ask per visible
      category / scroll position instead (each tile is one render + a bitmap).
- [ ] Owner's "Zoom zoomed my stickers" didn't reproduce in core at HEAD (golden check proves
      lanes are untouched); get a screen recording if it persists.
- [ ] Transitions over a letterboxed clip only warp/blur inside the clip's own box (a ripple
      doesn't spill into the letterbox; overlays like light leaks cover the whole canvas).
- [ ] Typewriter reveals the text's background box with the text; a "box first" option could be
      added if users want it.
- [ ] Animations are ignored on main-track clips (they have transitions). If the UI ever offers
      "animate the clip itself", decide how it combines with transitions.
- [ ] Glow loop is a pulsing light mix, not a halo outside the item's box.
- [ ] Spin blur computes cos/sin per tap (heaviest family): rotate incrementally if a device
      shows it.
- [ ] `TransitionPreset.ease` is a new required field (the preset's default curve) — the UI may
      show it as the default in an ease picker.

## PROGRESS entry (draft)

**2026-10-17 · Effects library (transitions, element animations, filters).** 76 transition
presets / 161 styles with direction + ease, built from parameterised families in the one
compositor shader (masks, warps, blurs, RGB split, colour mix, 3D turn) plus a full-canvas
overlay; 70 element animations (in / out / loop) for text, stickers and PIP incl. a typewriter
and word-by-word reveal; 115 filters in 15 categories with vibrance, hue and grain stages.
Schema stays version 1 (optional `direction`, `ease`, `animation`); new op `setAnimation`.
Transitions apply only to the main track (owner's zoom report) — proven by golden frames.
Low-tier preview halves blur taps. Checks: unit tests (372), golden frames for 30 transition
families + animations on both backends in Chrome / WebKit / Firefox, engine playback in three
browsers, export = preview frame comparisons, new `scripts/effects-bench.ts` (heaviest:
spin blur 2.1 ms WebGL2 / 1.9 ms WebGPU per 1080 × 1920 frame on an M4) and
`scripts/wgsl-check.ts` (compiles the WGSL with Chrome's Tint, stricter than naga).

## Notes for the UI engineer (API)

- `TRANSITION_PRESETS[i]`: `{ id, label, category, directions?, defaultDuration? (s), ease }`.
  Store `{ type: id, duration, direction?, ease? }` via `setTransition`. Directions mean the
  way the motion travels (`push` + `left` = the new clip comes in from the right moving left);
  `split` / `barn-doors` use `left` = opens sideways, `up` = opens vertically. `clock` / `spin-*`
  / `rotate` / `swirl`: `right` = clockwise.
- `findTransitionPreset(type)` resolves v0.1 ids (`slide-left`, `slide-up` → `push`); use it for
  labels instead of `TRANSITION_PRESETS.find`.
- `ANIMATION_PRESETS[i]`: `{ id, label, slot, category, textOnly?, defaultDuration? (s) }` — ids
  are unique across slots. `setAnimation(project, itemId, 'in' | 'out', { type, duration })`,
  `setAnimation(project, itemId, 'loop', { type, speed? })`, `null` clears a slot. Throws an
  `EditError` on main-track items and audio.
- `FILTER_PRESETS[i].category` + `FILTER_CATEGORIES` (`{ id, label }`).
- To preview a transition: play from just before the window (as today). To preview an
  animation: seek/play the item's first second.
