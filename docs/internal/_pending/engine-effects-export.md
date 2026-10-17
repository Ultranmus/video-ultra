# Pending: engine effects + export (Day 5 · 3.8–3.10, Day 6 · 4.1)

Written by the engine session on branch `worktree-agent-a7f847abb6ae102ff` for the coordinator to
merge into DECISIONS / PERF / BACKLOG / PROGRESS / PLAN. Nothing here edits those files directly.

## DECISIONS (new entries)

45. **One colour pipeline for every filter and adjustment** (2026-10-17). The shader runs a fixed
    chain — sharpen → HDR correction → gain → highlights/shadows → contrast → lift → saturation →
    split toning → mono tint → output levels → vignette — from 8 vec4 uniforms per layer
    (`effects/colour.ts`, `writeEffects`). Filters are parameter tables (`FILTER_PARAMS`), blended
    from identity by intensity; adjustments stack on top. No per-filter shaders, no LUT textures,
    nothing allocated per frame. Identity parameters return the picture unchanged (the layer's
    effect block is skipped when identity). Rejected: one shader per filter (pipeline count × 2
    backends), 3D LUTs for v0.1 (texture uploads; LUTs come with the pro layer).
46. **Transitions are centred on the cut and drawn by the compositor** (2026-10-17).
    `activeLayers` returns both main-track clips inside the window with
    `transition: { type, progress, role }`; the outgoing clip keeps playing past its end and the
    incoming one starts early, clamped to the media that exists (edge frame held). Each preset is a
    small table of numbers per role (`effects/transitions.ts`: opacity, scale, shift, blur, wipe
    edge); "fade" goes through black with a full-canvas black layer above the main track. Lanes
    (text, stickers, PIP) are never affected. Transition length is clamped defensively to both
    neighbours. Audio is not crossfaded (cuts stay hard) — revisit if users ask.
47. **Blurred background = two cheap passes through a small render target** (2026-10-17). The
    main clip is drawn cover-fitted (×1.08) into a texture 1/8 (amount 0) … 1/32 (amount 1) of the
    canvas with a footprint-sized 13-tap blur (anti-aliased downscale), then scaled up over the
    canvas with a 1.4-texel 13-tap blur. Same maths on both backends (`render/backdrop.ts`). The
    background follows the clip that is mostly on screen during a transition and carries that
    clip's filter.
48. **Text and emoji are rasterised in the worker with OffscreenCanvas 2D** (2026-10-17), cached
    per item by (text, style, raster size) in a per-renderer `RasterCache` with a tier byte budget
    (24 / 48 / 96 MB); old rasters' GPU copies are released immediately. Preview rounds raster sizes
    to quarter-octave steps (re-rasterise only every ~19 % of zoom); export is exact. Canvas sources
    are uploaded un-premultiplied (straight alpha, #39). Units (agreed with the UI): font px =
    `size × canvasH × scale`; `letterSpacing` em; `lineHeight`, `outline.width`,
    `background.padding/radius` × font size; shadow blur/x/y in px at a 1080-px-tall canvas. Emoji
    stickers are a square that contain-fits the canvas at scale 1 (new stickers use 0.3); image
    stickers place like images. `measureTextBox` (core internal) is shared with the UI.
49. **Export renders offline through the same compositor, exact frames** (2026-10-17). A separate
    `Composer` (own decoders, own renderer on its own OffscreenCanvas) waits for every decoded frame
    (no "late" reuse), `CanvasSource` encodes with encoder backpressure, audio from the same
    `Mixer` at 48 kHz stereo is interleaved frame by frame and trimmed to exactly
    `frames / fps`. Clips that are done give back decoders and frames every 15 frames (flat memory).
    Preview pauses during export; `play()` is refused. Output: OPFS file (deleted when the next
    export starts or on cancel) or, without OPFS, fragmented MP4 in Blob parts / WebM in memory.
50. **Audio encoder priming is measured and compensated** (2026-10-17). Mediabunny writes no edit
    list, so AAC's priming (2112 samples on Apple/Chrome-mac, 1024 for the WASM fallback) made the
    sound ~44 ms late. Once per session the worker encodes a tone that starts at a known sample,
    decodes it back and measures the offset; the export then feeds the mixer from that many
    samples in. Measured: Chrome 2113, WebKit 2113, Firefox (WASM AAC) 1025 → sound lands on the
    cut within 0–3 ms in ffmpeg. Opus needs none (pre-skip 312 is in the OpusHead).
51. **Export resolution is named by the shorter side** (2026-10-17): `height: 720` gives 720 × 1280
    for 9:16 and 1280 × 720 for 16:9; the long side follows the project's aspect, even pixels.
    Tier caps: low 1080, mid 1440, high 2160 (`maxExportHeight`); `exportLimits(tier)` also asks the
    encoders (plain WebCodecs, main-thread safe) which heights work per format.
52. **Export renders with WebGL2 by default** (2026-10-17). With the real engine WebGPU and WebGL2
    export now run at the same speed on Chrome (mp4 1080p 2.5–2.8× vs 2.6–2.8×; webm 8.8–9.2× vs
    8.0–8.2×), so the Phase-0 "WebGPU capture 2× slower" gap is gone; WebGL2 stays the default
    because it is the path every device has (one encoder-capture path to tune). Switch with the
    internal `exportWithInfo(..., backend)` if a device proves otherwise.

## PERF (measurements, Mac M4, headless Playwright; newest first)

### 2026-10-17 · Effects + export

**Preview with effects** (`scripts/engine-check.ts`, demo now: 5 main clips with a filter, an
adjustment, dissolve + slide + wipe, PIP video, PNG, title with outline/box, emoji, blurred bg):

| Browser · path               | Frames    | Late | Skipped | Draw / frame (6–8 layers + blur bg) | Long tasks |
| ---------------------------- | --------- | ---- | ------- | ----------------------------------- | ---------- |
| Chrome · WebGPU              | 509 / 510 | 0    | 0       | 0.3 ms                              | 0          |
| Chrome · WebGL2              | 509 / 510 | 0    | 0       | 0.6 ms                              | 0          |
| Chrome · WebGL2, tier low    | 509 / 510 | 0    | 0       | 0.3 ms (2 decoders)                 | 0          |
| Firefox · WebGL2             | 510 / 510 | 1    | 2       | 3 ms                                | 0          |
| WebKit (Playwright) · WebGL2 | 510 / 510 | 9    | 10      | 7 ms (test-build upload cost)       | 0          |

A/V p95 1.5–1.7 ms Chrome, 6 ms Firefox, 15 ms WebKit. WebKit's late frames sit at the slide-left
transition (two videos uploading in the test build at ~8 ms each) and the known PIP cuts; tier
low in WebKit dropped preview quality to 0.5 and had one 242 ms A/V spike. CPU throttling via CDP
only slows the page, not the engine worker, so it doesn't imitate a budget phone (use `?tier=low`
plus a real device).

