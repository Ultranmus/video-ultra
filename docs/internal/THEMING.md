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
| `--vu-playhead`     | `#ffffff`                | `#18181b`          | playhead line + head                      |
| `--vu-trim-handle`  | `#f5b54a`                | `#9a5b00`          | trim handles on the selected clip         |
| `--vu-selection`    | `var(--vu-accent)`       | same               | selected clip outline                     |

Clip colours were picked for label contrast ≥ 4.5:1 with `--vu-text`; verify again when the
timeline is built (Day 4) and record the checked ratios here.

## Non-colour tokens

Same scale as image-ultra: `--vu-text-xs…xl` (11–16px), `--vu-weight-*`, `--vu-space-1…8`
(4–40px), `--vu-radius-sm/md/lg/full`, `--vu-duration-fast/base/slow`, `--vu-ease`,
`--vu-size-touch` (40px), `--vu-z-overlay/popover/toast`.

Video-specific sizes: `--vu-size-topbar` 48px, `--vu-size-rail` 72px, `--vu-size-panel` 280px,
`--vu-size-inspector` 280px, `--vu-size-toolbar` 64px, `--vu-size-track` 48px (main track 56px:
`--vu-size-track-main`), `--vu-size-ruler` 24px, `--vu-size-trim-handle` 12px (touch: 20px).

## `ThemeOverrides` (public, typed)

Same keys as image-ultra (`accent`, `accentHover`, `accentContrast`, `accentText`, `bg`, `stage`,
`surface1/2/3`, `text`, `textMuted`, `border`, `fontFamily`, `radius`) plus `timelineBg`.
