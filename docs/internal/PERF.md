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

**GPU draw cost per frame**, `node scripts/effects-bench.ts` (new; `/lab/engine?bench=1`): each
case at its midpoint on a 1080 × 1920 canvas — two full-screen photo layers + overlay, 60-frame
batches timed to a forced read-back, best of 3.

| case                        | Chrome WebGL2 | Chrome WebGPU | WebKit WebGL2 |
| --------------------------- | ------------: | ------------: | ------------: |
| one plain layer             |          0.42 |          0.24 |          0.30 |
| dissolve (2 layers)         |          0.55 |          0.47 |          0.55 |
| blur (disc, 13 taps × 2)    |          1.76 |          1.41 |          1.75 |
| zoom-blur (radial)          |          1.60 |          1.32 |          1.60 |
| spin-zoom                   |          1.98 |          1.77 |          1.98 |
| **spin-blur (heaviest)**    |      **2.12** |      **1.90** |      **2.12** |
| motion-blur / whip (line)   |     1.80–1.85 |          1.43 |     1.78–1.80 |
| swirl / ripple / lens       |     0.68–0.74 |     0.52–0.56 |     0.63–0.70 |
| vhs / glitch / rgb-split    |     0.33–0.79 |     0.25–0.63 |     0.30–0.75 |
| heart / star / checker      |     0.71–0.78 |     0.55–0.60 |     0.67–0.73 |
| noise / page-curl / cube    |     0.58–0.79 |     0.48–0.61 |     0.53–0.73 |
| light-leak / film-burn      |          0.90 |          0.72 |     0.83–0.87 |
| static (overlay + noise)    |          1.06 |          0.81 |          1.00 |
| animation blur, full screen |          0.91 |          0.69 |          0.87 |
| blur, low tier              |          1.23 |          0.95 |          1.18 |
| spin-blur, low tier         |          1.43 |          1.22 |          1.38 |
| motion-blur, low tier       |          1.21 |          0.99 |          1.17 |

(Firefox numbers came out lower than its 'none' baseline for some rows — its read-back doesn't
seem to wait for the GPU; not used.) The heaviest families are the 13-tap blurs (≈ 3–4 × a
dissolve); everything else costs ≤ 2 × a dissolve. A budget phone GPU is maybe 10–20 × slower
than the M4 but previews at ≤ 960 px (¼ of these pixels) with half-tap blurs: est. 5–8 ms for the
worst frame of a blur transition — **to be confirmed on a real low-end Android** (BACKLOG).

**Preview with the new demo** (`engine-check`, demo now has a light leak, a v0.1 slide, a cube,
a typewriter title, a popping / wiggling / spinning-out sticker, a sliding logo and a flipping
PIP): Chrome WebGPU and WebGL2 509/510 frames, 0 late, 0 skipped, draw 0.3 / 0.6 ms, 0 long
tasks; tier low the same (1 late at 0.03 s on WebGPU); Firefox 509/510, 0–9 late (one run had a
cluster at 0.5–0.7 s when the title and sticker first appear, the next run had none); Playwright
WebKit 498–509/510 with 8–9 late at the light-leak and slide cuts (two videos uploading — the
known test-build upload cost), one run with 22 audio underruns (the next had 0).

**Export** (`export-check`, 720p, same demo): Chrome MP4 3.65–3.72 ×, WebM 9.2 ×; WebKit 2.5 ×;
Firefox MP4 3.2 ×, WebM 0.74 × (known, BACKLOG). All ffprobe / full-decode / duration / lip-sync
checks pass. **Export = preview:** frames decoded from the files at a sticker pop-in + typewriter,
a logo slide-in, the light leak and the cube match the engine's own capture of that moment
(MP4 1.1–3.0 / 255 in all three browsers, WebM 1.7–7.7 / 255) against 8–44 / 255 for the
frame 0.25 s later.