**Export** (`scripts/export-check.ts`, the 17 s demo, × real time = media seconds / wall seconds):

| Browser         | MP4 720p | WebM 720p | MP4 1080p                    | WebM 1080p | Storage |
| --------------- | -------- | --------- | ---------------------------- | ---------- | ------- |
| Chrome (WebGL2) | 3.5–3.7× | 8.6–9.4×  | 2.6–2.9× (first), 5.7× (2nd) | 7.9–8.2×   | OPFS    |
| Chrome (WebGPU) | 3.5×     | 12.8×     | 2.5–2.7×                     | 8.8–9.2×   | OPFS    |
| WebKit (PW)     | 2.5×     | 2.6×      | –                            | –          | memory  |
| Firefox         | 2.7×     | **0.71×** | –                            | –          | OPFS    |

The first H.264 export in a page session composes at ~6 ms/frame, later ones at ~0.5 ms (decoder
warm-up with the H.264 encoder running) — 136 s at 1080p: 4.4–5.5× real time. Per frame (1080p
Chrome): compose 0.5–6 ms, encoder wait 3–6 ms, audio mix 0.1 ms.

**Memory during export** (`--repeat 8 --memory`: 136 s, 4080 frames at 1080p, RSS of every process
of that Chrome): first export in a session +105–148 MB (warm-up), later exports flat (+15–19 MB
first → last third; −13 / −21 MB for WebM). 0 open VideoFrames after every export, 0 missing
layers. Before releasing finished clips during export (fixed) every clip kept its last 1080p frame.

**Every export verified** with ffprobe (`-count_frames`) + a full ffmpeg decode: 510 frames
(4080 for the long one), 720 × 1280 / 1080 × 1920, H.264 + AAC 48 kHz stereo or VP9 + Opus,
audio within one codec frame of the video (AAC 17.003–17.024 s, Opus 17.014–17.027 s for 17.000 s),
lip sync at the 14 s cut: MP4 0.0 ms (Chrome, Firefox) / 2.6 ms (WebKit); WebM 0–9 ms
(WebKit: 30 ms, see BACKLOG). Cancel → `AbortError` and no file left in OPFS.

**Golden frames** (`scripts/composite-check.ts`, `/lab/engine?golden=1` through `engine.capture`):
warm filter, contrast + saturation + vignette, dissolve midpoint, wipe midpoint, title text, blur
background — checked per backend; WebGPU vs WebGL2 differ by ≤ the browser's own decode
difference (Chrome: 1.1–2.5 / 255 vs a 2.1 baseline on the plain video; text 0.0–0.2), Chrome vs
WebKit 0.5 / 255. Passes in Chrome (both), WebKit and Firefox (WebGL2).

## BACKLOG

