# video-ultra — Performance

Speed, memory and "never hangs" are the product's main promise. This file holds the targets, how
we measure them, and every measurement (newest first). A regression against a target is a bug.

## Targets

Starting targets (2026-10-17), to be confirmed or adjusted with Phase 0 measurements.

| Metric                                             | High tier (desktop)            | Low tier (2020 Android / iPhone XS) |
| -------------------------------------------------- | ------------------------------ | ----------------------------------- |
| Editor interactive after mount                     | < 1 s                          | < 2 s                               |
| Input response (tap, drag)                         | < 16 ms                        | < 33 ms                             |
| Main-thread tasks > 50 ms while editing or playing | **0**                          | **0**                               |
| 1080p playback, 3 layers                           | 60 fps                         | ≥ 30 fps                            |
| Scrub: frame shown after the playhead stops        | < 100 ms                       | < 250 ms                            |
| Memory over a 30-min session                       | flat (no growth)               | flat                                |
| Open `VideoFrame`s after any operation settles     | ≤ decoder budget, 0 after stop | same                                |
| Initial JS (gzip), UI shell                        | < 200 KB                       | same                                |
| Export 1080p30                                     | faster than real time          | ≤ 2× real time                      |

## How we measure

- **Bench page** in the playground (`/bench`): opens from a phone on the same Wi-Fi. Runs a fixed
  set of scenarios on generated and real test media and prints a table to copy here.
- **Long tasks:** `PerformanceObserver({ type: 'longtask' })` on the main thread during every
  scenario (Chrome; Safari lacks it → we also sample `requestAnimationFrame` gaps).
- **Frame timing:** per-frame decode time, composite time, and present interval in the worker;
  dropped = frames whose deadline passed before present.
