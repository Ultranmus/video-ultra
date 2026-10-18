import type { ReactElement } from 'react';

/**
 * The editor's icons: 24 × 24, 1.75 stroke, round caps, drawn for video-ultra. Always paired with
 * a visible label (UI_VISION §1 "Obvious") — so they're decorative to screen readers.
 */
const paths = {
  close: 'M6 6l12 12M18 6L6 18',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M8 5v14M16 5v14',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  media:
    'M3 6.5A2.5 2.5 0 015.5 4h13A2.5 2.5 0 0121 6.5v11a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5zM10 9v6l5-3z',
  text: 'M5 6V4.5h14V6M12 4.5v15M9 19.5h6',
  audio: 'M9 18V5.5l11-2V16M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z',
  sticker: 'M20 12a8 8 0 11-8-8M20 12l-8-8M20 12h-5a3 3 0 01-3-3V4M8.5 14.5a4 4 0 007 0',
  canvas:
    'M7 3.5h10a1.5 1.5 0 011.5 1.5v14a1.5 1.5 0 01-1.5 1.5H7A1.5 1.5 0 015.5 19V5A1.5 1.5 0 017 3.5z',
  filter: 'M12 3a6 6 0 016 6 6 6 0 01-12 0 6 6 0 016-6zM8 12.5a6 6 0 108 0',
  transition: 'M4 6h7v12H4zM13 6h7v12h-7zM9 12h6M13 9.5L15.5 12 13 14.5',
  split: 'M12 3v18M6 7h3v10H6M18 7h-3v10h3',
  delete: 'M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5h10L18 7M9 7V4.5h6V7',
  duplicate: 'M8 8h11v11H8zM5 16V5h11',
  cut: 'M6 18a2.5 2.5 0 100-.1M6 6a2.5 2.5 0 100 .1M8 7.5L20 18M8 16.5L20 6',
  paste: 'M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2M9 12h6M9 16h4',
  speed: 'M12 20a8 8 0 118-8M12 12l4.5-4.5M20 12h-2',
  volume: 'M4 9.5h3.5L12 5v14l-4.5-4.5H4zM16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11',
  muted: 'M4 9.5h3.5L12 5v14l-4.5-4.5H4zM16 9.5l5 5M21 9.5l-5 5',
  fade: 'M3 19L10 8h4l7 11M3 19h18',
  extract: 'M9 18V6l10-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM19 16a3 3 0 11-6 0 3 3 0 016 0zM12 21h9',
  freeze: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5',
  crop: 'M6 2.5V18h15.5M2.5 6H18v15.5',
  rotate: 'M20 12a8 8 0 11-2.3-5.6M20 4v5h-5',
  flip: 'M12 3v18M8 7L3 17h5zM16 7l5 10h-5z',
  flipV: 'M3 12h18M7 8L17 3v5zM7 16l10 5v-5z',
  image: 'M4 5.5h16v13H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01',
  search: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  sparkle:
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-.8.5-1.5 1-1.5 2M12 17h.01',
  preview:
    'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  adjust: 'M5 4v16M12 4v16M19 4v16M3 9h4M10 15h4M17 7h4',
  fit: 'M4 6h16v12H4zM9 9.5h6v5H9z',
  opacity: 'M12 3.5s6.5 7 6.5 11a6.5 6.5 0 01-13 0c0-4 6.5-11 6.5-11zM5.5 14.5h13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  style: 'M4 20L10 4h4l6 16M7 14h10',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  zoomIn: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8M8 10.5h5M10.5 8v5',
  zoomOut: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8M8 10.5h5',
  mic: 'M12 3.5a3 3 0 013 3V12a3 3 0 01-6 0V6.5a3 3 0 013-3zM6 11.5a6 6 0 0012 0M12 17.5V21',
  stop: 'M6.5 6.5h11v11h-11z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  warning: 'M12 4l9 16H3zM12 10v4.5M12 17.5h.01',
  share: 'M12 3.5v11M7.5 8L12 3.5 16.5 8M5.5 12v8h13v-8',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  chevronDown: 'M6 9.5l6 6 6-6',
  back: 'M15 5l-7 7 7 7',
  alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  // Layers & organising (v0.2)
  lock: 'M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 017 0v3M12 14.5v2',
  unlock: 'M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 016.8-1.2M12 14.5v2',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  eyeOff:
    'M4 4l16 16M10 6c.6-.3 1.3-.5 2-.5 6 0 9.5 6.5 9.5 6.5a17 17 0 01-2.6 3.4M14.5 17.9c-.8.4-1.6.6-2.5.6-6 0-9.5-6.5-9.5-6.5a17 17 0 013.2-3.9M10.2 10.2a2.5 2.5 0 003.6 3.6',
  layers: 'M12 3.5l9 4.5-9 4.5L3 8zM3 12l9 4.5 9-4.5M3 16l9 4.5 9-4.5',
  history: 'M3.5 12a8.5 8.5 0 102.5-6M3.5 4v4h4M12 7.5V12l3 2',
  group: 'M4 4h4M16 4h4M4 20h4M16 20h4M4 4v4M20 4v4M4 16v4M20 16v4M8 8h5v5H8zM11 11h5v5h-5z',
  ungroup: 'M4 4h7v7H4zM13 13h7v7h-7zM15 4h5v5M4 15v5h5',
  forward: 'M8 9h11v11H8zM5 15V4h11',
  backward: 'M5 4h11v11H5zM8 19.5h11v-11',
  toFront: 'M8 8h8v8H8zM4 4h3M4 4v3M20 4h-3M20 4v3M4 20h3M4 20v-3M20 20h-3M20 20v-3',
  toBack: 'M4 4h16v16H4zM9 9h6v6H9',
  alignToLeft: 'M4 3v18M8 7h12v4H8zM8 14h7v4H8z',
  alignToCenter: 'M12 3v18M6 7h12v4H6zM8.5 14h7v4h-7z',
  alignToRight: 'M20 3v18M4 7h12v4H4zM9 14h7v4H9z',
  alignToTop: 'M3 4h18M7 8v12h4V8zM14 8v7h4V8z',
  alignToMiddle: 'M3 12h18M7 6v12h4V6zM14 8.5v7h4v-7z',
  alignToBottom: 'M3 20h18M7 4v12h4V4zM14 9v7h4V9z',
  distributeH: 'M4 3v18M20 3v18M9.5 7h5v10h-5z',
  distributeV: 'M3 4h18M3 20h18M7 9.5h10v5H7z',
  select: 'M5 4l13 6.5-5.5 1.5L10.5 18z',
  grip: 'M9 6.5v.01M15 6.5v.01M9 12v.01M15 12v.01M9 17.5v.01M15 17.5v.01',
  // v0.2 B. Sound: a speaker that dips (ducking)
  duck: 'M3.5 9.5H7L11 5.5v13l-4-4H3.5zM18 5v10M14.5 11.5L18 15l3.5-3.5',
  // v0.2 D. Capture & export
  camera:
    'M3 8.5A2.5 2.5 0 015.5 6h1.8l1.5-2h6.4l1.5 2h1.8A2.5 2.5 0 0121 8.5v9a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  switchCamera:
    'M4.5 12a7.5 7.5 0 0113-5.1M19.5 4v4.5H15M19.5 12a7.5 7.5 0 01-13 5.1M4.5 20v-4.5H9',
  micOff:
    'M15 10.5V6.5a3 3 0 00-5.6-1.5M9 9v3a3 3 0 004.6 2.5M6 11.5a6 6 0 009.5 4.9M18 11.5a6 6 0 01-.6 2.6M12 17.5V21M4 4l16 16',
  range: 'M6 5v14M18 5v14M6 12h12M3 5h6M3 19h6M15 5h6M15 19h6',
  // Picture tools (v0.2 C)
  blurArea:
    'M4 6h3M10.5 6h3M17 6h3M4 18h3M10.5 18h3M17 18h3M4 6v3M4 15v3M20 6v3M20 15v3M9 12h.01M12 9.5h.01M12 14.5h.01M15 12h.01',
  pixelate: 'M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16',
  greenScreen: 'M3 5h18v14H3zM12 8.5a2 2 0 110 4 2 2 0 010-4zM8 19c.5-2.5 2-4 4-4s3.5 1.5 4 4',
  eyedropper: 'M13 6l5 5M16.5 3.5a2.1 2.1 0 013 3L17 9l-2-2zM15 8l-8.5 8.5L4 20l3.5-2.5L16 9',
  blend: 'M9 15a6 6 0 100-12 6 6 0 000 12zM15 21a6 6 0 100-12 6 6 0 000 12z',
  template: 'M4 4h16v16H4zM4 9h16M9 9v11',
  cutout:
    'M12 4a3 3 0 110 6 3 3 0 010-6zM6 20c0-4 2.7-7 6-7s6 3 6 7M3 3l2 2M21 3l-2 2M3 21l2-2M21 21l-2-2',
  shape: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z',
  lut: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  rectangle: 'M4 6h16v12H4z',
  oval: 'M12 18c4.4 0 8-2.7 8-6s-3.6-6-8-6-8 2.7-8 6 3.6 6 8 6z',
  // v0.2 A. Captions
  captions:
    'M3.5 6.5A2 2 0 015.5 4.5h13a2 2 0 012 2v11a2 2 0 01-2 2h-13a2 2 0 01-2-2zM7 14h4M13 14h4M7 11h10',
  merge: 'M5 5v4a3 3 0 003 3h8a3 3 0 003-3V5M12 12v7M9 16l3 3 3-3',
} as const;

/** Name of an editor icon. */
export type IconName = keyof typeof paths;

/** An editor icon by name, or a host's own (`{ path }`: one SVG path on a 24 × 24 grid). */
export type IconSpec = IconName | { path: string };

/** An editor icon. Decorative: pair it with a visible label. */
export function Icon({ name, size = 20 }: { name: IconSpec; size?: number }): ReactElement {
  return (
    <svg
      className="vu-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={typeof name === 'string' ? paths[name] : name.path} />
    </svg>
  );
}
