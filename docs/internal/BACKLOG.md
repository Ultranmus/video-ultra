# video-ultra — Backlog

Known gaps to fix later. Add new ones when found; tick them when fixed.

## Open

- [ ] Phone test (owner, 2026-10-30): once the browser zooms the page in (pinch, or a double
      tap), it can't be zoomed back out — the page stays stuck zoomed. Not fixed yet, only
      recorded. Likely cause (to check): most of the editor area has `touch-action: none`
      (preview, timeline, sheets in `editor.css`), so a pinch-out lands on parts that swallow it
      and the browser never gets it. Also check the viewport settings in `apps/playground/app/layout.tsx`
      and whether an input under 16px font makes iOS zoom in on focus.
- [ ] Phone test (owner, 2026-10-30): in the selection menu, the Align submenu's top option
      shows the hover color, pressed right up against the Align row with no gap at all. Not
      fixed yet, only recorded. Likely cause (to check): on phones the submenu opens inline
      under its item (`.vu-submenu` in the `max-width: 767px` container query in `editor.css`)
      with `padding: 0` and no top margin, so the highlighted Align row (`aria-expanded`) and
      the first option touch. The first option also looks hovered because `:hover` sticks after
      a tap on touch screens (`.vu-menu-item:hover` isn't limited to `@media (hover: hover)`).
- [ ] Phone test (owner, 2026-10-30): renaming a layer (double tap on its name in Layers) works,
      but the name field's border and focus outline sit right on the layer row's border — no
      space between them, they touch. Not fixed yet, only recorded. Likely cause (to check):
      `.vu-layer-rename` (`editor.css`) is `--vu-size-choice` tall and stretches to the row's
      right edge (the row has only `--vu-space-1` right padding and no top/bottom padding),
      while the selected row draws a 2px inset `--vu-selection` ring and the root
      `:focus-visible` outline adds more, so field border, outline and row ring overlap.

- [ ] Playground voice (Google): the newer speech models (3.x) read pace words out loud and
      take no instruction field, so the speed slider does nothing on them; only the 2.5 models
      still get "Say slowly: …". Fix: time-stretch the answer (keep pitch) or set the placed
      clip's speed. Found 2026-10-28.
- [ ] mediabunny's dependency `@types/dom-webcodecs` clashes with TypeScript 6's built-in
      WebCodecs types when an app type-checks with `skipLibCheck: false` (Next.js and Vite default
      to true). Upstream; pack-check uses `skipLibCheck: true`.
- [ ] Docs (AI page, text to speech): show the real-world setups — your own backend with a
      JWT (a custom `SpeechGenerator`, or `createSpeechEndpoint` with `headers` / a `fetch` that
      adds a fresh token), a serverless function for sites without a backend, and a Google
      Gemini server example (the playground's `api/speech/route.ts`). Keys never in the browser.
      Maybe later: an on-device voice model (`createOnDeviceSpeech`), like on-device captions.
- [ ] Docs site: no search yet; the phone page list is long (a picker would be shorter).

- [ ] Combined clips (#155): Separate re-makes lanes at the end of their kind (a title can come
      back above a sticker it was under); keep their old row order.
- [ ] Combined clips: no waveform on the timeline for a combined clip with sound (mix its inside
      in the analyzer, cached), and Layers / Media show it as a video.
- [ ] Combined clips: the inside is drawn at the output size; zoomed past 1× (scale > 1) it's
      upscaled — draw it at the zoomed size (capped) when that matters.
- [ ] Combined clips on a budget phone: measure a combined clip over the main video (two
      decodes + a pass) in the device pass.

- [ ] Multiple timelines in one project (tabs; one dropped into another as a combined clip) —
      left out of v0.4 for edit-several + duplicate project (#153).

- [x] Owner's "frame lane flickers" (2026-10-19): it was the timeline lanes jumping when a
      Layers drag restacks — lanes now slide to their new places (180 ms, ease-out; reduced
      motion: instant). Measured: 12 in-between timeline frames instead of one jump.
- [ ] Checks that fail on this Mac before and after today's work (same numbers on main without
      it, 2026-10-20): editor-check (two 404s in the console + long tasks 58–137 ms on startup),
      proxies-check (preview luma 130 vs 128: the threshold is too tight here), cutout-check
      ("background gone" 35 → 10 with the test chart — it needs a real portrait as its argument).
- [ ] Captions: when the model ends a window early (a few words, then end of text), hear the
      rest of the window again from the last word (like a seek), so long speech isn't cut (#152).
- [ ] Captions: speech far under room sound (a phone re-recording) gives nothing — the model
      itself hears 1–3 words; consider a speech-band filter / noise reduction before the model.

- [ ] (v0.2 A) Captions: right-to-left captions show without the word highlight; Chinese /
      Japanese / Thai: character-based words done (DECISIONS #164); one caption row (no
      multi-language rows); the captions list renders every row (virtualise past a few hundred);
      phones not measured yet. (Hindi / other languages on the device: dropped — English only,
      other languages through the host's own service, DECISIONS #162.)
- [ ] Captions: the on-device model could be the English-only Whisper builds (`*.en`: same size,
      a little more accurate on English) — needs timestamped ONNX builds and a captions-bench
      run first.
- [ ] (v0.2 A) Export dialog: offer the .srt next to the video download (today: Captions panel).

- [ ] (v0.2 B) A ducking badge on timeline clips; optional look-ahead or a "listen to" choice so
      short sound effects don't dip music; default ducking on for library music (owner's call);
      show asset credits to the host at export.
- [ ] (v0.2 C) LUT chips have no previews, no delete / rename; a LUT import with nothing selected
      applies to nothing; "Apply to all clips" copies the filter only, not the LUT. Blend modes on
      a 3D-turn animation copy only the flat bounding box — confirm with a golden frame. Region
      items have no entrance / exit animations. Green screen not measured on budget phones.
- [ ] (v0.2 D) Each frame capture creates a renderer (WebKit warns "too many WebGL contexts" in
      export-check) — reuse one. Camera can't switch while recording; recording name uses the
      locale time format; the range bar has no film strip; sound-only export is offered for a
      silent part (the engine then refuses clearly).
- [ ] WebKit logs "WebKitBlobResource error 1" console messages in editor-interact (not failures).

- [x] (done 2026-10-19, #134) Copy / paste elements (⌘C / ⌘V, with a paste at the playhead) — image-ultra has it; not in
      v0.2's list.
- [ ] Templates with media placeholders (a framed slot you drop a clip into) and animated
      template previews (#139).
- [ ] Export: MOV / MKV containers and transparent video (VP9 / HEVC with alpha) (#144).
- [ ] Lottie stickers (.json / .lottie): need a Lottie runtime in the engine worker (#138).
- [ ] Animated stickers in Safari without `ImageDecoder` show their first frame: decode GIF /
      WebP frames ourselves (small WASM decoder) if the owner's iPhone lacks it (#138).
- [ ] Layers panel: drag-reorder on touch uses the grip only; a long-press-anywhere lift like the
      timeline would feel more natural on phones.
- [ ] Groups: resizing a group with rotated members scales positions around the box centre but
      can't skew (by design); a true group transform (rotate the box itself) would need a group
      object in the file format.

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
- [x] (fixed with explicit bitrates) WebKit's encoder makes ~3× smaller files at the same quality setting — compare visual
      quality; set explicit bitrates per resolution if needed.
- [x] Truncated files: probe finds the playable length and warns "incomplete" (2026-10-17).
- [x] Firefox + HEVC: probe returns `unsupported-video-codec` with a plain message (2026-10-17);
      the import UI (Day 4) must show it.
- [x] Vite consumers should set `worker: { format: 'es' }` — documented (docs /vite, the
      react README) and set in `apps/examples/vite` (2026-10-20).
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
      DECISIONS #13) for v0.2 speed curves. _2026-10-19: "Keep the voice natural" (DECISIONS
      #146) does it in TS for 0.5×–2×; beyond that range and for speed curves it's still open._
- [ ] Sound effects (#146): owner to listen on real voices — if the pitch shifter warbles on a
      voice, try a longer window (30 → 40 ms) or a WSOLA stretcher; compressor make-up gain may
      want tuning by ear.
- [ ] WebKit (Playwright) has late frames at cuts where a new video starts (2 s, 7 s in the demo):
      check on the iPhone; widen prefetch (1 s → 1.5 s) if real.
- [ ] Next iPhone batch: audio plays, A/V offset, underruns on a real phone (engine lab page).
- [x] Soak: late frames in looped playback — prefetch skipped clips whose decoder had been
      released (PERF "Soak, 30 minutes"); 30-minute soak flat (−3.6 %), 0 underruns.
- [ ] **Real Safari (iPhone batch):** storage worker with `createSyncAccessHandle` on iOS 17/18/26,
      `persist()` answer, recovery after the tab is killed by iOS; analyzer thumbnails of iPhone HEVC
      on the phone. Playwright's WebKit has no OPFS, so storage-check only covers memory there.
- [x] (fixed 2026-10-19: Web Lock per project; second tab read-only with "Use it here") **Two tabs on one project** corrupt each other's log (both append, both compact). Take a Web
      Lock (`navigator.locks`) per project in `attachAutosave`; the second tab opens read-only or asks.
- [ ] `url` sources: `getMedia` fetches the whole file into a Blob. Use range reads (Mediabunny
      `UrlSource`) in the engine/analyzer, or stream it into OPFS once.
- [ ] File handles: `requestPermission` only works inside a user gesture → the UI needs a
      "re-link / allow access" prompt when `getMedia` returns null for a `handle` source.
- [x] (fixed 2026-10-19: `storage.sweepMedia()`) Orphaned media: a crash between `putMedia` and the next snapshot leaves `media/<id>` that no
      project lists. Add a sweep (media not referenced by any project's meta, older than a day).
- [ ] HDR thumbnails show the browser's own HDR → SDR conversion (too bright, DECISIONS #33): the
      2D-canvas path has no correction. Fine for a strip; revisit if it looks wrong on iPhone.
- [ ] Two decode jobs on one asset can decode the same keyframe twice (long-GOP 4K: 5 decodes for 3
      keyframes). Share in-flight keyframe decodes across jobs.
- [ ] Analyzer watchdog isn't exercised by a test (needs a stalled fake decoder).
- [ ] `exact` thumbnails on long-GOP 4K take 0.7–2 s per strip — keep `keyframe` for strips; use
      `exact` only for single frames (cover / freeze preview).
- [ ] Mediabunny loads in two workers (engine + analyzer); measure the memory on a low-end phone.
- [x] (fixed 2026-10-19, PERF.md "Startup main-thread tasks") **Startup long tasks in Chrome:** two main-thread tasks of 70–140 ms in the first ~0.4 s after
      mount (production build; none in WebKit/Firefox, none while editing or playing). Likely the
      AudioContext + worklet setup (#44) and the capability probe. Profile and split.
- [x] (done 2026-10-19, #114) Stage: pinch with nothing selected should zoom the view (UI_VISION §6) — not built yet.
- [x] (fixed 2026-10-19) Voiceover plays the project while recording (so the speaker can follow); without headphones
      the project's sound is recorded too. Offer "mute while recording".
- [ ] File handles (Chromium desktop): import still copies into OPFS; use `showOpenFilePicker` +
      `putMediaHandle` and a re-link flow.
- [x] Timeline: lane header icons toggle mute (main/audio) / hide (visual lanes), with buttons in the accessible layer. Lock: the lock at a row name's right end (and in the accessible layer), v0.2 E.
- [x] ~~Exported audio is ~0.05–0.1 s longer than video (AAC padding)~~ — audio trimmed to the
      video length and encoder priming compensated (DECISIONS #66).
- [x] (fixed 2026-10-19: VP8 on Firefox, 2.6× real time) **Firefox WebM export is slower than real time** (VP9 software encoder, 0.71× at 720p;
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
- [x] (fixed 2026-10-19: files older than an hour are removed at startup) OPFS export files are deleted only when the next export starts (or on cancel). If the host
      never exports again the last file stays; add `engine.clearExports()` or delete on startup
      (needs care: the host may still hold the Blob).
- [ ] MP4 is written with moov at the end when streaming to OPFS (fast start needs the whole file
      in memory or `fastStart: 'reserve'` with packet counts). Fine for downloads/sharing; check
      upload targets that need fast start.
- [x] (fixed 2026-10-19: explicit bitrates, #112) Same `quality: 'medium'`, very different file sizes: the 17 s 720p MP4 is 2.9 MB (Chrome),
      3.2 MB (WebKit), 13.4 MB (Firefox). Set explicit bitrates per resolution × quality instead
      of Mediabunny's relative quality (joins the existing WebKit file-size item).
- [ ] Text wraps only at explicit line breaks (no automatic width/wrap box yet).
- [ ] Sharpen is an unsharp mask at 1.5 source texels — mostly invisible when the source is much
      larger than the preview; scale the tap distance with the on-screen size if users notice.
- [ ] Blur transition uses a 13-tap disc on the full-size frame: at full strength rings can show
      on high-contrast edges. Use the backdrop's downscale path if it looks bad on real footage.
- [x] (fixed 2026-10-19, #113) Transitions are not crossfaded in audio.
- [x] (fixed 2026-10-19, #138: ImageDecoder, frame per item) Image stickers that are animated GIFs show the first frame only.
- [ ] WebKit (Playwright) logs `AudioEncoder encode failed: InternalAudioEncoderCocoa encoding failed` during `scripts/export-check.ts` (around the cancel step) — the check passes; make
      cancel close the encoder without an unhandled error.
- [ ] Real-iPhone check of the second UI pass: keyboard lift (visualViewport) while editing text,
      long-press reorder without Safari's callout, dock heights, Preview mode.
- [x] (done 2026-10-19, #114) Stage view pinch-zoom (nothing selected) — still not built.
- [ ] Inspector: "Appearance" buttons stack one per row in a narrow inspector; consider an icon
      row (rotate / flip H / flip V) like image-ultra's adjust bar.
- [x] (fixed 2026-10-19) Ruler labels under the playhead capsule are hidden; a nicer approach would fade them.
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
- [x] (fixed 2026-10-19) A few emoji draw as boxes where the OS font lacks them (headless Chrome on macOS); the 3D
      tab doesn't have this. Consider hiding emoji the platform can't draw.
- [ ] Playground `window` test API + URL debug flags (DECISIONS #92). Small; helps phone debugging.
- [x] (done 2026-10-19: engine onFatal → stopped screen; covered by editor-interact) Fatal engine error screen with Reload (DECISIONS #93): catch worker `error` /
      `messageerror` / OOM, show the message, keep the autosave intact.
- [ ] v0.3 references to build against (specs, not code): loudness to EBU R128 / ITU-R BS.1770
      (integrated + true peak; "normalize audio" and an export loudness target such as −14 LUFS);
      SRT / WebVTT import + export with frame-exact timing and burn-in (ties into v0.4 AI
      captions); scopes — waveform, RGB parade, histogram, vectorscope (_scopes done 2026-10-19,
      DECISIONS #147_).
- [ ] Animation tiles: text previews use the item's own size — very long text can be tiny in the
      tile; consider fitting text to the tile in `itemPreview`.
- [ ] Transition still (A | B) and flip-books are re-fetched when the panel reopens; cache per
      cut signature across opens if it shows on low-tier phones.
- [ ] Waveform for video clips needs the clip tall enough (≥ 40 px); phone main track checks.
- [ ] Same-height sheets leave empty space under quick tools (Edit text, Speed, Volume): fill it
      usefully (e.g. quick styles under Edit) or let the sheet hug short content (owner call).
- [x] (fixed 2026-10-19) Phone toolbar scrolls sideways with no hint that more tools are off-screen (Rotate,
      Opacity, Split… on text): add an edge fade or a "More" entry.
- [x] (fixed 2026-10-19) The "browser may clear unsaved work" toast is large on phones and covers the stage.
- [ ] Device frames bigger than the window scroll (zooming the frame breaks canvas pointer maths).
- [ ] Proxies (#148): HDR clips get no copy (an HDR → SDR copy would need tone mapping that
      matches the engine's); a "Make a lighter copy" button per clip and a Media panel badge
      would make the automatic choice visible — wait for the owner's feedback first.
- [ ] Text to speech on the device (#150): needs an MIT/Apache phonemizer (or a character-level
      voice model small enough for phones with a permissive licence). Until then voices come
      from the host's service.
- [x] Captions: offer the playground's `alignWords` as a package helper — done:
      `createCaptionsEndpoint` times text-only replies from the sound (DECISIONS #164).
- [x] Captions: measure word timing against a true reference — done with the system voice's own
      word times (`captions-timing`, DECISIONS #165): Groq 0.05 s mean in English and Hindi.
      Still open: Chinese / Japanese (the voice and Groq split words differently) and Gemini's
      sound-based times on the same reference.
- [x] Perf: editor-interact (Chrome) shows one ~108 ms main-thread task around "drag text on
      stage" (~1.7 s into the flow). Profiled 2026-10-26: it is not the drag — it is the first
      Play tap (`prepareAudio`, Chrome starting its audio service), which the check presses
      ~1.8 s after load, before the 3 s idle preparation. The one accepted long task (PERF.md
      "AudioContext"); no change.
- [x] Captions: speech buried under room noise — the speech detector and confidence rules
      (DECISIONS #167) give no captions on our two Hindi phone clips. Still open: a confident
      wrong-language "translation" (en-tts-phone → Malay); asking twice and keeping what agrees
      would catch it (costs double requests).
- [x] Captions: Hinglish spelling — done by the service now (`hi-Latn`, DECISIONS #168).
- [ ] **Captions package: free on-device captions in more languages** (owner, 2026-10-25 —
      planned, not started). `@video-ultra/captions` becomes "free, private captions for every
      language that genuinely works on this device": 1. A test set per language with the system voices + `scripts/tts-words.swift` (known text,
      true word times): es, fr, de, it, pt, ru, ja, zh, ko, ar, tr, hi, ta, … 2. Measure per model × language: word accuracy, timing, speed, memory — phone-sized
      (Whisper base / small multilingual, Moonshine for English: no word times, timed from
      the sound) and computer-sized (Whisper large-v3-turbo on WebGPU: download size to
      measure). 3. Offer a language on a device only when it passes a bar (e.g. < 15 % wrong words,
      timing within 0.2 s); keep the result as a table in the package, re-checked when a
      model changes. Computers with WebGPU → nearly every language; phones → the well-heard
      ones (English, Spanish, French…), not Hindi. 4. The same safety net as the service path (speech detector, Detect voting, check
      marks, `captions-timing`). 5. Docs: self-hosting a free service (whisper.cpp / faster-whisper with the OpenAI
      transcription API) for apps with their own server.
      Candidates to measure first (owner, 2026-10-25: the on-device English model is "really
      good"): Whisper large-v3-turbo on WebGPU (computers, ~99 languages); Whisper small
      multilingual (phones, well-heard languages); Whisper fine-tuned for Indian languages
      (e.g. AI4Bharat / community Hindi models — check licence and ONNX builds); Vosk (light,
      ~20 languages incl. Hindi, word times, less accurate); Moonshine (English, no word times).
      Show the owner the measurement table before building.
