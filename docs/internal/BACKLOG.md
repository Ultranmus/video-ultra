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
- [ ] HDR: measure Safari's WebGPU path (iPhone, iOS 26) and Android Chrome with the bench's HDR
      check; add PQ (HDR10) calibration (needs a PQ test file); golden-frame HDR test in CI with a
      shareable (non-private) HLG clip + reference.
- [ ] **Playwright WebKit spends 9 ms (1080p) / 22 ms (4K) per frame uploading video to WebGL**
      (SDR too) — the real cause of the 4K60 drops (> 16.7 ms budget). Check real Safari; if real,
      low tier needs a proxy / lower preview size for 4K60.
- [ ] Playwright WebKit drops 30% of frames on iPhone 4K60 HDR — check real Safari on the iPhone
      and Mac; if real, low tier must use a proxy for 4K60.
- [ ] HEIC photo still missing from the owner's samples (needed to test HEIC import).
- [ ] BrowserStack (free for open source) for real budget-Android runs in CI — owner to sign up.
- [ ] Create the `@video-ultra` npm org (owner) before Day 7.
