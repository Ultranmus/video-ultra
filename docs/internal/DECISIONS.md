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
    The editor self-calibrates per device at startup with a synthetic HLG test frame; the shipped
    calibration is the fallback. Rejected: raw-plane tone mapping (impossible with hardware decode),
    software decoding for HDR (too slow for 4K60 on phones).
