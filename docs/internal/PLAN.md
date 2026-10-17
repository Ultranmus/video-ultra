# video-ultra — Plan

Start: 2026-10-17. v0.1 (production quality) in one week; full scope in about a month.
Work runs in long stretches; the owner reviews at milestones. **Device checks are batched:** one
iPhone check after every 3–4 completed tasks (owner, 2026-10-17), via a Vercel preview of the
playground (shareable link; videos picked from the phone's gallery — test media is never
uploaded). Android when available (in between: Chrome with CPU throttling + low tier + forced
WebGL2).

## Releases

| Release                       | Week | Contents                                                                                                                                                                                                                                                                      |
| ----------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1 — InShot layer**       | 1    | Production-quality simple editor (below)                                                                                                                                                                                                                                      |
| **v0.2 — + Canva layer**      | 2    | Text & element animations, elements library, templates, scenes + scene transitions, brand kit, magic resize, guides/layers/grouping, background remover (images), beat sync, speed curves, reverse                                                                            |
| **v0.3 — + Pro layer**        | 3    | Pro multi-track mode, ripple/roll/slip/slide, keyframes + graph editor, masks, blend modes, chroma key, LUTs, colour wheels, scopes, audio EQ/pitch/noise reduction (Rust WASM), more export formats (MOV/MKV, H.265/AV1, audio-only, subtitles), image-ultra "Advanced edit" |
| **v0.4 — AI + 1.0 hardening** | 4    | `@video-ultra/ai`: captions, silence removal, scene detection, video background removal. Full device pass, perf tuning, docs → aim for 1.0                                                                                                                                    |

Weeks 2–4 get a day-by-day plan when they start, adjusted by what week 1 teaches us.

## v0.1 definition of done (every feature)

1. Works on iPhone Safari, Android Chrome, desktop Chrome / Safari / Firefox / Edge.
2. Handles the real-world media library (`pnpm media`), not one sample file.
3. Never loses work (autosave, crash recovery, undo).
4. Never freezes (PERF.md targets on a low-tier device).
5. Fails clearly (what went wrong + what to do), never a blank screen.
6. Has automated tests, is accessible, is documented.

### v0.1 features

- Import video / photos / audio (incl. iPhone HDR, HEVC, HEIC); media panel
- Main track + layer lanes; split, trim, delete, duplicate, reorder, freeze frame
- Speed 0.1×–10× (constant), volume, mute, fade in/out, extract audio
- Crop, rotate, flip, canvas ratios (9:16, 1:1, 16:9, 4:5, 4:3, 21:9), background colour / blur, fit/fill
- Filters (12–16 presets) + adjustments
- Transitions (6–8: fade, dissolve, slide, zoom, wipe, blur…)
- Text (styles, fonts, outline, shadow, background), stickers / emoji, picture-in-picture
- Music and sound-effect tracks, voiceover recording
- Export MP4 (H.264/AAC) and WebM, 480p–4K (device limit), 24/30/60 fps, quality picker
- Autosave, crash recovery, undo/redo, keyboard shortcuts
- Themes, i18n labels, accessibility, `<VideoEditor />` with `initialProject` / `onSave` / `onExport`

Deferred to v0.2+: speed curves, reverse, text animations, templates, keyframes, masks, chroma key.

## Week 1 — day plan

### Day 1 — Foundations + performance proof (Phase 0)

