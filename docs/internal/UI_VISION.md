# video-ultra — UI Vision & Experience Rules

Source of truth for how video-ultra looks and feels. If a component doesn't match this doc, the
component is wrong (or this doc must be updated first, deliberately).

## 1. The feeling

> "Anyone can make a good video in minutes — and it never stutters."

- **Calm.** Quiet chrome; the video is the only colourful thing on screen.
- **Instant.** Every tap, drag and slider updates the preview in the same frame. No "Apply".
- **Confident.** Nothing is destructive; undo is always one tap away; work is always saved.
- **Obvious.** Every tool has an icon **and** a label. No mystery icons, no hidden core actions.
- **Simple first, deep when wanted.** A beginner never sees a graph editor unless they open one.

## 2. Principles

1. **Video is the hero.** The stage gets the most space; chrome never covers it except popovers.
2. **Selection drives the tools.** Nothing selected → the toolbar shows _add_ tools (Media, Text,
   Audio, Stickers, …). A clip selected → that clip's tools (Split, Speed, Volume, …). One decision
   at a time.
3. **Direct manipulation first.** Drag clips on the timeline, drag/pinch/rotate items on the stage,
   drag trim handles. Numeric inputs exist but are secondary.
4. **Progressive disclosure.** Common controls visible; advanced one tap deeper ("More ▸");
   pro tools behind Pro mode.
5. **Reversible everything.** Unlimited undo, per-tool reset, autosave.
6. **No modal dialogs while editing.** Only for export settings and "discard project?".
7. **Feedback < 16 ms** for interactions; heavy work shows progress and can be cancelled.

## 3. Layout

Breakpoints are **container queries on `.vu-root`** (the editor may live in a modal).

### Phone (container < 768px) — InShot-style

```
┌──────────────────────────┐
│ ✕   ↶ ↷  9:16▾  [Export] │  TopBar
├──────────────────────────┤
│                          │
│      STAGE / PREVIEW     │  pinch to zoom, drag items
│                          │
├──────────────────────────┤
│ ▶  00:04.2 / 00:30.0   ⛶ │  Transport
│        │                 │
│ [clip1][clip2][clip3] +  │  Timeline: playhead fixed in the centre,
│ ··[Title]····[sticker]·· │  content scrolls under it; lanes collapse
│ [~~~~~~ music ~~~~~~~]   │
├──────────────────────────┤
│ ✂ Split ⚡Speed 🔊 Vol … ⟶│  Contextual toolbar (scrolls sideways)
└──────────────────────────┘
```

Tool controls open in the **dock**: the same box as the timeline area (it covers the timeline, not
the video), with the tool's name and a ✓ Done button, never a second floating panel and never a
modal. While a text field has the on-screen keyboard, the bottom area rises above it (the editor
stays one box; the page never scrolls). Minimum usable size: 320 × 480.

### Tablet (768–1023px)

Desktop layout without the permanent Inspector; selected-item controls open in the dock.

### Desktop (≥ 1024px) — panel + stage + inspector + timeline

```
┌─────────────────────────────────────────────────────────────────┐
│ TopBar: ✕  ↶ ↷ │ project name │ 9:16 ▾ │ zoom       [Export ▸] │
├──────┬───────────────┬────────────────────────────┬─────────────┤
│ Rail │ Panel         │                            │ Inspector   │
│Media │ (browse:      │       STAGE / PREVIEW      │ (selected   │
│Text  │  uploads,     │                            │  item's     │
│Audio │  text styles, │                            │  settings,  │
│Stick.│  stickers,    │                            │  "More ▸")  │
│Filter│  transitions) │                            │             │
├──────┴───────────────┴────────────────────────────┴─────────────┤
│ ▶ 00:04.12 / 00:30   ✂ Split  🗑  ⚡ Speed  …        [Pro ⇄] ─○─ │
│ ─────────────●──────────────────────────────────────────────── │
│ 🎬 [ clip 1      ][ clip 2   ][ clip 3       ]  +              │
│ T  ·····[Title]·········[Caption]·····                          │
│ ★  ··········[sticker]···························               │
│ ♪  [~~~~~~~~~~~ music ~~~~~~~~~~~~~~~~~~~~~~]                   │
└─────────────────────────────────────────────────────────────────┘
```

### Right-to-left

