# video-ultra — Handoff

Where the last session stopped and what comes next. Update before ending every session.

## 2026-10-25 (Vercel fixed; assistant: media library + rename — merged to main)

- Vercel deploy fixed (packages built before TypeDoc) and pushed; the deploy succeeds. GitHub
  "Release" still fails until the owner allows Actions to open pull requests (Settings →
  Actions → General → Workflow permissions).
- Assistant (#159): sees the video's name and the media library, answers questions in full
  ("list my media"), renames the video, puts library files on the timeline, and edits what it
  added in the same answer. Checked live with Gemini. Merged to main, **not pushed**.
- **Owner is testing on desktop now:** Assistant (incl. the above), Audio, Captions.

## 2026-10-24/25 (owner's desktop test pass — merged to main and pushed)

Branch `fix/owner-desktop-pass`, merged into main, pushed at the owner's word. Every fix is in
PROGRESS 2026-10-24 (one line each); the bigger ones: typing on the stage (one click, phone tap
slop, field = drawn text, frame stays), template titles keep their lines when scaled (#157),
Transitions panel (chosen one first, then its settings, then the list), timeline cut buttons vs
trim handles (tap = transition, drag = trim), lazy thumbnails (PERF rule 9), Assistant redone as
a chat (Undo, Stop, busy message, scrolling), desktop panels resizable (#158). Playground: Read
aloud only with a voice key (Gemini works), assistant route Gemini → Claude fallback.

- **Owner testing so far — desktop (laptop) only:** Blur, Filters (incl. Apply to all clips),
  Templates, Text (incl. Read aloud with a real voice service), Stickers, Transitions, Media,
  Your videos (new video / make a copy) ✓.
  **Mobile (iPhone, Android): not tested yet** — none of these fixes have been tried on a phone.
- **Next (owner, tomorrow):** test Assistant, Audio and Captions on desktop.
- Playground keys live in `apps/playground/.env.local` (git-ignored): `SPEECH_API_KEY` is a
  Google key (Read aloud + the assistant). For the Claude fallback the owner adds
  `ANTHROPIC_API_KEY`. Google's flash models were overloaded on 2026-10-24 (the route falls back
  to `gemini-flash-lite-latest` after 12 s).
- Docs to write (BACKLOG): speech / assistant with your own backend + JWT, serverless, Gemini.
- I keep `pnpm dev` running (:3200) while the owner tests. The tsup watcher stops emitting after
  a file is replaced (`sed -i`, `git checkout`, sometimes Write) — check `dist` is newer than the
  source and restart it if not.

## 2026-10-20 (later — audio, release prep, soak; merged to main, not pushed)

- Clean up noise + Clean voice preset; Extract audio keeps fades / effects (#156).
- PLAN 5.1 and 5.2 done: docs site `/docs` + TypeDoc `/api` (`pnpm docs:api`), Next.js and Vite
  examples, `scripts/pack-check.ts`, CI on push / PR, release workflow (changesets + provenance;
  needs the `NPM_TOKEN` secret and the `@video-ultra` npm organisation — owner), first-release
  changeset (0.1.0).
- PLAN 2.6 done: 30-minute soak flat; the looped-playback late frame fixed (prefetch).
- **Owner (5.4):** create the `@video-ultra` npm organisation, add `NPM_TOKEN` to the repo
  secrets; then the "Version packages" pull request that the release workflow opens publishes
  0.1.0 when merged. Deploy the playground (it now has the docs).
- Next for me: the device pass when phones are available (BrowserStack or plugged in).

## 2026-10-20 (your list fixed, v0.4 finished — merged to main, not pushed)

Branch `feat/v0.4-finish`, merged into main locally. **Not pushed** (waits for the owner's word),
and the old helper worktrees under `.claude/worktrees/` are still there (owner to say).

- Owner's list (2026-10-19): items 1–5 and 7 fixed (#151, #152); item 6 turned out to be the
  timeline lanes jumping on a Layers restack — they slide now.
- v0.4 finished (#153–#155): edit several at once, Your videos (copy / new / open / delete),
  Combine into one clip (combine / open / separate; engine render targets). Multiple timelines
  → BACKLOG by the owner's choice.
- Checks: `pnpm verify` green; every browser check passes except three that fail identically on
  main without today's work (BACKLOG: editor-check, proxies-check, cutout-check); golden frames
  unchanged on both backends and browsers.
- **Next:** owner tests with `docs/internal/TEST_CHECKLIST.md` section 0 (desktop, iPhone over
  https, Android); then 1.0 hardening (device pass incl. a combined clip on a budget phone, perf
  tuning, docs) and the v0.1 release steps.

## 2026-10-19 (night branch merged to main)

`night/v0.3-v0.4` merged into main (21 commits: v0.3 complete; v0.4 keyframes, trims + markers,
HEVC / AV1, scenes, sound effects, scopes, proxies, AI editing endpoint, text to speech).
Not pushed yet. Owner's list for tomorrow (below) still stands; test list for the new work is
`docs/internal/TEST_CHECKLIST.md`.

## 2026-10-19 (end of day — owner's list for tomorrow)

Pushed to origin (main d4ae1c8). Do these first, then continue the captions calibration:

1. **Desktop: Align doesn't open in the context menu** (the submenu).
2. **Desktop: panels share their scroll position** — scroll Filters, open Stickers: it opens
   scrolled to the same point. Each panel should start at the top (or keep its own place).
3. **Text isn't editable on the canvas** (tap / double-click a text on the stage to type).
4. **Desktop: some button labels are cut off** (e.g. Transitions panel "Play previ…",
   "Apply to …"). Check every panel at desktop width.
5. **Phone: timeline starts with 0:00 in the centre** — at the start, show the add button to
   the left as well (no empty left half).
6. **Desktop: the frame lane (film strip) flickers** when changing the item selected in Layers.
7. **Captions — "No speech was heard" on the owner's iPhone for a video with speech** (Hindi
   and Detect). Findings so far: the sound path is faithful (checked on iPhone footage); clean
   real Hindi (LibriVox, public domain, in test-media/files/real/) captions well with `small`;
   speech under loud background makes the model itself hear almost nothing. Next: measure real
   Hindi at realistic levels (speech ~15 dB over background), retune the guards from DECISIONS
   #130 if they drop real speech, and ask the owner for the clip. The phone was on plain http
   (AudioWorklet missing → "Audio unavailable" toast): test over https
   (`pnpm --filter playground dev:https`), make that toast the calm "needs a secure page" note
   (Safari has `audioWorklet` but it's undefined on http), and make captions say plainly when
   the browser can't read the sound instead of "no speech".
8. Give the owner the full v0.2 test list (below) again.

**v0.2 test list (what's new and how to try it):**

- Layers & organising: History (clock icon), Layers (stack icon); Shift-click / ⌘A / drag a box
  to select several; ⌘G group, ⇧⌘G ungroup; ⇧⌘L lock, ⇧⌘H hide; ] [ ⌘] ⌘[ order; right-click
  or long-press for the menu; Arrange tool (phone) / Arrange section (desktop) for align.
- Captions: Captions tab → language → Make captions; import / download .srt / .vtt; Add a
  caption; styles, highlight modes, position, size; edit in the list; drag one caption.
- Sound: select music → Volume / Sound → "Lower under voice"; Audio panel → music & sounds
  library (search, ▶, + Add).
- Picture tools: select a video/photo → Green screen (switch on, green/blue, "Pick from video"
  then tap the screen colour on the stage; Range, Edge softness, Clean edges) — try a clip shot
  against a green or blue screen; Filters panel → LUT looks → Import .cube; Blur tab → Blur /
  Pixelate box or oval, drag over a face; select a layer/text/sticker → Blend chips.
- Capture & export: Media → Record with camera (front/back, mic) → Add to video / as a layer;
  Export → Video (Whole / Part with I/O keys, presets 9:16 / 16:9 / 1:1), Sound only
  (M4A / Ogg / WAV), Picture (PNG / JPEG of the frame at the playhead).

## 2026-10-19 night (branch `night/v0.3-v0.4` — owner's overnight request; release after v0.4)

Built on the branch **`night/v0.3-v0.4`**, now merged to main. The owner's test list is
**`docs/internal/TEST_CHECKLIST.md`** — tick boxes there tomorrow.

Done (each with its own browser check script in `scripts/` + unit tests; DECISIONS #131–#147):
fixes (Hindi model crash memory on phones, mouse marquee starting on the main video, copy /
paste); v0.3 (shape masks, high contrast + touch density, animated stickers + 611 animated
emoji + SVG, 192 templates, on-device background removal `@video-ultra/ai`, embedding API);
v0.4 (keyframes + graph editor, roll / slip / slide + markers, HEVC / AV1 export, scene detection

- Split at scenes, sound effects + keep pitch + level meter, scopes).

Not verifiable in the cloud sandbox (no GPU, no Safari, no phones): WebGPU golden frames, real
iPhone memory for Hindi captions and background removal, how the sound effects sound to a human.
Long main-thread tasks in the sandbox are the machine's (same on main — PERF "Cloud sandbox").

Still open from v0.4 (PLAN): proxies for heavy 4K clips, text-to-speech voiceover, multiple
sequences / compound clips, optional AI editing plugin — see the latest entry above this one if
a later session continued.

## 2026-10-19 (made-up captions fixed — DECISIONS #130)

Auto captions no longer invent sentences when nobody is speaking; default model is `base` (more
accurate on real recordings). Owner to retry on the iPhone with a clip where someone speaks
clearly, and say the language spoken — the remaining unknown is real-speech accuracy on device.

## 2026-10-19 (owner's iPhone report fixed — DECISIONS #129)

Captions crash on iPhone, Hindi/Bangla/Urdu disabled, sheet not scrolling (Captions, Blur),
History off-screen, Align submenu cut off, stage taps/moves/menu dead on iPhone, black line on
the selection — all fixed. Captions now also run in WebKit with the real model (30 s English in
10 s). Re-check on the iPhone: stage select / move / long-press menu after using menus and the
sheet; Hindi captions (expect a few minutes for a minute of speech); every sheet scrolls.

## 2026-10-19 (v0.2 built — owner's one test of the whole release is next)

All of v0.2 is built and verified on main: A captions, B sound, C picture tools, D capture &
export, E layers & organising (PLAN.md, DECISIONS #116–128, PROGRESS.md). Not pushed: pushing
to origin waits for the owner's word in this conversation.

**Checks on main, all passing:** unit tests (core 449 incl. property tests with every new op,
captions 3, react 18); organize-check, picture-check, camera-check, audio-check, captions-check
(incl. the real on-device model, English + Hindi), composite-check (golden frames, both GPU
backends, 3 browsers), export-check --picture (ffprobe / decode-verified), a11y-check dark +
light (0 violations), editor-interact (Chrome, WebKit, Firefox), editor-recovery, storage-check,
ui-review (no page errors); lint, format, shaders, typecheck.

**Owner's test (desktop first, then iPhone, then Android) — `pnpm --filter playground dev`
(phones: `dev:https`), open `/editor`:**

1. Layers: add 2 texts + a sticker; Shift-click two, ⌘G group, drag them; lock (⇧⌘L) and try to
   move; History (🕘) jump to Original and back; Layers panel (▤): hide, rename, drag to
   restack; right-click / long-press for the menu; Arrange → align.
2. Captions: Captions → English → Make captions on a clip with speech (first time downloads
   ~41–77 MB); try every style and highlight; edit a line; drag a caption; download .srt;
   import an .srt. Hindi: needs a computer with WebGPU (~300 MB once). **On the iPhone / Android:
   how long it takes and whether the tab survives (memory)** — the main unknown.
3. Sound: add music, turn on "Lower under voice" — it should dip when the video talks; the
   Audio panel's demo library (search, ▶ preview, + Add).
4. Picture tools: green screen + Pick from video on a green-screen clip; import a .cube LUT;
   Blur panel → blur / pixelate a box; blend modes on a layer.
5. Capture & export: Record with camera (front / back on the phone) → Add to video; Export →
   Part (I / O), a preset, Sound only (M4A / Ogg / WAV), Picture (PNG / JPEG); play each file.
6. The four phone fixes from the last report: timeline "+", its hint, the solid tab bar, tools
   swapping in the open sheet.

Results / screenshots to `~/Desktop/iphone test result/`.

## 2026-10-19 (v0.1 fix pass — release on hold)

Owner put the release on hold: fix v0.1, then plan v0.2. Fix pass F1–F9 done (PLAN.md):
one tab owns a project (Web Lock, read-only second tab), crashed-engine screen, explicit export
bitrates + VP8 on Firefox + stale export tidy, orphaned-media sweep, no startup long tasks
(AudioContext moved to a quiet moment — PERF.md), sound crossfades under transitions, UI polish
(toolbar fades, ruler fade, device-drawable emoji, voiceover mute), stage view zoom.
v0.2 scope confirmed by the owner (PLAN.md "v0.2 — everyday creator", DECISIONS #115): all four groups + auto-captions. Next: A0 speech-model spike, then captions A1–A6. Still needs the
owner: real iPhone / Android checkpoint (https: `pnpm --filter playground dev:https`).

## 2026-10-19 (mobile pass)

Done from the owner's mobile list: device frames in the playground, one draggable bottom sheet,
sheet spacing / sticky bar / chip alignment, smooth phone scrubbing, readable text previews,
filters + adjustments for text and stickers (file version 2), element transitions = entrance /
exit. Owner to check on the iPhone: sheet drag feel, scrub smoothness, text filters.

## 2026-10-18 (round 4 follow-up)

Owner feedback fixed: grouped, named rows (video first — owner's choice), layer transitions
between touching clips, chip highlight while scrolling, filter previews reliable, panels follow
the selected element. Waiting on the owner to retry the two-videos-on-a-layer case.

## 2026-10-18 (UI round 4)

Done from the owner's fourth list: scroll-by-category libraries, real engine previews for
transitions and animations, 13 feel curves, ratio tiles, text inspector rebuilt, export dialog
rebuilt, timeline overhaul (layers above main, new-layer slot, main ↔ layer drags, auto-scroll,
new clip look and waveforms). Per-element animation confirmed: a lifted photo animates alone.
Waiting on the owner to try it (desktop, then iPhone). Check on a real phone: long-press lift
into the new-layer slot, edge auto-scroll while dragging, export Share sheet.

## 2026-10-17 (UI round 3 — effects library)

Done from the owner's third list: ruler sliders, icon rows, 146 text styles, sticker library (3D /
emoji / shapes / upload), colour picker, scrollbars, Saved chip, full-screen icon, transitions
(76 presets / 161 styles, categories, direction + feel, animated tiles, play-once preview),
115 filters in 15 categories, Animate (In / Out / Loop), clear targets, lane drops into new
lanes. Waiting on the owner to try it (desktop, then iPhone). The "zoom also moved stickers"
report isn't reproducible in the engine — ask for a recording if it recurs.

## 2026-10-17 (UI second pass)

The owner rejected the first UI after testing it (desktop + phone). It was rebuilt to
UI_VISION §9 (image-ultra is the bar), reviewed screen by screen with `scripts/ui-review.ts`
(desktop + iPhone-size WebKit, dark + light). Waiting on the owner to try it again — desktop
first (`localhost:3200/editor`), then the iPhone. Not yet checked on a real phone: keyboard lift,
long-press drags vs Safari, Preview mode (BACKLOG).

## 2026-10-17 (end of Days 4–6)

**Done:** Days 4, 5 and 6 of PLAN.md — the whole v0.1 feature set is in the editor, with
automated checks in Chrome, WebKit and Firefox. Built on three tracks (UI; engine effects +
export; analyzer + storage) and merged. See PROGRESS.md (three entries), DECISIONS #45–68,
PERF.md (editor UI, effects + export, analyzer, storage).

**What's missing from Days 4–6 (all in BACKLOG):** HEIC WASM decoder (no sample yet), File
System Access handles (import copies into OPFS), pinch-to-zoom the stage view, VoiceOver pass,
real-device runs, Chrome startup long tasks (2 × 70–170 ms in the first 0.5 s), Firefox WebM
export slower than real time, two tabs on one project (needs a Web Lock), lane lock button.

**Waiting on the owner — checkpoint for Days 4–6 (iPhone + Mac, then Android):**

1. Deploy the playground (Vercel, as before) and open **`/editor`** on the iPhone:
   - add 2–3 videos + a photo from the gallery, music; split, trim (drag the amber handles),
     reorder (long-press a clip), add text and a sticker, drag/pinch them on the video;
   - filters, adjust, transition (tap the square on a cut), canvas 9:16 → 1:1, blur background;
   - play with sound; scrub fast by dragging the film strip;
   - Export 1080p MP4 → download → plays in Photos? Report time and any error text;
   - close the tab, reopen `/editor` → the project should come back (crash recovery).
   - Screenshots of anything that looks wrong; results to `~/Desktop/iphone test result/`.
2. Still open from earlier batches: `/lab/engine` report (late frames, A/V offset), HDR check
   (`/bench`), a HEIC photo sample.
3. Decide: Firefox WebM export (slow VP9) — offer MP4 only on Firefox, or try VP8?

**Next (Day 7, after the checkpoint):** fix checkpoint findings, then 5.1 docs site + examples,
5.2 package checks (publint, attw, size limits), CI triggers back on, 5.4 owner publishes.

## How to run things

```sh
pnpm install && pnpm media && pnpm build
pnpm --filter playground dev                    # http://localhost:3200/editor
node scripts/editor-interact.ts --browsers chrome,webkit,firefox   # 15-step user flow + export
node scripts/editor-check.ts --sizes phone,tablet,desktop --shots <dir>
node scripts/editor-recovery.ts                 # reload → same project (Chrome, Firefox)
node scripts/a11y-check.ts [--theme light]      # axe WCAG 2.2 AA
node scripts/export-check.ts                    # ffprobe/ffmpeg-verified exports (engine lab)
node scripts/composite-check.ts                 # golden frames, both backends
node scripts/analyzer-check.ts / storage-check.ts
node scripts/bench.ts --browsers chrome,webkit,firefox
node scripts/organize-check.ts / picture-check.ts / camera-check.ts / captions-check.ts [--no-model] [--hindi]
node scripts/speech-media.ts                    # speech clips with known text (macOS `say`)
node scripts/captions-bench.ts / captions-memory.ts   # model speed, accuracy, memory
FC_RUNS=30000 pnpm --filter @video-ultra/core test   # deep property tests
```

Check scripts take `--port` (or `PLAYGROUND=http://localhost:<port>` for the engine ones). The
`chrome` target is the installed Google Chrome (real GPU); `webkit` is Playwright's build (no
WebGPU, no OPFS — real Safari must be tested on the owner's devices).