**Golden frames** (`composite-check`, 3 browsers): 30 transition families at 30 % of the window
with lane overlays: overlays untouched on both backends; every transition changes the picture;
WebGPU vs WebGL2 worst 5.32 / 255 against a 4.18 decode baseline (bbb footage); Chrome vs
Firefox worst 4.99 / 255. Animations (typewriter, pop-in, spin loop, slide-in) at 0.3 / 0.5 /
1.5 / 2.25 s: WebGPU = WebGL2 (0.00 above baseline), typewriter monotonic, settled frames equal
the unanimated ones.

**Bundle:** shader source 22 → 65 KB raw in `generated.ts` (engine worker chunk; 82 KB before
deriving the WebGPU variant at load time). The catalogues the UI imports (`presets.ts`, minified +
gzip): 1.0 KB (v0.1) → 4.1 KB (115 filters, 76 transitions, 70 animations; 11 KB before the
data/engine split, #86).

### 2026-10-17 · Editor UI (Mac M4, headless; dev server unless noted)

`scripts/editor-interact.ts` (import, seek, split, undo/redo, trim drag, text, stage drag,
delete, export 480p, play 2 s) and `editor-check.ts` (phone / tablet / desktop):

| Browser | Ready after mount | Long tasks while editing / playing | Startup long tasks       | Play 2 s      |
| ------- | ----------------- | ---------------------------------- | ------------------------ | ------------- |
| Chrome  | 350–590 ms        | **0**                              | 2 × 70–170 ms (prod too) | 60/60, 0 late |
| WebKit  | 245–272 ms        | **0**                              | 0                        | 60/60, 0 late |
| Firefox | 288–300 ms        | **0**                              | 0                        | 61, 0–7 late  |

Chrome's two startup tasks happen in the first ~0.5 s (before any input) — suspected AudioContext +
worklet setup (#44) and the capability probe (BACKLOG). Fast 4K scrub: the thumbnail stand-in
covered 37 of 40 drag steps (was ~1 exact frame). Export through the dialog, ~13 s project at
480p MP4: 2.9–4.4 s. Timeline thumbnails byte budget 6 / 16 / 32 MB per tier (UI cache, on screen + scroll room) on
top of the analyzer's own 8 / 24 / 48 MB cache.

### 2026-10-17 · Effects + export

**Preview with effects** (`scripts/engine-check.ts`, demo now: 5 main clips with a filter, an
adjustment, dissolve + slide + wipe, PIP video, PNG, title with outline/box, emoji, blurred bg):

| Browser · path               | Frames    | Late | Skipped | Draw / frame (6–8 layers + blur bg) | Long tasks |
| ---------------------------- | --------- | ---- | ------- | ----------------------------------- | ---------- |
| Chrome · WebGPU              | 509 / 510 | 0    | 0       | 0.3 ms                              | 0          |
| Chrome · WebGL2              | 509 / 510 | 0    | 0       | 0.6 ms                              | 0          |
| Chrome · WebGL2, tier low    | 509 / 510 | 0    | 0       | 0.3 ms (2 decoders)                 | 0          |
| Firefox · WebGL2             | 510 / 510 | 1    | 2       | 3 ms                                | 0          |
| WebKit (Playwright) · WebGL2 | 510 / 510 | 9    | 10      | 7 ms (test-build upload cost)       | 0          |

A/V p95 1.5–1.7 ms Chrome, 6 ms Firefox, 15 ms WebKit. WebKit's late frames sit at the slide-left
transition (two videos uploading in the test build at ~8 ms each) and the known PIP cuts; tier
low in WebKit dropped preview quality to 0.5 and had one 242 ms A/V spike. CPU throttling via CDP
only slows the page, not the engine worker, so it doesn't imitate a budget phone (use `?tier=low`
plus a real device).

**Export** (`scripts/export-check.ts`, the 17 s demo, × real time = media seconds / wall seconds):

| Browser         | MP4 720p | WebM 720p | MP4 1080p                    | WebM 1080p | Storage |
| --------------- | -------- | --------- | ---------------------------- | ---------- | ------- |
| Chrome (WebGL2) | 3.5–3.7× | 8.6–9.4×  | 2.6–2.9× (first), 5.7× (2nd) | 7.9–8.2×   | OPFS    |
| Chrome (WebGPU) | 3.5×     | 12.8×     | 2.5–2.7×                     | 8.8–9.2×   | OPFS    |
| WebKit (PW)     | 2.5×     | 2.6×      | –                            | –          | memory  |
| Firefox         | 2.7×     | **0.71×** | –                            | –          | OPFS    |

The first H.264 export in a page session composes at ~6 ms/frame, later ones at ~0.5 ms (decoder
warm-up with the H.264 encoder running) — 136 s at 1080p: 4.4–5.5× real time. Per frame (1080p
Chrome): compose 0.5–6 ms, encoder wait 3–6 ms, audio mix 0.1 ms.

**Memory during export** (`--repeat 8 --memory`: 136 s, 4080 frames at 1080p, RSS of every process
of that Chrome): first export in a session +105–148 MB (warm-up), later exports flat (+15–19 MB
first → last third; −13 / −21 MB for WebM). 0 open VideoFrames after every export, 0 missing
layers. Before releasing finished clips during export (fixed) every clip kept its last 1080p frame.

**Every export verified** with ffprobe (`-count_frames`) + a full ffmpeg decode: 510 frames
(4080 for the long one), 720 × 1280 / 1080 × 1920, H.264 + AAC 48 kHz stereo or VP9 + Opus,
audio within one codec frame of the video (AAC 17.003–17.024 s, Opus 17.014–17.027 s for 17.000 s),
lip sync at the 14 s cut: MP4 0.0 ms (Chrome, Firefox) / 2.6 ms (WebKit); WebM 0–9 ms
(WebKit: 30 ms, see BACKLOG). Cancel → `AbortError` and no file left in OPFS.

**Golden frames** (`scripts/composite-check.ts`, `/lab/engine?golden=1` through `engine.capture`):
warm filter, contrast + saturation + vignette, dissolve midpoint, wipe midpoint, title text, blur
background — checked per backend; WebGPU vs WebGL2 differ by ≤ the browser's own decode
difference (Chrome: 1.1–2.5 / 255 vs a 2.1 baseline on the plain video; text 0.0–0.2), Chrome vs
WebKit 0.5 / 255. Passes in Chrome (both), WebKit and Firefox (WebGL2).

### 2026-10-17 · Media analyzer (Mac M4, headless, `scripts/analyzer-check.ts`, tier mid)

20 thumbnails 96 px high requested at once (as a timeline strip), fresh analyzer each:

| File                                  | Mode     | Chrome first / all 20 | WebKit first / all 20 | Firefox first / all 20 |
| ------------------------------------- | -------- | --------------------- | --------------------- | ---------------------- |
| 60 s 1080p H.264 (keyframe every 1 s) | keyframe | 10 / 55 ms            | 25 / 245 ms           | 12 / 72 ms             |
|                                       | exact    | 22 / 178 ms           | 48 / 494 ms           | 30 / 397 ms            |
| 4K30 H.264, long GOP                  | keyframe | 33 / 77 ms            | 61 / 249 ms           | 42 / 106 ms            |
|                                       | exact    | 65 / 697 ms           | 104 / 1208 ms         | 99 / 2016 ms           |
| HEVC 1080p                            | keyframe | 8 / 14 ms             | 28 / 54 ms            | (no HEVC)              |
| iPhone 4K60 HDR HEVC portrait         | keyframe | 14 / 360 ms           | 46 / 555 ms           | (no HEVC)              |
|                                       | exact    | 59 / 874 ms           | 81 / 1303 ms          | (no HEVC)              |

Same strip again (cache): 1–7 ms. Cold start (new worker + first file): first thumbnail 56 ms
Chrome, 78 ms WebKit, 27 ms Firefox. Low tier (1 decoder, Chrome): 60 s strip 67 ms.
Photo 12 MP → 128×96: 39–59 ms. Probe in the worker: 6–30 ms.

Waveforms (100 peaks/s; levels match ffmpeg volumedetect to 3 decimals):

| File                     | Chrome | WebKit | Firefox |
| ------------------------ | ------ | ------ | ------- |
| 3-min MP3 (18,005 peaks) | 220 ms | 394 ms | 522 ms  |
| 60 s video (AAC)         | 86 ms  | 189 ms | 195 ms  |
| 20 s AAC m4a             | 25 ms  | 39 ms  | 59 ms   |

20 thumbnails requested while the 3-min waveform decodes: 50 / 229 / 115 ms (they don't wait for
it; low tier Chrome 60 ms). Abort: 30 of 40 aborted → all 30 resolve `null` at once, only the 10
live ones decode. **0 main-thread long tasks, 0 open frames after every scenario, in all three.**

### 2026-10-17 · Storage (`scripts/storage-check.ts`, `storage.test.ts`)

| Check                                      | Chrome                   | Firefox            | WebKit (Playwright) |
| ------------------------------------------ | ------------------------ | ------------------ | ------------------- |
| Backend · open time                        | OPFS · 14–17 ms          | OPFS · 28–45 ms    | memory (no OPFS)    |
| Reload after 40 edits (no explicit flush)  | 40 / 40, exact           | 40 / 40, exact     | in-page only        |
| Tab killed mid-burst (edit every 5 ms)     | crash: 373 of ~380       | close: 282 of ~310 | —                   |
| Load (snapshot + log replay)               | 2–6 ms                   | 2–5 ms             | —                   |
| Copy 57 MB into OPFS (worker, sync handle) | 64–87 ms (~650–890 MB/s) | 56–61 ms (~1 GB/s) | —                   |
| Same with main-thread `createWritable`     | 64–83 ms                 | 63–66 ms           | —                   |
| 500-item project: stringify / attach+flush | 0.1 ms / 5 ms            | ≤ 1 ms / 3–10 ms   | —                   |
| Main-thread long tasks                     | 0                        | 0                  | 0                   |

Killed-tab recovery is always exactly a saved state, and never older than what the 250 ms batch
had written (edits made ≥ 1 s before the kill are always there). Node (vitest): 500-item project
175 KB JSON, stringify 1.0 ms, load 14 ms. Crash property test (random edits, random flushes, a
crash at a random byte, random snapshotEvery 2–12): 2000 runs pass (`FC_RUNS=2000`).

### 2026-10-17 · Engine v1 · demo project (Mac, headless)

`scripts/engine-check.ts`: 17 s, 9:16, five main clips (H.264, photo, HEVC, rotated portrait,
real footage) + PIP video + transparent PNG, played start to end by the engine worker.

| Browser · path               | Frames    | Late | Skipped | Draw / frame             | Main-thread long tasks |
| ---------------------------- | --------- | ---- | ------- | ------------------------ | ---------------------- |
| Chrome · WebGPU              | 510 / 510 | 0    | 0       | 0.2 ms                   | 0                      |
| Chrome · WebGL2              | 510 / 510 | 0    | 0       | 0.3 ms                   | 0                      |
| WebKit (Playwright) · WebGL2 | 509 / 510 | 0    | 0       | 9 ms (test-build upload) | 0                      |

With audio (AudioWorklet, audio-driven clock), same demo:

| Browser · path               | Underruns | A/V offset p50 / p95 / max                           | Main-thread long tasks |
| ---------------------------- | --------- | ---------------------------------------------------- | ---------------------- |
| Chrome · WebGPU              | 0         | 0.5 / 1.2 / 16 ms                                    | 0                      |
| Chrome · WebGL2              | 0         | 0.8 / 1.5 / 24 ms                                    | 0                      |
| WebKit (Playwright) · WebGL2 | 0         | 8 / 13 / 76 ms (late frames at the 2 s and 7 s cuts) | 0                      |

Lip-sync errors become noticeable around 40 ms. `scripts/audio-check.ts` verifies the mixer's
output: tone levels, volume 0.5 = half level (0.472), linear 1 s fade-in, MP3 44.1 → 48 kHz, clip
end, no clipping.

At the end: 1 decoder and 1 held frame (idle clips give theirs back). Paused seek → first draw
42–110 ms, all layers 42–184 ms (Chrome); the slowest is the first seek (cold PIP decoder).

### 2026-10-17 · Engine soak (Chrome, Mac) — stopped at 6.8 min (session end)

`scripts/soak.ts`: demo project looped (every 3rd pass starts with a seek), RSS of every process
of that Chrome (browser + GPU + page + engine worker), engine counters after each pass.

- RSS: 1566 MB (pass 1) → 1657 MB (pass 14, ~3.5 min, warm-up) → **plateau 1670–1678 MB**
  (passes 15–26). Needs the full 30-minute run to confirm flat.
- Held frames 1, decoders 1, underruns 0, A/V p95 0.8–1.4 ms in every pass.
- **~1 late frame per pass** (single runs earlier had 0) — investigate (BACKLOG).

### 2026-10-17 · First real-device check · owner's iPhone (iOS 18.7, Safari 26.6.1, WebGPU)

| File                                | Play: presented / dropped  | Scrub p95 · drag final frame          | Export (× real time) |
| ----------------------------------- | -------------------------- | ------------------------------------- | -------------------- |
| iPhone 1080p29.97 HDR (IMG_2072)    | 300 / 0 (draw 0.26 ms)     | 52 ms · **1 ms** (43/45 frames shown) | 1.54×                |
| iPhone 4K60 HDR portrait (IMG_9160) | **600 / 0** (draw 0.19 ms) | 343 ms · 370 ms (1/45 shown) ❌       | 1.27× (to 1080p)     |

0 main-thread long tasks, 0 leaked frames in every run. Safari doesn't expose JS heap size.
**Real Safari has none of Playwright WebKit's upload cost** (draw 0.2 ms vs 9–22 ms), so the 4K60
drops seen on the Mac were a test-build artifact. Fast drags on 4K60 still show almost nothing
until release → thumbnails (BACKLOG). First probe took 1082 ms (19 ms after warm-up).
HDR: Safari iOS labels decoded HDR frames as sRGB, so the correction didn't switch on (fixed:
track-level flag, DECISIONS #37); the shipped WebKit calibration brings the iPhone's own
conversion from error 29 → 6.2 (WebGPU) / 27.6 → 6.8 (WebGL2).

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

## Startup main-thread tasks (2026-10-19, production build, Chrome)

Before: two long tasks in the first 0.4 s — 78 ms (capability probe: nine `isConfigSupported`
calls started in one task, each 8–15 ms synchronous in Chrome, plus the WebGL2 probe) and 109 ms
(the first `AudioContext`). After:

- Probe: each check starts one task apart (still concurrent) → no long task.
- `AudioContext`: Chrome spends ~125 ms starting its audio service on a page's first context
  (measured: first 124.6 ms, second 0.3 ms). Unavoidable and on the main thread; inside the first
  Play tap it would delay playback. It now runs in a quiet idle moment ~3 s after start — **the
  one accepted long task** (rule exception, measured). An early Play prepares it on the spot.

Result: long tasks `['3281+116']` (the audio service only), none during startup or editing.

## v0.2 sound, picture tools, capture & export (2026-10-19)

- **Ducking DSP:** ~20 µs per 2048-frame block (0.05 % of real time); 600 s of audio in ~270 ms;
  no allocation per block once warm; a project with nothing ducked skips it entirely. Mixing with
  decode: ~4.0 ms per second of sound with ducking vs 2.4 ms without (audio lab).
- **Picture tools, GPU ms per 1080×1920 frame** (effects-bench; "none" 0.38 on Chrome WebGL2):
  green screen 0.42 / 0.29 (WebGL2 / WebGPU), WebKit 0.52; LUT 33 0.39 / 0.28, 0.47;
  full-screen overlay blend 1.07 / 0.73, 1.33; blurred area 0.8×0.5 0.93 / 0.70, 1.18;
  pixelated area 0.69 / 0.48, 0.70. `.cube` parse in the worker: 33-point 5.9 ms, 65-point
  44.9 ms. Export with every tool on, 720p MP4 Firefox: 2.79× real time.
- **Recording:** JS heap flat (22.3 → 21.1 MB over a 10 s take) — pieces stream to storage.
- **Exports:** sound only 48–324× real time; a 3 s part exports in 0.5 s (Chrome); video export
  speed unchanged (Chrome MP4 720p 8.15×).

## Captions (v0.2 A0, 2026-10-19, MacBook, Chrome, `scripts/captions-bench.ts` / `captions-memory.ts`)

Speech clips from `scripts/speech-media.ts` (synthetic voices with known text — easier than real
speech; real recordings are checked on devices). Word error rate (WER) against the known text.

| Model · runtime     | Download | English WER (3 clips + over music) | Speed (× real time) | Hindi                                                         |
| ------------------- | -------- | ---------------------------------- | ------------------- | ------------------------------------------------------------- |
| tiny · WebAssembly  | 41 MB    | 3 % / 3 % / 3 %                    | 9.6–10.4            | translated to English (unusable)                              |
| tiny · WebGPU       | 120 MB   | 2–3 %                              | 7.9–10.1            | unusable                                                      |
| base · WebAssembly  | 77 MB    | 2–4 %                              | 4.3–4.9             | Urdu script, loops                                            |
| base · WebGPU       | 206 MB   | 2–4 %                              | 5.8–7.1             | Urdu script                                                   |
| small · WebGPU      | ~300 MB  | 2 %                                | 2.3                 | Devanagari, good (WER 0.43 counting spelling variants) · 0.8× |
| small · WebAssembly | 249 MB   | 2 %                                | 0.9                 | same text · 0.9×                                              |

- **Memory (renderer = page + speech worker):** the general ML library peaked at +1.1 GB (tiny)
  to +2.0 GB (base); our runner settles ~+480 MB with tiny loaded (most of it the encoder's
  attention over a full 30 s window — fixed cost, not a leak: a 3-minute clip used no more). The
  worker is closed after each job, so it goes back. Runtime arena / optimisation settings made
  no real difference (±70 MB).
- **Through the editor** (captions-check): 30 s of English → 19 captions in 16.6 s including the
  first-time 77 MB download; 24 s of Hindi → 12 captions in 56.8 s including the ~300 MB download.
- **Audio for the transcriber:** pulled 10 s at a time from the export mixer at 16 kHz mono —
  flat memory for any length.
- Phones still need measuring (owner's devices): expect 2–4× slower than the laptop.
- **`small` memory, measured 2026-10-19** (Linux, 4 cores, Chrome 155, `captions-memory.ts wasm
small speech-hi.m4a`, renderer = page + worker): 155 MB before → ~880 MB once both model files
  are built (8 s) → **peak ~1.2–1.28 GB while hearing** (30 s windows) → back to ~190 MB after
  the job. 28 s of Hindi took 57 s (0.5× real time on this CPU). Session settings: arenas off
  1.28 GB (no saving); `graphOptimizationLevel: 'basic'` 1.18 GB but wrong text (20 words instead
  of 84). Files: 4-bit encoder + 8-bit decoder 1.17 GB but no words; 4-bit both 1.82 GB. So the
  8-bit pair stays. (espeak's Hindi voice is too robotic for a word-error rate — every setup
  scored ~100 %; the Mac voice gave 43 % earlier — so these runs compare memory and speed only.)
- **Download path** (DECISIONS #132): a model file is now held once (read back from Cache
  Storage) instead of three times while downloading — by design, not measured on a phone.

### Made-up text guards (DECISIONS #130)

Per 30 s window (no-speech probability · average token log-probability):

| Clip                        | tiny                        | base                        | small                       |
| --------------------------- | --------------------------- | --------------------------- | --------------------------- |
| speech (English, 2 windows) | 0.03 / 0.03 · −0.10 / −0.25 | 0.01 / 0.02 · −0.10 / −0.11 | 0.03 / 0.02 · −0.08 / −0.16 |
| speech (Hindi)              | —                           | —                           | 0.012 · −0.26               |
| iPhone, no speech (3 clips) | 0.18–0.72 · −0.75 to −1.77  | 0.10–0.56 · −1.03 to −2.27  | 0.08–0.75 · −0.82 to −2.98  |

After the guards: no captions from any no-speech clip; speech clips unchanged.

## Shape masks (v0.3, 2026-10-19)

- No textures or buffers: a shape is ~20–60 ALU ops per covered pixel in the layer's own draw
  (one uniform-driven branch; layers without a mask pay one compare). Uniform slot 496 → 528
  bytes (WebGPU slot 512 → 768 bytes, ×16 layers = 12 KB).
- Picker tiles: 126 × 40×40 alpha images, drawn in ≤ 6 ms slices per frame and cached for the page.
  shapes-check: opening the picker adds no main-thread task over 50 ms (Chrome, 4-core Linux).

## Animated stickers (v0.3, 2026-10-19)

- Memory: one decoded frame per animated item (a 512 px WebP frame = 1 MB RGBA) + the decoder's
  own state; never the whole animation. Opening times every frame once in the worker (each frame
  closed at once): 20-frame test GIF a few ms.
- stickers-check: GIF sticker frames 0.5 s apart differ (0.87 mean / 255 over the frame; the old
  build 0.00); the same time twice is identical (exact export).

## Background removal (v0.3, 2026-10-19, Linux 4 cores, Chrome 155, `scripts/cutout-check.ts`)

A 1024×683 portrait on a 16:9 project, first run (includes the model download):

| Model                 | Download | Time   | Renderer (page + workers) peak | After |
| --------------------- | -------- | ------ | ------------------------------ | ----- |
| people (MODNet 8-bit) | 6.6 MB   | 5.1 s  | 362 → 621 MB (+260)            | 368   |
| objects (ormbg 8-bit) | 44 MB    | 15.1 s | 361 → 1077 MB (+716)           | 297   |

Both: background fully removed (exported left fifth luma 113 → 0), the person unchanged (116 →
116). objects has cleaner edges (people left a faint smudge by the backpack). Phones: `people`
(DECISIONS #140) — not measured on a phone yet.

## Scene detection (v0.4, 2026-10-19, Linux 4 cores, Chrome 155, `scripts/scenes-check.ts`)

| Clip                                   | Time  | Cuts found                                  |
| -------------------------------------- | ----- | ------------------------------------------- |
| scenes-cuts.mp4 (720p30, 10 s, 3 cuts) | 1.6 s | 3, 6, 8 s — exact                           |
| Sintel trailer (480p24, 52 s)          | 3.5 s | the 6 hard cuts ffmpeg's scene filter finds |
| bbb-1080p60 (10 s, one shot), "high"   | —     | none                                        |

No main-thread long task while it runs; 0 frames left open. Hardware decode will be faster on
the owner's devices; budget phones decode slower but the job is cancellable and yields to
thumbnails.

## Sound effects (v0.4, 2026-10-19, `fx.test.ts`, `scripts/soundfx-check.ts`)

- All effects on (EQ 3 bands + compressor + pitch), one minute of 48 kHz stereo: under 1.5 s in
  Node on the cloud machine (the unit test's bound) — ≈ 2 % of real time; each off stage costs 0.
- Exported WAV measurements: Pitch +12 on 440 Hz → 880 Hz; 2× speed → 880 Hz, Keep the voice
  natural → 440 Hz; More bass (+8 dB shelf) lifts 60 Hz by 7.5 dB; Even out (1.0) narrows a
  24.1 dB loud / quiet gap to 4.4 dB. Meter: reads the tone's level (−13 dB → 0.72 of the bar),
  0 when paused; no React renders (refs).

## Cloud sandbox note (2026-10-19)

The night's checks ran on a Linux container without a GPU (Chrome 155, 4 cores; WebGL2 in
software). editor-interact logs main-thread tasks of 50–420 ms there — **the same on `main`**
(measured side by side, production builds, two runs each: main 10–20 long tasks, night branch
11), so they come from the machine (software rendering, slow cores), not from the v0.3 / v0.4
work. Long-task budgets are judged on the owner's devices; per-feature checks (shapes-check)
count only the tasks a feature adds.
