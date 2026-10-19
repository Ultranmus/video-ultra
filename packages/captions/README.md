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

Languages the small models hear badly (Hindi, Bangla, Urdu…) use a larger model where the device
can run it; the panel says when a language needs a computer. MIT licensed.
