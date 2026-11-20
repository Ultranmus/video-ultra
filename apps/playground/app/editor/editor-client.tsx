'use client';

/**
 * The editor, full screen. `?theme=light|auto`, `?backend=webgl2`, `?autosave=0` for testing,
 * `?sounds=0` without the demo music & sounds library. `?contrast=high|auto` for high contrast,
 * `?density=touch|compact` for control sizes. `?embed=1` shows the embedding API (embed-demo.tsx).
 * `?proxies=always|off` for the lighter editing copies (default auto). `?assistant=0` hides the
 * AI Assistant (it uses `/api/assistant` when the server has a key, else an offline demo);
 * Text to speech shows only when the server has a voice service (`/api/speech` has a key);
 * `?speech=0` hides it, `?speech=1` shows it anyway (checks that mock the service).
 * Captions use the server's captions service (`/api/captions`, any language) when it has one
 * (a speech-to-text key, or a Google key), else English on the device; `?transcriber=device` forces the device,
 * `=server` the service (checks that mock it), `=fake` a stand-in, `=0` none.
 * `?device=phone|phone-small|tablet|tablet-portrait` shows it at that device's size (the editor
 * picks its layout from its own width), so phone and tablet layouts can be checked on a desktop
 * without deploying. A strip at the top switches devices; it hides itself on real phones.
 */
import type { SpeechVoice } from '@video-ultra/core';
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { createBackgroundRemover, createCaptionsEndpoint } from '@video-ultra/ai';
import { createPlaygroundAssistant } from './demo-assistant';
import { createPlaygroundSpeech } from './demo-speech';
import { createOnDeviceTranscriber } from '@video-ultra/captions';
import { createDemoSounds } from './demo-sounds';
import { createFakeTranscriber } from './fake-transcriber';
import { embedDemo, logEvent } from './embed-demo';

const DEVICES = {
  full: { label: 'Full window', width: 0, height: 0 },
  phone: { label: 'iPhone 15 · 393×852', width: 393, height: 852 },
  'phone-small': { label: 'Budget Android · 360×740', width: 360, height: 740 },
  tablet: { label: 'Tablet · 1180×820', width: 1180, height: 820 },
  'tablet-portrait': { label: 'Tablet portrait · 820×1180', width: 820, height: 1180 },
} as const;
type Device = keyof typeof DEVICES;

function Editor({ speechSetup, captions }: { speechSetup: SpeechSetup; captions: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const theme = (params.get('theme') ?? 'dark') as 'dark' | 'light' | 'auto';
  const backend = (params.get('backend') ?? 'auto') as 'auto' | 'webgpu' | 'webgl2';
  const contrast = (params.get('contrast') ?? 'normal') as 'normal' | 'high' | 'auto';
  const density = (params.get('density') ?? 'auto') as 'auto' | 'touch' | 'compact';
  const requested = params.get('device') as Device | null;
  const device: Device = requested && requested in DEVICES ? requested : 'full';
  // The switcher only makes sense on a big screen (on a phone the editor already is the phone).
  const [sounds] = useState(createDemoSounds);
  // Auto captions: the server's service, else on this device (see the top comment).
  const [transcriber] = useState(() => {
    const pick = params.get('transcriber');
    if (pick === 'fake') return createFakeTranscriber();
    if (pick === 'server' || (captions && pick !== 'device'))
      return createCaptionsEndpoint({ endpoint: '/api/captions' });
    return createOnDeviceTranscriber();
  });
  // Background removal on this device (`?cutout=0`: none; `=people` / `=objects`: that model).
  const [backgroundRemover] = useState(() => {
    const model = params.get('cutout');
    return createBackgroundRemover(model === 'people' || model === 'objects' ? { model } : {});
  });
  // AI editing: the server's model, or an offline demo (`?assistant=0`: none).
  const [assistant] = useState(createPlaygroundAssistant);
  // Text to speech: the server's voice service, only when it has one (see the top comment).
  const [speech] = useState(() =>
    createPlaygroundSpeech(speechSetup?.voices, speechSetup?.appliesSpeed ?? false),
  );
  const [wide, setWide] = useState(false);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const check = () => {
      setWide(window.innerWidth >= 900);
      // Height left for a frame: the window minus the strip and the stage padding.
      setRoom(window.innerHeight - 37 - 32);
    };
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
  // A device taller than the window keeps its width (that is what picks the editor's layout) and
  // gets shorter, so the whole editor — bottom tab bar included — is always on screen. (Scaling
  // the frame instead would change how the editor measures pointers and its canvas timeline.)
  const height = room > 0 ? Math.min(size.height, room) : size.height;
  const trimmed = framed && height < size.height;

  const editor = (
    <VideoEditor
      // A new device size starts a fresh editor (the project comes back from autosave).
      key={device}
      theme={theme}
      contrast={contrast}
      density={density}
      backend={backend}
      autosave={params.get('autosave') !== '0'}
      proxies={(params.get('proxies') ?? 'auto') as 'auto' | 'always' | 'off'}
      {...(params.get('sounds') !== '0' ? { audioLibrary: sounds } : {})}
      {...(params.get('transcriber') !== '0' ? { transcriber } : {})}
      {...(params.get('cutout') !== '0' ? { backgroundRemover } : {})}
      {...(params.get('assistant') !== '0' ? { assistant } : {})}
      {...((speechSetup !== null && params.get('speech') !== '0') || params.get('speech') === '1'
        ? { speech }
        : {})}
      {...(params.get('embed') === '1' ? { customize: embedDemo, onEvent: logEvent } : {})}
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
          {trimmed ? (
            <span className="pg-devices-note">Shortened to {height}px to fit this window</span>
          ) : null}
        </div>
      ) : null}
      {framed ? (
        <div className="pg-stage">
          <div className="pg-frame" style={{ width: size.width, height }}>
            {editor}
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>{editor}</div>
      )}
    </div>
  );
}

/**
 * The server's voice service: null = none; `voices` = its voices (unset: the editor's own);
 * `appliesSpeed`: it changes its own pace (else the editor plays the clip at the speed).
 */
type SpeechSetup = { voices?: SpeechVoice[]; appliesSpeed: boolean } | null;

/** The editor page's client side. */
export function EditorClient({ speech, captions }: { speech: SpeechSetup; captions: boolean }) {
  return (
    <Suspense>
      <Editor speechSetup={speech} captions={captions} />
    </Suspense>
  );
}
