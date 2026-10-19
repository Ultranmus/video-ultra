# Owner test checklist — night of 2026-10-19 (branch `night/v0.3-v0.4`)

Tick each box when it works; write what went wrong next to it when it doesn't. "Checked here"
says what the automated checks already proved in the cloud machine (Chrome on Linux, no GPU, no
Safari) — the rest needs your devices.

Open the branch's Vercel preview (or `pnpm --filter playground dev`), then **`/editor`**.

## 1. Fixes

- [ ] **Hindi captions on the iPhone don't crash the tab any more.** Captions → Hindi → Make
      captions on a clip where someone speaks Hindi. Expected: the panel first warns that the
      large model may not fit a phone; then either it works (say how long it took), or — if the
      tab reloads — open Captions again: Hindi now says "ran out of memory… try on a computer"
      instead of crashing again. _Checked here:_ the Hindi model loads and hears with the new
      download path (84 words); it needs ~1.2 GB while it hears, which may simply be too much for
      the phone. Tell me which of the two happened.
- [ ] **Grouping with the mouse (desktop).** Add a video, then two texts. Drag a box with the
      mouse starting **on the video** across both texts → both selected (the video doesn't move).
      ⌘G groups them. A plain click on the video still selects it; once selected it drags.
      _Checked here:_ organize-check (7 new checks).
- [ ] **Copy / paste.** Select one or more elements → ⌘C, move the playhead, ⌘V → copies at the
      playhead (a group stays a group). ⌘X cuts. Right-click / long-press menu has Copy / Cut /
      Paste. Copy a video clip and paste it → it goes into the main video after the clip under
      the playhead. _Checked here:_ unit tests + organize-check.

## 2. v0.3 — Canva tier

- [ ] **Shape masks.** Select a video or photo → **Shape** (inspector section on desktop, tool on
      the phone toolbar) → pick shapes from the 6 groups (126 shapes). The picture shows only inside
      the shape; **Soft edge** feathers it; **Show outside the shape** inverts it; **No shape**
      removes it. Try it on the main video (black/blur background outside) and on a
      picture-in-picture. Export a video with a masked clip → the shape is in the file.
      _Checked here:_ WebGL2 golden frames match the reference maths exactly; shapes-check
      (picker, stage pixels, undo, phone tool, axe, no long tasks). **Not checked here: WebGPU**
      (no GPU in the cloud) — on the Mac run `node scripts/composite-check.ts` once.
- [ ] **High contrast / touch sizes.** `/editor?contrast=high` and `?contrast=high&theme=light`:
      everything readable, stronger borders and focus rings. `?density=touch` on the Mac: bigger
      handles and controls. _Checked here:_ axe 0 violations in both contrast themes.
- [ ] **Animated stickers.** Stickers → **Animated** tab (600+ animated emoji): tap a few — they
      move in the preview and in the exported video. Upload your own GIF as a sticker → it plays
      (before tonight it was still). Upload an `.svg` → crisp sticker. **On the iPhone:** do the
      animated stickers move? (If Safari lacks `ImageDecoder` they stay still — tell me.)
      _Checked here:_ stickers-check (GIF plays and is exact; SVG → 2048 px PNG; animated emoji
      added with its licence and plays).
- [ ] **Templates (192).** Left menu (phone: toolbar) → **Templates** → scroll the 9 groups →
      tap one → change the words → **Add to video**. It appears at the playhead as one group
      (drag moves all of it; double-tap a text to edit); the playhead jumps in so you see it.
      Play it — entrances and exits animate. Try the same template on 16:9 and 1:1 too.
      _Checked here:_ every template is valid and grouped (unit test over all 192);
      templates-check (form, your words, group, undo, countdown, phone, axe).
- [ ] **Remove background (photos).** Add a photo of a person → select it → **Remove background**
      (inspector on desktop, toolbar on the phone). First time downloads the model (phone 7 MB,
      computer 44 MB). Background disappears; **Restore background** brings it back. Try a pet or
      product photo on the computer too. **On the iPhone:** time it, and does the tab survive?
      Also works on an image sticker. _Checked here:_ cutout-check with both models (pixels:
      background gone, person kept; restore; undo; memory back to normal after).
- [ ] **Embedding API (for host apps).** Open `/editor?embed=1`: the left menu has **Brand**
      second (the host's own panel: "Add brand title" works), Blur is gone, the top bar has a
      **Share** button, the Media panel has a **Backgrounds** source (search "ocean", tap to
      add), and Duplicate is gone from the menu (⌘D does nothing). On the phone, Brand is in the
      add tools. _Checked here:_ embed-check (all of it, plus every event type arriving).

## 3. v0.4 — pro layer

- [ ] **Keyframes.** Add a title. Select it → Keyframes (inspector section; phone: toolbar) →
      ◆ next to Position at 0 s. Move the playhead to 2 s, drag the title somewhere else → it
      animates between the two (play it, export it). Try size / turn / opacity too (sliders key
      themselves once a ◆ is set). Graph: drag a ◆; tap the bar under two ◆ and pick a curve
      (Even, Spring, Bounce…, Custom with handles). Split the clip in the middle → the motion
      doesn't jump. Small ◆ marks show on the selected clip in the timeline.
      _Checked here:_ keyframes-check (auto-key by drag, exported positions, curve, undo,
      split) + 9 unit tests.
- [ ] **Fine trims (desktop timeline).** With 3 clips: hold **Alt (Option)** and drag the trim
      handle at a cut → the cut moves (one clip longer, the next shorter, the video the same
      length). Alt-drag a video clip → it shows a different part of the video in the same place.
      Alt+Shift-drag the middle clip → it slides between its neighbours. On the phone: select a
      clip → **Fine trim** (slip slider, Move cut ◀ ▶, Slide ◀ ▶). _Checked here:_ protrim-check.
- [ ] **Markers.** Press **M** to drop a marker (a flag on the ruler); M again on it removes it;
      **,** and **.** jump between markers; dragging the playhead or clips snaps to them.
      _Checked here:_ protrim-check.
- [ ] **Smaller files: HEVC / AV1 export.** Export → Video → a **Codec** row appears where your
      device can encode them: on the Mac / iPhone pick **HEVC** (about 40 % smaller) or **AV1** —
      the file plays in Photos / QuickTime? (HEVC should; AV1 needs a new device.) _Checked
      here:_ codecs-check (AV1 in MP4 and WebM, every frame decodes, half the size; HEVC absent
      on Linux with a clear message).
- [ ] **Split at scenes.** Add a video with several shots (any trailer, or a phone video you cut
      together) → select it → **Split at scenes** (inspector section; phone: toolbar) → each shot
      becomes its own clip; Undo puts it back in one step. Try **Big changes** / **Small changes
      too**. Time it on the iPhone and Android for a 1-minute video, and does Cancel stop it?
      Slow cross-fades stay in one clip (by design for now). _Checked here:_ scenes-check (exact
      cuts at 3 / 6 / 8 s in real footage, at 2× speed too, Sintel trailer, no false cut, Cancel,
      no long tasks, phone toolbar) + 6 unit tests.
