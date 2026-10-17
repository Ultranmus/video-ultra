# video-ultra — Progress log

Newest last. Append an entry after every work session.

## 2026-10-17 · Planning

Owner and Claude agreed the product, scope, stack and week plan (see DECISIONS.md #1–26 and
PLAN.md). Key calls: free MIT package; InShot → Canva (video features) → pro layers with staged
releases; TypeScript WebGPU + WebGL2 compositor (Rust + wgpu rejected after review); Rust WASM
only for measured CPU hotspots; no Canvas2D renderer; op-log state; host `onSave` is the durable
save; v0.1 production quality in one week.

## 2026-10-17 · Day 1 — Phase 0 (engine proof) ✅ (awaiting owner checkpoint)

- Monorepo, CI, docs, first commit. Engine lab in a worker: Mediabunny decode → WebGPU
  (zero-copy) / WebGL2 → playback, scrub and MP4/WebM export streamed to OPFS.
- Headless multi-browser bench runner (`scripts/bench.ts`) — Chrome (real GPU), WebKit, Firefox.
- Results (PERF.md): every codec/edge case plays at full rate in every browser; 0 main-thread
  long tasks; 0 leaked frames; 10-minute soak flat. Misses: long-GOP 4K/VP9 scrubbing, WebGPU
  export slower than WebGL2 — both planned for Phase 2.
- Fixed during the day: mono/22 kHz audio export (resample to 48 k stereo); WebKit/Private
  Browsing export (in-memory fallback when no OPFS); Firefox export (lazy WASM AAC encoder);
  main-thread bundle pulling in Mediabunny (capability checks now plain WebCodecs).
- Worker packaging verified in Next.js 16 (Turbopack dev + prod) and Vite 8 (dev + prod).

## 2026-10-17 · Day 2 (started early) — Core engine

- Project model (`model/`): flicks time base, Zod schema, `createProject`, invariants, migration
  - repair (damaged files open with warnings instead of failing).
- Edit operations (`edit/ops.ts`) and editor store with Immer patches: undo/redo, slider
  coalescing, operation log + replay (crash recovery).
- Tests: 31 unit/property tests. The property test (random edit sequences: invariants, full undo,
  log replay, save/reopen) found 2 real bugs on its first runs — `structuredClone` on Immer drafts
  (split/duplicate/freeze would crash in the app) and lane reordering on reopen — both fixed.
  30,000 random sequences pass.

## 2026-10-17 · Owner's iPhone footage + HDR research