- [x] ~~Exported audio is ~0.05–0.1 s longer than video (AAC padding)~~ — audio trimmed to the
      video length and encoder priming compensated (DECISIONS #50).
- [x] ~~WebGPU export ~2× slower than WebGL2 export~~ — no longer with the real engine (#52).
- [x] ~~Engine: blur background, text and sticker layers, transitions~~ (Day 5).
- [ ] **Firefox WebM export is slower than real time** (VP9 software encoder, 0.71× at 720p;
      encoder wait 39 ms/frame). Try VP8 on Firefox, or steer Firefox users to MP4 (2.7×).
- [ ] WebM/Opus lip sync in Playwright WebKit is 30 ms late in ffmpeg: WebKit's Opus chunk
      timestamps jitter (0, 33, 53, 67 ms … instead of 20 ms steps) and the muxer keeps them. Check
      in real Safari; if real, rewrite audio packet timestamps from the sample count.
- [ ] Chrome WebM: sound 9 ms late in ffmpeg (below the ~40 ms threshold) — the Opus pre-skip is in
      the header; find the remaining 6–9 ms.
- [ ] First H.264 export in a page session composes ~10× slower per frame than later ones (still
      2.6× real time at 1080p). Find out why (decoder warm-up with the encoder active?); maybe
      warm up with a 1-frame encode when the export sheet opens.
- [ ] WebKit (Playwright) late frames inside slide transitions (two video uploads per frame in the
      test build). Check on the iPhone.
- [ ] Export memory: first export in a session grows ~100–150 MB before it plateaus. Check on a
      phone that this warm-up fits (low tier).
- [ ] Export in a background tab: not tested (workers keep running, but some browsers throttle
      them); consider a Wake Lock / "keep this tab open" hint in the export sheet.
- [ ] Export when the WebM memory fallback is used keeps the whole file in memory (BufferTarget)
      — only Safari Private Browsing / Playwright WebKit. MP4's fallback is append-only Blob parts.
- [ ] OPFS export files are deleted only when the next export starts (or on cancel). If the host
      never exports again the last file stays; add `engine.clearExports()` or delete on startup
      (needs care: the host may still hold the Blob).
- [ ] MP4 is written with moov at the end when streaming to OPFS (fast start needs the whole file
      in memory or `fastStart: 'reserve'` with packet counts). Fine for downloads/sharing; check
      upload targets that need fast start.
- [ ] Same `quality: 'medium'`, very different file sizes: the 17 s 720p MP4 is 2.9 MB (Chrome),
      3.2 MB (WebKit), 13.4 MB (Firefox). Set explicit bitrates per resolution × quality instead
      of Mediabunny's relative quality (joins the existing WebKit file-size item).
- [ ] Text wraps only at explicit line breaks (no automatic width/wrap box yet).
- [ ] Sharpen is an unsharp mask at 1.5 source texels — mostly invisible when the source is much
      larger than the preview; scale the tap distance with the on-screen size if users notice.
- [ ] Blur transition uses a 13-tap disc on the full-size frame: at full strength rings can show
      on high-contrast edges. Use the backdrop's downscale path if it looks bad on real footage.
- [ ] Transitions are not crossfaded in audio.
- [ ] Image stickers that are animated GIFs show the first frame only.

## PROGRESS (entry)

**2026-10-17 · Engine effects + export (Day 5 · 3.8–3.10 engine side, Day 6 · 4.1)** — branch
`worktree-agent-a7f847abb6ae102ff`.

- Colour pipeline in the one WGSL shader (both backends via naga): 16 filters, 9 adjustments,
  vignette, sharpen; disc blur + wipe mask for transitions; blurred background through a small
  render target.
- Public catalogues: `FILTER_PRESETS`, `TRANSITION_PRESETS`, `ADJUST_KEYS`, `STICKER_EMOJI`,
  `FONT_PRESETS`; export helpers `maxExportHeight`, `exportLimits`, `exportSize`,
  `EXPORT_HEIGHTS`; types `ExportOptions`, `ExportProgress`, `ExportResult`, `ExportHeight`,
  `ExportLimits`.
- Timeline transitions (centred windows, out/in roles, extended media, prefetch spans) + tests.
- `Composer` (engine/compose.ts) shared by preview, `engine.capture` and export: filters,
  transitions, fade through black, blur background, text and emoji/image stickers with a raster
  cache; `measureTextBox` shared with the UI.
- `engine.export(options, onProgress, signal)`: offline exact render, MP4 (H.264 + AAC, WASM AAC
  fallback) / WebM (VP9→VP8 + Opus), 48 kHz stereo mixer audio trimmed to the video, encoder
  priming compensated, OPFS streaming + memory fallback, backpressure, cancel, ~4 Hz progress,
  preview paused.
- Lab: demo has a filter, an adjustment, dissolve / slide / wipe, a title, an emoji, blurred
  background, an Export button; `?golden=1`, `?tier=low`, `?repeat=N`, `?bg=color`.
- Checks: composite-check covers effects on both backends (Chrome, WebKit, Firefox);
  new `scripts/export-check.ts` (ffprobe + ffmpeg decode, lip sync, cancel, memory with
  `--memory`); engine-check takes `--tier` and Firefox; `PLAYGROUND=` env sets the URL.

## PLAN

- Day 5: 3.8 (background blur), 3.9 (filters, adjustments, transitions), 3.10 (text, stickers)
  — engine side done; UI side with the UI session.
- Day 6: 4.1 export — engine side done (resolution / fps / quality, progress, cancel, streaming to
  disk, tier limits); background-tab handling still open.
