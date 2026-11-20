'use client';

/**
 * The real editor inside the home page's editor window (loaded by home-parts.tsx only when the
 * window scrolls into view, so the page itself stays light).
 */
import { VideoEditor } from '@video-ultra/react';
import '@video-ultra/react/styles.css';
import { useDemoServices } from './editor/services';

/** The editor with the demo services, its theme following the page. */
export default function HomeEditor() {
  const services = useDemoServices({ speech: null, captions: false });
  return <VideoEditor theme="auto" {...services} />;
}