- Repo pushed (`Ultranmus/video-ultra`, private); CI made manual-only until v0.1 (DECISIONS #32).
- Rust + naga installed. Owner's 8 iPhone/social files linked into `test-media/private`.
- Bench on real iPhone footage: Chrome plays 4K60 HDR at 600/600, scrub p95 ≤ 110 ms; engine
  picks the AAC track over Apple's spatial-audio (APAC) track. WebKit (Playwright) drops frames on
  4K60; Firefox can't decode HEVC.
- HDR research (research/HDR.md): frames are opaque, browsers tone-map themselves (too bright);
  a fitted LUT + matrix brings every path to Apple's look on unseen frames (MAE 30–72 → 11).
  Decision #33: correction shader + startup self-calibration, zero-copy kept.

## 2026-10-17 · Day 2 finished, Day 3 started (batch tasks 2–4)

- **Day 2 · 1.5 media probing** (`media/probe.ts`): tracks, rotation, HDR, VFR, iPhone audio-track
  choice, plain-language errors, incomplete files (playable length). All test files pass in 3
  browsers (`scripts/probe-check.ts`).
- **Day 2 · 2.1 FrameSource** (`engine/frames.ts`): one decoder per clip, forward continuation,
  latest-wins, keyframe preview, watchdog, pool. Final frame after a drag 0–100 ms on real footage.
  A direct-VideoDecoder version failed on iPhone HEVC in Safari → Mediabunny iterators (#34).
- **Day 3 · 2.3 HDR correction:** one WGSL source → WebGPU + generated GLSL (`pnpm shaders`, #35);
  measured calibrations per engine/path; Chrome `texSubImage2D` HDR bug worked around (#36).
  Exports vs Apple: error 30–74 → **5.1–5.5 / 255** on every path; SDR unchanged.
- Found: Playwright WebKit's WebGL upload costs 9–22 ms/frame — likely the 4K60 drop cause.

## 2026-10-17 · Day 3 — playback engine (2.2 compositor, 2.4 audio, 2.5 tiers, 2.6 soak)

- **2.2** Timeline + layout maths (pure, tested); multi-layer compositor on WebGPU + WebGL2 with a
  golden check (`scripts/composite-check.ts`); engine worker v1 (`createEngine`) plays a real
  project: 17 s demo 510/510 in Chrome, 0 late, 0 main-thread long tasks. Fixed on the way: double
  premultiplied alpha on WebGL2 (#39), frames closed under a pending draw (#42), overlapping renders,
  a zombie engine from React strict mode (lab page).
- **2.4** Audio: worker mixer → MessagePort → AudioWorklet; audio is the clock (#43, #44). 0
  underruns, A/V p95 ≤ 1.5 ms in Chrome; `scripts/audio-check.ts` verifies the mix.
- **2.5** Tiers: preview caps and decoder budgets per tier; adaptive preview quality
  (`QualityGovernor`, unit-tested). CPU throttling doesn't reach the engine worker (hardware
  decode, off the main thread) — 6× throttled Chrome still plays 510/510.
- **2.6** 10-minute soak with OS-level memory of all Chrome processes (`scripts/soak.ts`).

## 2026-10-17 · Media analyzer + persistence (Day 4 · 3.3/3.4 core, Day 6 · 4.2)

- `media/analyzer.ts` + `analyzer-worker.ts` (→ `dist/analyzer.worker.js`): `createMediaAnalyzer`
  — probing in the worker, keyframe thumbnail batches (newest first, deduplicated, abortable,
  cached, tier decode budget, watchdog), streamed waveform peaks (`media/peaks.ts`, unit-tested
  against brute force).
- `storage/*`: `createProjectStorage` (OPFS via `storage.worker.js` sync access handles, memory
  fallback, IndexedDB file handles), snapshot + op-log format with compaction, crash-safe load,
  `StorageFullError`, waveform cache; `attachAutosave` (250 ms batches, snapshots every 200 / idle
  / hidden / pagehide, debounced `onSave`, follows `editor.load`).
- Tests: `storage.test.ts` (round trip, compaction, torn log line, torn snapshot, damaged line,
  editor.load, onSave debounce, full disk, media + waveform, 500-item project, crash property test),
  `peaks.test.ts`. Random-edit generator moved to `test/random-edits.ts` (shared with history tests).
- Browser checks: `scripts/analyzer-check.ts` (`/lab/analyzer`) and `scripts/storage-check.ts`
  (`/lab/storage`) — all pass in Chrome, WebKit, Firefox, 0 main-thread long tasks.
- Test media: `avc-1080p30-60s.mp4` (60 s, keyframe every 1 s) and `music-3min.mp3` (`pnpm media`).

## 2026-10-17 · Engine effects + export (Day 5 · 3.8–3.10 engine side, Day 6 · 4.1)

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

## 2026-10-17 · Days 4–6 — editor UI, integration, production pass

Three parallel tracks (UI here; engine effects + export and analyzer + storage in agent
worktrees, merged and integrated).

- **Day 4 · 3.1–3.5:** `<VideoEditor />` (packages/react) — phone / tablet / desktop layouts by
  container queries; `EditorController` (plain TS: editor, engine, analyzer, storage, UI store,
  playhead) so React never renders per frame (#45); canvas timeline with film-strip thumbnails,
  dB waveforms, scrub / pan with a fixed centre playhead on phones, pinch + Ctrl/⌘-wheel zoom,
  snapping with a haptic tick, trim handles, move, long-press reorder (#48), transition markers,
  lane mute/hide, accessible DOM layer; stage selection with move / scale / rotate / pinch and
  centre guides; contextual toolbar, sheet (phone/tablet) and inspector (desktop); import with
  per-file errors and drag-drop; i18n labels; tokens + editor.css.
- **Day 5 · 3.6–3.10:** split, trim, delete, duplicate, reorder, freeze, speed, volume, mute,
  fades, extract audio, crop, rotate/flip, fit/fill, canvas ratios, colour / blur background,
  16 filters + intensity, 9 adjustments, 7 transitions, text (8 styles, colour, size, bold,
  italic, align, outline, shadow, background box), 48 emoji stickers, music + SFX import,
  voiceover recording. Drags and sliders preview without store writes and commit once (#47).
- **Day 6:** export dialog (resolution limited by the device's encoders, fps, quality, format,
  progress, cancel, Wake Lock, download) on `engine.export`; autosave + crash recovery of the last
  project, load warnings, missing-media notice, persistence request; `onReady(controller)`.
- **Checks:** `scripts/editor-check.ts` (layouts + real media), `editor-interact.ts` (15 steps
  incl. export → ffprobe; pass in Chrome, WebKit, Firefox), `editor-recovery.ts` (reload →
  same project, media, preview; Chrome + Firefox OPFS), `a11y-check.ts` (axe WCAG 2.2 AA: 0
  violations, dark + light, phone + desktop). Fixed on the way: strict-mode double mount killed
  the engine (#46), shortcuts lost after clicking the canvas (#51), element resets outranking
  component classes, a banner covering the controls (#50), quiet audio drawing flat.

## 2026-10-17 · Editor UI second pass (owner review)

The owner tested the first UI on desktop and phone and rejected it (no tooltips or guidance,
duplicate menus, cramped/overlapping hover states, empty panels, black canvas melting into the
chrome, no split feedback, dead buttons, glitchy trim and drag, mixed-axis scrolling, filters and
transitions hard to find; on phones: sheet hard to close, fullscreen did nothing, flickering
timecode, drags fighting Safari, keyboard cutting the text box, crude selection boxes). Rebuilt to
UI_VISION §9 with image-ultra as the bar: tooltip layer, disabled-with-reason actions
(`targets.ts`), one home per control, inspector sections, engine-rendered filter thumbnails,
transition tiles + apply-to-all, action toasts with Undo and a cut flash, empty states, lighter
stage with a framed canvas, floating-copy drags with drop outlines, trim that keeps the playhead,
one-axis wheel, neutral lane clips, phone dock + Back/Done, Preview mode, keyboard-aware bottom
area, no iOS callout/selection, tenths timecode. `scripts/ui-review.ts` walks desktop + phone and
saves screenshots; all were reviewed (dark + light). Interaction (Chrome, WebKit, Firefox),
recovery and axe checks pass; `pnpm verify` green.

## 2026-10-17 · Effects library (transitions, element animations, filters).** 76 transition

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

## 2026-10-17 · UI round 3 (owner feedback): libraries, ruler sliders, picker, animate

Ruler sliders (image-ultra style); adjust / crop as chips + one ruler; rotate / flip icon row;
146 text styles; sticker library (3D, emoji, shapes, upload); HSV colour picker; themed
scrollbars; Saved chip; full-screen icon; filters and transitions by category with engine-rendered
previews and animated tiles, direction / feel / length options, play-once previews; Animate panel
(In / Out / Loop) for lane items; panels select their target; lane drops into existing or new
lanes. Checks: verify (373 + 10 tests), interaction 3 browsers, axe 0, composite golden.

## 2026-10-17 · Review of an open-source Rust editor for ideas

Read its docs (not its code; we copy nothing). Not usable directly: its web build runs all work
on the UI thread, wants cross-origin isolation, ships its own codecs in WASM and draws a canvas
UI. Ideas recorded: command registry (DECISIONS #91, PLAN 6.0), playground test API + URL flags
(#92), fatal-error screen (#93), and v0.3 specs to follow — R128 loudness, SRT / WebVTT,
scopes (BACKLOG). Things it does that we already do: exact integer time, audio-clock master,
OPFS recovery, WebCodecs first, ranged reads.

## 2026-10-18 · UI round 4 (owner list 4)

- Libraries scroll by category with a following chip row (filters, transitions, animations,
  text styles, stickers); filter previews per section, lazily.
- Transition and animation tiles show the engine's real frames (still + hover flip-book).
- 13 timing curves with curve tiles; ratio picker as shape tiles; button rows share width;
  wider side rail; ellipsis on segments / chips; text style samples fit their tiles.
- Text inspector: format strip (bold, italic, align), size / letter spacing / line height,
  effect cards (outline, shadow, label box) with switches and their settings.
- Export dialog: poster beside the options, resolution / quality tiles with size estimates,
  progress ring over a greying poster, animated done state with the video inline, Share on phones.
- Timeline: layers above main, new-layer slot, main ↔ layer drags (core ops + tests), edge
  auto-scroll, kind-tinted clips with glyphs, accent trim handles with chevrons, selection glow,
  filled-envelope waveforms (sound clips and video clips with sound).
- Fixes: filter previews thrown away under strict mode; first preview frame black on a fresh
  renderer (warm-up draw).
- Checks: verify (386 core + 11 React tests), interaction 15 steps × Chrome / Firefox / WebKit,
  axe 0 (phone + desktop), recovery, composite golden; ui-review desktop + phone, dark + light.
