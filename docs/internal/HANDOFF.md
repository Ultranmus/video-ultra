# video-ultra — Handoff

Where the last session stopped and what comes next. Update before ending every session.

## 2026-10-17 (end of Day 1 + half of Day 2)

**Done:** Day 1 (Phase 0) complete except the owner's iPhone run. Day 2 items 1.1–1.4 done
(model, edit ops, undo/redo + op log, property tests). See PROGRESS.md and PERF.md.

**Waiting on the owner (Day 1 checkpoint):**

1. **iPhone bench run — batched** after the next 3–4 tasks (owner). Path: Vercel preview of the
   playground with a shareable link; exclude test media from the upload.
2. iPhone files: done (8 files). Still wanted: one **HEIC photo** (+ optional slow-mo clip).
3. ~~Rust toolchain~~ — installed. ~~GitHub repo~~ — `Ultranmus/video-ultra` (private) pushed.
   Owner's iPhone files linked in `test-media/private/` (no HEIC or slow-mo yet).

**Batch before the next iPhone check (owner: check after 3–4 tasks):**

1. ✅ HDR research (research/HDR.md, DECISIONS #33)
2. ✅ Media probing (`media/probe.ts`, `scripts/probe-check.ts` — all pass in 3 browsers)
3. ✅ Decoder pool + scrubbing (`engine/frames.ts`, DECISIONS #34; numbers in PERF.md)
4. ⏳ **Next:** HDR correction shader + startup self-calibration (WGSL → GLSL via naga), then
   deploy the playground as a Vercel preview (ask the owner first) for the batched iPhone check.

Then Day 3 proper: compositor (layers, transforms), audio engine + A/V sync, device tiers.

## How to run things

```sh
pnpm install && pnpm media && pnpm build
pnpm --filter playground dev                    # http://localhost:3200/bench
node scripts/bench.ts --browsers chrome,webkit,firefox [--backends auto,webgl2] \
  [--files avc-1080p30.mp4,...] [--play 600] [--save <dir>]
FC_RUNS=30000 pnpm --filter @video-ultra/core test   # deep property test
```

The `chrome` bench target is the installed Google Chrome (real GPU); `webkit` is Playwright's
build (no WebGPU, no OPFS — real Safari must be tested on the owner's devices).
