# video-ultra

A free (MIT), fast, fully typed **video editor for React and Next.js** — simple enough for anyone,
deep enough for pros. It runs entirely in the browser (WebCodecs + WebGPU / WebGL2), on phones and
desktops, and never uploads the user's media.

```tsx
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';

export default function Page() {
  return (
    <div style={{ height: '100dvh' }}>
      <VideoEditor onSave={(project) => saveSomewhere(project)} />
    </div>
  );
}
```

**Docs:** the docs site (`/docs` in the demo app) — getting started, guides for Next.js and Vite,
every option, events, theming, customising the editor, captions and AI, and the generated API
reference.

## What it does

- **Simple first:** add videos and photos, trim, split, speed, filters, transitions, text,
  stickers, music, voiceover, export to MP4 / WebM — on a phone or a desktop, one layout each.
- **Canva-style extras:** templates, text and element animations, layers, groups, align, blend
  modes, green screen, LUTs, blur areas, shape masks, animated stickers, background removal.
- **Pro tools, out of the way:** keyframes with a graph editor, roll / slip / slide trims,
  markers, scopes, sound effects (EQ, even out, pitch, clean up noise), edit several clips at
  once, combine clips into one, HEVC / AV1 export, proxies for heavy 4K files.
- **Captions:** on-device speech to text (optional `@video-ultra/captions`), styles with word
  highlight, `.srt` / `.vtt` import and export.
- **Built to stay smooth:** heavy work runs in workers, React never renders per frame, memory
  stays flat (media is read in ranges, frames are closed as soon as they're drawn), quality drops
  before smoothness does. No `SharedArrayBuffer` / COOP-COEP needed.
- **Yours to shape:** hide or reorder tools, add your own panels, buttons and media sources,
  theme tokens, every label translatable, keyboard and screen-reader accessible (WCAG 2.2 AA).

## Packages

| Package                 | What it is                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `@video-ultra/react`    | `<VideoEditor />`, its controller and hooks                                                       |
| `@video-ultra/core`     | The engine and project model — framework-free, SSR-safe                                           |
| `@video-ultra/captions` | Optional: on-device auto captions (speech to text in a worker)                                    |
| `@video-ultra/ai`       | Optional: background removal on the device; AI editing and text to speech through your own server |

```sh
npm install @video-ultra/react
# optional
npm install @video-ultra/captions @video-ultra/ai
```

## Browsers

Current Chrome / Edge, Safari (iOS and macOS) and Firefox — anywhere WebCodecs is available;
tested on Chrome 155, Safari 26 (iPhone and Mac) and Firefox 157. A browser that can't run it gets
a clear message (and `onUnsupported`). WebGPU is used when present, WebGL2 otherwise (same
picture on both). The editor needs a secure page (https or localhost) for WebCodecs, storage and
sound.

## Projects and saving

A project is plain JSON (validated and versioned; old files always open). The editor autosaves to
the browser (OPFS) for crash recovery; `onSave` hands you the project to store wherever you like.
Media stays on the device unless you store it yourself (`resolveMedia`).

## Development

```sh
pnpm install
pnpm media                      # the test media library (needs ffmpeg)
pnpm build
pnpm --filter playground dev    # http://localhost:3200/editor and /docs
pnpm verify                     # shaders, lint, format, build, types, unit tests
node scripts/pack-check.ts      # the packages as npm will see them
```

Browser checks live in `scripts/*-check.ts` (Playwright; the playground must be running).

## License

MIT © Ultranmus
