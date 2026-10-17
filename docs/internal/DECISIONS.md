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
