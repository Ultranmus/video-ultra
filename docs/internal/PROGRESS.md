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
