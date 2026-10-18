'use client';

/**
 * The editor, full screen. `?theme=light|auto`, `?backend=webgl2`, `?autosave=0` for testing.
 * `?device=phone|phone-small|tablet|tablet-portrait` shows it at that device's size (the editor
 * picks its layout from its own width), so phone and tablet layouts can be checked on a desktop
 * without deploying. A strip at the top switches devices; it hides itself on real phones.
 */
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

const DEVICES = {
  full: { label: 'Full window', width: 0, height: 0 },
  phone: { label: 'iPhone 15 · 393×852', width: 393, height: 852 },
  'phone-small': { label: 'Budget Android · 360×740', width: 360, height: 740 },
  tablet: { label: 'Tablet · 1180×820', width: 1180, height: 820 },
  'tablet-portrait': { label: 'Tablet portrait · 820×1180', width: 820, height: 1180 },
} as const;
type Device = keyof typeof DEVICES;

function Editor() {
  const params = useSearchParams();
  const router = useRouter();
  const theme = (params.get('theme') ?? 'dark') as 'dark' | 'light' | 'auto';
  const backend = (params.get('backend') ?? 'auto') as 'auto' | 'webgpu' | 'webgl2';
  const requested = params.get('device') as Device | null;
  const device: Device = requested && requested in DEVICES ? requested : 'full';
  // The switcher only makes sense on a big screen (on a phone the editor already is the phone).
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const check = () => setWide(window.innerWidth >= 900);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
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

  const pick = (next: Device) => {
    const q = new URLSearchParams(params.toString());
    if (next === 'full') q.delete('device');
    else q.set('device', next);
    router.replace(`/editor${q.size ? `?${q}` : ''}`);
  };
  const size = DEVICES[device];
  const framed = wide && device !== 'full';
  // A device taller than the window scrolls here, at true size: scaling it would change how
  // the editor measures pointers and its canvas timeline.

  const editor = (
    <VideoEditor
      // A new device size starts a fresh editor (the project comes back from autosave).
      key={device}
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
  );

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      {wide ? (
        <div className="pg-devices" role="toolbar" aria-label="Preview size">
          {(Object.keys(DEVICES) as Device[]).map((d) => (
            <button key={d} type="button" aria-pressed={d === device} onClick={() => pick(d)}>
              {DEVICES[d].label}
            </button>
          ))}
        </div>
      ) : null}
      {framed ? (
        <div className="pg-stage">
          <div className="pg-frame" style={{ width: size.width, height: size.height }}>
            {editor}
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>{editor}</div>
      )}
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
