# video-ultra — Handoff

Where the last session stopped and what comes next. Update before ending every session.

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
