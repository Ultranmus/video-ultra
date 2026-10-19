# @video-ultra/react

A fast, fully typed video editor component for React and Next.js. Runs in the browser on phones
and desktops; the user's media never leaves the device.

```sh
npm install @video-ultra/react
```

```tsx
'use client';
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';

export default function Editor() {
  return (
    <div style={{ height: '100dvh' }}>
      <VideoEditor
        onSave={(project) => localStorage.setItem('video', JSON.stringify(project))}
        onExport={({ blob }) => download(blob)}
      />
    </div>
  );
}
```

The editor fills its container and picks a phone, tablet or desktop layout from its own width.
Optional extras: `transcriber` (auto captions, `@video-ultra/captions`), `backgroundRemover`
(`@video-ultra/ai`), `audioLibrary`, `assistant`, `speech`, `customize` (hide / add tools),
`theme`, `labels` (translation). Every option is documented in its type.

Vite: set `worker: { format: 'es' }` in `vite.config.ts`.

Docs, guides and the API reference: see the repository. MIT licensed.
