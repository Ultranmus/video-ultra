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

## 2026-10-18 · Owner follow-up on round 4

- Rows grouped video-first and named (owner picked it): Video, slot, Layer, Text, Audio.
- Transitions between touching pictures on a layer (core ops, invariants, timeline, compositor,
  previews, markers, inspector, phone toolbar) + tests.
- Category chip row now lights up while scrolling (the active state was never styled).
- Filter previews: picker previews run one at a time in the worker (they shared one renderer and
  could draw over each other) and retry while the engine / media are still starting.
- Panels follow the selected element, with notes when it can't take the effect.
- Checks: verify (389 + 11), interaction × 3 browsers, axe 0, composite golden, ui-review.

## 2026-10-19 · Mobile pass (owner list)

- Playground device frames (`/editor?device=phone|phone-small|tablet|tablet-portrait`), so phone
  and tablet layouts can be checked on a desktop without deploying.
- One draggable bottom sheet for every phone tool (same height, drag down to close, up to
  expand); Done has room; the sticky category bar sits flush under the header; chips line up.
- Phone timeline scrub no longer jitters (paused engine echoes ignored).
- Text animation previews fit the text to the tile.
- Filters and adjustments on text and stickers (file version 2 + migration); Transitions for an
  element shows its entrance / exit; phone toolbar and inspector gained Filter / Adjust for them.
- Focus tooltips only after keyboard use (no tooltip after a tap).
- Checks: verify (390 + 11), interaction × 3 browsers, axe 0, composite golden, recovery,
  ui-review; probes for drag-to-close and text filters (WebKit, iPhone size).

## 2026-10-19 · v0.1 fix pass (F1–F9)

- F1 Web Lock per project; second tab read-only with "Use it here" (tested with two tabs).
- F2 Engine `onFatal` → "The editor stopped" screen with Reload (covered in editor-interact).
- F3 `exportBitrate()` / `exportAudioBitrate()`: same size in every browser (5.4–5.5 MB vs 2.9–13.4);
  stale export files removed at startup. F4 VP8 for WebM on Firefox (2.6× vs 0.70× real time).
- F5 `storage.sweepMedia()` for media no project uses (tested).
- F6 Capability probe split into tasks; first AudioContext moved to a quiet moment (PERF.md).
- F7 Equal-power audio crossfade under transitions (`audio/spans.ts`, tested; export ±1 ms).
- F8 Toolbar edge fades, ruler label fade, emoji filtered to the device's font, voiceover mute.
- F9 Stage view zoom (pinch, Ctrl/⌘ + wheel, pan, Fit), exact editing while zoomed.
- Checks: verify (395 + 11), interaction × 3 (+ crash step), export-check × 3, axe 0, recovery.

## 2026-10-19 · v0.2 — E. Layers & organising ✅ (owner tests all of v0.2 at the end)

