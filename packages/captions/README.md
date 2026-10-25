# @video-ultra/captions

Auto captions for `@video-ultra/react`, on the device: speech to timed words in a worker (WebGPU
or WebAssembly), nothing uploaded. Models download on first use and are cached.

```sh
npm install @video-ultra/captions
```

```tsx
import { createOnDeviceTranscriber } from '@video-ultra/captions';

const transcriber = createOnDeviceTranscriber();
<VideoEditor transcriber={transcriber} />;
```

**English only.** For other languages, or to use your own speech service instead of the on-device
model, don't install this package: pass your own `transcriber` to `<VideoEditor>` (see the
docs, "Your own captions service"). MIT licensed.
