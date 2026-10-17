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
- [x] **Fast drags on 4K show almost no frames until release** — fixed 2026-10-17: the stage shows the analyzer's keyframe thumbnail while a scrub is fast (`stage/ScrubPreview.tsx`; 37/40 steps covered in a 4K drag). (decoder can't keep pace). Show
      timeline thumbnails (Day 4) while the drag is fast, exact frames when it slows/stops.
      Long-GOP 4K on WebKit settles in 1.3 s — proxies on low tier.
- [ ] Keyframe-preview decoder isn't counted by `DecoderPool`; previews are off on the low tier.
- [x] (fixed: no longer with the real engine, #68) **WebGPU export ~2× slower than WebGL2 export** (WebGPU canvas capture). Phase 2: measure
      capture paths (copyExternalImageToTexture / readback / VideoFrame from GPUTexture); export
      with WebGL2 until WebGPU wins.
- [x] Exported audio is ~0.05–0.1 s longer than video (AAC padding) — trimmed + priming compensated (#66).
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
- [x] React component (Day 4): async setup in effects must check it wasn't cleaned up before
      creating the engine (strict mode runs effects twice; the lab page leaked a zombie engine).
- [x] Engine: blur background, text and sticker layers (Day 5), transitions (Day 5).
- [ ] Engine: count project frames lost to display timing (60 Hz tick vs 30 fps) separately.
- [ ] Speed changes shift pitch (plain resampling). Pitch-preserving time-stretch (Rust → WASM,
      DECISIONS #13) for v0.2 speed curves.
- [ ] WebKit (Playwright) has late frames at cuts where a new video starts (2 s, 7 s in the demo):
      check on the iPhone; widen prefetch (1 s → 1.5 s) if real.
- [ ] Next iPhone batch: audio plays, A/V offset, underruns on a real phone (engine lab page).
- [ ] Soak: ~1 late frame per pass in looped playback (0 in single runs) — find where (`lateAt`
      in stats); run the full 30-minute soak; confirm RSS stays at the ~1675 MB plateau.
- [ ] **Real Safari (iPhone batch):** storage worker with `createSyncAccessHandle` on iOS 17/18/26,
      `persist()` answer, recovery after the tab is killed by iOS; analyzer thumbnails of iPhone HEVC
      on the phone. Playwright's WebKit has no OPFS, so storage-check only covers memory there.
- [ ] **Two tabs on one project** corrupt each other's log (both append, both compact). Take a Web
      Lock (`navigator.locks`) per project in `attachAutosave`; the second tab opens read-only or asks.
- [ ] `url` sources: `getMedia` fetches the whole file into a Blob. Use range reads (Mediabunny
      `UrlSource`) in the engine/analyzer, or stream it into OPFS once.
- [ ] File handles: `requestPermission` only works inside a user gesture → the UI needs a
      "re-link / allow access" prompt when `getMedia` returns null for a `handle` source.
- [ ] Orphaned media: a crash between `putMedia` and the next snapshot leaves `media/<id>` that no
      project lists. Add a sweep (media not referenced by any project's meta, older than a day).
- [ ] HDR thumbnails show the browser's own HDR → SDR conversion (too bright, DECISIONS #33): the
      2D-canvas path has no correction. Fine for a strip; revisit if it looks wrong on iPhone.
- [ ] Two decode jobs on one asset can decode the same keyframe twice (long-GOP 4K: 5 decodes for 3
      keyframes). Share in-flight keyframe decodes across jobs.
- [ ] Analyzer watchdog isn't exercised by a test (needs a stalled fake decoder).
- [ ] `exact` thumbnails on long-GOP 4K take 0.7–2 s per strip — keep `keyframe` for strips; use
      `exact` only for single frames (cover / freeze preview).
- [ ] Mediabunny loads in two workers (engine + analyzer); measure the memory on a low-end phone.
- [ ] **Startup long tasks in Chrome:** two main-thread tasks of 70–140 ms in the first ~0.4 s after
      mount (production build; none in WebKit/Firefox, none while editing or playing). Likely the
      AudioContext + worklet setup (#44) and the capability probe. Profile and split.
- [ ] Stage: pinch with nothing selected should zoom the view (UI_VISION §6) — not built yet.
- [ ] Voiceover plays the project while recording (so the speaker can follow); without headphones
      the project's sound is recorded too. Offer "mute while recording".
- [ ] File handles (Chromium desktop): import still copies into OPFS; use `showOpenFilePicker` +
      `putMediaHandle` and a re-link flow.
- [x] Timeline: lane header icons toggle mute (main/audio) / hide (visual lanes), with buttons in the accessible layer. Lock: not exposed yet.
- [x] ~~Exported audio is ~0.05–0.1 s longer than video (AAC padding)~~ — audio trimmed to the
      video length and encoder priming compensated (DECISIONS #66).
- [ ] **Firefox WebM export is slower than real time** (VP9 software encoder, 0.71× at 720p;
      encoder wait 39 ms/frame). Try VP8 on Firefox, or steer Firefox users to MP4 (2.7×).
- [ ] WebM/Opus lip sync in Playwright WebKit is 30 ms late in ffmpeg: WebKit's Opus chunk
      timestamps jitter (0, 33, 53, 67 ms … instead of 20 ms steps) and the muxer keeps them. Check
      in real Safari; if real, rewrite audio packet timestamps from the sample count.
- [ ] Chrome WebM: sound 9 ms late in ffmpeg (below the ~40 ms threshold) — the Opus pre-skip is in
      the header; find the remaining 6–9 ms.
- [ ] First H.264 export in a page session composes ~10× slower per frame than later ones (still
      2.6× real time at 1080p). Find out why (decoder warm-up with the encoder active?); maybe
      warm up with a 1-frame encode when the export sheet opens.
- [ ] WebKit (Playwright) late frames inside slide transitions (two video uploads per frame in the
      test build). Check on the iPhone.
- [ ] Export memory: first export in a session grows ~100–150 MB before it plateaus. Check on a
      phone that this warm-up fits (low tier).
- [ ] Export in a background tab: not tested (workers keep running, but some browsers throttle
      them); the export sheet now takes a screen Wake Lock and says "keep this tab open".
- [ ] Export when the WebM memory fallback is used keeps the whole file in memory (BufferTarget)
      — only Safari Private Browsing / Playwright WebKit. MP4's fallback is append-only Blob parts.
- [ ] OPFS export files are deleted only when the next export starts (or on cancel). If the host
      never exports again the last file stays; add `engine.clearExports()` or delete on startup
      (needs care: the host may still hold the Blob).
- [ ] MP4 is written with moov at the end when streaming to OPFS (fast start needs the whole file
      in memory or `fastStart: 'reserve'` with packet counts). Fine for downloads/sharing; check
      upload targets that need fast start.
- [ ] Same `quality: 'medium'`, very different file sizes: the 17 s 720p MP4 is 2.9 MB (Chrome),
      3.2 MB (WebKit), 13.4 MB (Firefox). Set explicit bitrates per resolution × quality instead
      of Mediabunny's relative quality (joins the existing WebKit file-size item).
- [ ] Text wraps only at explicit line breaks (no automatic width/wrap box yet).
- [ ] Sharpen is an unsharp mask at 1.5 source texels — mostly invisible when the source is much
      larger than the preview; scale the tap distance with the on-screen size if users notice.
- [ ] Blur transition uses a 13-tap disc on the full-size frame: at full strength rings can show
      on high-contrast edges. Use the backdrop's downscale path if it looks bad on real footage.
- [ ] Transitions are not crossfaded in audio.
- [ ] Image stickers that are animated GIFs show the first frame only.
- [ ] WebKit (Playwright) logs `AudioEncoder encode failed: InternalAudioEncoderCocoa encoding failed` during `scripts/export-check.ts` (around the cancel step) — the check passes; make
      cancel close the encoder without an unhandled error.
- [ ] Real-iPhone check of the second UI pass: keyboard lift (visualViewport) while editing text,
      long-press reorder without Safari's callout, dock heights, Preview mode.
- [ ] Stage view pinch-zoom (nothing selected) — still not built.
- [ ] Inspector: "Appearance" buttons stack one per row in a narrow inspector; consider an icon
      row (rotate / flip H / flip V) like image-ultra's adjust bar.
- [ ] Ruler labels under the playhead capsule are hidden; a nicer approach would fade them.
- [ ] Real-device pass of the effects library: iPhone (WebGPU) and a low-end Android (WebGL2):
      play the blur family (spin-blur, motion-blur, zoom-blur), the 3D family and a typewriter
      title; watch late frames and preview-quality drops. Tune `cheapEffects` / tap counts.
- [ ] The UI asks `filterPreviews` for every filter id (now 115 + none): ask per visible
      category / scroll position instead (each tile is one render + a bitmap).
- [ ] Owner's "Zoom zoomed my stickers" didn't reproduce in core at HEAD (golden check proves
      lanes are untouched); get a screen recording if it persists.
- [ ] Transitions over a letterboxed clip only warp/blur inside the clip's own box (a ripple
      doesn't spill into the letterbox; overlays like light leaks cover the whole canvas).
- [ ] Typewriter reveals the text's background box with the text; a "box first" option could be
      added if users want it.
- [ ] Animations are ignored on main-track clips (they have transitions). If the UI ever offers
      "animate the clip itself", decide how it combines with transitions.
- [ ] Glow loop is a pulsing light mix, not a halo outside the item's box.
- [ ] Spin blur computes cos/sin per tap (heaviest family): rotate incrementally if a device
      shows it.
- [ ] `TransitionPreset.ease` is a new required field (the preset's default curve) — the UI may
      show it as the default in an ease picker.
- [ ] Owner reported a transition "zoom" affecting stickers too; not reproduced in the engine
      (golden check proves lanes are untouched across 30 families). Ask for a screen recording if
      it shows up again on the new build.
- [ ] A few emoji draw as boxes where the OS font lacks them (headless Chrome on macOS); the 3D
      tab doesn't have this. Consider hiding emoji the platform can't draw.
- [ ] Playground `window` test API + URL debug flags (DECISIONS #92). Small; helps phone debugging.
- [ ] Fatal engine error screen with Reload (DECISIONS #93): catch worker `error` /
      `messageerror` / OOM, show the message, keep the autosave intact.
- [ ] v0.3 references to build against (specs, not code): loudness to EBU R128 / ITU-R BS.1770
      (integrated + true peak; "normalize audio" and an export loudness target such as −14 LUFS);
      SRT / WebVTT import + export with frame-exact timing and burn-in (ties into v0.4 AI
      captions); scopes — waveform, RGB parade, histogram, vectorscope.
- [ ] Animation tiles: text previews use the item's own size — very long text can be tiny in the
      tile; consider fitting text to the tile in `itemPreview`.
- [ ] Transition still (A | B) and flip-books are re-fetched when the panel reopens; cache per
      cut signature across opens if it shows on low-tier phones.
- [ ] Waveform for video clips needs the clip tall enough (≥ 40 px); phone main track checks.
