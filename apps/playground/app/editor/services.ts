'use client';

/**
 * The demo services the editor pages hand to the editor: the music & sounds library, auto
 * captions, background removal, the AI Assistant and text to speech. Shared by `/editor` (the
 * plain editor) and `/playground` (the editor with options), so both behave the same.
 */
import type { SpeechVoice } from '@video-ultra/core';
import type { VideoEditorProps } from '@video-ultra/react';
import { createBackgroundRemover, createCaptionsEndpoint } from '@video-ultra/ai';
import { createOnDeviceTranscriber } from '@video-ultra/captions';
import { useState } from 'react';
import { createPlaygroundAssistant } from './demo-assistant';
import { createDemoSounds } from './demo-sounds';
import { createPlaygroundSpeech } from './demo-speech';
import { createFakeTranscriber } from './fake-transcriber';

/**
 * The server's voice service: null = none; `voices` = its voices (unset: the editor's own);
 * `appliesSpeed`: it changes its own pace (else the editor plays the clip at the speed).
 */
export type SpeechSetup = { voices?: SpeechVoice[]; appliesSpeed: boolean } | null;

/** What the server knows: whether it has a voice service and a captions service. */
export interface ServerSetup {
  speech: SpeechSetup;
  captions: boolean;
}

/** Which services to turn on (all on unless set to false). */
export interface ServiceSwitches {
  sounds?: boolean | undefined;
  captions?: boolean | 'device' | 'server' | 'fake' | undefined;
  cutout?: boolean | 'people' | 'objects' | undefined;
  assistant?: boolean | undefined;
  /** `'force'`: offer it even without a server voice service (checks that mock it). */
  speech?: boolean | 'force' | undefined;
}

type ServiceProps = Pick<
  VideoEditorProps,
  'audioLibrary' | 'transcriber' | 'backgroundRemover' | 'assistant' | 'speech'
>;

/**
 * The services as editor props. Each is made once per page (they hold workers and caches);
 * the switches only choose which are passed.
 */
export function useDemoServices(server: ServerSetup, on: ServiceSwitches = {}): ServiceProps {
  const [sounds] = useState(createDemoSounds);
  // Auto captions: the server's service when it has one, else on this device.
  const [transcriber] = useState(() => {
    const pick = on.captions;
    if (pick === 'fake') return createFakeTranscriber();
    if (pick === 'server' || (server.captions && pick !== 'device'))
      return createCaptionsEndpoint({ endpoint: '/api/captions' });
    return createOnDeviceTranscriber();
  });
  const [backgroundRemover] = useState(() =>
    createBackgroundRemover(
      on.cutout === 'people' || on.cutout === 'objects' ? { model: on.cutout } : {},
    ),
  );
  // AI editing: the server's model, or an offline demo.
  const [assistant] = useState(createPlaygroundAssistant);
  const [speech] = useState(() =>
    createPlaygroundSpeech(server.speech?.voices, server.speech?.appliesSpeed ?? false),
  );
  const speechOn = on.speech === 'force' || (server.speech !== null && on.speech !== false);
  return {
    ...(on.sounds !== false ? { audioLibrary: sounds } : {}),
    ...(on.captions !== false ? { transcriber } : {}),
    ...(on.cutout !== false ? { backgroundRemover } : {}),
    ...(on.assistant !== false ? { assistant } : {}),
    ...(speechOn ? { speech } : {}),
  };
}

/** A full-screen app page: the document itself never scrolls (iOS keyboard, rubber-banding). */
export function lockPageScroll(): () => void {
  const html = document.documentElement;
  html.style.overflow = 'hidden';
  html.style.overscrollBehavior = 'none';
  document.body.style.overflow = 'hidden';
  return () => {
    html.style.overflow = '';
    html.style.overscrollBehavior = '';
    document.body.style.overflow = '';
  };
}
