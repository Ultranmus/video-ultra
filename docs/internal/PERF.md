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

_None yet — Phase 0 (Day 1) fills the first table from the bench on the owner's Mac and iPhone._
