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

Tool controls open in a **bottom sheet** above the toolbar (slider, presets, options), never a
modal. Minimum usable size: 320 × 480.

### Tablet (768–1023px)

Desktop layout without the permanent Inspector; selected-item controls open in a bottom sheet.

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
| Sheet     | `<Sheet/>`     | Bottom sheet for a tool's controls (phone/tablet)         |

## 5. Timeline rules

- **Main track** holds the story (video / photo clips, back to back). **Layer lanes** hold text,
  stickers, picture-in-picture and audio, each item free on time. Pro mode turns lanes into free
  multi-track.
- Phone: playhead fixed in the centre, content scrolls (one-thumb scrubbing). Desktop: playhead
  moves; click the ruler to seek.
- Snapping to playhead, clip edges and markers, with a visible guide and a light haptic on phones
  (`navigator.vibrate` where available).
- Trim handles on the selected clip; a ghost shows the hidden media while trimming.
- Pinch (touch) or Ctrl/⌘ + wheel zooms time around the pointer.
- Thumbnails and waveforms appear progressively; the timeline never waits for them.
- The canvas has an accessible DOM layer: each clip is a focusable item with a label
  ("Clip 2, video, 0:04 to 0:09"); arrow keys move, Shift + arrows trim, Delete removes.

## 6. Gestures

- One finger on the stage: select / move an item. Two fingers: pinch-scale and rotate the
  selected item; with nothing selected, pinch zooms the view.
- Long-press a clip on the timeline to reorder (lift + drag).
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
