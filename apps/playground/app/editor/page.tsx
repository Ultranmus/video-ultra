'use client';

/**
 * The editor, full screen. `?theme=light|auto`, `?backend=webgl2`, `?autosave=0` for testing.
 */
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

function Editor() {
  const params = useSearchParams();
  const theme = (params.get('theme') ?? 'dark') as 'dark' | 'light' | 'auto';
  const backend = (params.get('backend') ?? 'auto') as 'auto' | 'webgpu' | 'webgl2';
  // A full-screen app page: the document itself never scrolls (iOS keyboard, rubber-banding).
  useEffect(() => {
    const html = document.documentElement;
    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = '';
      html.style.overscrollBehavior = '';
      document.body.style.overflow = '';
    };
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <VideoEditor
        theme={theme}
        backend={backend}
        autosave={params.get('autosave') !== '0'}
        onReady={(controller) => {
          (window as unknown as { vuEditor: unknown }).vuEditor = controller;
        }}
        onExport={(result) =>
          console.info('[editor] exported', result.width, result.height, result.blob.size)
        }
      />
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense>
      <Editor />
    </Suspense>
  );
}