Chrome mirrors (rail and panels swap sides). **Time always runs left → right** on the timeline;
the stage and everything drawn on it don't mirror. Text items in RTL scripts render RTL.

## 4. Region names (use these in code and conversation)

| Region    | Component      | Purpose                                                   |
| --------- | -------------- | --------------------------------------------------------- |
| TopBar    | `<TopBar/>`    | Close, undo/redo, project name, aspect ratio, export      |
| Rail      | `<Rail/>`      | Add-content categories (desktop/tablet)                   |
| Panel     | `<Panel/>`     | Browse the selected category                              |
| Stage     | `<Stage/>`     | Preview canvas + interaction overlay (handles, guides)    |
| Inspector | `<Inspector/>` | Selected item's settings (desktop)                        |
| Transport | `<Transport/>` | Play/pause, timecode, fullscreen                          |
| Timeline  | `<Timeline/>`  | Canvas timeline + accessible DOM layer                    |
| Toolbar   | `<Toolbar/>`   | Contextual tools (phone/tablet; desktop: timeline header) |
| Dock      | `<Dock/>`      | A tool's controls over the timeline area (phone/tablet)   |

## 5. Timeline rules

- **Main track** holds the story (video / photo clips, back to back). **Layer lanes** hold text,
  stickers, picture-in-picture and audio, each item free on time. Pro mode turns lanes into free
  multi-track.
