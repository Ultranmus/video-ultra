# Owner test checklist — night of 2026-10-19 (branch `night/v0.3-v0.4`)

Tick each box when it works; write what went wrong next to it when it doesn't. "Checked here"
says what the automated checks already proved in the cloud machine (Chrome on Linux, no GPU, no
Safari) — the rest needs your devices.

Open the branch's Vercel preview (or `pnpm --filter playground dev`), then **`/editor`**.

## 00000. 2026-10-26 — Audio (desktop first)

- [ ] **Music:** Audio panel → music library → search, ▶ preview, **+ Add** → it plays under the
      video. Select it → Volume, fade in / out.
- [ ] **Lower under voice:** select the music → Volume / Sound → **Lower under voice** → the
      music dips when someone talks in the video.
- [ ] **Clean up noise:** select a clip with room noise → **Clean up noise** / **Clean voice**.
- [ ] **Extract audio:** select a video → **Extract audio** → its sound becomes its own clip and
      keeps the fades / effects.
- [ ] **Record voiceover:** Audio → **Record voiceover** → it lands at the playhead; mute it, unmute it.
- [ ] **Sound effects (headphones):** see section 3 — Clear voice, Podcast, Phone call, Deep
      voice, Chipmunk, Bass / Middle / Treble, Pitch; 1.5× speed + **Keep the voice natural**.
- [ ] **Level meter:** the two thin bars next to the time move while playing, rest when paused.
- [ ] **Text to speech:** without a voice key you hear the demo voice (soft tones) — expected.
- [ ] **Export → Sound only** (M4A / Ogg / WAV) → the file sounds like the preview.

## 0000. 2026-10-25 — export dialog and camera

- [x] **Export:** Export → Quality tiles (sizes shown), Length, More settings (Same as video,
      file type, Extra quality, Smaller file where offered) → Export video → plays? Phone: the
      Export button stays at the bottom while scrolling.
- [x] **Camera:** Media → Record with camera → the round microphone button beside the record
      button (and switch camera on a phone) — tap it off and on.

## 000. 2026-10-25 — captions: check marks, names, Hear again, Hinglish

_Owner, 2026-10-25 — desktop: **captions tested ✓** (Groq, Gemini fallback, on-device English "really good", without the package)._

- [x] **Hinglish:** Captions → **Hinglish** (after Detect) → Make captions on a Hindi clip.
      Readable the way you'd type it? Note words that look wrong.
- [x] **Names to spell right:** type names said in the video (e.g. your channel's name) → Make captions
      → spelled right?
- [x] **Check marks:** on a clip with a hard-to-hear part — lines marked ⚠, "N captions to check",
      Next to check, Looks right.
- [x] **Hear again:** pick a caption → the captions button on its row → just that part redone.
- [x] **Talk over music:** a clip with music playing all through — captions now come (they could
      be skipped before).

## 00. 2026-10-25 — captions in every language (Groq in the playground)

_Owner, 2026-10-25 — desktop: **captions tested ✓** (Groq, Gemini fallback, on-device English "really good", without the package)._

- [x] **Hindi sync.** Captions → Hindi → Make captions on a Hindi clip. Do the words light up
      with the speech now (try a highlight look such as Karaoke)?
- [x] **Detect**, then the **wrong language** (e.g. French on Hindi speech): expect "This sounds
      like Hindi, not French…".
- [x] **More languages…** → search "chi" → Chinese (or Japanese) on a clip in that language: no
      spaces between characters, lines wrap, highlight goes character by character.
- [x] English as before (now through Groq, not the device): sync still good?

## 0. 2026-10-20 — your list, edit several, Your videos, combined clips (branch `feat/v0.4-finish`)

- [ ] **Align (desktop).** Right-click a title → hover **Align** → the list opens beside the menu
      (left of it near the right edge); click it too — it stays open. _Checked here:_ the list is
      really on top (hit-tested), organize-check.
- [ ] **Panels keep their own place (desktop).** Scroll Filters down, open Stickers → it starts
      at the top; back to Filters → where you left it.
- [ ] **Type on the stage.** Desktop: double-click a title → type, click away (one undo). Phone:
      tap a title, tap it again → keyboard, type, tap away. Esc / ✕ puts the old text back.
      _Checked here:_ stage-text-check (Chrome + WebKit).
- [ ] **No cut-off labels (desktop).** Inspector "Extract audio", Transitions "Play preview" /
      "Apply to all cuts", Stickers "Animated", filter "Cross process". _Checked here:_ every
      panel and inspector scanned at 1024 and 1440 px — nothing cut.
- [ ] **Phone timeline start.** With clips, at 0:00 there's a "+" before the first clip → it adds
      at the start.
- [ ] **Film strip flicker (desktop).** Didn't reproduce here (Chrome, WebKit, 1×/2× pixels,
      clips and video layers). If you still see it: a short screen recording please.
