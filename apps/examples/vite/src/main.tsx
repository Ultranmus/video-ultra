// The editor in a Vite app: saves to this browser's localStorage, downloads exports.
import { VideoEditor, type Project } from '@video-ultra/react';
import '@video-ultra/react/styles.css';
import { createRoot } from 'react-dom/client';

const saved = localStorage.getItem('example-video');

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

createRoot(document.getElementById('root')!).render(
  <VideoEditor
    initialProject={saved ?? undefined}
    onSave={(project: Project) => localStorage.setItem('example-video', JSON.stringify(project))}
    onExport={({ blob, extension }) => download(blob, `video.${extension}`)}
    theme="auto"
  />,
);