- Rows top to bottom, always grouped and named: Video (main), the "new layer" slot, picture
  layers, text, audio (DECISIONS #100). Drag a main clip down into the slot (or a layer) to make
  it a layer; drag a layer picture onto the main video to put it in the sequence (#95). Drop
  places show as a dashed outline (into a lane), a glowing line + "New layer" (between rows) or
  a bar on the cut (into the sequence). Dragging near an edge scrolls. Touching pictures on a
  layer can have transitions too (#101).
- Phone: playhead fixed in the centre, content scrolls (one-thumb scrubbing). Desktop: playhead
  moves; click the ruler to seek.
- Snapping to playhead, clip edges and markers, with a visible guide and a light haptic on phones
  (`navigator.vibrate` where available).
- Trim handles on the selected clip; a ghost shows the hidden media while trimming.
- Pinch (touch) or Ctrl/⌘ + wheel zooms time around the pointer.
- Thumbnails and waveforms appear progressively; the timeline never waits for them.
- The canvas has an accessible DOM layer: each clip is a focusable item with a label
  ("Clip 2, video, 0:04 to 0:09"); arrow keys move, Shift + arrows trim, Delete removes.

- **Phone main track:** at the start the playhead sits mid-screen, so a "+" also sits before the
  first clip (adds media at the start) — the left half is never empty.

## 5b. Layers & organising (v0.2, DECISIONS #116–117)

- **Top bar:** ↶ Undo, ↷ Redo | 🕘 History, ▤ Layers. History is a popover: "Original" and every
  step by name, the current one marked, later ones faded; tap any to go there (and back).
- **Layers** (left panel on desktop / tablet, the sheet on phones): what's on screen at the
  playhead, front first, the main video last. Row = grip, picture, name (double-click / F2 to
  rename), Group badge, lock, eye, "⋯". Drag the grip (or Alt + ↑/↓) to restack. "Select
  several" turns taps into multi-select (phones have no Shift).
- **Selection:** Shift / ⌘-click (stage, timeline, Layers), ⌘A (everything on screen), a mouse
  drag on empty stage draws a rectangle. Several = one upright box with a faint outline on each;
  move / resize / rotate act on all, locked ones stay put. A group selects as one; double-click
  picks one member.
- **Context menu** (right-click, touch long-press on the stage or a still long-press on a clip,
  "⋯" in Layers, Shift+F10): the selection's commands in groups; Align as a submenu. On desktop the
  submenu opens beside the menu (flipped left near the right edge); on phones, inline under its
  item.
- **Your videos** (#154): a button at the top bar's start (every layout) opens a popover —
  Make a copy, New video, and the other saved videos (tap to open; a bin asks before
  deleting). Not shown when the host keeps its own project list.
- **Several selected** (#153): the desktop inspector shows "Changes here apply to all N
  selected" and the settings they share (Speed, Sound, Adjust, Opacity & blend); the left
  menu's Filters and Transitions act on all of them; the phone's multi-selection tools add
  Speed, Volume, Fade, Filter, Adjust, Animate, Opacity.
- **Typing on the stage** (#151): double-click a text (mouse) or tap a selected text (touch) →
  a field over it, styled like the text, dashed accent outline; click away or ⌘/Ctrl+Enter keeps
  it, Esc puts the old text back.
- **Arrange** (phone tool; desktop inspector section): Order (forward, backward, front, back),
  Align (6; several also distribute), Lock, Hide. Several selected on desktop: the inspector
  becomes the Group / Selection view (Group or Ungroup, Arrange, Duplicate, Delete).
- **Locked** items show a dashed box without handles and a lock badge on the clip; their
  settings show "Locked — unlock it to make changes" with Unlock and are dimmed. A row locks
  from the lock at its name's right end.

## 5c. Sound, picture tools, capture & export (v0.2, DECISIONS #120–124)

- **Sound:** "Lower under voice" (switch + how much) in the inspector's Sound section and the
  phone Volume tool; the host's music & sounds library in the Audio panel (search, categories,
  ▶ preview, licence line, + Add).
- **Picture tools:** Green screen is an inspector section and a phone tool (switch, green / blue,
  Pick from video with a hint pill on the stage, Range, Edge softness, Clean edges). LUT looks
  sit at the top of the Filters panel. Blend chips live in "Opacity & blend" / "Appearance"
  (desktop) and a "Blend" phone tool. Blur is a rail entry and panel (box / oval × blur /
  pixelate); a blurred area stretches from side handles when it's larger than 88 px on screen.
- **Capture & export:** "Record with camera" in the Media panel opens a recorder over the whole
  editor (preview, switch camera, mic, record / stop with a clock, then Add to video / Add as a
  layer / Retake). The export dialog has three kinds — Video (Length: whole / part, presets),
  Sound only (M4A / Ogg / WAV), Picture (the frame at the playhead, PNG / JPEG). I / O set the
  part from the playhead; the ruler shows it as a band.

## 5d. Captions (v0.2, DECISIONS #125–128)

- A **Captions** rail entry (desktop) / tab-bar tool (phone) opens the Captions panel: Auto
  captions (spoken language chips — English, Hindi, the browser's language, Detect, "More
  languages…" — then Make captions; one line says it runs on the device, the one-time download
  and roughly how long; progress with Stop), Import captions (.srt / .vtt), Add a caption.
- With captions: Style (preset tiles drawn in their style), Highlight words (Off, Colour, Box,
  Fill, Word by word, Letter by letter + colour), Position (Top / Middle / Bottom) and Size
  (S / M / L), the list of all captions (time → seek; edit the text in place; Split, Join with
  next, Delete on the selected row), Download captions (.srt / .vtt).
- Timeline: a "Captions" row after text. A selected caption's phone tools: Edit, Style
  (the panel), Split, Join with next, Delete. Dragging a caption on the stage moves all of them.

## 6. Gestures

- One finger on the stage: select / move an item. Two fingers: pinch-scale and rotate the
  selected item; with nothing selected, pinch zooms the view.
- Long-press a clip on the timeline to lift it: reorder, move to another lane, or make it a layer.
- A second finger always cancels what the first one started.

## 7. Motion

One motion curve and three durations (tokens). Motion answers the user's action (sheet opens,
clip lifts) — no decorative animation. Reduced motion: durations become 0.

## 8. Visual design plan (Day 4 — for owner review)

Brief: an embeddable editor that anyone can use on a phone, that looks like part of the host app,
sibling of image-ultra. Fixed by the brief: plum brand, calm dark chrome, image-ultra's token
system, the host's font. The free choices below are spent on the timeline — the one memorable
element — and everything else stays quiet.

**Colour** (dark theme; light mirrors image-ultra)

| Name     | Hex                                  | Role                                                                                 |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| Night    | `#0b0b0d`                            | editor background (image-ultra `--bg`)                                               |
| Stage    | `#060607`                            | behind the video — darker than chrome so footage glows                               |
| Graphite | `#16161a`                            | timeline lanes                                                                       |
| Plum     | `#9c479c` (dark) / `#4d194d` (light) | selection, playhead, primary action — the only saturated chrome colour               |
| Lilac    | `#d08bd0`                            | accent text/icons on dark surfaces                                                   |
| Amber    | `#f5b54a`                            | trim handles only: "you are changing length" reads at a glance, never used elsewhere |

Clip bodies are desaturated per kind (video graphite-violet, text umber, stickers teal, audio
slate) so the thumbnails and waveforms carry the colour, not the chrome.

**Type** — the host's font (`inherit`), falling back to the system stack. One family; hierarchy by
size and weight only (11 / 12 / 13 / 14 / 16 px; 400 / 500 / 600). Timecodes use the same family
with `font-variant-numeric: tabular-nums` so digits don't jitter while playing — no monospace.
Sentence case everywhere; no all-caps labels.

**Layout** — as sections 3–5. Alignment: chrome is left-aligned; the stage is centred; the phone
timeline is centred on the fixed playhead.

**The memorable element: the playhead spine.** A 2 px plum line through every lane with a small
timecode capsule on the ruler; on phones it stays fixed in the centre and the film strip slides
under it, with a light haptic tick when it snaps to a cut. Clips are drawn as continuous film strips
(thumbnail frames, not one repeated poster) with a 6 px radius that's smaller than chrome buttons'
(8 px) — clips read as material, buttons as controls.

**Principles**

1. Footage is the only vivid thing; chrome recedes.
2. One accent (plum) means "selected / now"; amber means "length"; red means "delete". Nothing else
   gets colour.
3. Every control has an icon and a label; touch targets ≥ 40 px.
4. Motion answers actions only (sheet opens, clip lifts on long-press, snap tick) — no decorative
   entrances. Reduced motion: none.
5. Copy names what users do: "Split", "Speed", "Add text" — never internal words.

**Review against generic defaults.** The near-black + single accent combination is one of the
common generated looks; here it's pinned by the brief (image-ultra parity), so it stays — but it's
distinguished by footage-first contrast (stage darker than chrome), amber reserved for trimming,
and the film-strip timeline. Changed from the first draft: dropped a monospace timecode (a generic
tell) for tabular figures in the host font; dropped all-caps lane labels for icons + sentence case;
clip radius made smaller than button radius instead of one radius everywhere.

## 9. Owner review rules (2026-10-17, after the first build was rejected)

The first editor build worked but felt bad (no help, duplicated menus, crude states, jumpy drags).
These rules come from that review; image-ultra is the polish bar — compare side by side.

1. **One home per control.** Rail = add / browse (Media, Text, Audio, Stickers, Filters,
   Transitions). Inspector (desktop) = settings of the selected item as titled sections, no tabs;
   with nothing selected it shows the video's settings (ratio, background) and how-to steps.
   Timeline bar (desktop) = clip actions only (Split, Duplicate, Freeze, Delete) + zoom. The
   inspector's Look section shows the current filter with _Change_ (opens the Filters panel) —
   the picker itself lives in one place.
2. **Every control explains itself.** Hover/focus tooltip on every icon button, tool and clip
   (with the shortcut); never on touch.
3. **No dead buttons.** An action that can't run is shown disabled and its tooltip says why
   ("Move the playhead inside a clip"). Filters and Transitions act on the selected clip, or the
   clip / cut at the playhead, and say which ("For bbb.mp4").
4. **Every action answers.** Split flashes the cut, selects the new half and shows "Split into 2
   clips · Undo"; delete / duplicate / freeze / apply-to-all show a toast with Undo.
5. **Empty states invite.** The empty stage shows "Start your video" with Add media; empty
   Filters / Transitions say what's needed.
6. **Drags never jump.** A dragged clip is a floating copy under the pointer (both axes), the
   original stays as a faint placeholder, a dashed outline / insertion bar shows the drop. Trim
   never moves the playhead: the preview shows the edge frame and a label shows the new length.
   One guide line at a time. A wheel gesture scrolls one axis.
7. **Calm colour.** Lane clips are one neutral with a thin kind stripe; footage carries colour.
   The canvas frame has a border on a lighter stage, so black video never melts into the chrome.
8. **Spacing.** Rhythm 4 / 8 / 12 / 16; rows of controls keep ≥ 4 px gaps so focus rings and
   hover fills never touch a neighbour; selection rings sit inside padded containers.
9. **Phones.** Same rules; filters and transitions are one sideways strip in the dock; long-press
   and drags never trigger the browser's own selection or callout; Preview mode replaces
   fullscreen (iPhone has no element fullscreen) and in it a tap only plays / pauses.
10. **Review before shipping UI.** Run `scripts/ui-review.ts` (desktop + phone, dark + light) and
    look at every screenshot as a first-time user.
