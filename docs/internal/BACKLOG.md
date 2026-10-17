# video-ultra — Backlog

Known gaps to fix later. Add new ones when found; tick them when fixed.

## Open

- [x] Rust toolchain installed (rustup, 2026-10-17); `naga-cli` for WGSL → GLSL.
- [ ] Verify real Safari (owner's iPhone + Mac Safari): WebGPU in workers (Safari 26),
      OPFS `createSyncAccessHandle`, WebCodecs audio, HEVC/HLG decode, export speed. Playwright's
      WebKit has no OPFS and no WebGPU, so it can't answer these.
- [ ] **Phone access over HTTPS.** WebCodecs, WebGPU and OPFS need a secure context; the phone
      opening `http://<LAN IP>:3200` isn't one. Options: Vercel preview, a tunnel, or a trusted
      local certificate — owner decision.
- [x] Scrubbing: `FrameSource` (continue forward, latest wins, keyframe preview, watchdog,
      pool) — final frame after a drag 0–100 ms on real footage (PERF.md).
- [ ] **Fast drags on 4K show almost no frames until release** (decoder can't keep pace). Show
      timeline thumbnails (Day 4) while the drag is fast, exact frames when it slows/stops.
      Long-GOP 4K on WebKit settles in 1.3 s — proxies on low tier.
- [ ] Keyframe-preview decoder isn't counted by `DecoderPool`; previews are off on the low tier.
- [ ] **WebGPU export ~2× slower than WebGL2 export** (WebGPU canvas capture). Phase 2: measure
      capture paths (copyExternalImageToTexture / readback / VideoFrame from GPUTexture); export
      with WebGL2 until WebGPU wins.
- [ ] Exported audio is ~0.05–0.1 s longer than video (AAC padding). Trim to video length.
- [ ] WebKit's encoder makes ~3× smaller files at the same quality setting — compare visual
      quality; set explicit bitrates per resolution if needed.
- [x] Truncated files: probe finds the playable length and warns "incomplete" (2026-10-17).
- [x] Firefox + HEVC: probe returns `unsupported-video-codec` with a plain message (2026-10-17);
      the import UI (Day 4) must show it.
- [ ] Vite consumers should set `worker: { format: 'es' }`; without it Vite inlines the AAC
      fallback into the worker (1.57 MB instead of a lazy chunk). Document, or ship a pre-bundled
      worker (Day 7 packaging).
- [ ] Turbopack also copies `lab.worker.js` as an unused static asset — harmless, check again
      with the real engine worker.
- [x] HDR (HLG) washed out — fixed: correction shader + measured calibrations (Chrome WebGPU 5.5,
      Chrome WebGL2 5.4, WebKit 5.1 / 255 vs Apple). DECISIONS #33, #35, #36.
- [x] HDR on iPhone: Safari labels HDR frames sRGB → track-level flag (#37); WebKit calibration
      verified on the iPhone (6.2 / 6.8). Re-check on the next batch that frames now get corrected.
- [ ] **First WebGPU draw came back black on the iPhone** (HDR check, 4K file). Could be a black
      first frame / flash when a clip first shows. The HDR check now records `firstDrawBlank`.
- [ ] Tier: iPhone was detected "low" (Safari reports 4 cores, no memory) → iOS is "mid" now;
      revisit with a real low-end iPhone (e.g. iPhone XS / SE 2).
- [ ] HDR: measure Android Chrome with the bench's HDR check; add PQ (HDR10) calibration (needs a PQ test file); golden-frame HDR test in CI with a
      shareable (non-private) HLG clip + reference.
- [x] Playwright WebKit's 9–22 ms/frame WebGL upload doesn't happen in real Safari (0.2 ms).
- [x] WebKit 4K60 drops — a Playwright-WebKit artifact: the real iPhone plays 4K60 HDR 600/600.
- [ ] HEIC photo still missing from the owner's samples (needed to test HEIC import).
- [ ] BrowserStack (free for open source) for real budget-Android runs in CI — owner to sign up.
- [ ] Create the `@video-ultra` npm org (owner) before Day 7.
- [ ] React component (Day 4): async setup in effects must check it wasn't cleaned up before
      creating the engine (strict mode runs effects twice; the lab page leaked a zombie engine).
- [ ] Engine: blur background, text and sticker layers (Day 5), transitions (Day 5).
- [ ] Engine: count project frames lost to display timing (60 Hz tick vs 30 fps) separately.
