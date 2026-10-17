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