- [x] 0.1a Monorepo skeleton (pnpm, turbo, TS, ESLint, Prettier, changesets), LICENSE
- [x] 0.1b `CLAUDE.md` + all `docs/internal/` docs
- [x] 0.1c CI workflow, git init, first commit
- [x] 0.2 Spike: Mediabunny decode in a worker → WebGPU (`importExternalTexture`) and WebGL2 → playback; measure frame time, decode time, memory, dropped frames
- [x] 0.3 Spike: 1080p MP4 export via WebCodecs, streamed to OPFS; measure speed + memory
- [x] 0.4 Spike: engine worker shipped inside the package loads in Next.js (Turbopack) and Vite → works with tsup (DECISIONS #22); bundler choice final on Day 7
- [x] 0.5 Capability detection + device tier (`detectCapabilities()`), bench page (phone access needs HTTPS — owner decision)
- [x] 0.6 Test media library: download free-licence files + generate edge cases with ffmpeg (`pnpm media`)
- [ ] **Checkpoint:** owner runs the bench on iPhone + Mac browsers → go / no-go on the engine design; owner supplies 3–4 iPhone files (HDR, portrait, slow-mo, HEIC); decide on installing Rust (for naga)

### Day 2 — Core engine (Phase 1) + decoder pool

- [x] 1.1 Project model, time in integer flicks (no float drift), Zod schema + migrations + repair
- [x] 1.2 Edit operations: add, move, trim, split, delete, duplicate, speed, reorder, freeze frame, transitions, properties
- [x] 1.3 Operation log + undo/redo + coalescing + log replay (OPFS persistence adapter → Day 6, 4.2)
- [x] 1.4 Property tests (fast-check): random edit sequences never break invariants (30,000 runs pass)
- [x] 1.5 Media probing: duration, codecs, rotation, VFR, HDR, audio-track choice (skips iPhone spatial audio), clear unsupported-codec messages, incomplete-file detection with playable length (`scripts/probe-check.ts`: all pass in 3 browsers)
- [ ] 2.1 Decoder pool with tier budget, frame scheduling, cancellation, watchdog
- [ ] **Checkpoint:** engine demo in the playground

### Day 3 — Playback engine (Phase 2)

- [ ] 2.2 Compositor: WGSL → GLSL build step; WebGPU + WebGL2 backends; layers, transforms, opacity
- [ ] 2.3 HDR → SDR tone-mapping; rotation; golden-frame tests on both backends
- [ ] 2.4 Audio engine: AudioWorklet mixer, audio-driven clock, A/V sync, fades
- [ ] 2.5 Device tiers in action: adaptive preview resolution, cache budgets, frame-leak counter
- [ ] 2.6 30-minute soak test + main-thread long-task monitor
- [ ] **Checkpoint (iPhone + Android):** multi-clip playback on phones

### Day 4 — Editor UI shell (Phase 3a)

- [ ] 3.1 `--vu-*` tokens, dark/light/auto, `@layer` CSS, typed `themeOverrides`
- [ ] 3.2 Layouts: phone (InShot), tablet, desktop (panel + stage + inspector + timeline), container queries
- [ ] 3.3 Media import (picker, drag-drop, file handles), media panel, per-file errors, HEIC/HEVC handling
- [ ] 3.4 Canvas timeline: main track + lanes, playhead, zoom, snapping, thumbnails, waveforms, accessible layer
- [ ] 3.5 Selection, contextual toolbar, direct manipulation on the stage (move / scale / rotate)
- [ ] **Checkpoint:** layout + feel on iPhone and Mac

### Day 5 — Editing tools (Phase 3b)

- [ ] 3.6 Split, trim, delete, duplicate, reorder, freeze frame
- [ ] 3.7 Speed, volume, mute, fades, extract audio
- [ ] 3.8 Crop, rotate, flip, canvas ratio, background colour / blur, fit/fill
- [ ] 3.9 Filters + adjustments, transitions
- [ ] 3.10 Text, stickers / emoji, picture-in-picture, music + SFX tracks, voiceover
- [ ] **Checkpoint:** owner edits a real video end to end

### Day 6 — Export, saving, production pass (Phase 4)

- [ ] 4.1 Export MP4/WebM: resolution / fps / quality, progress, cancel, streaming to disk, tier limits, background-tab handling
- [ ] 4.2 Autosave via op log, crash recovery, `storage.persist()`, `initialProject` / `onSave` / `onExport`
- [ ] 4.3 Cross-browser e2e (Chromium, WebKit, Firefox), perf fixes on low tier, error screens, storage-full handling
- [ ] 4.4 Accessibility audit (axe + keyboard + VoiceOver), i18n labels
- [ ] **Checkpoint (iPhone + Android):** create → export → reopen on every device

### Day 7 — Release v0.1

- [ ] 5.1 Docs site + API reference + examples (Next.js, Vite)
- [ ] 5.2 Package checks (publint, attw, size limits), fresh install from npm tarball; turn CI back on for push / PR + add the release workflow
- [ ] 5.3 Fix Day 6 findings
- [ ] 5.4 **Owner publishes** (`changeset publish`) + deploys the demo site
