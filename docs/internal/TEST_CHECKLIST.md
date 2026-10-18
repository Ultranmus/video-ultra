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
