# video-ultra — Backlog

Known gaps to fix later. Add new ones when found; tick them when fixed.

## Open

- [x] (fixed 2026-11-20, #195) Owner (iPhone): switching between template fields (and editing in a
      full-height Layers sheet) still jumped like the sheet opening again, the next field hid
      under Safari's address bar, and switching fast lagged. Confirmed fixed on the iPhone.
- [x] (fixed 2026-11-20, #193) Owner (iPhone): green screen on the yellow wall still said "grey,
      white and black" on the first tap; a second or third tap on the same spot worked.
- [x] (fixed 2026-11-20, #194) Owner (iPhone): with the Layers sheet already full height (and in
      Templates), editing a field looked like the sheet opening again and the field was only
      partly in view. Checked with a simulated keyboard (WebKit, iPhone 13): nothing moves when it
      comes (before: a 230 px jump).
- [x] (fixed 2026-11-20, #191) Owner (iPhone + desktop): a locked item showed only its top and
      bottom dashed lines on the phone, and its box stayed upright for a turned item. Now an SVG
      outline turned with the item and trimmed to the video.
- [x] (fixed 2026-11-20, #192) Owner (iPhone): typing a template's words, the full-height sheet
      left the field under the keyboard. The preview shrinks while typing.
- [ ] `stage-text-check` phone part (WebKit) logs "ResizeObserver loop completed with undelivered
      notifications" — same without the 2026-11-20 changes; harmless, but find the observer that
      changes its own target's size (Sheet's measure is the likely one).
- [x] (fixed 2026-11-18: the phone rule now also overrides the desktop `left: 0`) Phone (owner,
      iPhone screenshot 2026-11-18): the "Your videos" popover looks left-aligned
      on a phone — it hangs from the top bar's start, so its left edge sits at the button's edge
      and the right gap is much wider. `.vu-videos-anchor .vu-popover` sets `left: 0` (desktop
      intent, `editor.css`) while the width is `92cqi`. On narrow `.vu-root` (container query)
      centre it in the editor with equal side gutters, like the other popovers; keep the
      left-hanging placement on wide layouts.
- [x] (fixed 2026-11-18: typing in any sheet covers the editor above the keyboard, #188) Phone
      (owner, iPhone screenshots 2026-11-18): renaming a layer in the Layers sheet opens
      it full height with the keyboard, but the editor's top bar (videos, undo / redo, history,
      layers, ratio, Export) stays visible above it. It should cover everything like the text
      Edit sheet does. Only `tool === 'text-edit'` sets `data-cover` (`shell.tsx`); the Layers
      sheet needs the same cover while a name is being typed (and back to its usual height
      after).
- [x] (fixed 2026-11-18: phones show a chevron that turns over) Phone (owner, iPhone screenshot
      2026-11-18): in the item's menu (long-press / ⋯), Align
      shows a right arrow (`arrowRight`), but on phones its submenu opens inline below it
      (`organize.tsx`, `submenu && phone`). The arrow points the wrong way: on phones use a
      chevron that points down when closed and turns up (or rotates) when open; keep the
      right arrow for the desktop side flyout.
- [x] (fixed 2026-11-18, #188) Owner: a canvas size change (9:16 → 16:9…) "ends with a clamp, not
      an animation". Measured: the frame jumped to its new place and grew from its top-left corner
      (most of it in the first 100 ms of 200), and the old picture was stretched to the new shape
      until the engine drew again. Now the frame morphs centred (uniform scale + clip, 320 ms) and
      the canvas keeps its picture's shape (`object-fit: contain`) until the new frame arrives.
- [x] (fixed 2026-11-18, #189) Phone (owner, iPhone screenshot): green screen "Pick from video"
      on the warm wall said "Grey, white and black can't be removed". The wall in a dim room is
      a dull beige (#91836f): the old grey test (channels within 40 of each other) called it
      grey. Now grey means almost no colour tone (chroma < 6, as the shader measures it), so
      the wall goes the "Range lowered" way (#184). Also the pick no longer counts the
      background around the clip (bars) as black picture.
- [x] (fixed 2026-11-18, #190) Owner: editing a text, the caret started at the beginning (the
      Edit sheet; on the video a double-click's second press moved it where it landed, and a
      mouse double-click selected everything). It now always opens after the last letter; the
      Edit sheet's box is a little taller (about 3 lines).
- [ ] `scripts/picture-check.ts`: the blend step still looks for an "Appearance → Screen" chip;
      blend is now tiles (10-31). Update the step (the green screen / LUT / Blur parts pass).
- [ ] Transparent background in exported files (#186): the preview shows a checkerboard; video
      files and PNG frames come out black there. Needs an alpha-capable export canvas on both
      backends (WebGL2 `alpha: true`, WebGPU `alphaMode: 'premultiplied'` with premultiplied
      output), VideoEncoder `alpha: 'keep'` (VP9 in WebM — mediabunny supports alpha side data),
      golden-frame tests on both backends, and PNG frames with alpha. MP4 / H.264 stays black.
- [ ] HEIF on Android (#187): decoded with WebCodecs HEVC; needs the owner's Android check with
      a real iPhone HEIC (grid of tiles) and a Samsung one. Devices without an HEVC decoder still
      get the "save it as JPEG" message (a WASM decoder only after measuring, CLAUDE.md).
- [x] (fixed 2026-10-31) Phone test 5 (owner): a tap near the top of the play bar folded / unfolded
      the timeline (the grip's tap), so the video resized as if the canvas size changed. The grip
      now only resizes on a drag; a tap does nothing.
- [x] (fixed 2026-10-31) Phone test 5: the full-screen Edit sheet went back to partial once the
      keyboard opened (the keyboard's sheet cap also hit full-height sheets). Full-height sheets
      now keep their height with the keyboard up.
- [x] (fixed 2026-10-31) Phone test 5: a text low on the video was hidden by the keyboard when
      edited there. On phones a tap on the selected text now opens the full-screen Edit sheet
      instead of typing on the video (#185); stage-text-check updated.
- [x] (fixed 2026-10-31) Phone test 5: a turned locked item showed stray diagonal dashed lines (its
      turned box ran out of the frame). A locked item now shows its upright bounds, inside the
      frame.
- [x] (fixed 2026-10-31) Phone test 4 (owner, screenshots): the "[ ] highlighted region" was the
      export range (in / out points) on the ruler: a band over the whole ruler with brackets. Now
      a light band along the ruler's foot with a short tick at each end; the times stay readable.
- [x] (fixed 2026-10-31) Phone test 4: filter tiles for a template title showed "ummer in Lisbon",
      cut at the sides. The tile sized text from an average letter width; the iPhone's Didot is
      much wider. Now measured in the text's own font; the tile also drops the title's wrap width,
      keyframes and group. (Not reproducible without Didot here; check on the iPhone.)
- [x] (fixed 2026-10-31) Phone test 4: green screen on a pale yellow wall said "grey… can't be
      removed" / did nothing — the wall's colour is all over a warm video. Now a colour that would
      remove > 85 % is applied with Range lowered to keep about half the picture, with a message
      saying so; only grey / white / black are refused.
- [x] (fixed 2026-10-31) Phone test 4: a several-line message was a pill (round ends) — toasts are
      now rounded cards.
- [x] (fixed 2026-10-31) Phone test 4: typing on the video made the video bigger (timeline and tab
      bar hidden) and text near its bottom went under the keyboard. Now the video keeps its size
      and place, and slides up under the top bar just enough to keep the text above the keyboard.
- [x] (fixed 2026-10-31) Phone test 3 (owner): a tap on the timeline jumped the playhead (a drag
      was smooth). On phones a tap on the ruler now glides the playhead there (220 ms, eased;
      instant under reduced motion; a new touch stops it). If the jump was from a tap somewhere
      else on the lanes, the owner says where.
- [x] (fixed 2026-10-31) Phone test 3 (owner): the text Edit sheet was partial; the owner wants it
      to cover everything. It now covers the whole editor, top bar and tab bar included
      (`data-cover`), and the next tool opens at the usual height (#183).
- [x] (fixed 2026-10-31) Phone test 3 (owner): renaming a layer low in the Layers list — the row
      stayed under the keyboard. The field is now scrolled into view in the box that really
      scrolls it (the Layers list), not only the sheet body.
- [x] (fixed 2026-10-31) Phone test 3 (owner): a locked full-width item still showed only top and
      bottom on the iPhone (Chromium showed all four). The dash is now a border inside the box
      (Safari didn't draw the negative-offset outline's sides), and the box stays inside the frame.
- [x] (fixed 2026-10-31, test 4) Phone test 2 (owner, 2026-10-31): Filters for an emoji sticker or a text — the preview tiles
      show the emoji / text pushed right and cut in half (video and image tiles are fine). Not
      reproduced in the cloud container (Chromium, WebGL2: centred and whole), so likely the
      iPhone's WebGPU path of the looks renderer (`filterPreviews` → `centredForTile`, worker).
      Needs a screenshot from the phone, then a WebGPU check of the text / sticker draw at the
      tile size.
- [x] (fixed 2026-10-31, test 4) Phone test 2 (owner, 2026-10-31): on the main (frame) lane "some region is highlighted with
      [ ] and the accent colour" — not clear which part (a selected clip's trim handles? a drop
      slot?). Needs a screenshot. (The "+" no longer moves when a handle appears — fixed below.)
- [x] (fixed 2026-10-31) Phone test 2: the timeline grip snapped and the whole bottom area, tab bar
      included, moved with the finger. Now the timeline's height follows the finger live (one CSS
      variable, like the desktop splitter) and settles on the nearest size on release.
- [x] (fixed 2026-10-31) Phone test 2: timeline lanes jumped a few px when a scroll started (the
      axis dead zone's distance came in at once). The pan now starts from where the axis locks.
- [x] (fixed 2026-10-31) Phone test 2: the "+" after the last clip moved when the clip was selected
      (to clear its trim handle). It now always sits past the handle's room; unit test.
- [x] (fixed 2026-10-31) Phone test 2, bad one: typing (e.g. renaming a layer, or text on the
      video) broke the layout — top bar in the middle, black above, sheet under it. Cause: the
      editor followed iOS's page pan with `top`, which fed back into itself. Now the page scroll
      iOS makes is undone while a field in the editor has focus (when the editor fills the
      window), and the editor never moves; the sheet rises above the keyboard (#175).
- [x] (fixed 2026-10-31) Phone test 2: typing on the video shrank the video and pushed the frame
      lane up. Now the timeline and tab bar step aside while typing on the video, so the video
      keeps the room above the keyboard (#175).
- [x] (fixed 2026-10-31) Phone test 2: during a pinch / resize / drag on the video the selection
      border jumped to the top left, empty, and came back on release. Cause: the touch "frame
      drawn" listener (#176) kept the stage scale from mount (0). It now follows the scale.
- [x] (fixed 2026-10-31) Phone test 2: the green screen "tap the colour" hint was still a narrow
      pill. On phones it spans the stage like a toast.
- [x] (fixed 2026-10-31) Phone test 2: picking grey said "tap the green or blue background", which
      read as wrong. A grey / white / black pick now explains why it can't be removed; another
      colour that covers nearly all says so without naming green / blue.
- [x] (fixed 2026-10-31) Phone test 2: templates 3 to a row still too small → 2 on phones; the
      Templates sheet opens at full height; the form doesn't open the keyboard by itself on touch;
      a full-height sheet doesn't move when the keyboard comes or goes (its list gets room to
      scroll above it) — no more snap when scrolling closes the keyboard (#180, #175).
- [x] (fixed 2026-10-31) Phone test 2: a locked item still had no left / right border. The dash
      was moved inside, but the box is 6 px larger than the item, so for a full-width item the
      sides were still outside the frame. A locked upright box is now kept inside the frame.

- [ ] Checks in the cloud container (2026-10-31): `stage-text-check`'s phone part needs WebKit,
      which isn't installed there; run in Chromium, the tap that opens the field also moves the
      caret into the word ("HeSalello"), same before and after the 10-31 changes. Check on the real
      iPhone that typing on the video goes on at the end of the text.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): once the browser zooms the page in (pinch, or a double
      tap), it can't be zoomed back out — the page stays stuck zoomed. Not fixed yet, only
      recorded. Likely cause (to check): most of the editor area has `touch-action: none`
      (preview, timeline, sheets in `editor.css`), so a pinch-out lands on parts that swallow it
      and the browser never gets it. Also check the viewport settings in `apps/playground/app/layout.tsx`
      and whether an input under 16px font makes iOS zoom in on focus.
      Fixed: no focus zoom (16 px fields on touch), pinch gets through once zoomed (#174).
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): in the selection menu, the Align submenu's top option
      shows the hover color, pressed right up against the Align row with no gap at all. Not
      fixed yet, only recorded. Likely cause (to check): on phones the submenu opens inline
      under its item (`.vu-submenu` in the `max-width: 767px` container query in `editor.css`)
      with `padding: 0` and no top margin, so the highlighted Align row (`aria-expanded`) and
      the first option touch. The first option also looks hovered because `:hover` sticks after
      a tap on touch screens (`.vu-menu-item:hover` isn't limited to `@media (hover: hover)`).
      Fixed: gap under the open item; hover only on real pointers.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): renaming a layer (double tap on its name in Layers) works,
      but the name field's border and focus outline sit right on the layer row's border — no
      space between them, they touch. Not fixed yet, only recorded. Likely cause (to check):
      `.vu-layer-rename` (`editor.css`) is `--vu-size-choice` tall and stretches to the row's
      right edge (the row has only `--vu-space-1` right padding and no top/bottom padding),
      while the selected row draws a 2px inset `--vu-selection` ring and the root
      `:focus-visible` outline adds more, so field border, outline and row ring overlap.
      Fixed: the field sits inside the row with room; no second focus ring.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): with Layers open, picking Style in the bottom nav opens
      Style, but the Layers button in the top bar still shows as pressed (selected). Not fixed
      yet, only recorded. Likely cause (to check): `openTool` (`controller.ts`) sets `tool` but
      leaves `sheetPanel: true`; the sheet hides the panel because a tool is open, but the top
      bar's `layersOpen` (`shell.tsx`) checks only `panel === 'layers' && sheetPanel` and not
      `!tool`. Same for the History button. Fix either side: clear `sheetPanel` when a tool
      opens on phone, or add `!s.tool` to those two checks.
      Fixed: a tool sheet replaces the Layers / History sheet; the buttons check `!tool`.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): Media → camera → record a video. On the review screen the
      "Add as a layer" and "Add to video" buttons are different heights; they should match.
      Not fixed yet, only recorded. Likely cause (to check): the review bar
      (`.vu-camera-bar[data-review]`, `editor.css`) is flex but keeps `align-items: center` from
      the base `.vu-camera-bar` grid rule, so buttons don't stretch to the row's height; on a
      narrow phone the longer label ("Add as a layer", plus its icon) wraps to two lines and
      that button grows taller than its neighbour. Fix: `align-items: stretch` on the review
      bar (and/or keep labels on one line).
      Fixed: `align-items: stretch` on the review bar.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): in any bottom sheet, the horizontal row of tab pills
      (category chips) sits with extra space on the left/right, so it doesn't line up with the
      text and options under it — looks off. Not fixed yet, only recorded. Likely cause (to
      check): the sticky `.vu-browser-bar` (`editor.css`) breaks out with
      `margin-inline: -space-4` and pads back `space-4`, assuming the sheet's side padding is
      exactly `--vu-space-4`; if the phone sheet's padding differs, the chips shift. The inner
      `.vu-chips-scroll` also adds `padding: space-1` (focus-ring room) with a matching negative
      margin — check that it really cancels inside the bar. The first chip should start on the
      same line as the section titles and grid below. Owner confirmed it on the Text and
      Stickers tabs too (their pill bars are shifted inward the same way).
      Fixed (check on the iPhone): the chip row runs edge to edge, its padding puts the first chip on the content line.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): the Templates grid shows 4 per row on a phone; the text in
      each template is too small to read or judge. Owner wants 2 or 3 per row on phones. Not
      fixed yet, only recorded. Cause: `.vu-template-grid` (`editor.css`) is
      `repeat(auto-fill, minmax(var(--vu-size-template), 1fr))` with `--vu-size-template: 72px`
      (`tokens.css`), so a ~360–430px sheet fits 4. Fix: a phone container query with a fixed
      2 (or 3) columns, or a larger min size token. Check UI_VISION.md before choosing.
      Reference the owner liked: the Text tab on phone — 3 per row, big readable text.
      Fixed: 3 per row on phones (#180).
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): the Filters grid also shows 4 per row on a phone; owner
      wants 3. Not fixed yet, only recorded. Same cause as the Templates entry above:
      `.vu-filter-grid` (`editor.css`) is
      `repeat(auto-fill, minmax(var(--vu-size-filter-tile), 1fr))` with
      `--vu-size-filter-tile: 72px`. Fix both together (a phone column count of 3).
      Owner's rule for phone grids: tiles with long text or a picture to judge (templates,
      filters) → 3 per row; tiles with an emoji or a short word (stickers, emoji) → keep 4,
      bigger would look oversized. Apply per grid, not one global count.
      Fixed: 3 per row on phones; emoji / stickers keep 4 (#180).
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): on-screen keyboard. After picking a template, the keyboard
      opens and the whole editor shifts up — the top part goes off screen and the text field
      being edited isn't kept in view, so editing is hard. Same everywhere a text field opens
      the keyboard. Wanted: the editor stays put, the sheet rises above the keyboard as one
      whole piece, and the field being edited is always visible. Not fixed yet, only recorded.
      Likely cause (to check): iOS ignores `interactiveWidget: 'resizes-content'`
      (`apps/playground/app/layout.tsx`) and pans the whole page up to reveal the focused field;
      the `visualViewport` handler in `VideoEditor.tsx` sets `--vu-keyboard` / `data-keyboard`
      but doesn't undo the pan (pin the root to `vv.offsetTop` / `vv.height`, or stop the page
      scroll), and nothing scrolls the focused field into view inside the sheet. Test on both
      iPhone Safari and Android Chrome.
      Fixed (check on iPhone + Android): #175.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): tapping any text field to edit also zooms the page in, so
      the parts beside it get cut off (and then it can't be zoomed back out — see the first
      phone-test entry above). Owner: no zooming anywhere in the phone view. Not fixed yet, only
      recorded. Cause: iOS Safari zooms in on focus whenever a field's font is under 16px; our
      text tokens are 11–13px (`--vu-text-xs/sm/md`, `tokens.css`) and the fields inherit them.
      Fix: fields at least 16px on phones (a phone token, via the `.vu-root` container query),
      not a `maximum-scale=1` viewport (that blocks zoom for people who need it, and host apps
      own the viewport anyway). Owner confirmed the same when adding text from the Text tab:
      it zooms in and the editor isn't in full view while typing.
      Fixed: #174.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): Templates → pick one → "Add to video": the sheet stays
      open, so it's unclear what's left to do there and the added template can't be seen in
      the frame. Wanted: the sheet closes by itself after adding, showing the template on the
      preview. Not fixed yet, only recorded. Check the other add actions in sheets (media,
      stickers, text) for the same behaviour, and keep the result selected so it can be edited
      right away.
      Fixed: template, sticker and library-media adds close the phone sheet (#180).
- [x] (done 2026-10-31, preview; see the export item) Phone test (owner, 2026-10-30), feature request: Canvas tab → Color section should offer
      a transparent background as one of the background colors. (Canvas and Blur tabs were
      otherwise fine on phone.) Not done yet, only recorded. To think through: the preview
      shows a checkerboard for transparent; export keeps it only in formats that carry alpha
      (WebM VP9/AV1 with alpha, PNG/WebP stills, GIF one-bit) — H.264 MP4 has no alpha, so pick
      a fallback (black) and say so in the export sheet. Must work the same on WebGPU and
      WebGL2. Record the choice in DECISIONS.md.
      Not done 2026-10-31: needs transparent-video export first (#144 left it out). Owner to choose: MP4 (no alpha) falls back to black with a note, and transparent only in WebM (VP9 alpha) / PNG stills?
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): selecting a locked item shows its dashed box only on the
      top and bottom edges, not left and right. Spec (UI_VISION.md: "Locked items show a dashed
      box without handles") wants all four sides. Not fixed yet, only recorded. Likely cause (to
      check): the item spans the full frame width, so `.vu-selection-box[data-locked]`'s
      `outline` (`editor.css`) is drawn outside the box and the stage's overflow clips the left
      and right sides. Fix: draw the dash inside (`outline-offset` negative, or an inset
      border) so it shows at the frame edges. Check unlocked full-width selections too.
      Fixed: the dash is drawn inside the box.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30), bad one: double tap a text on the preview to edit it in
      place → the page zooms and the keyboard opens, the frame shifts up, and the typing text
      ends up drawn over the frame in the wrong place (not on top of the text it edits). Not
      fixed yet, only recorded. Likely cause (to check): the in-place field (`textarea.vu-stage-text`
      in `Stage.tsx`, an absolutely placed DOM overlay) gets its font size from the text's size
      × preview scale, often under 16px, so iOS zooms on focus (same cause as the field-zoom
      entry above); the zoom + keyboard pan move the frame, and the overlay's position isn't
      re-measured, so it drifts off its text. Fix together with the keyboard and field-zoom
      entries: no focus zoom (scale the field with a transform instead of a small font size),
      keep the frame in view above the keyboard, and re-place the overlay on
      `visualViewport` resize/scroll.
      Fixed (check on the iPhone): field scales instead of a small font; the video shrinks above the keyboard (#174, #175).
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): Filters → Intensity slider. Dragging it sideways also
      starts a vertical scroll (owner: not the sheet's list moving up/down inside the sheet —
      a vertical scroll of the view itself), the two mix, and then the intensity jumps back to
      its old value. Not fixed yet, only recorded. Cause (from the code): the ruler slider
      (`.vu-ruler`, `editor.css`) has `touch-action: pan-y`, so any slightly diagonal swipe lets
      the browser take the gesture as a vertical scroll; it then fires `pointercancel`, and
      `onPointerCancel` in `controls.tsx` calls `onCancel` and reverts the value. Fix: once the
      drag has moved sideways (`d.moved`), keep it (e.g. `touch-action: none` on the ruler while
      dragging / lock direction on the first move), and on a cancel after a real sideways drag
      commit the last value instead of reverting. Affects every ruler slider in sheets, not just
      Filters.
      Fixed: a sideways first move stops the browser's scroll; a cancel after a real drag keeps the value (every ruler slider).
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30), design: Opacity and Blend both work, but each sheet
      looks too empty — Opacity is a single slider, and Blend is a list of names only, with no
      preview of what each mode does. Owner's options: combine the small ones (e.g. Opacity +
      Blend, maybe other one-control tools) into one sheet, or give each a richer view — e.g.
      Blend as preview tiles showing the selected item blended with each mode. Not done yet,
      only recorded. Decide against UI_VISION.md (tool bar layout) and record it in
      DECISIONS.md; previews must be cheap (small, cached, made off the main thread).
      Done: one "Opacity & blend" tool with preview tiles (#178).
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): dragging a text on the preview — the selection border
      moves with the finger but the text itself doesn't keep up (border and text come apart
      during the drag). (The rest of the Text tab works on phone.) Not fixed yet, only
      recorded. Likely cause (to check): the box is DOM on the main thread and moves at once,
      while the text is drawn by the engine worker from `ctl.preview(...)` (`Stage.tsx`), so it
      lands a frame or more later — or previews get dropped/coalesced on a phone. Measure the
      box-to-frame lag on the iPhone; options: move the box only when the engine reports the
      frame drawn, or draw the box in the same pass.
      Fixed (check on the iPhone): on touch the frame moves when the engine has drawn the move (#176).
- [x] (done 2026-10-31) Phone test (owner, 2026-10-30): Rotate, Flip and canvas size (ratio) changes apply as an
      instant snap, which feels abrupt; owner wants them smooth. Not done yet, only recorded.
      Idea: a short eased transition (~150–200 ms, `--vu-duration-*` / `--vu-ease-out`) of the
      item or frame from old to new, animated in the engine (no React per frame), instant
      under reduced motion. One edit is still committed; the animation is view-only.
      Partly done 2026-10-31: Rotate (quarter turn) and a blurred area's flips now ease over 180 ms (instant under reduced motion), one edit. Still open: a picture's mirror flip (the transform has no in-between for a mirror) and the canvas size change.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): on the timeline's main (frame) lane, the last clip's
      right trim/drag handle sits behind the "+" (add media) button at the end, so it's hidden
      and hard or impossible to grab. Not fixed yet, only recorded. Cause (from the code): the
      "+" is placed only 8px after the last clip's end (`addButtonRect`,
      `timeline/geometry.ts`), the touch trim handle is wider than that, and the hit test checks
      the "+" before the clip's handles (same file, ~line 267), so a touch there adds media
      instead of trimming; `timeline/view.ts` also draws the "+" over the handle. Fix: when the
      last clip is selected, push the "+" past the handle (or hide it while trimming) and test
      handles before the "+".
      Fixed: the "+" moves past a selected end (or start) clip's handle, drawn and hit-tested; unit test.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): Sound effects sheet — too little space between the sound
      look chips and the "Clean up noise" slider label under them; they feel stuck together.
      Not fixed yet, only recorded. Cause (from the code): `.vu-soundfx` (`editor.css`) is a
      column with `gap: var(--vu-space-3)` for everything, so the chip group → first slider
      break is the same as slider → slider. Fix: a bigger gap after the chips (a section-gap
      token, matching other sheets), not a raw value.
      Fixed: more room after the chips.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): tooltips on phone are only ~70–80% of the screen wide, so
      their text wraps onto several lines. Wanted: full width on phones (with the side gutter).
      Not fixed yet, only recorded. Cause: `.vu-tooltip` (`editor.css`) has
      `max-width: var(--vu-size-tooltip)`; add a phone rule (container query on `.vu-root`) that
      lets it span the editor width minus the gutter.
      Fixed: as wide as the editor less the edge gap on phones.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): Green screen → "Pick from video": the sheet stays open and
      covers the preview. Wanted: close (or drop) the sheet so the person can tap a colour on
      the video — the tooltip already tells them to tap — then bring the sheet back after the
      pick (or on cancel). Not done yet, only recorded.
      Fixed: the sheet goes down while picking, back after (#177).
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30), bad one: Green screen → pick a colour on the video → the
      whole video disappears (keyed out entirely), not just the picked colour. Didn't happen on
      desktop; owner isn't sure if it's this video. Not fixed yet, only recorded. To check:
      (1) the tap point is wrong on phone — page zoom / keyboard pan (see the zoom entries)
      shifts the preview, so `Stage.tsx` (~line 522) sends wrong `x/pw, y/ph` to
      `pickKeyColour` (`controller.ts`) and it picks a colour that matches most of the frame;
      (2) the engine's `pickColour` readback on the phone's backend (likely WebGL2 on iPhone)
      returns a wrong value (premultiplied alpha, colour space, or reading an empty/black
      frame before the picture is drawn); (3) the key tolerance is too wide for that colour.
      Reproduce with the same video on desktop and phone, log the picked hex on both.
      Fixed (check with the same video): taps outside the picture don't pick; a colour that would remove > 85 % is refused (#177). Cause: the key ignores brightness, so a black / grey pick removed most of the picture.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30), feature request: make the timeline (frame lanes) area on
      phone resizable like a sheet, with a drag handle and snap points: **minimal** (only the
      play bar — play button, timecode — so the preview gets the most room), **normal** (today's
      height), **full** (expanded, many lanes visible). Drag down from normal to collapse to
      the play bar; drag up to bring it back. Not done yet, only recorded. To think through:
      fit with UI_VISION.md's phone layout and the bottom tool sheet (which one wins the space),
      keep the preview resizing smooth (drag state local, one commit on release, no React per
      frame), remember the chosen size, keyboard/screen-reader way to change it, reduced
      motion. Record in DECISIONS.md.
      Done: grip on the play bar, minimal / normal / large (#179).
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30): scrolling the timeline lanes up/down isn't as smooth as
      expected (feels unlike a native list). Not fixed yet, only recorded. Cause (from the
      code, `timeline/view.ts`): the canvas does its own vertical pan (~line 866) — it follows
      the finger 1:1 but has no momentum (the fling ~line 1145 only handles horizontal: samples
      record `x` only), so it stops dead on release; no edge bounce; and the axis locks on the
      very first move (`Math.abs(dx) >= Math.abs(dy)`, no dead zone), so a slightly sideways
      start turns into a seek instead. Fix: vertical fling with the same decay, a few px dead
      zone before locking the axis, maybe a soft edge stop. Measure redraw cost per frame on
      the iPhone while scrolling (should be a cheap redraw, no React).
      Fixed: vertical fling with the same decay, 6 px before the axis locks.
