# video-ultra — instructions for Claude

A free (MIT), fully typed video editor package for React / Next.js. Sibling of image-ultra
(`../image-editor`): same owner, same org (Ultranmus), same brand and theming system.

Experience: **InShot simplicity first, Canva's video features second, pro (multi-track NLE) tools
third**, all behind progressive disclosure. Top goals, in order: **fast, lowest memory, never
hangs, works on every device (incl. budget phones), easy for anyone.**

We build everything from scratch. Never copy code, assets or icons from any other editor, and
never mention other editors' names in the repo (docs, comments, commits).

## Read these before any work (source of truth)

0. `docs/internal/HANDOFF.md` — **where the last session stopped and what's next. Start here; update it before ending a session.**
1. `docs/internal/PLAN.md` — releases, phases, day plan, task checklist
2. `docs/internal/DECISIONS.md` — why things are the way they are. Don't re-litigate without a new reason.
3. `docs/internal/PERF.md` — performance targets, rules and measurements. **Every change must respect them.**
4. `docs/internal/UI_VISION.md` — layout, interaction and visual rules. **Never invent UI outside this.**
5. `docs/internal/THEMING.md` — every design token. Components use tokens only.
6. `docs/internal/PROGRESS.md` — log of what was done. **Append an entry after every work session.**
7. `docs/internal/BACKLOG.md` — known gaps. **Add new ones when found; tick them when fixed.**

## Hard rules — performance (the product's main promise)

- **The main thread never does heavy work.** Decoding, compositing, audio mixing, thumbnails,
  waveforms and export run in workers / AudioWorklet. No main-thread task over 50 ms.
- **React never renders per frame.** Playhead, timecode and meters update via refs/subscriptions.
  The timeline is drawn on a canvas. Components select only the state they show.
- **Every `VideoFrame` / `AudioData` is closed exactly once**, by its single owner. The frame-leak
  counter must read 0 in tests.
- **Memory stays flat.** Never load a whole media file into memory; read ranges. Caches have byte
  budgets per device tier. GPU textures and buffers come from pools.
- **No allocation in hot loops** (render loop, audio worklet). Reuse typed arrays and objects.
- **Drags never write to the store per pointer move.** Keep transient drag state local; commit one
  operation on pointer-up.
- **Backpressure everywhere** (decoder/encoder queue sizes), **everything cancellable**
  (`AbortSignal`), and a watchdog resets stalled decoders.
- **Degrade quality, never smoothness:** lower preview resolution before dropping frames; drop
  video frames before glitching audio.
- **Never require `SharedArrayBuffer` / cross-origin isolation** (host apps can't set COOP/COEP).
- Perf budgets are checked by the bench; a regression is a bug.

## Hard rules — code

- TypeScript strict everywhere. No `.js` source files, no `any` in public API.
- `@video-ultra/core` must never import React or touch `window`/`document` at module top level
  (SSR safe). Browser APIs only inside functions.
- Core's public, semver-covered API is `packages/core/src/index.ts` only. Everything else goes in
  `src/internal.ts` (`@video-ultra/core/internal`), which React imports from.
- Every public export needs a doc comment.
- Rendering: TypeScript compositor, **WebGPU first, WebGL2 at full feature parity**. Shaders are
  written once in WGSL; GLSL is generated at build time. Any visual feature must work and look the
  same on both backends (golden-frame tests on both).
- Rust → WASM only for small, lazy-loaded CPU-heavy modules (audio DSP, analysis), and only after
  a measurement shows TS is too slow.
- Every edit is non-destructive: an operation on the `Project` (serializable JSON), never on media.
- Project JSON is validated (Zod) and versioned with migrations. Old projects must always open.

## Hard rules — UI & styling

- No CSS-in-JS runtime, no Tailwind, no UI kit styling. Plain CSS + `--vu-*` variables in
  `@layer video-ultra`, plus the one unlayered `all: revert-layer` guard.
- CSS class prefix: `vu-`. CSS var prefix: `--vu-`. No raw hex/px values in component CSS — tokens only.
- Breakpoints use container queries on `.vu-root`, not the viewport.
- Accessible (WCAG 2.2 AA): keyboard, screen reader (the canvas timeline has an accessible DOM
  layer), reduced motion. Every label is translatable.

## Process

- Package manager: pnpm. Stop at each checkpoint in PLAN.md and show the owner the result.
- When a decision changes, update `DECISIONS.md` (and the affected doc) in the same change.
- Test on real media (`pnpm media` builds the test library) — never only on one sample file.
- The owner tests on an iPhone daily and on Android every 3–4 days; the playground must stay
  reachable from a phone on the same Wi-Fi.