- **Memory:** `performance.measureUserAgentSpecificMemory()` where available (needs isolation —
  usually not), else `performance.memory` (Chrome), plus our own counters: open VideoFrames,
  GPU texture bytes, cache bytes. On iPhone, watch for tab reloads ("A problem repeatedly
  occurred") — that is the OOM signal.
- **Soak:** 30 minutes of play / scrub / edit loops; memory and open-frame count must be flat.

## Rules that keep us fast (also in CLAUDE.md)

1. Main thread: UI only. Decode, composite, mix, analyse and export happen off it.
2. React never renders per frame; the timeline is a canvas.
3. One owner per `VideoFrame`; closed exactly once; leak counter in tests.
4. Read media by range; byte budgets on every cache; GPU resource pools.
5. No allocation in hot loops.
6. Drags commit one operation on release.
7. Backpressure + cancellation + watchdog.
8. Degrade preview resolution before smoothness; drop video before audio.

## Measurements

### 2026-10-17 · Phase 0 lab · MacBook (Apple M4, 16 GB, macOS 15.5)

`node scripts/bench.ts` — headless, so these are best-case desktop numbers. Single layer, preview
canvas 1280 px wide. Export = 5 s at 1080p30 with audio. Test files have one keyframe every
~8 s (x264 default), the worst case for seeking. **Phones still to measure (owner's iPhone).**

**Chrome 155 (installed Chrome, real GPU, hardware decode)**

| File                      | Renderer        | Play: presented / dropped | Scrub p50 / p95 (ms) | Export (× real time) |
| ------------------------- | --------------- | ------------------------- | -------------------- | -------------------- |
| H.264 1080p30             | WebGPU          | 298 / 2 (startup)         | 63 / 91              | 2.1×                 |
| H.264 4K30 (57 Mbps)      | WebGPU          | 300 / 0                   | 263 / 503 ❌         | 2.5×                 |
| H.264 4K30                | WebGL2          | 299 / 1                   | 235 / 488 ❌         | 5.0×                 |
| HEVC 1080p30              | WebGPU / WebGL2 | 300 / 0                   | 45 / 90              | 4.1× / 4.3×          |
| HEVC 10-bit HLG (HDR)     | WebGPU / WebGL2 | 179 / 1 · 180 / 0         | 37 / 63              | 4.1× / 5.3×          |
| H.264 rotated (portrait)  | both            | 180 / 0                   | 60 / 98              | 4.9× / 5.2×          |
| H.264 VFR                 | both            | 180 / 0                   | 22 / 36              | 3.8× / 4.3×          |
| VP9 1080p30               | both            | 300 / 0                   | 66 / 150 ❌          | 4.0× / 5.1×          |
| AV1 1080p30               | both            | 300 / 0                   | 42 / 71              | 4.1× / 5.1×          |
| H.264 1080p60 (two files) | both            | 600 / 0                   | 40 / 103             | 4.9× / 5.4×          |

Every run: **0 main-thread tasks > 50 ms, max 1 open VideoFrame, 0 open after.** Draw CPU per
frame ≈ 0.2 ms. Main-thread JS heap ≈ 14–15 MB.

**WebKit (Playwright build ≈ Safari engine; no WebGPU in this build)** — WebGL2: 1080p30 300 / 0,
scrub 75 / 98 ms, HLG 37 / 73 ms, VP9 79 / 168 ms. Export 2.7× real time (memory fallback: no
OPFS in Playwright's WebKit). 0 long tasks, 0 leaked frames.

**Firefox 157** — WebGL2 (no WebGPU on macOS here): 1080p30 300 / 0 but **scrub 240 / 356 ms**
(slowest), VP9 122 / 331 ms. No HEVC decode. No native AAC encoder → WASM AAC fallback: export
3.5× real time. 0 long tasks, 0 leaked frames.

**Soak, 10 minutes (Chrome, WebGPU, 360p30):** 18,000 frames presented, **0 dropped**, frame
interval p95 37 ms, max 1 open VideoFrame, 0 after; main-thread heap 15.0 → 13.8 MB (flat);
0 long tasks. Worker-side memory isn't measured yet (Day 3: add worker heap + GPU byte counters).

**Exports verified with ffprobe + full ffmpeg decode** (Chrome, WebKit, Firefox): 150 frames / 5 s,
AAC 48 kHz stereo (also from mono 22 kHz input), rotated input → 1080×1920 output, no decode errors.

**Bundle:** main-thread page JS 139 KB gz (incl. React + Next). Worker (engine + Mediabunny)
107 KB gz. WASM AAC fallback 281 KB gz, loaded only by browsers without native AAC, only on export.

**Owner's real iPhone footage (Chrome / WebKit, desktop):** all iPhone videos are HEVC Main 10,
HLG + Dolby Vision 8.4, mostly rotated, with an AAC track **and** an Apple spatial-audio (APAC,
4 ch) track. The engine picks the AAC track correctly.

| File                             | Chrome play / scrub p95 / export | WebKit play / scrub p95 / export |
| -------------------------------- | -------------------------------- | -------------------------------- |
| 1080p30 HDR portrait             | 300/0 · 24 ms · 2.3×             | 300/0 · 32 ms · 2.9×             |
| 4K60 HDR portrait (54 Mbps)      | 600/0 · 97 ms · 5.5×             | **415/185** · 116 ms · 1.0×      |
| 1080p29.97 HDR landscape, mono   | 300/0 · 25 ms · 4.8×             | 300/0 · 29 ms · 2.8×             |
| Screen recording HEVC 60 fps VFR | 600/0 · 110 ms · 6.1×            | 600/0 · 116 ms · 2.2×            |
| Social H.264 Baseline VFR        | 296/0 · 15 ms · 3.8×             | 296/0 · 20 ms · 6.1×             |

iPhone keyframes are ~1 s apart, so scrubbing real footage is far faster than our synthetic
long-GOP files. Firefox can't decode any of the iPhone HEVC files.
**HDR looks washed out in the Chrome/WebGPU export** (HLG clipped, not tone-mapped); WebKit's
WebGL2 output looks natural. Tone-mapping is now top of Day 3.

**Scrubbing with `FrameSource` (2026-10-17, Chrome / WebKit):** forward steps continue one
decoder, jumps restart from the keyframe, latest request wins. "Drag" = 45 seeks 16 ms apart.

| File                               | Frames shown during drag | Final frame after release | Random jump p95 |
| ---------------------------------- | ------------------------ | ------------------------- | --------------- |
| iPhone 1080p30 HDR                 | 45 / 44                  | 0 / 0 ms                  | 31 / 35 ms      |
| H.264 1080p                        | 43 / 43                  | 0 / 0 ms                  | 96 / 112 ms     |
| VP9 1080p                          | 42 / 42                  | 0 / 0 ms                  | 162 / 175 ms    |
| VFR 720p                           | 45 / 44                  | 0 / 0 ms                  | 39 / 106 ms     |
| iPhone 4K60 HDR                    | **1 / 1**                | 81 / 102 ms               | 104 / 121 ms    |
| 4K long-GOP (synthetic worst case) | 26 / **2**               | 0 / **1325 ms**           | 500 / 805 ms    |

Before (one `getSample` per seek): final frame after a drag 160–500 ms. Fast drags on 4K can't
keep up with exact frames → thumbnails during fast drags (BACKLOG).

**What this tells us**

- Playback, decoding and export are comfortably fast on desktop in every browser; the main thread
  stays free and frames never leak. The worker architecture works.
- **Seeking long-GOP 4K and VP9 misses the scrub target** (p95 0.5 s / 0.15–0.33 s). Fix in
  Phase 2: show the nearest keyframe immediately, then refine; keep a forward-decoding decoder warm
  while scrubbing; on-demand proxies for long-GOP 4K on low tier.
- **WebGPU export is ~2× slower than WebGL2 export** (canvas capture from a WebGPU canvas costs
  more). Phase 2: measure capture paths; until then export renders with WebGL2.
- Firefox is the slowest seeker; its numbers set the "mid" expectations for desktop.
