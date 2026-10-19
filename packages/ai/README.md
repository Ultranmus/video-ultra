# @video-ultra/ai

Optional AI features for `@video-ultra/react`:

- `createBackgroundRemover()` — removes photo and sticker backgrounds on the device (nothing
  uploaded; the model downloads on first use).
- `createChatAssistant({ endpoint })` — AI editing through your own server (OpenAI-compatible
  chat endpoint): people type what they want, the answer is applied as one undo step.
- `createSpeechEndpoint({ endpoint })` — text to speech through your own server.

```sh
npm install @video-ultra/ai
```

```tsx
import { createBackgroundRemover } from '@video-ultra/ai';

<VideoEditor backgroundRemover={createBackgroundRemover()} />;
```

MIT licensed.