- [x] ~~**Hindi captions on the iPhone.**~~ Dropped: on-device captions are English only now
      (owner, DECISIONS #162). Make captions on the clip that said "No speech" (open the
      playground over **https**: `pnpm --filter playground dev:https`). Real Hindi under music
      now comes through (DECISIONS #152); if the phone can't read the sound you get a plain
      message saying so. Tell me how many lines it made.
- [ ] **Edit several at once.** Select two clips (Shift-click / Layers "Select several") →
      Inspector: Speed 2×, Mute, Adjust — all change; Filters panel → a look → both; two titles →
      Opacity, Transitions → an entrance → both. One undo each. Phone: the same tools in the
      multi-selection toolbar. _Checked here:_ multiedit-check.
- [ ] **Your videos.** Top-left button → Make a copy (you're now in "… (copy)"; "Back to
      original" in the note) → change something → Your videos → open the original: unchanged.
      New video; delete the copy (it asks). _Checked here:_ videos-check (desktop + phone).
- [ ] **Combine into one clip.** Select two clips and a title → right-click / long-press →
      **Combine into one clip** → one clip. Speed it up, add a filter, a transition — all act on
      it as one. Right-click → **Open combined clip** → the bar over the timeline; change
      something inside → **Back** → the clip shows the change. **Separate** puts the pieces
      back. Export a video with one in it and play the file. _Checked here:_ compound-check
      (frames identical to the pieces on WebGPU and WebGL2, sound, export), combine-ui-check
      (desktop + phone).

## 1. Fixes

- [x] ~~**Hindi captions on the iPhone don't crash the tab any more.**~~ Dropped (#162). Captions → Hindi → Make
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
- [ ] **Sound effects (listen with headphones).** Select a video where someone talks →
      **Sound effects** (inspector; phone: toolbar) → try **Clear voice**, **Podcast**, **Phone
      call**, **Deep voice**, **Chipmunk**; then Bass / Middle / Treble, **Even out** and
      **Pitch**. Does the voice sound clean (no warble, no clicks while playing)? Speed a clip to
      1.5× → turn on **Keep the voice natural** → normal pitch, faster talk. Export → the file
      sounds the same as the preview. _Checked here:_ soundfx-check (pitch, keep pitch, EQ,
      compressor measured on exported WAVs; axe) + 7 unit tests. Nobody has listened yet — your
      ears are the test.
- [ ] **Level meter (desktop).** Play a video: two thin bars next to the time move with the
      sound, amber near the top, red if it's too loud; they rest when paused. _Checked here:_
      soundfx-check (reads the tone's level, rests at 0).
- [ ] **Scopes (desktop).** Click empty space (video settings) → open **Scopes** → switch
      Wave / RGB / Levels / Colour while you scrub and play: they follow the picture, playback
      stays smooth. Select a clip → Adjust → drag Brightness / Warmth: the scopes move with it.
      Skin tones should sit near the line on Colour. _Checked here:_ scopes-check (colour-bar
      counts, every view draws, follows an edit, ≤ 4 updates/s while playing, axe, no long
      tasks) + 3 unit tests.
- [ ] **Proxies (heavy 4K clips).** On a budget Android phone (or the iPhone with a 4K
      recording): add a long 4K video → a note says a lighter copy is being made → after it's
      done, play and scrub: smoother than before? Export → the file is full quality (4K export
      looks sharp). Reopen the project → no new copy is made. To force it on the Mac:
      `/editor?proxies=always`. _Checked here:_ proxies-check (copy made, 540p, keyframe each
      second, every frame decodes, playback 17 → 70 frames shown in 3 s, export reads the
      original, reused after reopening).
- [ ] **AI Assistant.** Left menu (phone: last tool) → **Assistant** → tap an example or type
      "Make the whole video warmer", "Add a title “Day one” at the start", "Add a fade between
      every clip", "Make it square" → it edits; **Undo** takes the whole answer back. With no
      server key this is an offline demo (a few phrases only). To try a real model: on Vercel set
      `ASSISTANT_API_KEY` (and `ASSISTANT_MODEL`, e.g. a small fast model; `ASSISTANT_URL` for a
      non-OpenAI OpenAI-compatible endpoint), redeploy, then ask anything ("cut the first 2
      seconds", "make the title yellow and bigger"). _Checked here:_ assistant-check (mocked
      model end to end, one undo, bad plan changes nothing, offline demo, axe, phone) + 6 unit
      tests.
      _Owner, 2026-10-25 — desktop: **mostly works**_ (real Gemini). Fixed while testing: media
      list, rename, naming files (#159), a rejected answer retried once (#160), styled-text edit
      crash + `place` (#161), chat reopens at the bottom, History names. Phone not tried yet.
- [ ] **Text to speech.** Audio panel → **Text to speech** → type a sentence, pick a voice →
      **Add voice** → a sound clip at the playhead. Select a title → **Read aloud** → its words
      are spoken where it starts. Without a server key you hear the demo "voice" (soft tones per
      syllable) — set `SPEECH_API_KEY` (or the assistant's key) on Vercel for a real voice.
      _Checked here:_ speech-check (mocked service with a real recording, placement, failure
      message, demo voice, axe) + 1 unit test.
