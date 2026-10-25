# video-ultra — Decision Log

Each entry: what we decided, why, and what we rejected. Don't re-open a decision without a new
reason; when one changes, edit the entry and note the date.

## Product

1. **A free, MIT-licensed npm package, not an app** (2026-10-17). Developers drop
   `<VideoEditor />` into their React / Next.js app, like image-ultra. A demo site on the owner's
   domain is built on top of the package. Goal: a free alternative to paid video editor SDKs.
2. **Experience = three layers** (2026-10-17): (a) InShot-like simplicity — mobile-first,
   contextual bottom toolbar, main track + layer lanes; (b) Canva's _video_ features — templates,
   scenes, text/element animations, elements, brand kit, magic resize (not presentations,
   documents, whiteboards, print or comments); (c) pro NLE tools — multi-track, ripple/roll/slip/
   slide, keyframes + graph editor, masks, blend modes, chroma key, LUTs, scopes, pro audio.
   Pro features stay hidden until wanted (progressive disclosure) and behind feature flags.
3. **Full scope, staged releases** (2026-10-17). Nothing is cut; it ships in order: v0.1 InShot
   layer (week 1, production quality), v0.2 + Canva layer, v0.3 + pro layer, v0.4 AI + 1.0
   hardening. Real users find bugs that tests can't, so early releases make the end result stabler.
4. **Single user per project, no real-time collaboration** (2026-10-17). Removes sync engines
   and servers entirely.
5. **No server rendering** (2026-10-17). Export happens in the browser. A headless, in-browser
   `renderVideo(project)` is still offered.
6. **Built from scratch** (2026-10-17). We don't copy code or assets from other editors and don't
   credit or mention them in the repo.
7. **Image clips get basic editing built in** (crop, rotate, filters, adjustments, masks, border,
   animation). image-ultra becomes an optional, lazy-loaded "Advanced edit" later (v0.3).

## Devices