- [x] (fixed 2026-10-31) Phone test (owner, 2026-10-30), clarity: the owner couldn't tell how fine trim works on a
      sound clip on phone. Desktop explains it with a shortcut (Alt-drag on the timeline);
      phone has no hint at all. Not done yet, only recorded. What exists: the Fine trim tool
      (`protrim.tsx`, all devices) — Slip (which part of the sound plays, clip stays put), Roll
      (move the cut after the clip) and Slide (main video only), a frame per step plus a
      slider. Needed on phone: a one-line explanation per row (what Slip/Roll do, in plain
      words) and/or a short first-use hint, translatable; check the tool shows and works for
      sound clips (Slip needs extra media beyond the trimmed part — say so when there's none).
      Fixed: a plain-words line under Slip, Move cut and Slide; "nothing to slip" when the whole recording is in use; the desktop shortcut line only on desktop.
- [x] (done 2026-10-31; check on Android) User report (via owner, 2026-10-30): a HEIF photo (`.heif` / `image/heif` — owner: HEIF,
      not HEIC) shared from an iPhone to an Android phone can't be picked in the editor on
      Android. Note: `probe.ts` (~line 75) sniffs every HEIF brand, including the generic
      `mif1`/`msf1`, as `image/heic` and calls it "a HEIC photo" in the error — wrong name for
      a `.heif`, and a `mif1` file can actually hold AVIF (check the compatible brands before
      deciding), which Chrome on Android _can_ decode. Owner: the same file picks and opens fine
      on iPhone — expected, since iOS Safari decodes HEIF natively (and its picker may hand it
      over as JPEG); so the gap is Android-only (picker filtering and/or no HEIF decoder). Not fixed yet, only recorded. Two parts
      to check: (1) the picker — the file input's `accept`
      (`'video/*,audio/*,image/*,.mov,.mkv,.heic,.heif,…'`, `VideoEditor.tsx` ~line 153) may
      not let Android's picker select it (some pickers grey files out by extension/MIME; try
      adding `image/heic,image/heif`, test the system picker and Google Photos), and a shared
      file can arrive with no extension or a generic MIME; (2) decoding — Chrome on Android
      generally can't decode HEIC, so `probe.ts` (~line 164) would reject it with "this browser
      can't open yet". Real fix needs a HEIC decoder (lazy-loaded, in a worker, only when a
      HEIC arrives; measure size/speed first — see the WASM rule in CLAUDE.md). That error
      message is also hard-coded English, not a translatable label.
      Partly done 2026-10-31: the picker lists `image/heic,image/heif`; `mif1`/`msf1` files are told apart by their compatible brands (AVIF → opens, HEIC, else HEIF) and the message names HEIF vs HEIC with how to save it as JPEG. Still open: decoding HEIC/HEIF on Android Chrome (needs a decoder; measure first) and the message isn't translatable yet.

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
      in the analyzer, cached), and Media shows it as a video. (Layers fixed 2026-11-18: combine
      icon and "Combined clip" for screen readers.)
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
- [x] (fixed 2026-11-18) (v0.2 A) Export dialog: offer the .srt next to the video download
      (today: Captions panel). "Captions (.srt)" shows under Download when the video has captions.

