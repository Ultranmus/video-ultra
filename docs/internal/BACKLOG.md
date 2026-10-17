# video-ultra — Backlog

Known gaps to fix later. Add new ones when found; tick them when fixed.

## Open

- [ ] Rust toolchain needed for the WGSL → GLSL build step (naga) — owner to approve installing
      `rustup` before Day 3, or we find an npm-distributed naga build.
- [ ] Verify real Safari (owner's iPhone + Mac Safari): WebGPU in workers (Safari 26),
      OPFS `createSyncAccessHandle`, WebCodecs audio, HEVC/HLG decode, export speed. Playwright's
      WebKit has no OPFS and no WebGPU, so it can't answer these.
- [ ] **Phone access over HTTPS.** WebCodecs, WebGPU and OPFS need a secure context; the phone
      opening `http://<LAN IP>:3200` isn't one. Options: Vercel preview, a tunnel, or a trusted
      local certificate — owner decision.
- [ ] **Scrubbing long-GOP media is slow** (4K p95 0.5 s, VP9 0.15 s, Firefox 0.36 s). Phase 2:
      nearest-keyframe preview first, then exact frame; warm forward decoder; proxies for
      long-GOP 4K on low tier.
- [ ] **WebGPU export ~2× slower than WebGL2 export** (WebGPU canvas capture). Phase 2: measure
      capture paths (copyExternalImageToTexture / readback / VideoFrame from GPUTexture); export
      with WebGL2 until WebGPU wins.
- [ ] Exported audio is ~0.05–0.1 s longer than video (AAC padding). Trim to video length.
- [ ] WebKit's encoder makes ~3× smaller files at the same quality setting — compare visual
      quality; set explicit bitrates per resolution if needed.
- [ ] Truncated files play their first part without a warning. Detect (metadata duration vs
      real duration / read errors) and show "this file looks incomplete".
- [ ] Firefox can't decode HEVC (iPhone video) → import must say so clearly and suggest another
      browser.
- [ ] Vite consumers should set `worker: { format: 'es' }`; without it Vite inlines the AAC
      fallback into the worker (1.57 MB instead of a lazy chunk). Document, or ship a pre-bundled
      worker (Day 7 packaging).
- [ ] Turbopack also copies `lab.worker.js` as an unused static asset — harmless, check again
      with the real engine worker.
- [ ] HDR (HLG/PQ) is detected but not tone-mapped yet — Phase 2 shader.
- [ ] BrowserStack (free for open source) for real budget-Android runs in CI — owner to sign up.
- [ ] Create the `@video-ultra` npm org (owner) before Day 7.
