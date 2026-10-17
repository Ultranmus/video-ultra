/**
 * video-ultra's own shape stickers: bold, simple artwork on a 64 × 64 grid with a light outline so
 * it reads on any video. Drawn for this project. Rasterised to a PNG when placed.
 */
export interface ShapeSticker {
  id: string;
  label: string;
  /** Inner SVG for `viewBox="0 0 64 64"`. */
  svg: string;
}

const O = 'stroke="#fff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
const T = (text: string, size = 13, y = 37, fill = '#fff') =>
  `<text x="32" y="${y}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-weight="800" font-size="${size}" fill="${fill}">${text}</text>`;

export const SHAPE_STICKERS: readonly ShapeSticker[] = [
  {
    id: 'burst-yellow',
    label: 'Burst',
    svg: `<path ${O} fill="#ffcc00" d="M32 3l5.5 10.5L49 8l-1.5 12L60 23l-9 8.5 9 8.5-12.5 3L49 55l-11.5-5.5L32 61l-5.5-11.5L15 55l1.5-12L4 40l9-8.5L4 23l12.5-3L15 8l11.5 5.5z"/>`,
  },
  {
    id: 'burst-wow',
    label: 'Wow burst',
    svg: `<path ${O} fill="#ff3d71" d="M32 3l5.5 10.5L49 8l-1.5 12L60 23l-9 8.5 9 8.5-12.5 3L49 55l-11.5-5.5L32 61l-5.5-11.5L15 55l1.5-12L4 40l9-8.5L4 23l12.5-3L15 8l11.5 5.5z"/>${T('WOW', 14)}`,
  },
  {
    id: 'badge-new',
    label: 'New',
    svg: `<circle ${O} fill="#7c3aed" cx="32" cy="32" r="27"/>${T('NEW', 15)}`,
  },
  {
    id: 'badge-sale',
    label: 'Sale',
    svg: `<rect ${O} fill="#ef4444" x="5" y="19" width="54" height="26" rx="7" transform="rotate(-10 32 32)"/>${T('SALE', 15, 38).replace('<text', '<text transform="rotate(-10 32 32)"')}`,
  },
  {
    id: 'badge-hot',
    label: 'Hot',
    svg: `<path ${O} fill="#f97316" d="M32 6c4 9 14 14 14 28a14 14 0 01-28 0c0-7 3-11 6-14 0 5 2 8 5 9-1-9 1-16 3-23z"/>`,
  },
  {
    id: 'badge-live',
    label: 'Live',
    svg: `<rect ${O} fill="#e11d48" x="6" y="20" width="52" height="24" rx="12"/><circle fill="#fff" cx="17" cy="32" r="4"/>${T('LIVE', 12, 36.5).replace('x="32"', 'x="37"')}`,
  },
  {
    id: 'arrow-right',
    label: 'Arrow',
    svg: `<path ${O} fill="#3b82f6" d="M6 25h28V12l24 20-24 20V39H6z"/>`,
  },
  {
    id: 'arrow-curve',
    label: 'Curved arrow',
    svg: `<path fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" d="M12 48c4-20 18-30 36-30"/><path fill="none" stroke="#facc15" stroke-width="6" stroke-linecap="round" d="M12 48c4-20 18-30 36-30"/><path ${O} fill="#facc15" d="M42 8l14 10-14 10z"/>`,
  },
  {
    id: 'arrow-down',
    label: 'Down arrow',
    svg: `<path ${O} fill="#22c55e" d="M25 6h14v28h13L32 58 12 34h13z"/>`,
  },
  {
    id: 'check',
    label: 'Check',
    svg: `<circle ${O} fill="#22c55e" cx="32" cy="32" r="26"/><path fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" d="M20 33l8 8 16-17"/>`,
  },
  {
    id: 'cross',
    label: 'Cross',
    svg: `<circle ${O} fill="#ef4444" cx="32" cy="32" r="26"/><path fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" d="M22 22l20 20M42 22L22 42"/>`,
  },
  {
    id: 'heart',
    label: 'Heart',
    svg: `<path ${O} fill="#ff3b5c" d="M32 56S6 40 6 22.5C6 14 12.5 8 20 8c5 0 9.3 2.8 12 7 2.7-4.2 7-7 12-7 7.5 0 14 6 14 14.5C58 40 32 56 32 56z"/>`,
  },
  {
    id: 'star',
    label: 'Star',
    svg: `<path ${O} fill="#ffc83d" d="M32 5l8.2 17.2 18.8 2.3-13.9 12.9 3.6 18.6L32 46.8 15.3 56l3.6-18.6L5 24.5l18.8-2.3z"/>`,
  },
  {
    id: 'sparkle',
    label: 'Sparkle',
    svg: `<path ${O} fill="#fde047" d="M32 4c2 14 6 20 24 28-18 8-22 14-24 28-2-14-6-20-24-28 18-8 22-14 24-28z"/>`,
  },
  {
    id: 'bubble-speech',
    label: 'Speech bubble',
    svg: `<path fill="#fff" stroke="#111" stroke-width="3" stroke-linejoin="round" d="M10 10h44a4 4 0 014 4v26a4 4 0 01-4 4H28L16 55v-11h-6a4 4 0 01-4-4V14a4 4 0 014-4z"/>`,
  },
  {
    id: 'bubble-thought',
    label: 'Thought bubble',
    svg: `<g fill="#fff" stroke="#111" stroke-width="3"><ellipse cx="34" cy="26" rx="24" ry="18"/><circle cx="16" cy="48" r="5"/><circle cx="8" cy="57" r="3"/></g>`,
  },
  {
    id: 'bubble-shout',
    label: 'Shout bubble',
    svg: `<path fill="#fde047" stroke="#111" stroke-width="3" stroke-linejoin="round" d="M6 14l10 2 6-10 6 9 9-7 3 10 12-3-4 11 10 6-11 4 5 11-12-2-2 12-9-8-8 9-3-12-11 4 4-11-9-6 10-4z"/>`,
  },
  {
    id: 'subscribe',
    label: 'Subscribe',
    svg: `<rect ${O} fill="#ef4444" x="3" y="20" width="58" height="24" rx="6"/>${T('SUBSCRIBE', 9.5, 35.5)}`,
  },
  {
    id: 'like',
    label: 'Like',
    svg: `<circle ${O} fill="#3b82f6" cx="32" cy="32" r="26"/><path fill="#fff" d="M20 30h6v16h-6zM29 46V30l7-12c3 0 4 2 4 5l-1 6h7c2 0 4 2 3 4l-3 10c-1 2-2 3-4 3z"/>`,
  },
  {
    id: 'location',
    label: 'Location pin',
    svg: `<path ${O} fill="#ef4444" d="M32 58S12 38 12 24a20 20 0 0140 0c0 14-20 34-20 34z"/><circle fill="#fff" cx="32" cy="24" r="7"/>`,
  },
  {
    id: 'circle-frame',
    label: 'Circle frame',
    svg: `<circle fill="none" stroke="#fff" stroke-width="5" cx="32" cy="32" r="26"/>`,
  },
  {
    id: 'square-frame',
    label: 'Square frame',
    svg: `<rect fill="none" stroke="#fff" stroke-width="5" x="7" y="7" width="50" height="50" rx="4"/>`,
  },
  {
    id: 'underline',
    label: 'Underline',
    svg: `<path fill="none" stroke="#facc15" stroke-width="7" stroke-linecap="round" d="M6 40c14-6 38-6 52 0"/>`,
  },
  {
    id: 'circle-scribble',
    label: 'Scribble circle',
    svg: `<path fill="none" stroke="#ef4444" stroke-width="4" stroke-linecap="round" d="M50 18C42 8 18 8 10 22s4 32 22 32 26-14 22-26-14-18-30-12"/>`,
  },
  {
    id: 'sun',
    label: 'Sun',
    svg: `<g ${O} fill="#fbbf24"><circle cx="32" cy="32" r="12"/><path d="M32 4v10M32 50v10M4 32h10M50 32h10M12 12l7 7M45 45l7 7M12 52l7-7M45 19l7-7"/></g>`,
  },
  {
    id: 'cloud',
    label: 'Cloud',
    svg: `<path ${O} fill="#e0f2fe" d="M18 48a11 11 0 010-22 15 15 0 0129-3 10 10 0 015 19 6 6 0 01-4 6z"/>`,
  },
  {
    id: 'lightning',
    label: 'Lightning',
    svg: `<path ${O} fill="#facc15" d="M36 4L12 36h16l-6 24 26-34H32z"/>`,
  },
  {
    id: 'music',
    label: 'Music note',
    svg: `<path ${O} fill="#a855f7" d="M26 46a8 8 0 11-6-7.7V10l28-6v32a8 8 0 11-6-7.7V14l-16 3.5z"/>`,
  },
  {
    id: 'play',
    label: 'Play button',
    svg: `<circle ${O} fill="#111" cx="32" cy="32" r="26"/><path fill="#fff" d="M26 20l18 12-18 12z"/>`,
  },
  {
    id: 'question',
    label: 'Question',
    svg: `<circle ${O} fill="#0ea5e9" cx="32" cy="32" r="26"/>${T('?', 32, 43)}`,
  },
  {
    id: 'exclaim',
    label: 'Exclamation',
    svg: `<circle ${O} fill="#f59e0b" cx="32" cy="32" r="26"/>${T('!', 32, 43)}`,
  },
  {
    id: 'percent',
    label: 'Percent off',
    svg: `<path ${O} fill="#10b981" d="M32 4l6 7 9-2 2 9 8 4-4 8 4 8-8 4-2 9-9-2-6 7-6-7-9 2-2-9-8-4 4-8-4-8 8-4 2-9 9 2z"/>${T('%', 22, 40)}`,
  },
];

/** The sticker's SVG document (64 × 64). */
export function shapeSvg(shape: ShapeSticker): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${shape.svg}</svg>`;
}
