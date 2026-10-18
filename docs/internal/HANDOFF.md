# video-ultra — Handoff

Where the last session stopped and what comes next. Update before ending every session.

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
FC_RUNS=30000 pnpm --filter @video-ultra/core test   # deep property tests
```

Check scripts take `--port` (or `PLAYGROUND=http://localhost:<port>` for the engine ones). The
`chrome` target is the installed Google Chrome (real GPU); `webkit` is Playwright's build (no
WebGPU, no OPFS — real Safari must be tested on the owner's devices).