- Owner added group E to v0.2 and asked for one stretch with one test at the end (DECISIONS #116).
- Core: file version 3 (optional `locked` / `hidden` / `groupId`), `setItemFlags`, `groupItems` /
  `ungroupItems`, `shiftItems`, `arrangeItem`, `groupOf`, `editor.history()` / `goTo`; hidden
  items skipped by the compositor. Property tests run the new ops in random sequences (3,000).
- React: command registry (`commands.ts`, 6.0 pulled forward), multi-selection, group box on the
  stage (move / scale / rotate / pinch, marquee, long-press menu), History popover, Layers panel
  (rename, lock, hide, drag restack, select several), context menu with Align submenu, Arrange
  tool / inspector section, Group inspector, locked notes, timeline group drag, row lock,
  lock badges, shortcuts (⌘A, ⌘G, ⇧⌘G, ⇧⌘L, ⇧⌘H, [ ], ⌘[ ⌘], Shift+F10).
- Owner's phone report fixed on the way: timeline "+" didn't open the picker on iPhone (#119),
  its hint was cut off, the tab bar was see-through at its edges, and switching tools re-opened
  the sheet (#118).
- Checks: `scripts/organize-check.ts` 32/32 (Chrome desktop + WebKit phone, axe on Layers and
  the menu); editor-interact 48/48 (Chrome, WebKit, Firefox); a11y-check 0 violations; core
  402 tests, react 15.

## 2026-10-19 · v0.2 everyday creator — all groups built ✅ (waiting on the owner's one test)

Built in one stretch (owner's request); B, C and D by three helper agents in their own worktrees,
merged and re-verified on main; A (captions) and E (layers) here.

- **A. Captions:** A0 spike → our own lean Whisper runner on the ONNX runtime (DECISIONS #127),
  model choice per language and device (#128), `@video-ultra/captions` (optional package,
  on-device, nothing uploaded). Caption row with word times, SRT / VTT, grouping, 8 style
  presets, 5 word-highlight modes drawn by the engine, balanced wrapping, Captions panel,
  timeline row, phone tools, `transcriber` prop (host services welcome). Real speech through the
  editor: English 19 captions / 16.6 s, Hindi 12 captions / 56.8 s (incl. downloads).
- **B. Sound:** ducking ("Lower under voice"), music & sounds library slot + synthesised starter
  sounds, sound-only export (in D).
- **C. Picture tools:** green screen (pick from video), LUT import, blur / pixelate areas, 9 blend
  modes — one shader on both backends.
- **D. Capture & export:** camera recorder, save frame as PNG / JPEG, export a part (I / O),
  presets, sound-only export (M4A / Ogg / WAV).
- **E. Layers & organising:** command registry, History, Layers panel, lock, hide, groups,
  arrange / align, context menu.
- Owner's phone report fixed on the way (#118, #119).
- Checks on main: see HANDOFF for the full list and results.

## 2026-10-19 · Vercel deploy fixed

- The playground deploy failed at install: the lockfile held `onnxruntime-web`
  `1.31.0-dev.20260914`, outside `^1.30.0`. Pinned that exact version (#131); frozen install and
  the playground build (14 routes) pass.

## 2026-10-19 night · v0.3 + v0.4 on `night/v0.3-v0.4` (owner asleep; checklist in TEST_CHECKLIST.md)

- **Fixes:** Hindi (large) speech model: streamed download into Cache Storage, crash memory so a
  phone that ran out of memory says so instead of crashing again, phone warning (#131–#133);
  mouse marquee from the main video (organize-check +7); copy / cut / paste with groups.
- **v0.3:** shape masks — 126 SDF shapes in WGSL and generated GLSL, golden-frame checked
  (#134); high-contrast themes + touch density (#135); animated stickers (GIF / WebP / APNG via
  ImageDecoder in the worker) + 611 animated emoji + SVG import (#136–#137); 192 templates
  (32 layouts × 6 themes) with text variables (#138); `@video-ultra/ai` on-device background
  removal (MODNet on phones, ormbg on computers) (#139–#140); embedding API (#141).
- **v0.4:** keyframes on transform properties + graph editor, exact across split / trim
  (`shift`) (#142); roll / slip / slide, Fine trim tool, markers (file version 4) (#143); HEVC
  / AV1 export (#144); scene detection + Split at scenes (#145; real-footage test media with
  known cuts + Sintel trailer); sound effects (EQ, Even out, pitch, keep pitch) + level meter
  (#146); scopes (#147).
- Checks added: shapes-, stickers-, templates-, cutout-, embed-, keyframes-, protrim-, codecs-,
  scenes-, soundfx-, scopes-check; composite-check mask goldens; organize-check marquee + paste;
  a11y-check --contrast. Core unit tests 493, react 18.

## 2026-10-20 · Owner's list, then the rest of v0.4 (branch `feat/v0.4-finish`)

- Merged `night/v0.3-v0.4` into main (local; not pushed).
- **Owner's list:** Align submenu (outside the scrolling menu, flips left; hover + click keeps it
  open); each desktop panel its own scroll box and place; typing on the stage (#151); cut-off
  labels (row buttons wrap to a full line, tabs by label, filter names / sound credits two
  lines); phone "+" before the first clip; captions on real speech under sound, collapsed word
  timing, unreadable sound, Safari-on-http sound note (#152). Film strip "flicker" in Layers:
  the owner clarified it's the timeline lanes jumping on a Layers restack (fixing next).
- **Edit several at once** (#153): fan-out controller; inspector / left menu / phone tools.
- **Your videos** (#154): make a copy (shared media), new, open, delete.
- **Combine into one clip** (#155): file version 5; combine / separate in core (property tests);
  render targets in both renderers + child composer + nested mixer; Open / Back with a scoped
  view; export carries picture and sound.
- Dev: the React package's watch build no longer deletes styles.css (tsup clean off, `build`
  empties dist).
- Checks added: stage-text, multiedit, videos, compound, combine-ui. Golden frames unchanged on
  both backends and browsers.

## 2026-10-20 (later) · Audio, release prep (branch `feat/audio-and-release`)

- **Clean up noise** (#156): spectral noise gate, first in the effect chain; Clean voice preset;
  Extract audio keeps fades, effects and lower-under-voice. denoise-check on real speech + fan
  noise: −8 dB (50 %) / −10.5 dB (100 %) in pauses, speech within 0.2 dB.
- **PLAN 5.2:** pack-check (publint, attw, gzip budgets, fresh install from the tarballs, typical
  app type-check, Node import + server render); READMEs and licences per package; styles.css
  types; `^` ranges on core; CI on push / PR with pack-check; release workflow (changesets,
  provenance; needs `NPM_TOKEN`); first-release changeset (0.1.0).
- **PLAN 5.1:** docs site in the playground (`/docs`, 12 pages, docs-check: axe clean, phones),
  TypeDoc API reference (`pnpm docs:api`, built before the playground on Vercel); public types for
  every prop; optional props accept `undefined`; Next.js example (server component + server
  action, checked in a browser); Vite example shows the editor.
- Fixes on the way: stray screenshots out of the repo root; per-package Vitest cache (a shared one
  raced — the session's first unexplained test failure).

## 2026-10-24 · Owner-reported UI fixes (inspector)

- Blurred area: the stage's selection box follows Width / Height (and any side-panel slider)
  while dragging — new `ctl.onPreview()` subscription; it used to catch up only on release.
- Pressed buttons keep their accent on hover (flip H / V looked unchanged after a click), and
  buttons in an icon row get a visible hover (the row was already the hover colour).
- Align buttons: each has its own tooltip (left / centre / right / top / middle / bottom, to the
  video or to each other) instead of one shared line.
- Locked note in the desktop inspector lines up with the sections (it touched the panel edges).
- Blurred area: Flip mirrors it as it sits on the video (a tilted box tilts the other way); off with a reason when upright, where it would look the same.
- Rotate 90° turns from the current angle (45° → 135°) instead of snapping first.
- **Owner-tested:** Blur tab fully tested on the laptop ✓ (phones still to do).
- Filters → Apply to all clips: copies this clip's look (filter at its strength, plus its LUT look) to every video and photo, layers too, skipping locked ones; the toast says how many. It used to keep each clip's old strength and skip layers.
- **Owner-tested:** Filters tested on desktop ✓ (phones still to do).
- Sound effects: room between the look chips and the sliders (the list had no spacing).
- **Owner-tested:** Templates tab works on desktop ✓ (phones still to do).
- Text on the stage: one click on the selected text types (desktop; no double-click needed); a phone tap that wobbles a few pixels types instead of counting as a drag (touch drags start after 10 px); the typing field shows its dashed outline instead of the dark focus ring. stage-text-check covers all three.
- Typing on the stage: the field is the drawn text's exact width (no extra caret room that made it wider), and the selection frame stays while typing (handles hidden) and grows with the text, instead of a separate dashed outline.
- Typing into a template title (text with a wrap width): the field hugs the drawn lines like the selection frame, instead of spreading to the whole wrap width.
- Read aloud: the speed control is the editor's own slider (it was the browser's default range input).
- Template titles keep their lines when made bigger: the wrap width grows with the text's scale (DECISIONS #157); captions keep a fixed wrap. The typing field follows, since it uses the same measure. Core test + stage-text-check (scaled wrapping title).
- Checked text adjustments by rendering each at −1 / +1 on a yellow title: all nine apply. Brightness, contrast, saturation and highlights show clearly; warmth, tint, shadows, sharpen and vignette barely change a flat, bright colour.
- Stage: the selection frame hides while playing (animated / keyframed items moved away from it) and follows a keyframed item while scrubbing.
- Playground: Text to speech / Read aloud only show when the server has a voice service key (page.tsx reads it on the server; editor-client.tsx is the old page). The buzzing offline demo voice is gone. `?speech=1` forces it on for speech-check, which now also checks it's hidden without a key.
- .gitignore: .env*.local and .env (the owner's playground key file wasn't ignored). Playground key confirmed reaching OpenAI; the account has no credits (429 insufficient_quota).
- Playground speech: Google's Gemini speech model as a second service (auto when the key isn't an OpenAI one, or SPEECH_PROVIDER=gemini): its voices in the editor, PCM wrapped as WAV, pace asked for in words (no speed setting there). Checked end to end with the owner's key: Add voice puts a real 2.8 s spoken clip on the timeline.
- **Owner-tested:** Text tab works on desktop ✓, Read aloud included (Gemini voice); phones still to do.
- Stickers → Animated: tiles show a still of the placed art (Noto `emoji.svg`, ~3 KB, lazy) instead of the device's emoji font, which looked different (Apple vs Google art); the font emoji stays as a fallback. 3D and Emoji tabs already matched (checked by screenshots).
- Stickers → Animated: a mouse over a tile plays its animation (the 512.webp loads only then; back to the still on leave); one hint line says they move when the video plays.
- **Owner-confirmed (desktop):** Animated sticker tiles match the placed art; hover preview plays.
- **Owner-tested:** Stickers tab works on desktop ✓.
- Remove background on stickers only when there's a background to remove: hidden for animated images (a cut-out is one still — it would stop the animation) and for images already see-through at their edges (library 3D / animated / shapes, cut-out logos). Checked once per sticker (4 KB header + a 48 px decode). Photos unchanged. Browser-checked: animated, 3D, shape, PNG logo, GIF → hidden; JPEG photo sticker → shown.
- Transitions → Direction: arrows only, the name in the tooltip (the labels were cut to "L…", "Ri…"). New `iconOnly` option on the segmented control.
- Transitions panel (desktop): the list comes first; the chosen transition's settings sit in a bar pinned to the panel's bottom — Direction on one line (arrows), Feel closed to one row (opens as a sideways strip of curves), Duration, Preview + Apply to all side by side. Phones keep settings above the list (the sheet is too short to pin them).
- Transitions panel: the chosen transition's settings open inside the list, right under its tile's row (a full-width card; dense grid packing keeps the tiles in order) — owner picked this over the pinned bar. Scrolls into view when picked low in the list. Direction one line with arrows, Feel one collapsible row (sideways strip), Preview + Apply to all side by side. Same on phones. axe clean.
- Transitions panel: back to the original order at the owner's word (settings above the list), keeping the tidy-ups: Direction on one line with arrows, Feel one collapsible row, Preview + Apply to all side by side. (Tried a pinned bottom bar and settings inside the list; neither kept.)
- Transitions: the Cut tile is gone — a "Remove transition" button (tip: back to a straight cut) shows in the settings when one is set. Feel is always open (no toggle): its name and the chosen curve's name, then the sideways strip of curves.
- Transitions → Feel: no name on the right (the highlighted curve says it); the strip opens scrolled to the chosen curve.
- Transitions: switching between two cuts with the panel open now shows each cut's choice — the panel starts fresh per cut (its chosen tile scrolled into view if it isn't; the Feel strip follows the chosen curve).
- Transitions: the settings start with the cut's transition name ("Transition — Slide & fade"); its tile is usually far down the list, so which one a cut had (and why Direction shows or not) wasn't visible. Owner's report of Direction missing on a video→photo cut: that cut had a transition without directions (directions are per transition, not per clip type).
- Transitions panel: the cut's chosen transition comes first — its tile playing, with its name — then its settings (Direction, Feel, Duration, Preview / Apply to all, Remove), then "Change transition" and the list. Owner: settings must read as belonging to a transition.
- Transitions panel opens at the top (the chosen one is shown there), also when switching cuts — no more jumping down the list to its tile.
- Transitions: the "Change transition" line runs edge to edge like the chip bar's, so heading + chips read as one header.
- Transitions: "Change transition" is a section title (white, like the inspector's), so it reads above the list's grey group names (Basic, Slide…).
- **Owner-tested:** Transitions tab works on desktop ✓.
- Tooltips draw above popovers (Your videos, History): new `--vu-z-tooltip` (40), on top of everything; they shared the toast layer, one below popovers. THEMING.md updated.
- Your videos button: clearer tooltip (saved in this browser; start a new one, copy this one, or switch).
- Timeline: a cut's transition button on the selected clip's edge works — a tap / click opens the transition, a drag from it trims (the trim handle used to win, so taps there started a trim). Transitions now open on release, so a scroll that starts on a button no longer opens it (phones). Unit test updated; browser-checked with mouse and real touch events (tap → transition, drag → trim).
- Timeline: where a transition button sits on the selected clip's trim handle, the button is centred on the handle and the handle's arrows sit above and below it (they were hidden behind it, the button half off the handle). Hit area follows (`cutButtonX`).
- Timeline cut buttons, owner's rule: nothing selected → the cut's transition button (click opens it); a clip selected → its edges show only its trim handles, no button; a tap / click on a handle that sits on a cut opens that cut's transition, a drag trims (tooltip says both). The selected clip's handles are drawn after the row's clips, so the right one isn't covered by the next clip. Browser-checked with mouse and real touch on both edges.
- Media panel: thumbnails show on a fresh load. The project opens before its files are read back from storage; tiles asked for a thumbnail too early, got nothing and never asked again (switching tabs remounted them). New `ctl.whenMedia(assetId, signal)`; tiles wait for it. Browser-checked: 3 reloads, all tiles drawn.
- Media panel and Layers panel thumbnails are lazy (decode only when scrolled near the view) and wait for their file on a fresh load. Checked: 40 photos → 9 of 40 thumbnails decoded at the top of the panel; 3 reloads → all visible tiles drawn. PERF.md rule 9 written down (lazy previews everywhere).
- Layers lazy thumbnails, browser-checked: 41 layers (40 photo stickers + the video) → 7 decoded at the top, 15 after jumping to the end (the middle never decoded); after a reload the visible 7 draw.
- **Owner-tested on desktop:** Media tab ✓, Your videos popup (new video / make a copy) ✓.
- Assistant panel: standard panel padding (its content ran edge to edge — it lacked `vu-panel-body`); the example chips get a "Try one of these" label; the greyed Send's tooltip says "Type what you'd like to change first" (it repeated the placeholder).
- Assistant: an Undo button beside "Made N changes", shown only while that turn's changes are the latest step (the turn keeps the project it produced; `undoAssistantTurn`); after it, the turn says "Undone". Browser-checked: warmer → Undo → warmth back to 0; another edit hides it.
- Assistant panel redesigned as a chat: greeting centred while empty; the box pinned to the bottom (text on top, a small send button in its corner); suggestions as short icon pills under it; replies with a sparkle avatar and "✓ Made N changes · Undo" inside the reply; one-line privacy note.
- Playground assistant route: OpenAI-compatible key if set, else Gemini (the voice key, `gemini-3.8-flash` via Google's OpenAI-compatible endpoint), and Claude (`ANTHROPIC_API_KEY`, `claude-opus-5-5` through `@anthropic-ai/sdk`, server-side refusal fallbacks on) when the first fails or none is set. Checked: Gemini answered "make it warmer" and the 2 changes applied.
- Assistant: what you sent shows at once as your message, with a reply bubble of three pulsing dots, "Editing your video…" and Cancel while it works (the empty greeting and a bare spinner line showed before). Reduced motion: still dots.
- Assistant: while it works, the send button turns into a stop button (■) — the Cancel left the reply bubble.
- Assistant Stop: your words go back in the box; the playground route passes the cancel on to Gemini / Claude (request.signal), so they stop too.
- Busy model: a 429/503/529 shows "The AI is busy right now — try again in a moment" (the error carries its status from `createChatAssistant`). Playground route: `gemini-3.8-flash` with a 12 s limit, then `gemini-flash-lite-latest` (measured today: flash 503 after 11 s or hanging past 60 s; lite 6 s), then Claude if set. Real request "add a title Hello at the start and make it warmer" → 2 changes applied.
- Filters panel: previews re-render when you switch to another clip. They were keyed only on the clip's picture settings, so two clips with the same settings (e.g. two untouched clips) kept the first one's previews. Browser-checked switching video ↔ photo.
- Assistant scrolling: the conversation scrolls on its own above a box that never moves (the whole panel scrolled before). Sending brings your message to the top of the chat (a spacer under the newest exchange makes room and shrinks as the answer fills it); the answer never moves the chat. Checked with 5 long mocked replies: your message at the top each time, the reply's start in view, panel never scrolls.
- Desktop: the side panel, settings panel and timeline are resizable by their inner edges (DECISIONS #158): today's sizes are the minimum, ceilings 400 / 400 / 420 px (timeline ≤ 45 % of the height); kept per browser; keyboard and double-click reset. Browser-checked: every limit holds, sizes come back after a reload.
- Assistant instructions: "this / it / the selected one" = the selection; change only what was asked for.
- Timeline can shrink below its default too: 160 px minimum (owner).
- Timeline floor: exactly the ruler + the whole main video row (92 px at normal density; read from the timeline's sizes), owner's ask; the lanes below scroll.

## 2026-10-25 · Vercel build fix

- The first Vercel deploy failed: `pnpm docs:api` (TypeDoc) ran before the packages were built,
  so `@video-ultra/react` couldn't find `@video-ultra/core`'s types (they come from `dist/`,
  which a fresh clone doesn't have). The build command now builds the playground's packages
  first (`turbo run build --filter=playground^...`), then TypeDoc, then the playground.
- GitHub "Release" workflow failed only because the repo doesn't allow Actions to open pull
  requests (owner setting: Settings → Actions → General → Workflow permissions).

## 2026-10-25 · Assistant: media library, rename, naming files (DECISIONS #159)

- Owner asked the assistant to list the media: it said "here it is" and showed nothing — it
  never saw the media library and was told to answer in one sentence. It now gets the video's
  name and the media library, and answers questions in full, one entry per line.
- New actions: rename the video; put a media-library file on the timeline (main video, layer or
  sound lane). New items can be edited in the same answer (`ref`).
- Checked live with Gemini through `/api/assistant`: list media, rename, "put beach.jpg after
  the first clip", music from the start, "make sunset.mov black and white", "add beach.jpg at
  the end and make it black and white", "add a title … and make it fade in" — all applied.
- Playground assistant asks Gemini's lite model first (flash only if lite is busy): answers in
  1–2 s instead of ~13 s while flash is overloaded (owner's choice; no Claude key on a Pro plan).
- Assistant: "make it smoother and high class" was rejected (it tried to animate main clips) and
  the chat still said "I added…". Now a rejected answer is retried once with the reason, a
  rejected turn hides the false claim, and the guide steers main clips to transitions (#160).
  Live with Gemini lite: 3 of 3 right on the first try. `assistant-check` covers the retry; its
  offline-demo part now answers 501 itself (a real key on the dev server made it fail).
- Assistant: reopening the panel on a long chat started at the top; it now opens at the latest
  exchange, as right after sending (`assistant-check` covers it).
- Assistant: "put the watermark diagonal… colour with opacity" failed with "could not be cloned"
  (editing a styled text inside the editor's draft). Fixed in `ops.ts` `copy()` for every op;
  new `place` action (position, size, rotation, opacity); lane items' placement in the
  description (#161). Live with Gemini lite: 5 of 5 centred, −45°, scale 2, coloured, 0.8.
- Assistant: History steps are named after the request ("Assistant: put the watermark…")
  instead of "Assistant edit" for every one (owner couldn't find them; `assistant-check`).

## 2026-10-25 · Captions: English on the device, your own service for the rest (DECISIONS #162)

- Owner: Hindi on the device isn't good enough; offer English only and let hosts plug in their
  own service. `createOnDeviceTranscriber()` hears English only (no `small` model, no Detect /
  model switch, no phone memory warning); `Transcriber.languages` drives the panel's choice —
  one language shows "Spoken language: English". Docs: "Your own captions service" with a
  typed example (checked with tsc). captions-check: Hindi part removed; checks that the device
  offers no language choice; a host service (no list) still offers Hindi.

## 2026-10-25 · Playground captions with Gemini (DECISIONS #163)

- Owner: use Gemini for all captions in the playground. `/api/captions` (Gemini, text only) +
  `server-captions.ts` (30 s chunks, silent ones skipped, retries when busy) + `align-words.ts`
  (word times from the sound — Gemini's own drift by seconds). Live: English 30 s in 3.2 s,
  real Hindi 1 min in ~5 s (chosen and Detect), right script. Timing vs the on-device model:
  0.14–0.25 s mean on three clips. captions-check: a mocked-service section (languages, chunks,
  timing); the on-device parts now force `?transcriber=device`.
- Captions (owner): Hindi speech with another language chosen said "No speech" (Gemini writes
  it in Latin letters or nothing). The route now drops words in another language than the one
  chosen and reports the language heard; the editor says "This sounds like Hindi, not French.
  Choose Hindi or Detect". Language chips: English, Hindi, Detect, then the rest.

## 2026-10-25 · Captions in every language (DECISIONS #164)

- Owner: support all languages through a service the host plugs in; Groq for the playground.
  `createCaptionsEndpoint` (`@video-ultra/ai`) with one fixed reply format (word times
  optional); the playground route uses Groq (`CAPTIONS_API_KEY`) → Gemini → device.
- Every script: one word rule in core (Chinese / Japanese / Thai… character by character, no
  spaces, wrapping between characters, a word's characters kept on one caption); Hindi fill
  highlight no longer runs ahead (graphemes). ~100 languages in the panel with a search; the
  list closes after picking; "Added 1 caption".
- Live through the editor with Groq: English 0.9 s, Hindi 3.6 s (chosen and Detect), Hindi
  with French chosen → "This sounds like Hindi…", Chinese and Japanese 0.5 s. Tests: core word
  rule (7), ai helper (5), captions-check (Chinese with word times).
- Captions (owner): on a clip whose speech starts at 15 s the first caption showed at 0 s
  (Whisper stretches the first word over the silence). `snapToVoice` in the helper moves such
  words onto the voice: first caption now at 15.00 s. New `captions-timing` check with true
  word times from the system voice: Groq 0.05 s mean in English and Hindi (#165).
- Captions (owner): Hindi turned into Urdu partway with Detect — Detect now decides once, and
  Hindi / Urdu goes to Hindi unless the browser says Urdu or Pakistan. Made-up text from
  Whisper on unhearable audio dropped (segment confidence + impossibly fast word runs); longer
  retries honouring Retry-After (#166). All real Hindi test clips: Devanagari only.

## 2026-10-25 · Captions: all 12 improvements (DECISIONS #167)

- Helper (every service): Detect votes; cuts at pauses; up to 3 pieces at once; context and
  names sent; confidence → drop doubtful words, mark captions to check; impossibly fast words
  dropped; no captions when nothing is heard clearly; words past a piece left out.
- On-device speech detector (Silero VAD, 0.64 MB, worker): fixed a real bug — speech under
  music playing throughout was skipped as silence by the loudness method.
- Editor: "N captions to check" + Next + Looks right; Names & words field; Hear this part again;
  Hinglish (Hindi in Latin letters). File version 6 (`unsure`).
- Proof: `captions-timing` — English / Hindi / under music / under noise 0.04–0.07 s mean, 110 s
  talk 99 % words and none doubled, music / noise alone and two buried-speech clips 0 words; one
  known limit (a confident Malay "translation"). captions-check: Hinglish, names, marks, Next,
  Looks right, Hear again, axe with the new controls.
- Hinglish (owner): a language of its own (`hi-Latn`, "Hinglish" chip after Detect), written by
  the service — our own converter removed. Groq: English + a Hinglish prompt → Hinglish on all
  19 Hindi test pieces (#168).
- Captions panel (owner: too much text): the notes under the button are one line ("Under a
  minute · Replaces your captions"; "On this device · 77 MB once" for the on-device model);
  "Names & words (optional)" → "Names to spell right", placeholder "e.g. Priya, Goa".

## 2026-10-25 · Export dialog and camera buttons (DECISIONS #170)

- Owner: the export dialog had too much at once; built from the approved mockup — Quality tiles
  with sizes, Length, "More settings" (frame rate, file type, Extra quality, Smaller file),
  summary + Export under the preview (sticky on phones), "Made for" removed.
- Camera: round microphone / switch-camera buttons beside the record button.
- Resize handles: aria values from the start (a11y-check was failing on them).
- Checks: editor-interact (Chrome + WebKit export), a11y-check dark + light 0 violations,
  camera-check, combine-ui-check, ui-review (no page errors).
