'use client';

/**
 * The plain editor, full screen: nothing around it (options live in `/playground`).
 * URL switches for checks, invisible to visitors: `?theme=light|auto`, `?backend=webgl2`,
 * `?autosave=0`, `?sounds=0`, `?contrast=high|auto`, `?density=touch|compact`,
 * `?proxies=always|off`, `?assistant=0`, `?speech=0|1`, `?cutout=0|people|objects`,
 * `?transcriber=device|server|fake|0` and `?embed=1` (the embedding API, embed-demo.tsx).
 */
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { embedDemo, logEvent } from './embed-demo';
import {
  lockPageScroll,
  useDemoServices,
  type ServerSetup,
  type ServiceSwitches,
} from './services';

function flag(value: string | null): boolean | undefined {
  return value === '0' ? false : undefined;
}

function Editor({ server }: { server: ServerSetup }) {
  const params = useSearchParams();
  const transcriber = params.get('transcriber');
  const cutout = params.get('cutout');
  const speech = params.get('speech');
  const switches: ServiceSwitches = {
    sounds: flag(params.get('sounds')),
    captions:
      transcriber === 'device' || transcriber === 'server' || transcriber === 'fake'
        ? transcriber
        : flag(transcriber),
    cutout: cutout === 'people' || cutout === 'objects' ? cutout : flag(cutout),
    assistant: flag(params.get('assistant')),
    speech: speech === '1' ? 'force' : flag(speech),
  };
  const services = useDemoServices(server, switches);
  useEffect(lockPageScroll, []);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <VideoEditor
        theme={(params.get('theme') ?? 'dark') as 'dark' | 'light' | 'auto'}
        contrast={(params.get('contrast') ?? 'normal') as 'normal' | 'high' | 'auto'}
        density={(params.get('density') ?? 'auto') as 'auto' | 'touch' | 'compact'}
        backend={(params.get('backend') ?? 'auto') as 'auto' | 'webgpu' | 'webgl2'}
        autosave={params.get('autosave') !== '0'}
        proxies={(params.get('proxies') ?? 'auto') as 'auto' | 'always' | 'off'}
        {...services}
        {...(params.get('embed') === '1' ? { customize: embedDemo, onEvent: logEvent } : {})}
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

/** The editor page's client side. */
export function EditorClient(server: ServerSetup) {
  return (
    <Suspense>
      <Editor server={server} />
    </Suspense>
  );
}
