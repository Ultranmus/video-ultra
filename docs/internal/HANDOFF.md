# video-ultra — Handoff

Where the last session stopped and what comes next. Update before ending every session.

## 2026-10-17 (end of Day 1 + half of Day 2)

**Done:** Day 1 (Phase 0) complete except the owner's iPhone run. Day 2 items 1.1–1.4 done
(model, edit ops, undo/redo + op log, property tests). See PROGRESS.md and PERF.md.

**Waiting on the owner (Day 1 checkpoint):**

1. **Run the bench on the iPhone.** Needs HTTPS (WebCodecs/WebGPU/OPFS require a secure
   context). Owner to choose: Vercel preview deploy of the playground, a tunnel
   (`cloudflared`), or a trusted local certificate (mkcert + install the CA on the phone).
2. **3–4 iPhone files** into `test-media/private/`: HDR video (default camera), portrait video,
   slow-motion clip, HEIC photo.
3. ~~Rust toolchain~~ — installed. ~~GitHub repo~~ — `Ultranmus/video-ultra` (private) pushed.
   Owner's iPhone files linked in `test-media/private/` (no HEIC or slow-mo yet).

**Next (Day 2 rest → Day 3):**

- 1.5 Media probing module (`media/probe.ts`) from the lab's `load()`: codec, rotation, VFR,
  HDR, audio layout, decodability, truncated-file detection → `Asset`.
- 2.1 Decoder pool: per-tier decoder budget, LRU close, cancellation, watchdog; keyframe-first
  scrubbing (fixes the long-GOP scrub misses in PERF.md).
- Then Day 3: real compositor (WGSL → GLSL), HDR tone-mapping, audio engine, device tiers.

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
