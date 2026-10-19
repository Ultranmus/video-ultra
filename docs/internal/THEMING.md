# video-ultra — Theming

Same system as image-ultra, with the prefix `vu`. Keep this file and
`packages/react/src/styles/tokens.css` in sync.

## How theming works

- All styles live in `@layer video-ultra`, plus **one unlayered guard**:
  `.vu-root :where(*) { all: revert-layer }` (and `::before` / `::after` / `::placeholder`), so the
  host app's unlayered CSS (resets, Tailwind preflight) can't reach inside the editor. Hosts
  restyle via `--vu-*` variables, a two-class selector, or their own layer after `video-ultra`.
- Tokens are CSS custom properties prefixed `--vu-`, declared on `.vu-root`.
- Theme: `data-vu-theme="dark" | "light"` on `.vu-root`; `theme="auto"` omits it and follows
  `prefers-color-scheme`.
- React prop `themeOverrides` (typed `ThemeOverrides`) maps camelCase keys → CSS vars, e.g.
  `{ accent: '#ff5a1f' }` → `--vu-accent: #ff5a1f`.
- Components reference **semantic** tokens only, never hex or px.

## Brand

Plum `#4d194d` (shared with image-ultra). Exact in light theme; lightened tints on dark
(contrast-checked in image-ultra's THEMING.md). Accent-coloured text uses `--vu-accent-text`.

## Colour tokens

Chrome tokens have the same values as image-ultra: `--vu-bg`, `--vu-stage`, `--vu-surface-1/2/3`,
`--vu-border`, `--vu-border-strong`, `--vu-text`, `--vu-text-muted`, `--vu-text-subtle`,
`--vu-accent`, `--vu-accent-hover`, `--vu-accent-contrast`, `--vu-accent-soft`,
`--vu-accent-text`, `--vu-danger`, `--vu-warning`, `--vu-overlay`, `--vu-handle-fill`,
`--vu-guide`, `--vu-checker-a/b`, `--vu-shadow-popover`, `--vu-focus-ring`.

Video-specific tokens:

| Token               | Dark                     | Light              | Used for                                  |
| ------------------- | ------------------------ | ------------------ | ----------------------------------------- |
| `--vu-timeline-bg`  | `#0e0e11`                | `#ececf0`          | timeline area                             |
| `--vu-track-bg`     | `#16161a`                | `#f7f7f9`          | lane background                           |
| `--vu-clip-video`   | `#3b3b46`                | `#d9d9e3`          | video/photo clip body (behind thumbnails) |
| `--vu-clip-text`    | `#7a4a14`                | `#f3d9b5`          | text items                                |
| `--vu-clip-sticker` | `#1f5a4a`                | `#bfe6d8`          | stickers / PIP                            |
| `--vu-clip-audio`   | `#1e4466`                | `#c4daf0`          | audio clips                               |
| `--vu-waveform`     | `rgba(255,255,255,0.55)` | `rgba(0,0,0,0.45)` | waveform peaks                            |
| `--vu-playhead`     | `var(--vu-accent)`       | same               | playhead spine + timecode capsule         |
| `--vu-trim-handle`  | `#f5b54a`                | `#9a5b00`          | trim handles on the selected clip         |
| `--vu-selection`    | `var(--vu-accent)`       | same               | selected clip outline                     |
| `--vu-trim-grip`    | `rgba(0,0,0,0.55)`       | same               | grip lines on trim handles                |
| `--vu-on-media`     | `#ffffff`                | same               | labels drawn over thumbnails / footage    |
| `--vu-stage-canvas` | `#000000`                | same               | the preview frame before the first draw   |

Contrast checked on the built timeline (2026-10-17), label `--vu-text` on clip bodies — dark:
video 10.1, text 6.8, sticker 7.3, audio 9.2; light: video 12.6, text 13.0, sticker 13.1,
audio 12.4. Playhead capsule text on accent: 5.5 (dark), 13.5 (light). Ruler labels
(`--vu-text-muted` on `--vu-timeline-bg`): 7.5 / 5.7. DOM chrome: axe WCAG 2.2 AA, 0 violations
in both themes at phone and desktop sizes (`scripts/a11y-check.ts`).

## Non-colour tokens

Same scale as image-ultra: `--vu-text-xs…xl` (11–16px), `--vu-weight-*`, `--vu-space-1…8`
(4–40px), `--vu-radius-sm/md/lg/full`, `--vu-duration-fast/base/slow`, `--vu-ease`,
`--vu-size-touch` (40px), `--vu-z-overlay/popover/toast`.

Video-specific sizes: `--vu-size-topbar` 48px, `--vu-size-rail` 72px, `--vu-size-panel` 280px,
`--vu-size-inspector` 280px, `--vu-size-toolbar` 64px, `--vu-size-track` 48px (main track 56px:
`--vu-size-track-main`), `--vu-size-ruler` 24px, `--vu-size-trim-handle` 12px (touch: 20px),
`--vu-size-timeline` 248px (phone: `--vu-size-timeline-phone` 184px), `--vu-size-transport` 48px,
`--vu-size-sheet` 360px (max), `--vu-size-tool` 56px, `--vu-size-handle` 12px (touch 18px),
`--vu-size-min-height` 480px, plus control sizes (`--vu-size-choice-lg`, `-preset`,
`-preset-tile`, `-asset`, `-swatch`, `-slider-track`, `-slider-thumb`, `-toast`, `-modal`) and
`--vu-text-emoji`. Layers & organising (v0.2): `--vu-size-popover` 288px (History),
`--vu-size-menu` 232px (context menu), `--vu-size-layer-row` 48px, `--vu-size-layer-thumb` 32px;
`--vu-size-timeline-header` is 100px (room for a row's name and its lock). Sound (v0.2 B):
`--vu-size-audiolib-play` 36px, `--vu-size-audiolib-row` 52px. Picture tools (v0.2 C):
`--vu-clip-region` (dark #9aa3b8 / light #5d6b8a), `--vu-size-handle-side` 8px,
`--vu-size-region-swatch` 64px, `--vu-size-key-preset` 28px. Capture & export (v0.2 D):
`--vu-size-record`, `-record-mark`, `-record-stop`, `-record-ring`, `--vu-size-camera-dot`,
`--vu-size-range-track`, `--vu-size-range-thumb`, `--vu-camera-bg`, `--vu-record`. Captions
(v0.2 A): `--vu-size-caption-preset` 64px, `--vu-size-caption-time` 52px. Combined clips (v0.4, #155):
`--vu-size-inside-bar` 44px (the bar over the timeline while one is open). Element resets in editor.css use `:where()` (zero specificity) so component
classes always win.

## `ThemeOverrides` (public, typed)

Same keys as image-ultra (`accent`, `accentHover`, `accentContrast`, `accentText`, `bg`, `stage`,
`surface1/2/3`, `text`, `textMuted`, `border`, `fontFamily`, `radius`) plus `timelineBg`.

## Contrast and density (v0.3)

- `contrast="high"` (or `"auto"`: high when the OS asks for more contrast, `prefers-contrast:
more`) sets `data-vu-contrast` on `.vu-root`. High contrast redefines the colour tokens only:
  pure black / white surfaces, text-muted near full strength, borders at 55–60 % (strong borders
  solid), a brighter accent on dark (`#c879c8`, black text on it) and a deeper one on light
  (`#3a0f3a`), and a thicker focus ring. Works with `theme` dark, light and auto. axe: 0
  violations on every a11y-check page in both (2026-10-19).
- `density="touch"` sets `data-vu-density`: thumb-sized controls everywhere (trim handles 20 px,
  choices 36 px, touch targets 48 px, tracks 52 / 64 px, slider thumbs 24 px, layer rows 56 px),
  also with a mouse. `density="compact"` keeps mouse sizes on touch screens. `auto` (default):
  touch sizes when the primary pointer is coarse.