8. **Minimum: iOS 17+, Android ~2020+ (current Chrome), current desktop Chrome/Edge/Safari/
   Firefox** (2026-10-17). These all have WebCodecs and WebGL2 in workers. Devices without WebGL2
   or WebCodecs get a clear "this device isn't supported" screen (and an `onUnsupported` hook) —
   no Canvas2D mode (see #12).
9. **Device tiers: high / mid / low** (2026-10-17). Low = ~3 GB RAM phones. Each tier sets preview
   resolution, max export resolution, decoder count and cache budgets. Detected from
   `deviceMemory`, `hardwareConcurrency`, GPU and a short startup probe; overridable by the host.

## Engine

10. **TypeScript compositor in a worker, WebGPU first with WebGL2 at full parity**
    (2026-10-17). WebGPU gives zero-copy video frames (`importExternalTexture`), compute shaders
    and lower CPU overhead. But iOS 17–18, most budget Android phones and Firefox Android don't
    have it, so **WebGL2 is the path most of our audience runs** — we tune on it first.
    Shaders are written once in WGSL; GLSL ES 3.0 is generated at build time (naga). Golden-frame
    tests run on both backends. On WebGPU device loss, switch to WebGL2 without losing state.
11. **Rejected: Rust + wgpu compositor in WASM** (2026-10-17, owner agreed). The compositor's CPU
    work is tiny (a few draw calls per frame), so Rust gains little; wgpu on the web costs an extra
    texture copy per frame (no zero-copy external textures), adds ~0.5–1 MB+ WASM to download
    and compile (slow on budget phones), WASM memory never shrinks, and shipping WASM in an npm
    package adds bundler/CSP friction. Revisit only with measurements showing a win.
12. **Rejected: Canvas2D emergency renderer** (2026-10-17). A third backend with different
    capabilities means a third set of bugs; devices without WebGL2 almost never have WebCodecs
    either, so they couldn't edit video anyway.
13. **Rust → WASM only for small CPU-heavy modules** (2026-10-17): audio time-stretch / pitch,
    noise reduction, waveform peaks for very long files. Each lazy-loaded, tens of KB, and only
    after measuring that TS is too slow.
14. **Media I/O: WebCodecs + Mediabunny** (MPL-2.0, fine as a dependency of an MIT package)
    (2026-10-17). Hardware decode/encode, reads MP4/MOV/WebM/MKV/MP3/WAV/…, writes MP4/WebM,
    reads only the byte ranges it needs. Rejected: ffmpeg.wasm (≈30 MB, slow, needs
    cross-origin isolation).
15. **Proxies only on demand** (2026-10-17). Creating a proxy re-encodes the whole file (battery,
    time, storage). We create one only for clips the current device can't play smoothly.
16. **Audio: Web Audio + AudioWorklet; the audio clock is the master clock** (2026-10-17).
    `OfflineAudioContext` mixdown for export.
17. **No `SharedArrayBuffer` / cross-origin isolation** (2026-10-17). Host apps usually can't set
    COOP/COEP headers. Worker communication uses transferable objects and `MessagePort`s.

## State & storage

18. **Zustand + Immer; edits are an operation log** (2026-10-17). Immer patches are appended to a
    log in OPFS with periodic snapshots → near-free autosave, crash recovery by replay, and undo/
    redo from the same mechanism. Drags keep transient state locally and commit one op on release.
19. **Storage: OPFS, plus file handles on Chromium desktop** (2026-10-17). With the File System
    Access API we keep a handle to the user's original file instead of copying it. Elsewhere,
    media is copied into OPFS. We call `navigator.storage.persist()`; Safari can still evict
    storage after ~7 days without a visit, so **the host's `onSave` is the durable save** and the
    UI warns when storage isn't persistent.
20. **Project JSON validated with Zod and versioned with migrations** (2026-10-17).

## Packaging

21. **Packages: `@video-ultra/core` (engine, no React), `@video-ultra/react` (`<VideoEditor />`
    - headless hooks), `@video-ultra/ai` later** (2026-10-17). Headless hooks let developers build
      their own UI on the engine. AI is a separate package so the core stays small. Names are free on
      npm; the owner creates the `@video-ultra` org.
22. **ESM only** (2026-10-17). Bundler (tsup vs tsdown vs Vite library mode) is chosen in Phase 0
    by testing that the engine worker loads in Next.js, Vite and React Router apps.
23. **TypeScript 6.0.x, not 7** (2026-10-17). TS 7 (native compiler) is out, but declaration
    bundling and typescript-eslint support aren't proven yet. Same as image-ultra.

## UI

24. **Same theming system as image-ultra, own layout** (2026-10-17). Same plum brand, token
    names (prefix `--vu-`), `@layer` + `revert-layer` guard, `themeOverrides` API. Layout is built
    for video: InShot-style on phones, panel + stage + inspector + timeline on desktop. Rejected:
    Tailwind + shadcn — a package's styles must not clash with the host app's CSS.
25. **Timeline drawn on a canvas with an accessible DOM layer** (2026-10-17). DOM-per-clip
    timelines slow down with hundreds of clips; the hidden DOM layer gives keyboard and screen
    reader access.

## Real-world media (v0.1 must handle)

26. **iPhone HDR (HLG / Dolby Vision HEVC)** is tone-mapped to SDR in the shader; **HEVC** support
    is checked per device with a clear message when missing; **HEIC** photos decode via a
    lazy-loaded WASM decoder on browsers without native support; **rotation metadata** is applied;
    **variable frame rate** uses real timestamps; odd audio (mono, no audio, unusual sample rates)
    is normalised in the mixer; unsupported/corrupt files fail per file with a clear message.

## Phase 0 findings (2026-10-17)

27. **Export target: OPFS first, in-memory fallback.** OPFS streams the file to disk in constant
    memory. Where OPFS is missing (Safari Private Browsing, some webviews), we write a fragmented
    MP4 append-only into Blob parts instead of failing.
28. **AAC everywhere via a lazy WASM fallback.** Firefox has no native AAC encoder. We load
    `@mediabunny/aac-encoder` (MPL-2.0; FFmpeg's AAC encoder in WASM) only when
    `canEncodeAudio('aac')` is false and only at export — other browsers never download it.
    Rejected: Opus-in-MP4 (social apps and older players reject it).
29. **Export audio is always 48 kHz stereo.** Encoders reject odd layouts (e.g. mono 22.05 kHz);
    the mixer/encoder normalises.
30. **Capability detection uses plain WebCodecs `isConfigSupported`, no media library** — keeps the
    main-thread bundle small (Mediabunny only loads inside the worker).
31. **Worker packaging:** the worker ships as its own file next to the code that loads it
    (`new Worker(new URL('./x.worker.js', import.meta.url), { type: 'module' })`). Verified in
    Next.js 16 (Turbopack dev + build) and Vite 8 (dev + build) across Chrome, WebKit, Firefox.
32. **CI runs manually until v0.1** (owner, 2026-10-17). The GitHub Actions workflow only runs
    from the Actions tab ("Run workflow"); `pnpm verify` runs locally before every commit instead.
    Restore the push / pull-request triggers before the v0.1 release (PLAN Day 7).
33. **HDR: correct the browser's own conversion, keep zero-copy** (2026-10-17, research in
    `research/HDR.md`). Hardware-decoded frames are opaque (no raw 10-bit access), and every
    browser converts HDR → SDR itself, too bright. A per-path correction (tone-curve LUT + 3×3
    matrix) in the shader brings every path to Apple's look (held-out error 30–72 → 11 / 255).
    Calibrations are measured per engine + GPU path and shipped (`render/hdr-calibration.ts`).
    Rejected: raw-plane tone mapping (impossible with hardware decode), software decoding for HDR
    (too slow for 4K60 on phones), startup self-calibration with a synthetic frame (synthetic frames
    convert differently from decoded ones on Chrome WebGL2; WebKit can't build them).
34. **Preview decoding goes through Mediabunny's iterators, not a hand-driven `VideoDecoder`**
    (2026-10-17). A direct-decoder version was fast in Chrome but produced no frames for iPhone
    HEVC in Safari: Mediabunny carries per-browser/codec workarounds (HEVC RASL pictures, Chromium
    packet fixes, WebKit timestamps). `FrameSource` adds continuation, latest-wins, previews,
    watchdog and pooling on top of `VideoSampleSink.samples()`.
35. **Shaders: one WGSL source, generated GLSL committed** (2026-10-17). `pnpm shaders` turns
    `render/shaders/*.wgsl` into the WebGPU variant (frame as `texture_external`) and WebGL2 GLSL
    ES 3.0 via naga (`--keep-coordinate-space`: we draw straight to the canvas). `generated.ts` is
    committed so building never needs Rust; `pnpm verify` checks it's fresh when naga is installed.
36. **WebGL2: HDR frames always upload with `texImage2D`** (2026-10-17). Chrome converts HDR video
    differently in `texSubImage2D`; WebKit doesn't. SDR frames keep the in-place update.
37. **HDR is decided per track, not per frame** (2026-10-17, owner's iPhone). Safari on iOS labels
    decoded HLG frames as sRGB (`iec61966-2-1`), so a per-frame check never switched the correction
    on. The track's colour space from the container decides (`FramePlacement.hdr`); a frame that
    says HLG is corrected too.
38. **iOS devices are at least "mid" tier** (2026-10-17). Safari reports a fixed low core count and
    no memory size; the owner's iPhone plays 4K60 HDR smoothly.
39. **Image layers use straight (non-premultiplied) alpha** (2026-10-17). WebGL ignores its unpack
    flags for ImageBitmaps, so a premultiplied bitmap got its transparency applied twice on the
    WebGL2 backend (a 90% purple square came out 103 instead of 115). Bitmaps are created with
    `premultiplyAlpha: 'none'`; the golden composite check (`scripts/composite-check.ts`) asserts
    the exact blend on every backend.
40. **Engine timing rules** (2026-10-17). (a) While playing, a layer whose frame isn't decoded by
    80% of the frame time reuses its previous picture — playback never waits. (b) Paused seeks draw
    what's ready within 60 ms, then redraw when the exact frames arrive (unless a newer seek came).
    (c) Play pre-rolls: the first frame is decoded before the clock starts (≤ 500 ms). (d) Only one
    render is ever in flight (play waits for the paused-preview loop to stop). (e) The display may
    tick faster than the project; only new project frames are drawn.
41. **Idle clips give back their decoder and frame** (2026-10-17): anything not on screen or within
    a few seconds of the playhead (2 s back, 3 s ahead) releases them — memory stays flat on long
    timelines.
42. **Frames are borrowed only synchronously** (2026-10-17). Temporary `VideoFrame`s for drawing
    are created right before `render()` with no `await` in between; a late frame arriving during
    gathering could otherwise close the picture underneath (seen as "detached" in WebKit).
43. **Audio path: worker mixer → MessagePort → AudioWorklet; audio is the master clock**
    (2026-10-17). The engine worker mixes (`audio/mixer.ts`: per-clip readers, seamless linear
    resampling, click-free gain ramps, soft limiter) and sends 2048-frame stereo blocks straight to
    the AudioWorklet over a transferred MessagePort (no SharedArrayBuffer, main thread untouched).
    The worklet reports frames played every ~21 ms; video shows what's audible (played − output
    latency, extrapolated, never past what's queued). The same mixer will produce export audio.
44. **The AudioContext is created while the engine loads, resumed inside the Play tap**
    (2026-10-17). Creating it + loading the worklet took 110–139 ms of main-thread time in Chrome
    when done inside the tap; a context created without a gesture starts suspended, and `resume()`
    in the tap is cheap and satisfies iOS Safari's gesture rule.

## Editor UI (Day 4–5)

45. **A plain-TypeScript controller owns the editor; React only selects slices** (2026-10-17).
    `EditorController` (packages/react) holds the core editor (project + undo), the engine, the
    media analyzer, storage, a small Zustand UI store and the `Playhead` (a plain observable, not
    React state). Components subscribe to the slice they show; the timecode, timeline and stage
    overlay follow the playhead through subscriptions, so nothing re-renders per frame. The timeline
    is an imperative canvas view (`timeline/view.ts`) with its own redraw-per-frame scheduling.
    Rejected: playhead in React state (renders 60×/s), a DOM node per clip (#25).
46. **The controller is restartable** (2026-10-17). `start()` / `stop()` with a generation counter;
    async work from an older start backs out. React strict mode (dev) unmounts and remounts once —
    a one-shot `destroy()` on unmount killed the engine of the real mount.
47. **Drags and sliders preview without touching the store** (2026-10-17). `controller.preview()`
    applies the edit to an Immer draft and sends the result to the engine (coalesced per frame); the
    timeline draws the same ghost. Release commits exactly one operation. Sliders preview on `input`
    and commit on the native `change` event (pointer release or one keyboard step, coalesced into one
    undo step).
48. **Phone timeline: a drag scrubs, a long-press lifts** (2026-10-17). With the playhead fixed in
    the centre, a plain horizontal drag scrolls the film strip (= seeks, with a short fling); a
    long-press (350 ms, haptic tick) lifts a clip to reorder (main track) or move (lanes). Trim
    handles of the selected clip drag at once. Desktop: dragging a clip moves it immediately;
    dragging the ruler or empty space scrubs.
49. **The playhead spine uses the accent colour** (2026-10-17). UI_VISION §8 (approved with the
    owner's go-ahead for Days 4–6) — `--vu-playhead` is `var(--vu-accent)` in both themes.
50. **"Storage may be cleared" is a one-time notice after the first edit** (2026-10-17), not a
    permanent banner: shown once per browser (remembered in localStorage) when
    `storage.persist()` is refused. A banner over an empty editor covered the controls.
51. **Keyboard shortcuts work after clicking the canvas** (2026-10-17): the editor root is
    focusable (`tabIndex=-1`) and takes focus on pointer-down outside controls. Space/K play,
    S split, Delete, ⌘/Ctrl Z / ⇧Z / Y, ⌘/Ctrl D duplicate, ←/→ frame (⇧ ×10), Home/End, Esc.
    Timeline clips in the accessible layer: ←/→ move (main: reorder), ⇧←/→ trim end, ⌥ = 1 s.
52. **`onReady(controller)` is public** (2026-10-17): hosts (and our tests) drive the editor
    programmatically — play, seek, `run(label, recipe)` with the core edit operations.

## Media analysis & storage (Day 4 · 3.3/3.4, Day 6 · 4.2)

53. **Media analysis runs in its own worker, not the engine worker** (2026-10-17). Thumbnail and
    waveform decoding must never take the engine's decoders or delay a preview frame, and gets its
    own tier budget (**low 1 decode job, else 2**). Cost: Mediabunny is loaded by two workers
    (one extra ~100 KB gz parse; a few MB of worker heap).
54. **Timeline thumbnails snap to the keyframe at or before the time** (2026-10-17, measured).
    One packet decode per thumbnail; requests that snap to the same keyframe + height share one
    decode. Measured 20-thumbnail strips (Chrome / WebKit / Firefox): 60 s 1080p 55–126 / 245 /
    72 ms vs exact 178 / 494 / 397 ms; long-GOP 4K 77 / 249 / 106 ms vs 697 / 1208 / 2016 ms;
    iPhone 4K60 HEVC 360 / 555 ms vs 874 / 1303 ms. `exact` mode stays available (cover frames).
    Decoding goes through Mediabunny `VideoSampleSink.samplesAtTimestamps` (one decoder per batch,
    keeps the per-browser workarounds of #34). Scaling happens in the worker: OffscreenCanvas 2D +
    `VideoSample.drawWithFit` (applies rotation) + `transferToImageBitmap`. `CanvasSink` would do
    the same decode + draw but hands out a canvas pool, not transferable bitmaps.
55. **Thumbnail scheduling: newest request first, batched per asset, abortable, byte-budgeted
    cache** (low 8 MB, mid 24 MB, high 48 MB of bitmaps). The caller owns every returned bitmap
    (the cache keeps its own copy). Watchdog 4 s per decode step.
56. **Waveforms: max |sample| over all channels per 10 ms bucket (100/s), capped at 262,144
    buckets (1 MB) per asset**; stream-decoded, never the whole PCM. A waveform job yields its
    decode slot to waiting thumbnails every 8 s of audio. Cached in memory and, through
    `WaveformCache`, in OPFS (`media/<id>.peaks`).
57. **Project files: `snapshot-<seq>.json` + `log-<seq>.jsonl`, never overwritten** (2026-10-17).
    OPFS has no atomic rename everywhere (`move()` is missing in older Safari/Firefox), so a new
    snapshot gets a new name and older snapshots/logs are deleted only after it is complete.
    Load = newest snapshot that parses + its log while seqs continue without a gap; a torn last
    line is ignored. Log entries store `patches` only (no `inverse`): undo history isn't restored
    after a crash. Seqs belong to the storage (the editor's restart at 1 per session).
58. **Every OPFS write goes through a storage worker using `createSyncAccessHandle`**
    (2026-10-17). It's the only OPFS write API on iOS 17/18 Safari (`createWritable` arrived in
    Safari 26) and keeps 1 GB copies off the main thread. Measured the same speed as main-thread
    `createWritable` (57 MB: 64 ms vs 64 ms Chrome, 56 vs 66 ms Firefox). Different files write in
    parallel (a big import doesn't hold up autosave); a locked file is retried briefly.
59. **Memory fallback, and OPFS is only given up after a retried probe** (2026-10-17). Falling
    back silently loses work on reload: in dev (strict mode) two storages probing one file made
    Firefox fall back once. Probe files are unique; both lock errors (`NoModificationAllowedError`,
    Firefox `InvalidStateError`) retry. `putMedia` checks `estimate()` first and maps
    `QuotaExceededError` to `StorageFullError`; a failed log append is reported and closed by a
    snapshot ~1 s later.
60. **Autosave makes the editor's project the saved state at attach** (fresh snapshot), batches
    log writes every 250 ms, snapshots every 200 entries / 5 s idle / tab hidden / pagehide /
    1 s after a rename, and calls `onSave` 1 s after the last edit. `listProjects` reads names
    from `meta.json` (written after each snapshot) and only lists projects whose first snapshot
    completed.

## Effects & export (Day 5 · 3.8–3.10, Day 6 · 4.1)

61. **One colour pipeline for every filter and adjustment** (2026-10-17). The shader runs a fixed
    chain — sharpen → HDR correction → gain → highlights/shadows → contrast → lift → saturation →
    split toning → mono tint → output levels → vignette — from 8 vec4 uniforms per layer
    (`effects/colour.ts`, `writeEffects`). Filters are parameter tables (`FILTER_PARAMS`), blended
    from identity by intensity; adjustments stack on top. No per-filter shaders, no LUT textures,
    nothing allocated per frame. Identity parameters return the picture unchanged (the layer's
    effect block is skipped when identity). Rejected: one shader per filter (pipeline count × 2
    backends), 3D LUTs for v0.1 (texture uploads; LUTs come with the pro layer).
62. **Transitions are centred on the cut and drawn by the compositor** (2026-10-17).
    `activeLayers` returns both main-track clips inside the window with
    `transition: { type, progress, role }`; the outgoing clip keeps playing past its end and the
    incoming one starts early, clamped to the media that exists (edge frame held). Each preset is a
    small table of numbers per role (`effects/transitions.ts`: opacity, scale, shift, blur, wipe
    edge); "fade" goes through black with a full-canvas black layer above the main track. Lanes
    (text, stickers, PIP) are never affected. Transition length is clamped defensively to both
    neighbours. Audio is not crossfaded (cuts stay hard) — revisit if users ask.
63. **Blurred background = two cheap passes through a small render target** (2026-10-17). The
    main clip is drawn cover-fitted (×1.08) into a texture 1/8 (amount 0) … 1/32 (amount 1) of the
    canvas with a footprint-sized 13-tap blur (anti-aliased downscale), then scaled up over the
    canvas with a 1.4-texel 13-tap blur. Same maths on both backends (`render/backdrop.ts`). The
    background follows the clip that is mostly on screen during a transition and carries that
    clip's filter.
64. **Text and emoji are rasterised in the worker with OffscreenCanvas 2D** (2026-10-17), cached
    per item by (text, style, raster size) in a per-renderer `RasterCache` with a tier byte budget
    (24 / 48 / 96 MB); old rasters' GPU copies are released immediately. Preview rounds raster sizes
    to quarter-octave steps (re-rasterise only every ~19 % of zoom); export is exact. Canvas sources
    are uploaded un-premultiplied (straight alpha, #39). Units (agreed with the UI): font px =
    `size × canvasH × scale`; `letterSpacing` em; `lineHeight`, `outline.width`,
    `background.padding/radius` × font size; shadow blur/x/y in px at a 1080-px-tall canvas. Emoji
    stickers are a square that contain-fits the canvas at scale 1 (new stickers use 0.3); image
    stickers place like images. `measureTextBox` (core internal) is shared with the UI.
65. **Export renders offline through the same compositor, exact frames** (2026-10-17). A separate
    `Composer` (own decoders, own renderer on its own OffscreenCanvas) waits for every decoded frame
    (no "late" reuse), `CanvasSource` encodes with encoder backpressure, audio from the same
    `Mixer` at 48 kHz stereo is interleaved frame by frame and trimmed to exactly
    `frames / fps`. Clips that are done give back decoders and frames every 15 frames (flat memory).
    Preview pauses during export; `play()` is refused. Output: OPFS file (deleted when the next
    export starts or on cancel) or, without OPFS, fragmented MP4 in Blob parts / WebM in memory.
66. **Audio encoder priming is measured and compensated** (2026-10-17). Mediabunny writes no edit
    list, so AAC's priming (2112 samples on Apple/Chrome-mac, 1024 for the WASM fallback) made the
    sound ~44 ms late. Once per session the worker encodes a tone that starts at a known sample,
    decodes it back and measures the offset; the export then feeds the mixer from that many
    samples in. Measured: Chrome 2113, WebKit 2113, Firefox (WASM AAC) 1025 → sound lands on the
    cut within 0–3 ms in ffmpeg. Opus needs none (pre-skip 312 is in the OpusHead).
67. **Export resolution is named by the shorter side** (2026-10-17): `height: 720` gives 720 × 1280
    for 9:16 and 1280 × 720 for 16:9; the long side follows the project's aspect, even pixels.
    Tier caps: low 1080, mid 1440, high 2160 (`maxExportHeight`); `exportLimits(tier)` also asks the
    encoders (plain WebCodecs, main-thread safe) which heights work per format.
68. **Export renders with WebGL2 by default** (2026-10-17). With the real engine WebGPU and WebGL2
    export now run at the same speed on Chrome (mp4 1080p 2.5–2.8× vs 2.6–2.8×; webm 8.8–9.2× vs
    8.0–8.2×), so the Phase-0 "WebGPU capture 2× slower" gap is gone; WebGL2 stays the default
    because it is the path every device has (one encoder-capture path to tune). Switch with the
    internal `exportWithInfo(..., backend)` if a device proves otherwise.

## Editor UI, second pass (owner review, 2026-10-17)

69. **The first UI was rejected; UI_VISION §9 holds the rules that replaced it** (2026-10-17).
    Tests passed but the experience failed a first-time user: no help, duplicated menus, actions
    that silently did nothing, jumpy drags, an empty-looking chrome. The fix is structural (one
    home per control, §9.1) and is now part of how UI work is checked (`scripts/ui-review.ts`).
70. **Phones/tablets use a dock over the timeline, not a floating sheet** (2026-10-17). The sheet
    sat over part of the timeline at a different height ("two boxes"), was hard to close and was
    cut off by the keyboard. The dock takes exactly the timeline's box and has a ✓ Done.
71. **Disabled-with-reason instead of hidden or silent** (2026-10-17). Buttons use
    `aria-disabled` (not `disabled`) so they stay hoverable and focusable and the tooltip can
    explain; `targets.ts` computes what each action would act on, re-rendering only when the
    answer changes (not per playhead frame).
72. **Filter thumbnails are rendered by the engine** (2026-10-17): `engine.filterPreviews()`
    decodes the clip's frame once and draws it with every filter through a small reused renderer
    (freed after 5 s idle). CSS filters were rejected — they don't match the real look.
73. **Preview mode replaces the fullscreen button** (2026-10-17). iPhone Safari has no element
    fullscreen, so the button did nothing there. Preview hides the editing chrome everywhere and
    also requests real fullscreen where the browser allows.
74. **Timecode shows tenths (`0:04.2`) with fixed-width digits** (2026-10-17). Hundredths
    flickered while playing; the ruler capsule is sized for the widest digits so it doesn't wobble.
75. **New stickers start upper right** (2026-10-17) so they don't land on a centred title.

## Effects library (owner request, 2026-10-17)

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

87. **Libraries the owner asked for, and where they come from** (2026-10-17): 146 text styles
    generated from the system font families × colour / outline / shadow / glow / box treatments
    (`library/textStyles.ts`, no font downloads); stickers = 1,852 3D stickers (MIT,
    `@lobehub/fluent-emoji-3d@1.1.0` from a pinned CDN, `stickerLibrary` prop to self-host or turn
    off — the same choice the owner made for image-ultra), all 1,923 Unicode emoji
    (emojibase-data, MIT, trimmed into a lazy chunk by `scripts/gen-emoji.ts`), 32 shape stickers
    drawn for video-ultra, and uploads. Placed 3D / shape stickers are stored in the project as
    image assets, so exports never depend on the CDN.
88. **Ruler sliders everywhere; one ruler per group** (2026-10-17): like image-ultra, a tick scale
    slides under a fixed marker. Adjust and Crop pick the setting with chips and show one ruler,
    instead of stacking nine sliders.
89. **Panels select their target, and keep themselves open while doing it** (2026-10-17):
    Filters / Transitions / Animate show "For …" and select the clip they change
    (`select(id, { keepPanel: true })`); picking a transition or an animation plays it once.
90. **A dropped lane clip never bounces back** (2026-10-17): it lands in the lane under it when
    that lane takes its kind and has room, else in a new lane right there (`moveItemToNewLane`),
    shown as a "New lane" band while dragging.
91. **Every user action becomes a command, before v0.3** (2026-10-17). One registry: stable id,
    translatable label, shortcut, an `enabled()` check that returns a plain reason when it's off
    ("Select a clip first"), and `run()` that dispatches the edit operation. Toolbar buttons,
    menus, keyboard shortcuts, the timeline's accessible layer, tests and the future
    `@video-ultra/ai` automation all go through it, so they can't drift apart, and disabled
    controls can say why. Done before v0.3 adds the pro tools, while the action list is still
    short. Commands are thin: they never replace the operation log (#18) as the source of truth.
92. **The playground exposes a test / debug API on `window`, never the package** (2026-10-17):
    `execute(commandId, params)`, `info()` (backend, WebCodecs support, tier, counters such as
    the frame-leak count) and `screenshot()`. Scripts drive the editor through it instead of
    clicking, and the owner can read `info()` on the phone. Plus URL flags to force a path:
    `?webgl`, `?nowebcodecs`, `?fresh` (no restored media), `?norecover`. Host apps never get a
    global.
93. **A fatal engine error shows a "stopped" screen, never a frozen editor** (2026-10-17). If the
    engine worker dies (uncaught error, out of memory) the editor replaces the stage with a
    translated message, the error text and a Reload button; crash recovery (#60) reopens the
    project after reload. Serves "never hangs": the user always sees what happened and a way out.

## Editor UI, round 4 (owner review, 2026-10-18)

94. ~~**Layers sit above the main track; sound below it**~~ — replaced by #100 (2026-10-18). The timeline shows picture
    and text lanes on top in front-to-back order (the top row is drawn in front), then the main
    track, then sound lanes. "Higher = in front" is how people picture layers. Track order in the
    project is unchanged (display only). A dashed "new layer" slot stays above every row, so
    there is always an obvious place to drop.
95. **A main clip dragged up becomes a layer; a layer picture dragged onto the main track joins
    the sequence** (2026-10-18). New core ops `moveMainToLane` / `moveLaneToMain`. A clip still
    at full-frame size shrinks to 60% (`LAYER_SCALE`) when lifted, so it reads as an element
    and its own animation / filter visibly apply to it alone (owner: "image over video, animation
    applied to the whole frame"). A toast with Undo says what happened.
96. **Picker previews are the engine's real output** (2026-10-18). Transition tiles: a still of
    clip A | clip B (a linear wipe at its midpoint) and, on hover / focus / while chosen, a
    12-frame flip-book of that preset on the real cut (`engine.transitionPreview`). Animation
    tiles: the selected element alone at rest and its 12-frame flip-book on hover
    (`engine.itemPreview`). Fetched on first hover, LRU of 12, all closed when the panel closes.
    CSS approximations per family were misleading (owner: "all look like fade") and are gone.
97. **Libraries scroll by category; the chip row follows** (2026-10-18). Filters, transitions,
    animations, text styles and stickers are one scrolling list with a small heading and divider
    per category; the sticky chip row highlights the category in view and jumps on tap. Filter
    previews load per section as it nears the view; off-screen sticker sections use
    `content-visibility`.
98. **13 timing curves** (2026-10-18): even, smooth, speed up, slow down, snappy, swift,
    overshoot, wind up, spring, elastic, bounce, slow-mo, stop-motion. Additive enum values, so
    old projects stay valid with no migration. Shown as tiles that draw their curve.
99. **Waveforms are filled envelopes scaled to the file's own peak** (2026-10-18), mirrored on
    sound clips and rising along the bottom of video clips that have sound. Replaces the dB bar
    chart that turned loud music into a solid block.
100.  **Rows are grouped, video first, and named** (owner choice, 2026-10-18, replaces #94): the
      main video, the "new layer" slot right under it, picture layers, text, then sound — the same
      order every time. Every row is named in the left column ("Video", "Layer", "Text", "Audio",
      numbered when there are several); on phones the name sits faintly at the row's left. With
      layers above the video the owner found the order confusing ("video in between").
101.  **Transitions also work between touching pictures on a layer** (2026-10-18). Two videos or
      photos on one layer that touch (one ends where the next starts — snapping makes it easy)
      can have a transition; it plays inside the clips' own box, so a picture-in-picture stays an
      element. Edits that pull them apart remove it (`tidyLaneTransitions`); the invariants allow
      it only where the clips touch. Text and stickers have entrance/exit animations instead.
102.  **Library panels follow the selection and say when it can't take the effect** (2026-10-18).
      Filters: the selected picture, else the main clip under the playhead, with a note when a
      text or sticker is selected. Transitions: the selected picture's own cut (main or layer),
      with "drag another clip right up against this one" when a layer clip has no neighbour.
      Picking a look selects the clip it changed.
103.  **One bottom sheet on phones and tablets** (owner, 2026-10-19). Every tool and library opens
      in the same sheet: the same height for all (460 px, capped to the room above the toolbar),
      a grab handle, drag down to close (a quarter of its height, or a flick), drag up to expand,
      a short drag springs back. It follows the finger through inline styles only (no React
      render per move). Replaces the timeline-sized dock and the separate "tall" library dock.
104.  **Text and stickers take filters and adjustments** (owner, 2026-10-19). Project file
      version 2: text and sticker items gain `filter` and `adjust`; migration 1 → 2 adds empty
      ones, so every older project opens unchanged otherwise. The compositor's colour stage runs
      for every item that has a look; filter previews show the element itself on a neutral grey.
105.  **One menu for all elements; the inspector is the detail view** (owner, 2026-10-19). The
      left Filters / Transitions act on whatever is selected (nothing selected: the clip under
      the playhead / the nearest cut). For a text, sticker or lone layer picture, Transitions
      shows how it appears and leaves (its In / Out / Loop animations) — the element's own
      transition. Clip-to-clip transitions stay for cuts.
106.  **While paused, the playhead belongs to the UI** (2026-10-19). The engine's echo of a seek
      arrives a frame late; applying it pulled a scrubbing phone timeline back and made it
      jitter. Engine time is applied only while playing and when playback stops.
107.  **The sheet moves only with `transform`** (owner: "not smooth", 2026-10-19). It is always
      full height (to the top of the editor) and pushed down to show its top 460 px; expanding,
      dragging, opening and closing (Done animates out too) only change `translateY`, so no
      layout runs per frame. It slides under the bottom tab bar (the tab bar stacks above it);
      the part pushed off-screen is body padding, so a list's end still scrolls into view.
108.  **No duplicate controls on desktop** (owner, 2026-10-19): Filters, Transitions and
      animations live only in the left menu; the inspector is the detail view (text, style,
      speed, sound, adjust, crop, opacity…). Phones keep them in the toolbar (no left menu there).
109.  **Nothing may scroll the editor itself** (2026-10-19). `.vu-root` uses `overflow: clip`, and
      the libraries scroll their own list and chip row by hand — `scrollIntoView` also scrolled the
      editor when part of the sheet was off-screen (the tab bar ended up mid-screen). The sheet's
      full height is measured (the editor is a width-only container, so `100cqh` meant the browser
      window, wrong whenever the editor is embedded in a smaller box).
110.  **No sound without a secure page, said plainly** (2026-10-19). Browsers only offer
      AudioWorklet on https / localhost; on `http://<LAN IP>` the engine reports
      `onAudioUnavailable('insecure')` and the editor shows a calm one-time note instead of a raw
      error. Phone testing with sound: `pnpm --filter playground dev:https` or a preview deploy.
111.  **WebM on Firefox uses VP8** (2026-10-19; owner asked for a recommendation earlier). Firefox's
      VP9 encoder is software-only: 0.70× real time at 720p. VP8 there runs at 2.6× (3.7× faster)
      for a larger file (7.5 vs 4.1 MB for 17 s). Every other browser keeps VP9 (smaller, fast).
112.  **Exports use explicit bitrates** (2026-10-19): bits per pixel per frame by quality (low 0.05,
      balanced 0.09, best 0.16; VP9 ×0.8, VP8 ×1.2), audio 96 / 128 / 192 kb/s. The browsers'
      own quality presets gave 2.9 / 3.2 / 13.4 MB for the same 17 s 720p MP4; now 5.4–5.5 MB
      everywhere. The export dialog's size estimate uses the same `exportBitrate()`.
113.  **Sound crossfades under picture transitions** (2026-10-19). At a cut with a transition the
      outgoing clip's sound runs on past the cut (as far as its media goes, at most the window's
      second half) fading out, and the incoming one starts early (as far as its media allows)
      fading in — equal power (sin / cos). With no spare media a side fades inside its own clip: a
      dip, never a hard cut. Pure maths in `audio/spans.ts` (tested); preview and export share it.
      The export check measures the fade's end to the millisecond (A/V offset ≤ 1 ms in MP4).
114.  **The stage view zooms** (UI_VISION §6, 2026-10-19). Two fingers with nothing selected (or
      Ctrl/⌘ + wheel / trackpad pinch on desktop) zoom the preview up to 500% around the fingers or
      pointer; one finger on empty stage pans while zoomed; a "Fit · N%" pill resets. It is CSS on
      the frame (the project never changes); the engine renders more pixels to stay sharp (never
      beyond the project's size); stage pointer maths uses the frame's on-screen size, so editing
      while zoomed is exact; handles and the outline keep their on-screen size.
115.  **Auto-captions: pluggable transcriber + optional on-device model, chosen for speed and
      efficiency** (owner, 2026-10-19). Core gets a caption track, SRT / VTT, caption rendering and
      a transcriber interface (audio in → timed words out). The default speech engine ships as a
      separate optional package (`@video-ultra/captions`): nothing downloads until the user taps
      "Auto captions" (a one-time, clearly sized download, then cached in OPFS); it runs in its
      own worker, WebGPU first, single-threaded WASM otherwise (no SharedArrayBuffer — CLAUDE.md);
      audio streams in 30 s chunks at 16 kHz mono so memory stays flat. Hosts may plug in any
      transcriber (a server is allowed — then privacy is the host's to state). Speed first: the
      smallest model that captions well; the A0 spike picks it from measurements (tiny multilingual
      vs an English-only fast model for English, Hindi accuracy checked). Low-tier phones get auto
      captions only through a host transcriber; import and typed captions work everywhere.
116.  **v0.2 adds layers & organising, built first; v0.2 ships as one test** (owner, 2026-10-19).
      Group E — command registry (6.0 pulled forward), History panel, Layers panel, lock (element
      - lane), multi-select + grouping — as in image-ultra. It comes before captions because it is
        shared plumbing (one action definition for menus, Layers, shortcuts, a11y; named history
        steps) and doesn't wait on the speech-model numbers. Video twist: a group moves together in
        time as well as on the stage. The owner tests all of v0.2 together at the end instead of
        per-checkpoint; the A0 phone measurements become part of that test, and desktop numbers set
        conservative device gating until then.
117.  **Layers & organising: how it works** (2026-10-19, v0.2 E). File version 3 adds optional
      `locked`, `hidden` and `groupId` on items (no other changes; v1/v2 files migrate as-is).
      **Lock** = selectable, not editable: every edit op refuses a locked item (`editable()`),
      except flags, rename and duplicate (the copy is unlocked). **Hide** = not drawn in preview
      or export (a video's sound still plays — mute is separate); hidden items are skipped by hit
      tests but listed in Layers. **Groups** are lane items only (main-track clips are a sequence);
      a group of one dissolves (`tidyGroups` after every lane change); a split member keeps both
      halves in the group; picking a member selects the group, double-click picks one member.
      A group moves together on the stage _and in time_ (`shiftItems`: each member keeps its lane
      when it fits). **Stacking** is lane order (later lanes draw on top): `arrangeItem` moves the
      element's lane, or the element alone into a new lane when its lane holds others; the main
      video is always at the back; "the stack" is what's on screen at the playhead. **History**
      shows the in-memory undo steps (`editor.history()` / `goTo`), each jump logged as undo/redo
      entries so autosave and crash recovery stay exact. **Commands** (`commands.ts`): one
      definition per action (label, icon, shortcut, disabled reason, run) — the timeline bar,
      phone toolbar, inspector, Arrange, context menu and keyboard all use it.
118.  **The phone sheet stays open when switching tools** (owner, 2026-10-19). Picking another
      tool or panel while the sheet is open swaps its contents with a 120 ms fade; it only slides
      in when it was closed. A close that is under way is cancelled if something else opens.
      The tab bar is solid; only its row of tools fades at the edges (the mask was making the bar
      itself see-through over the sheet).
119.  **File pickers open on touch release** (2026-10-19). Browsers only count a finger lifting
      (`pointerup`), not pressing, as a user activation for touch — the timeline's "+" opened
      nothing on iPhone because it fired on `pointerdown`. Mouse still opens on press.
120.  **Ducking is per item and computed in the mixer** (2026-10-19, v0.2 B1). `duck` (0…1) on a
      music / sound / video item lowers it under everything that isn't itself ducked, after gain,
      through a speech-band follower (150 Hz–4 kHz, 5 ms windows on timeline samples, −40…−30
      dBFS knee, 300 ms hold, 40 / 450 ms attack / release, per-sample ramps). Block-size
      independent and primed after a seek, so preview and export match (export-check: within
      0.2 dB). No look-ahead (the dip starts ~45 ms after the voice). Rejected: precomputed
      envelopes from the analyzer's peaks (main-thread data, not ready right after import).
121.  **The music & sounds library is a host slot; the editor ships no catalogue** (2026-10-19,
      v0.2 B2). `audioLibrary` (search / load with abort signals, categories, licence line).
      Added sounds become ordinary assets with `credit`. `createStarterSounds()` is an opt-in
      set of sound effects synthesised on the device from our own recipes (CC0, no files).
122.  **Picture tools are uniform-driven stages of the one compositor shader** (2026-10-19, v0.2 C).
      Green screen, LUT, blend modes and blurred areas extend the effect block (24 vec4, still one
      512-byte WebGPU slot) plus two bindings: a copy of the pixels under the layer and a 3D LUT.
      Layers that read what's underneath copy that rectangle mid-frame (WebGPU: end the pass,
      copy the canvas; WebGL2: `copyTexSubImage2D`) into one texture that grows in 256 px steps.
      Rejected: fixed-function blending (no overlay / soft light / difference); a render target
      per layer (memory). Blend = W3C separable formulas in gamma space, lane items only.
123.  **Green screen keys on BT.709 chroma distance**, ignoring brightness (shadows on the screen
      key out too); "Pick from video" renders the item alone, unkeyed, in the worker and averages
      5×5 px (the browser EyeDropper is Chrome-only and sees the keyed picture). **LUTs** are
      `lut` assets stored like media and parsed in the worker (2–65 points, 0–1 input); items
      keep `{ assetId, intensity }` — a 33-point file is ~1 MB, too big for project JSON.
      **Blurred / pixelated areas** are a `region` item kind on picture layers; sizes scale with
      the canvas so preview equals export.
124.  **Capture & export** (2026-10-19, v0.2 D, B3). Presets never letterbox: when the shape
      differs the dialog offers an undoable canvas change, else exports the project's shape. The
      part to export is optional `settings.exportRange` (I / O keys, a band on the ruler),
      clamped at export, never trimmed by edits. Sound only: M4A (AAC), Ogg (Opus — the standard
      Opus file, not WebM audio), WAV; encoder delay measured per codec and container. A frame
      picture renders at the project's size through the export renderer, encoded in the worker.
      The camera recorder covers the editor (a capture mode): MP4/H.264 preferred, pieces stream
      to storage, limits 10 / 20 / 30 min by tier (5 in memory), camera released during review.
      Editor shortcuts pause while the camera or export dialog is open.
125.  **Captions are text items on one caption row, with word times and one look** (2026-10-19,
      v0.2 A1). Track kind `caption` holds text items (so every text style, edit and the engine's
      text path apply) in time order; each caption may carry `words` (times relative to its
      start); the row carries `caption` (preset id, highlight mode and colour). Styles, place and
      size apply to all captions at once (`setCaptionLook`; dragging one moves them all). Text
      edits keep word times when the words still line up, else time is shared by word length.
      Split / trim / merge carry words along. SRT / VTT in and out (forgiving reader, strict
      writer). Captions wrap to a balanced `maxWidth` (86 % of the frame) — a new optional text
      field the selection box and the engine share. Burned in on export like any text; the
      subtitle file is a separate download. One caption row in v0.2 (languages: later).
126.  **Karaoke reuses the engine's two existing text paths** (v0.2 A6). `reveal` / `type`
      (words / letters appear as said) drive the typewriter reveal mask from the word times — no
      re-raster. `word` / `box` / `fill` (the word said changes colour, gets a box, or fills
      letter by letter) re-rasterise the caption once per state (cached per item; fill in
      half-letter steps). Box text switches to dark on a light box. Right-to-left captions show
      without the highlight for now (BACKLOG).
127.  **Our own lean Whisper runner on the ONNX runtime, not a general ML library** (2026-10-19,
      A0 spike, PERF.md "Captions"). The general library peaked at +1.1–2.0 GB in the tab for a
      41 MB model (it loads the WebGPU runtime build even for WebAssembly and keeps big
      transient buffers); a bare runtime session is lean. The runner: our log-mel (mixed-radix
      FFT, checked against the reference), greedy decoding with the merged decoder's cache and
      Whisper's suppression rules, a repetition guard, the decoder's full 444-token budget (Hindi
      needs it), and word times by DTW over the alignment heads' cross-attention. 9.7× real time
      for tiny vs 7.8× through the library, 3 % vs 5 % word errors. The worker closes after each
      job (WebAssembly memory never shrinks); model files stay in Cache Storage.
128.  **Which speech model where** (A0 measurements, supersedes the model guess in #115). English
      and other well-heard languages: `tiny` on WebAssembly (41 MB, ~10× real time on a laptop,
      2–3 % word errors incl. over music); `base` (77 MB) when the device reports ≥ 8 GB.
      WebGPU isn't faster for these (each token round-trips the GPU) and holds more memory.
      Hindi (and other Indic / Urdu): only `small` writes them properly — tiny translates to
      English, base writes Urdu script and loops — so they use `small` on WebGPU (~300 MB, about
      real time on a laptop) and aren't offered on devices without WebGPU unless the host plugs
      in a transcriber. Under 4 GB / 4 cores: no on-device captions (import / type still work).
      The speech the model hears leaves out music marked "Lower under voice".
129.  **Owner's iPhone report fixes** (2026-10-19). (a) Auto captions failed on iPhone with
      "Maximum call stack size exceeded": the tokenizer spread its 50 000-entry vocabulary into
      `Math.max(...)`, past Safari's argument limit — loops now (no large spreads in captions).
      (b) Hindi / Bangla / Urdu are offered on every capable device (amends #128): the larger
      model runs on WebAssembly where there's no WebGPU, and the panel says how long it takes
      (phone speeds estimated at a third of a laptop's); a reason shows as text, not only a
      tooltip. "Detect" switches to the larger model after the first window when it hears such a
      language. (c) The phone sheet's scroll area now ends where its visible part ends (a bottom
      margin, not padding) and its content swap is opacity-only — iOS scrolls every panel.
      (d) History spans the width under the top bar on phones; the Align submenu opens inline;
      menus re-clamp when they grow; popovers and menus sit above toasts. (e) The stage resets
      stale touch state when a new gesture starts (iOS can end a touch without telling us; the
      stuck finger made every later tap look like a second finger — no select, move, menu or
      deselect) and ends a gesture on lost pointer capture. (f) The selection outline is one
      accent line (the dark outer ring read as a black line).
130.  **Auto captions reject made-up text** (owner's iPhone test, 2026-10-19: "I don't know if you
      can speak English"). With no clear speech (quiet room, wind, ambient sound) every model
      wrote confident sentences. The sound path was ruled out first (what the model gets matches
      a reference decode: correlation 0.993–0.9999 on speech clips and iPhone footage). Guards,
      tuned on real iPhone recordings without speech vs. speech clips: (a) a window that's almost
      silent (< 4 % of 20 ms frames louder than −44 dBFS and 3× its noise floor) never reaches
      the model; words said where there was no sound are dropped; (b) a window is dropped when
      its average token log-probability < −1, or no-speech probability > 0.06 with log-probability
      < −0.6, or no-speech > 0.5 (speech measured ≤ 0.04 / ≥ −0.3, made-up text ≥ 0.08 /
      ≤ −0.75), or its words only repeat; (c) sound tags ("[music]") are dropped; (d) Detect only
      chooses among the languages the panel offers (on noise it drifted to Norwegian, Javanese,
      Korean). Result: every iPhone clip without speech now gives no captions in all three models;
      English (2–5 % WER) and Hindi (72 words) unchanged. Default model is now `base` (amends
      #128): it hears real recordings clearly better than `tiny`; `tiny` only where the device
      reports < 6 GB.

131.  **Speech runtime pinned exactly** (Vercel deploy failed, 2026-10-19). `onnxruntime-web` is
      pinned to `1.31.0-dev.20260914-8d85527a0`, the build every caption measurement and iPhone
      test ran on. The old `^1.30.0` range had resolved to that pre-release, which the range does
      not allow, so `pnpm install --frozen-lockfile` refused the lockfile. Move to the next
      stable release only after re-running the caption checks on it.

132.  **Large speech model: lean download and crash memory** (owner's iPhone: the tab died after
      the ~300 MB Hindi model downloaded, "A problem repeatedly occurred", 2026-10-19). (a) Model
      files stream straight into Cache Storage (`cache.put` with the response stream, progress
      counted in a TransformStream) and are read back once, just before their session is built —
      the old path held each file three times (chunks, joined copy, cache copy). Without Cache
      Storage, one buffer sized from Content-Length. (b) While a model is built and hears its
      first window, `video-ultra-captions-building` names it in localStorage; a page that dies
      there leaves it set, and the next visit records that setup as crashed (kept a week): the
      other runtime once (WebAssembly), else a smaller model when the language allows, else not
      offered, with "ran out of memory… try on a computer" — never a second crash. (c) On phones
      the panel says before starting that `small` may not fit (`TranscriberCheck.memoryRisk`).
      Measured on desktop Chrome (PERF.md "Captions"): `small` peaks at ~1.2 GB while it hears
      (the encoder's attention), so the download fix alone may not be enough on an iPhone. Tried
      and rejected: `graphOptimizationLevel: 'basic'` (wrong output), no arenas (no saving),
      4-bit encoder (no words) and 4-bit decoder (+500 MB).
133.  **Shape masks** (v0.3, file version 4). A picture (video, photo, freeze) can show only
      inside a shape, or only outside it (`mask: { shape, feather, invert? }`). Shapes are signed
      distance fields drawn in the compositor (one more `vec4` pair of uniforms; no textures, no
      memory), mirrored in TypeScript (`effects/shapes.ts`) for the picker tiles and tests; 126
      presets in 6 groups from 15 families (polygons, stars, rounded boxes, ellipse, squircle,
      heart, cross, ring, flower, cog, blob, crescent, arrow, bubble, cloud). Proportional shapes
      fit the picture's smaller side; `stretch` ones fill its box. Feather 0…1 = up to a quarter
      of the radius; one pixel of anti-aliasing from the layer's on-screen size. Masks apply on
      the main track too (the background shows outside). Golden frames: WebGL2 matches the
      TypeScript reference with 0.00 / 255 mean error (circle, inverted star, feathered heart on
      the main video); WebGPU runs the same WGSL (owner's Mac: composite-check). Uniform slot
      528 bytes → WebGPU slots 768. GLSL generated with naga 30.0.1.
134.  **Copy / paste** (⌘C / ⌘X / ⌘V; backlog). `pasteItems` places copies at the playhead with
      their spacing; groups stay groups (new group ids); clips copied from the main video go back
      into it after the clip under the playhead; media from another project comes with the copy.
      The clipboard is in memory, shared by every editor on the page (not the system clipboard —
      a project item isn't useful to other apps).
135.  **A mouse drag on the main video draws a selection box** (owner: "check grouping on canvas
      by cursor"). The main video fills the frame, so a drag almost always started on it and
      moved it off the canvas. While the main video isn't selected, a drag on it now draws the
      selection box (lane items only, as before) and a click selects it; once selected it drags.
      Touch is unchanged (a drag on the video still moves it: no box on phones).
136.  **High contrast and density** (v0.3). `contrast` ('normal' | 'high' | 'auto' — follows
      `prefers-contrast: more`) and `density` ('auto' | 'touch' | 'compact') on `<VideoEditor>`,
      as data attributes that redefine tokens only (THEMING.md). axe: 0 violations on every
      a11y-check page with high contrast, dark and light.
137.  **Release after v0.4** (owner, 2026-10-19): v0.1 isn't published on its own; v0.3 and v0.4
      are built first, then the Day 7 packaging and the owner's publish.
138.  **Animated and vector stickers** (v0.3). (a) GIF, animated WebP and APNG stickers and photos
      play: the engine worker opens them with WebCodecs `ImageDecoder`, times every frame once
      (each closed at once), then decodes only the frame on screen per item, by the item's own
      time (it loops) — one bitmap per item, the old one's GPU copy released when it changes, so
      memory stays flat for any length. No `ImageDecoder` (older Safari): the first frame, as
      before. Same time → same frame (exports are exact). (b) An **Animated** sticker tab: the
      611 Noto Emoji Animation emoji (Google, CC BY 4.0) that match our emoji list, shown as the
      device's own emoji glyphs (cheap); a tap fetches `<library><code>/512.webp` (~370 KB) and
      stores it in the project with the licence line on the asset. `animatedStickerLibrary` (a
      base URL or `false`) lets hosts self-host or hide it; default Google's public copy.
      (c) SVG files (upload, drop, sticker upload) are drawn once on import into a PNG of up to
      2048 px on the longest side, keeping their aspect (the engine worker can't decode SVG).
      Lottie files: not supported (needs a Lottie runtime; the animated WebP library covers the
      common case) — BACKLOG.
139.  **Templates** (v0.3). 192 templates = 32 layouts (titles & intros, name tags, quotes, social,
      sales & promos, steps & lists, events, vlog & recipes, endings) × 6 themes (Bold, Clean,
      Elegant, Neon, Retro, Playful: fonts, colours, boxes, shadows, entrance / exit). A template
      is styled, animated text and emoji elements with timing; texts hold `{variables}` the
      editor asks for (examples filled in) before adding — that is the "placeholders and text
      variables" of PLAN v0.3. `applyTemplate` (core) adds them at the playhead as lane items,
      grouped; empty texts are skipped. The tiles are CSS miniatures on the project's canvas shape
      (text sized with container units), not engine renders — cheap, and close enough to choose
      by. After adding, the playhead moves ~1 s in so the template shows (entrances start
      invisible). Media placeholders ("drop your clip here") are not in this round — BACKLOG.
      Headings in every library browser are `h3` now (they were `h4` under the panel's `h2`: an
      axe heading-order issue).
140.  **Background removal** (v0.3; photos and image stickers; video is v0.4). A
      `BackgroundRemover` interface in core (like the transcriber) and an on-device one in the new
      optional package `@video-ultra/ai`: a segmentation model in a worker (single-threaded
      WebAssembly, no cross-origin isolation), downloaded once into Cache Storage (streamed, as
      #132). Two Apache-2.0 models: `people` = MODNet 8-bit (6.6 MB, shorter side 512) and
      `objects` = ormbg / ISNet 8-bit (44 MB, 1024²). Measured (PERF.md): people 5 s / +260 MB,
      objects 15 s / +716 MB, both back to baseline after (the worker closes). So phones and
      tablets (coarse pointer) and devices under 4 GB use `people`; computers use `objects`
      (cleaner edges, any subject). The matte is scaled up by the canvas while it cuts the
      full-size photo (`destination-in`) — no full-size matte copy; results are capped at 4096 px.
      Non-destructive: the transparent PNG is a new image asset and the item gets
      `cutout: { assetId }` (file version 4); the engine draws it instead; Restore removes the
      field. Copy / paste carries the cutout asset.
141.  **Embedding API** (v0.3). `<VideoEditor customize={…} onEvent={…}>`: `hide` (built-in panel,
      tool and command ids — hidden commands leave menus and their shortcuts do nothing),
      `railOrder`, `panels` (the host's own left-menu panels, also phone add tools; rendered
      with the controller), `buttons` (top bar, before Export), `mediaSources` (search + load,
      shown in the Media panel, credit kept on the asset; like `audioLibrary`). Icons are one SVG
      path on a 24 × 24 grid (our stroke style). Events: `change` (with the undo label),
      `selection`, `playback`, `command`, `import`, `export` (start / done / cancelled / error),
      `panel` — also `controller.on(listener)`; a listener that throws never breaks the editor.
      Custom labels were already `labels`. Demo: playground `?embed=1`; embed-check covers it.
      The command registry (#91, #116) is what makes hiding consistent everywhere.
142.  **Keyframes and the graph editor** (v0.4, file version 4). Position (x, y), size, turn and
      opacity of any element with a place on the video (pictures — main video too — text,
      stickers, blurred areas) take keyframes: `item.keyframes[prop] = [{ t, v, ease? }]`, `t` in
      flicks from the item's start, `ease` the curve to the next one (the 13 named curves, or a
      cubic Bézier from the graph editor). Split and trim-from-start keep the whole list and add
      a `shift`, so each part plays its share of the motion **exactly** (re-sampling into new
      keyframes can't reproduce a curve that was cut in the middle — caught by a test). Editing:
      ◆ per group (position keys x and y together) with previous / next; while a property is
      keyframed, any change to it (stage drag, sliders, align, nudge) keys it at the playhead
      (`setTransformAt`); removing the last keyframe keeps its value. The engine samples into a
      per-slot copy (one object per edit, numbers rewritten per frame — no allocation per frame).
      Graph editor: SVG, drag a ◆ (time snaps to frames; one edit on release), tap a segment to
      pick its curve, "Custom" shows two Bézier handles. The timeline marks the selected clip's
      keyframes with small ◆. UI values follow the playhead only while paused (React never
      renders per frame). Text with keyframed size re-rasterises at most per quarter-octave in
      the preview (rasterSize), every frame in exports.
143.  **Fine trims and markers** (v0.4). Core: `rollEdit` (the cut between two touching clips moves;
      one longer, the other shorter — nothing else moves), `slipItem` (a video / sound shows
      another part of its media in the same place), `slideItem` (a main-video clip moves between
      its neighbours, which give and take the time). All clamp to the media both sides have and to
      one frame; keyframes follow (shift, #142). Desktop timeline: Alt-drag a trim handle = roll,
      Alt-drag a clip = slip (the media moves the other way, like grabbing the film), Alt+Shift-
      drag a main clip = slide; previews live, one edit on release. Every device: a **Fine trim**
      tool (slip slider, Move cut ◀ ▶, Slide ◀ ▶ a frame at a time). Markers:
      `project.markers` (file version 4); M adds one at the playhead (M on a marker removes it),
      `,` / `.` jump to the previous / next; flags on the ruler; scrubbing, trims and moves snap
      to them. Track lock already existed (v0.2 E).
144.  **More export codecs** (v0.4). `ExportOptions.videoCodec`: `auto` (as before: H.264 in MP4,
      VP9 / VP8 in WebM), `hevc` (MP4) and `av1` (MP4 or WebM), offered in the export dialog only
      at sizes this device's encoder accepts (`ExportLimits.hevc / av1`, probed with
      `isConfigSupported`); bitrates 60 % (HEVC) and 50 % (AV1) of H.264's for the same look.
      Measured (codecs-check, Chrome on Linux): AV1 140 KB vs H.264 293 KB for the same 2 s at
      480p, every frame decodes in ffmpeg; HEVC isn't offered there (no encoder) and asking for it
      says so — Macs and iPhones have hardware HEVC. MOV / MKV containers and transparent video:
      not in this round (BACKLOG).
145.  **Scene detection + auto-split** (v0.4). In the media analyzer worker (no new worker, no
      model): the clip's range is decoded frame by frame, each frame drawn at 64×36 and scored
      against the previous one (half colour-histogram change, half brightness change per pixel).
      A cut = score over the sensitivity's threshold **and** 2–3× the last 12 frames' average
      (fast motion lifts every score; a cut is a spike) **and** ≥ 0.4 s after the previous cut (a
      flash isn't two scenes). Lowest priority in the analyzer: it steps aside every 2 s of video
      for waiting thumbnails. Buffers are reused (no per-frame allocation except the 9 KB
      `getImageData`). Cuts map onto the clip as it is now (speed, trims), then one
      `splitItemAt` edit = one undo. Slow cross-fades are not cuts (a trailer's dissolves stay in
      one clip) — a deliberate limit for now. UI: a "Split at scenes" section / tool on video
      clips with Big changes / Normal / Small changes too, progress and Cancel. Test media:
      `scenes-cuts.mp4` (real footage cut at known times) and the Sintel trailer (CC BY).
146.  **Sound effects and level meter** (v0.4). `audioFx` on video and sound clips (file version
      4, optional): three-band EQ (shelf 120 Hz, peak 1 kHz, shelf 8 kHz; ±12 dB), **Even out**
      (stereo-linked compressor with soft knee and make-up gain: one 0…1 amount sets threshold
      −12…−30 dB and ratio 1.5…6), **Pitch** (±12 semitones, speed unchanged) and **Keep the
      voice natural** (undoes a speed change's pitch for 0.5×–2×; BACKLOG's "speed shifts pitch"
      for that range). In TypeScript (DECISIONS #13: WASM only after measuring TS too slow — a
      minute of stereo through every effect takes well under a second). Pitch: a two-tap
      delay-line shifter whose taps, when they jump, line up with the other tap by
      cross-correlation (≤ 12 ms) — without that, a tone came out as side lines 25 Hz apart (a
      warble); with it the spectrum is clean (440 → 880 Hz exactly). Runs in the shared mixer on
      each clip's sound before volume / fades, so preview and export match; state resets on seek;
      off stages cost nothing. 13 ready-made looks (Clear voice, Podcast, More bass, Phone call,
      Radio, Deep / High voice, Chipmunk, Monster…) then the sliders. **Meter**: the AudioWorklet
      tracks the peak per side per report (~21 ms), the engine sends it with the per-frame time
      event, `ctl.levels` → a two-bar meter in the desktop timeline bar drawn through refs (no
      React renders; −48…0 dB, amber over −6 dB, red at full scale). Phones: no meter (space;
      InShot-simple), effects in the toolbar.
147.  **Video scopes** (v0.4). Waveform, RGB parade, histogram ("Levels") and vectorscope
      ("Colour", with 75 % targets and the skin-tone line) of the **whole picture** under the
      playhead. The engine worker renders the project at ≤ 256 px on the long side with the
      warm looks renderer (no new GPU context), reads it back once and counts (`computeScopes`,
      pure, unit-tested); the counts are transferred, the UI draws them into one small canvas
      (one view at a time — the inspector is narrow). Lives as a collapsed **Scopes** section in
      the desktop inspector (video settings, and every picture item next to Adjust — where colour
      gets fixed). Measures only while open: one request at a time, ≤ 4 per second while playing,
      60 ms after a seek or edit while paused. Phones: none (pro tool, progressive disclosure).
      Scope colours are tokens read once (`--vu-scope-*`).
148.  **Proxies** (v0.4). A lighter copy of a heavy video is made automatically when this device
      would struggle (`proxyHeightFor`: low tier > 720p → 540p, mid > 1080p → 720p, high > 4K →
      1080p; `proxies: 'always'` = anything over 540p, `'off'`). Made in its **own worker**
      (`proxy.worker.js`; one at a time, so the analyzer's thumbnails aren't blocked) with
      Mediabunny's Conversion: H.264, a keyframe every second (quick seeks), no sound (sound
      comes from the original), rotation metadata kept (shows exactly like the original). Written
      straight to OPFS with a sync access handle (never in memory) under
      `video-ultra-proxies/`, marked finished with a `.ok` file; a byte budget per tier (1 / 2 /
      4 GB) deletes the oldest; skipped when free space < 2× the estimate + 200 MB. Device-local:
      not in the project file; a reopened project finds its copies. The engine keeps two video
      maps: previews and the small looks renders (scopes, pickers) read the copy, **exports and
      saved frames always read the original** (checked by giving a clip a deliberately different
      copy). HDR clips get no copy (it would lose the HDR look). One info toast says a copy is
      being made and that exports use the original; `ui.proxyJobs` has the progress.
149.  **AI editing, bring-your-own endpoint** (v0.4, optional). The model never edits the project
      JSON: it answers in an **edit-action language** (`EditActionSchema`, 14 actions in seconds
      and ids — split, trim, delete, move, speed, sound (incl. sound looks), filter, adjust,
      transition, addText, editText, animate, canvas, marker) that `applyEditActions` validates
      and maps onto the existing ops; the whole plan is one edit (one undo) or, if any action is
      invalid, nothing changes and the conversation says which action and why. The model reads
      `describeProject` (ids, kinds, times, names, texts, catalogue ids — no media; < 8 KB).
      Interface `EditingAssistant` in core (like BackgroundRemover); `createChatAssistant({
endpoint })` in `@video-ultra/ai` speaks OpenAI-compatible chat completions with JSON
      output so keys stay on the host's server. UI: an **Assistant** panel (last in the rail /
      phone tools, only when the host passes `assistant`): example chips, conversation, Enter
      to send, Cancel, a privacy line. Playground: `/api/assistant` forwards to any
      OpenAI-compatible model when `ASSISTANT_API_KEY` (+ `ASSISTANT_URL`, `ASSISTANT_MODEL`) is
      set; otherwise an offline demo understands a few phrases (warmer, title "…", fades,
      square…), so the panel can be tried with no account.
150.  **Text to speech through the host's voice service** (v0.4). On-device voices were weighed and
      left out: the good small open models need an espeak-based phonemizer (GPL — can't ship in
      an MIT package) or carry non-commercial licences, and the big character-level ones are
      hundreds of MB. So, like captions and AI editing: an interface (`SpeechGenerator`: voices +
      speak → audio Blob) and `createSpeechEndpoint` in `@video-ultra/ai` for OpenAI-compatible
      `/audio/speech` endpoints (hosted services, or a self-hosted open voice model behind the
      host's server). The answer is imported like a recording (stored, a sound clip, one undo).
      UI: **Text to speech** in the Audio panel (text, voice chips, speed, Add voice → at the
      playhead) and **Read aloud** on texts (the text's words, where it starts; phone tool +
      inspector section). Playground: `/api/speech` forwards when `SPEECH_API_KEY` (or the
      assistant's key) is set; otherwise an offline demo "voice" (tones per syllable) so the flow
      can be tried. BACKLOG: revisit on-device voices when an MIT-compatible phonemizer exists.

151.  **Typing on the stage** (owner's list, 2026-10-19: "text isn't editable on the canvas").
      Double-click a text (mouse; it selects all), or tap a text that's already selected (touch;
      the caret goes to the end), and a field opens right over it, styled like the text — font,
      size, colour, spacing, alignment, turn, outline, shadow, background. The engine hides that
      item meanwhile (a preview, not an edit), so only the field shows. Typing stays in the field
      — no store write per key — and lands as one edit (one undo step) when the field closes
      (click away, ⌘/Ctrl+Enter); Esc puts the old text back. The field is always in the page and
      focused inside the tap: iOS only raises the keyboard for focus given in a user gesture.
      Its own line breaks can differ by a line from the engine's balanced wrap while typing; the
      engine's layout returns as soon as it closes. Captions keep their own editing (list).

152.  **Captions on real speech under background sound** (owner's iPhone, Hindi: "No speech was
      heard"). Measured on real Hindi (LibriVox) mixed 15 / 8 dB over background: the model
      reports a high no-speech probability (0.4–0.7) on windows full of words it wrote with
      confidence (≥ −0.5), and #130's "no-speech > 0.5" dropped them. Made-up text (#130's
      clips, every model, English and Hindi) is always sparse or unsure (≤ −0.75), so that rule
      now drops a window only when it is also sparse (fewer than 0.3 words per second) or unsure
      (< −0.6); every other #130 guard stands. Also: when the model's word timing collapses
      (every word stamped within 0.5 s at the window's end — seen on real Hindi), the words are
      spread over the parts of the window with sound instead of being dropped, so captions come
      with rough timing the user can nudge. And when the video has sound the browser can't
      decode here (no AudioDecoder on an http page, or a missing codec), captions say that
      plainly instead of "No speech was heard" (`listen` fails with `SoundUnreadable`). Safari
      on http keeps an undefined `audioWorklet`: playback sound now says "needs a secure
      (https) page" from `isSecureContext` first. Results in PERF.md "Captions".

153.  **Finishing v0.4: edit several at once, duplicate project, combine into one clip — no
      multiple timelines** (owner, 2026-10-20, after weighing compound clips vs. multiple
      sequences for what people prefer). Everyday editors change several clips at once ("apply
      to all / selected") far more often than they reach for a nested clip, and expect
      "Duplicate project" for another version, not timeline tabs. So: (1) **Edit several at
      once** — with several selected, the inspector's Speed, Sound (volume, mute, fades),
      Adjust and Opacity & blend, the left menu's Filters and Transitions / entrance-exit, and
      the phone's multi-selection tools (Speed, Volume, Fade, Filter, Adjust, Animate, Opacity)
      act on all of them, one undo step. Built once, not per tool: the tools show a
      representative item, and run through a controller whose edits (direct, or inside a
      controller method) are spread to every other selected item that has that setting —
      speed through `setSpeed` (later clips move up), the rest field by field through
      `updateItem` / `setAnimation` / `setTransition`, so an item without that setting keeps
      its own; place, size, timing and text are never copied. (2) **Duplicate project** sharing
      the media files. (3) **Combine into one clip** (compound) only in the context menu (pro,
      progressive disclosure): Combine / Open / Separate. Multiple timelines in one project →
      BACKLOG (1 + 2 cover what people use them for).

154.  **Your videos: make a copy, new video, open, delete** (#153 part 2). A copy shares the
      media files (the media folder is already shared by every project, and deleting a project
      removes only media no other project uses), so it costs one project file. It needs a way
      back, so a small **Your videos** popover from the top bar's start (all layouts; phones
      don't show the name there): Make a copy (opens the copy; a toast offers "Back to
      original"), New video, the other saved videos (open; delete asks first). Switching saves
      the open video first, then moves the editor's lock, history and saving to the other one
      and registers only the media not already loaded. Shown only when the editor saves
      locally (`autosave` on) and not hidden (`customize.hide: ['videos']`) — hosts with their
      own project list keep theirs. Checked by videos-check (desktop + phone).

155.  **Combine into one clip** (#153 part 3; a pro tool in the context menu only). **Model:** a
      combined clip is an ordinary video item playing an asset of the new kind `compound` (file
      version 5; 4 → 5 changes nothing) that holds its own tracks (main track first, timed from
      0), the canvas size it was made at, its length and whether it has sound — no file. Being a
      video item, it trims, splits, speeds up, takes filters, LUT, opacity, blend, transitions,
      animations, keyframes, copy / paste like any clip with no new code; several items may play
      one combined clip (a split, a copy), and editing its inside changes them all. Freeze,
      Extract audio and Split at scenes need a real file: refused with a reason. Combine takes
      next-to-each-other main clips (the transition into the first one comes along) plus the
      layers inside their span, or layers alone (a new layer); captions stay out. Separate puts
      the pieces back where it played them, its trim and speed applied (its own look doesn't
      carry over); pieces get new ids so other clips playing it keep it. Invariants and repair
      cover every inside (ids unique across all; no clip containing itself; the inside fits the
      length); the property tests include combine / separate. **Engine:** renderers gain render
      targets (WebGPU: rgba8unorm texture, its own pipelines and copy-under texture; WebGL2: an
      FBO, read bottom row first); a target is cleared transparent and, used as a layer, its
      premultiplied colour is divided back out in the shader (`uvT.z`, one flag). Each item
      playing a combined clip gets a child composer (its own decode positions, the shared
      decoder pool and media) that draws the inside into that item's target, sized to fit the
      output (exports stay sharp); the target then goes through the normal picture path. Sound:
      a nested mixer behind the clip-reader interface, resampled for speed. Nesting stops at 4
      levels. Measured: frames identical to the pieces on both backends (0.00 mean difference);
      sound correlation 1.0; exports carry picture and sound. **Editing inside ("Open"):** the
      editor shows a view of the project whose tracks are the clip's inside (cached per project
      object); edits run on the real project through a draft whose `tracks` are the clip's, then
      its length / sound follow and clips playing it stay within it — so the timeline, stage,
      inspector, history and saving all work unchanged inside. A bar over the timeline names
      where you are with Back; Captions and the canvas size say they're the whole video's;
      Export and undoing past the Combine leave the clip. Multiple timelines stay out (#153).

156.  **Clean up noise, and Extract audio keeps what was done to the sound** (owner, 2026-10-20).
      A sound effect (`audioFx.denoise`, 0…1; optional, so file version 5 holds it): a spectral
      noise gate in TypeScript (no WASM — measured at under 1 % of real time), first in each
      clip's effect chain so Even out can't bring the noise back. 1024-sample Hann frames a
      quarter apart through one complex FFT for both channels; the noise floor per band is the
      minimum of the last ~1.4 s (minimum statistics) × 3; gains over-subtract (1 + 3 × amount),
      never below −24 dB × amount, rise at once and fall gently, averaged with neighbours (no
      "musical noise"). One frame of latency (~21 ms at 48 kHz), not compensated — like the
      pitch shifter. For steady noise (hiss, hum, fans, rumble); not for music or crowds behind a
      voice. New preset "Clean voice" (clean 60 %, voice EQ, Even out 40 %). Extract audio now
      copies the video's fades, effects and lower-under-voice to the sound clip, not only the
      volume.
157.  **A title's wrap width grows with its size; captions' doesn't** (owner, 2026-10-24).
      `maxWidth` is the wrap width as a fraction of the canvas width _at scale 1_: the engine
      wraps at `maxWidth × canvas width × scale`, so making a template title bigger keeps its
      lines (before, the font grew but the wrap stayed, and the title broke onto more lines).
      In raster pixels the wrap no longer depends on the scale, so resizing never re-wraps.
      Captions (caption track) keep a fixed wrap, so bigger captions still fit the frame. No
      migration: a saved title that was scaled re-wraps to the lines it had at scale 1.
158.  **Desktop panels can be resized** (owner, 2026-10-25); the side panels' default sizes are
      their floor; the timeline can also shrink, down to its ruler and the whole main video row
      (measured from the timeline's own sizes, so density is respected).
      Desktop only (≥ 1024 px; tablets keep the fixed layout, their sheet sits over the
      timeline): a thin handle on the side panel's right edge, the settings panel's left edge and
      the timeline's top edge. Side and settings panels 280–400 px, timeline (ruler + main video row)–420 px and at
      most 45 % of the editor's height; the video keeps ≥ 320 × 200 px. Dragging only changes a
      CSS variable on the root (no render per move); release keeps the size in this browser
      (`localStorage`, a per-viewer convenience). Arrow keys / Home / End on a focused handle,
      double-click or Enter resets. `splitters.tsx`.
159.  **The assistant sees the media library and can rename** (owner, 2026-10-25; extends #149).
      `describeProject` now carries the video's `name` and `media` (every imported video, photo
      and sound: id, name, kind, length, on the timeline or not — LUTs and combined clips are
      left out), so "list my media" has an answer and a file can be named ("make beach.mp4 black
      and white"). Two new actions (16): `rename`, and `addMedia` (a sound on a sound lane at
      `start`; a video / photo into the main video before the clip at `start`, at the end without
      one, or on a layer with `asLayer`). `addMedia` and `addText` take a `ref`, a name the model
      gives the new item so later actions of the same answer can edit it ("add the photo and
      make it black and white" is one answer, one undo). Questions are answered in `reply`, one
      entry per line (the chat keeps line breaks). The item factories `visualItem` / `audioItem`
      moved to core (`model/items.ts`, internal) so the assistant and the editor build the same
      items.