- [ ] (v0.2 B) A ducking badge on timeline clips; optional look-ahead or a "listen to" choice so
      short sound effects don't dip music; default ducking on for library music (owner's call);
      show asset credits to the host at export.
- [ ] (v0.2 C) LUT chips have no previews, no delete / rename; a LUT import with nothing selected
      applies to nothing. ("Apply to all clips" copies the LUT too — checked 2026-11-18.) Blend modes on
      a 3D-turn animation copy only the flat bounding box — confirm with a golden frame. Region
      items have no entrance / exit animations. Green screen not measured on budget phones.
- [ ] (v0.2 D) Each frame capture creates a renderer (WebKit warns "too many WebGL contexts" in
      export-check) — reuse one. Camera can't switch while recording; the range bar has no film
      strip. (Fixed 2026-11-18: recording / voiceover names use a fixed `14.05.09` stamp; sound
      only is offered only when something sounds inside the chosen part.)
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
- [x] (done — icon row `vu-icon-row`, checked 2026-11-18) Inspector: "Appearance" buttons stack one per row in a narrow inspector; consider an icon
      row (rotate / flip H / flip V) like image-ultra's adjust bar.
- [x] (fixed 2026-10-19) Ruler labels under the playhead capsule are hidden; a nicer approach would fade them.
- [ ] Real-device pass of the effects library: iPhone (WebGPU) and a low-end Android (WebGL2):
      play the blur family (spin-blur, motion-blur, zoom-blur), the 3D family and a typewriter
      title; watch late frames and preview-quality drops. Tune `cheapEffects` / tap counts.
- [x] (done — per category when it scrolls near the view, checked 2026-11-18) The UI asks `filterPreviews` for every filter id (now 115 + none): ask per visible
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
- [x] (done — the ease picker shows `preset.ease`, checked 2026-11-18) `TransitionPreset.ease` is a new required field (the preset's default curve) — the UI may
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
- [x] (done — `centredForTile` fits text to the tile, checked 2026-11-18) Animation tiles: text previews use the item's own size — very long text can be tiny in the
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
