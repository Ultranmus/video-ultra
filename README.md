# video-ultra

A free (MIT), fast, fully typed video editor for React and Next.js. Works on phones and desktops.

> **Status:** in development (Phase 0 — engine proof). Not published yet.

## Packages

| Package | What it is |
| --- | --- |
| `@video-ultra/core` | Framework-agnostic engine: decoding, compositing (WebGPU + WebGL2), export |
| `@video-ultra/react` | `<VideoEditor />` component and headless hooks (coming in Phase 3) |

## Development

```sh
pnpm install
pnpm media        # build the test media library (needs ffmpeg)
pnpm build
pnpm --filter playground dev   # http://localhost:3200/bench
node scripts/bench.ts --browsers chrome,webkit,firefox   # run the bench headless
```

## License

MIT
