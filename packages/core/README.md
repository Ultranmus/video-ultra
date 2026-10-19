# @video-ultra/core

The engine behind `@video-ultra/react`: the project model (JSON, validated and versioned, with
migrations), edit operations with undo, decoding (WebCodecs), compositing (WebGPU with a WebGL2
fallback at full parity), sound mixing, export (MP4 / WebM, sound only, still frames) and local
storage. Framework-free and SSR-safe (no browser API is touched at import).

```sh
npm install @video-ultra/core
```

Most apps use `@video-ultra/react`; use this package directly to build your own editor UI, to
work with projects on the server (`parseProject`, `createProject`, the edit operations), or to
export headlessly in the browser. Everything public is exported from the package root and
documented in its types. MIT licensed.
