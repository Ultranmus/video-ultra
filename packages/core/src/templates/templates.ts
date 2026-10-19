import { FONT_PRESETS } from '../effects/presets';
import { DEFAULT_TEXT_STYLE, DEFAULT_TRANSFORM, type IdFactory } from '../model/project';
import type { Item, Project, TextStyle } from '../model/schema';
import { fromSeconds, type Time } from '../model/time';
import { addToLane, groupItems } from '../edit/ops';

/**
 * Templates (v0.3): ready-made titles, lower thirds, quotes, calls to action, sales, outros… — a
 * few styled and animated text and emoji elements, added at the playhead as one group. Texts may
 * hold **variables** like `{name}`: the editor asks for them (with the template's examples
 * filled in) before adding. Built from layouts × themes, so every layout comes in every look.
 */

/** One element of a template. Times in seconds from the template's start. */
export interface TemplateElement {
  kind: 'text' | 'emoji';
  /** Text with `{variable}`s, or the emoji. */
  content: string;
  /** Centre, fractions of the canvas. */
  x: number;
  y: number;
  /** Emoji: size as a fraction of the canvas's shorter side. Text: ignored (style.size). */
  scale?: number;
  rotation?: number;
  style?: Partial<TextStyle>;
  /** Text wrap width, fraction of the canvas width. */
  maxWidth?: number;
  start: number;
  duration: number;
  in?: string;
  out?: string;
  loop?: string;
}

/** A variable a template asks for. */
export interface TemplateVariable {
  key: string;
  /** What to ask ("Your name"). */
  label: string;
  /** Example value, filled in at first. */
  example: string;
}

/** One template. */
export interface TemplatePreset {
  id: string;
  name: string;
  category: TemplateCategory;
  /** Look family (`TEMPLATE_THEMES`). */
  theme: string;
  /** Seconds. */
  duration: number;
  elements: readonly TemplateElement[];
  variables: readonly TemplateVariable[];
}

/** Template groups, in picker order. */
export const TEMPLATE_CATEGORIES = [
  'intro',
  'lower-third',
  'quote',
  'social',
  'sale',
  'list',
  'event',
  'vlog',
  'outro',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

interface Theme {
  id: string;
  name: string;
  title: string; // font preset id
  body: string;
  ink: string; // main text colour
  accent: string; // accent text / boxes
  boxInk: string; // text on accent boxes
  card: string; // card / box background
  cardInk: string;
  /** Title look extras. */
  titleShadow: TextStyle['shadow'];
  titleOutline: TextStyle['outline'];
  letterSpacing: number;
  in: string;
  out: string;
}

/** The looks every layout comes in. */
export const TEMPLATE_THEMES: readonly Theme[] = Object.freeze([
  {
    id: 'bold',
    name: 'Bold',
    title: 'bold',
    body: 'classic',
    ink: '#ffffff',
    accent: '#ffd60a',
    boxInk: '#111111',
    card: '#111111',
    cardInk: '#ffffff',
    titleShadow: { color: 'rgba(0,0,0,0.6)', blur: 0, x: 4, y: 4 },
    titleOutline: null,
    letterSpacing: 0.01,
    in: 'stomp-in',
    out: 'fade-out',
  },
  {
    id: 'clean',
    name: 'Clean',
    title: 'classic',
    body: 'classic',
    ink: '#ffffff',
    accent: '#3a86ff',
    boxInk: '#ffffff',
    card: '#ffffff',
    cardInk: '#111111',
    titleShadow: { color: 'rgba(0,0,0,0.45)', blur: 8, x: 0, y: 2 },
    titleOutline: null,
    letterSpacing: 0,
    in: 'rise-in',
    out: 'fade-out',
  },
  {
    id: 'elegant',
    name: 'Elegant',
    title: 'elegant',
    body: 'serif',
    ink: '#fff3d6',
    accent: '#d4a373',
    boxInk: '#1b1b1b',
    card: 'rgba(20,16,12,0.78)',
    cardInk: '#fff3d6',
    titleShadow: { color: 'rgba(0,0,0,0.5)', blur: 10, x: 0, y: 2 },
    titleOutline: null,
    letterSpacing: 0.08,
    in: 'blur-in',
    out: 'blur-out',
  },
  {
    id: 'neon',
    name: 'Neon',
    title: 'rounded',
    body: 'rounded',
    ink: '#e8fdff',
    accent: '#ff4fa3',
    boxInk: '#ffffff',
    card: 'rgba(10,0,30,0.75)',
    cardInk: '#00e5ff',
    titleShadow: { color: '#00e5ff', blur: 18, x: 0, y: 0 },
    titleOutline: null,
    letterSpacing: 0.04,
    in: 'flicker-in',
    out: 'flicker-out',
  },
  {
    id: 'retro',
    name: 'Retro',
    title: 'typewriter',
    body: 'typewriter',
    ink: '#fff3d6',
    accent: '#ff9f1c',
    boxInk: '#2b1a0e',
    card: '#2b1a0e',
    cardInk: '#fff3d6',
    titleShadow: { color: '#c2410c', blur: 0, x: 3, y: 3 },
    titleOutline: null,
    letterSpacing: 0.03,
    in: 'typewriter-in',
    out: 'fade-out',
  },
  {
    id: 'playful',
    name: 'Playful',
    title: 'rounded',
    body: 'rounded',
    ink: '#ffffff',
    accent: '#9b5de5',
    boxInk: '#ffffff',
    card: '#ff4fa3',
    cardInk: '#ffffff',
    titleShadow: null,
    titleOutline: { color: '#9b5de5', width: 0.12 },
    letterSpacing: 0.02,
    in: 'bounce-in',
    out: 'pop-out',
  },
]);

const fontOf = (id: string) => FONT_PRESETS.find((f) => f.id === id) ?? FONT_PRESETS[0]!;

/** Builders for the elements of a layout in a theme. */
function kit(t: Theme) {
  const title = (patch: Partial<TextStyle> = {}): Partial<TextStyle> => ({
    fontFamily: fontOf(t.title).family,
    fontWeight: fontOf(t.title).weight,
    color: t.ink,
    shadow: t.titleShadow,
    outline: t.titleOutline,
    letterSpacing: t.letterSpacing,
    ...patch,
  });
  const body = (patch: Partial<TextStyle> = {}): Partial<TextStyle> => ({
    fontFamily: fontOf(t.body).family,
    fontWeight: Math.min(700, fontOf(t.body).weight),
    color: t.ink,
    shadow: { color: 'rgba(0,0,0,0.5)', blur: 6, x: 0, y: 2 },
    ...patch,
  });
  const box = (fill: string, ink: string, patch: Partial<TextStyle> = {}): Partial<TextStyle> => ({
    ...body({ color: ink, shadow: null }),
    background: { color: fill, padding: 0.45, radius: 0.25 },
    ...patch,
  });
  return { title, body, box };
}

type Layout = {
  id: string;
  name: string;
  category: TemplateCategory;
  duration: number;
  variables: TemplateVariable[];
  elements: (t: Theme) => TemplateElement[];
};

const v = (key: string, label: string, example: string): TemplateVariable => ({
  key,
  label,
  example,
});

const LAYOUTS: Layout[] = [
  // ── intros ──
  {
    id: 'title-center',
    name: 'Big title',
    category: 'intro',
    duration: 4,
    variables: [
      v('title', 'Title', 'Summer in Lisbon'),
      v('subtitle', 'Subtitle', 'A travel story'),
    ],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{title}',
          x: 0.5,
          y: 0.45,
          style: k.title({ size: 0.075 }),
          maxWidth: 0.86,
          start: 0,
          duration: 4,
          in: t.in,
          out: t.out,
        },
        {
          kind: 'text',
          content: '{subtitle}',
          x: 0.5,
          y: 0.56,
          style: k.body({ size: 0.032, color: t.accent }),
          maxWidth: 0.8,
          start: 0.4,
          duration: 3.6,
          in: 'fade-in',
          out: 'fade-out',
        },
      ];
    },
  },
  {
    id: 'kicker-title',
    name: 'Label + title',
    category: 'intro',
    duration: 4,
    variables: [v('label', 'Label', 'EPISODE 1'), v('title', 'Title', 'Getting started')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{label}',
          x: 0.5,
          y: 0.36,
          style: k.box(t.accent, t.boxInk, { size: 0.026, letterSpacing: 0.12 }),
          start: 0,
          duration: 4,
          in: 'wipe-right-in',
          out: 'fade-out',
        },
        {
          kind: 'text',
          content: '{title}',
          x: 0.5,
          y: 0.49,
          style: k.title({ size: 0.065 }),
          maxWidth: 0.86,
          start: 0.3,
          duration: 3.7,
          in: t.in,
          out: t.out,
        },
      ];
    },
  },
  {
    id: 'stacked-words',
    name: 'Stacked words',
    category: 'intro',
    duration: 4,
    variables: [
      v('one', 'First word', 'MAKE'),
      v('two', 'Second word', 'IT'),
      v('three', 'Third word', 'HAPPEN'),
    ],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{one}',
          x: 0.5,
          y: 0.38,
          style: k.title({ size: 0.08 }),
          start: 0,
          duration: 4,
          in: 'slide-left-in',
          out: t.out,
        },
        {
          kind: 'text',
          content: '{two}',
          x: 0.5,
          y: 0.47,
          style: k.title({ size: 0.08, color: t.accent }),
          start: 0.25,
          duration: 3.75,
          in: 'slide-right-in',
          out: t.out,
        },
        {
          kind: 'text',
          content: '{three}',
          x: 0.5,
          y: 0.56,
          style: k.title({ size: 0.08 }),
          start: 0.5,
          duration: 3.5,
          in: 'slide-left-in',
          out: t.out,
        },
      ];
    },
  },
  {
    id: 'title-emoji',
    name: 'Title with emoji',
    category: 'intro',
    duration: 4,
    variables: [v('title', 'Title', 'Morning routine'), v('emoji', 'Emoji', '☀️')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'emoji',
          content: '{emoji}',
          x: 0.5,
          y: 0.36,
          scale: 0.18,
          start: 0,
          duration: 4,
          in: 'pop-in',
          loop: 'float',
          out: 'pop-out',
        },
        {
          kind: 'text',
          content: '{title}',
          x: 0.5,
          y: 0.5,
          style: k.title({ size: 0.065 }),
          maxWidth: 0.86,
          start: 0.2,
          duration: 3.8,
          in: t.in,
          out: t.out,
        },
      ];
    },
  },
  {
    id: 'top-banner',
    name: 'Top banner',
    category: 'intro',
    duration: 4,
    variables: [v('title', 'Title', 'How I edit on my phone')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{title}',
          x: 0.5,
          y: 0.14,
          style: k.box(t.card, t.cardInk, {
            size: 0.04,
            fontFamily: fontOf(t.title).family,
            fontWeight: fontOf(t.title).weight,
          }),
          maxWidth: 0.86,
          start: 0,
          duration: 4,
          in: 'drop-in',
          out: 'slide-top-out',
        },
      ];
    },
  },
  // ── lower thirds ──
  {
    id: 'name-role',
    name: 'Name and role',
    category: 'lower-third',
    duration: 5,
    variables: [v('name', 'Name', 'Alex Morgan'), v('role', 'Role', 'Product designer')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{name}',
          x: 0.3,
          y: 0.8,
          style: k.box(t.card, t.cardInk, { size: 0.034, align: 'left', fontWeight: 800 }),
          start: 0,
          duration: 5,
          in: 'slide-left-in',
          out: 'slide-left-out',
        },
        {
          kind: 'text',
          content: '{role}',
          x: 0.3,
          y: 0.855,
          style: k.box(t.accent, t.boxInk, { size: 0.024, align: 'left' }),
          start: 0.25,
          duration: 4.75,
          in: 'slide-left-in',
          out: 'slide-left-out',
        },
      ];
    },
  },
  {
    id: 'name-pill',
    name: 'Name pill',
    category: 'lower-third',
    duration: 5,
    variables: [v('name', 'Name', '@yourhandle')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{name}',
          x: 0.5,
          y: 0.84,
          style: k.box(t.accent, t.boxInk, {
            size: 0.032,
            background: { color: t.accent, padding: 0.55, radius: 1 },
          }),
          start: 0,
          duration: 5,
          in: 'pop-in',
          out: 'pop-out',
        },
      ];
    },
  },
  {
    id: 'location',
    name: 'Location tag',
    category: 'lower-third',
    duration: 4,
    variables: [v('place', 'Place', 'Kyoto, Japan')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'emoji',
          content: '📍',
          x: 0.2,
          y: 0.82,
          scale: 0.08,
          start: 0,
          duration: 4,
          in: 'drop-in',
          out: 'fade-out',
        },
        {
          kind: 'text',
          content: '{place}',
          x: 0.5,
          y: 0.82,
          style: k.box(t.card, t.cardInk, { size: 0.03 }),
          start: 0.15,
          duration: 3.85,
          in: 'wipe-right-in',
          out: 'fade-out',
        },
      ];
    },
  },
  {
    id: 'speaker',
    name: 'Speaker card',
    category: 'lower-third',
    duration: 5,
    variables: [v('name', 'Name', 'Dr. Priya Shah'), v('topic', 'Topic', 'The future of cities')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{name}\n{topic}',
          x: 0.5,
          y: 0.82,
          style: k.box(t.card, t.cardInk, { size: 0.03, lineHeight: 1.35 }),
          maxWidth: 0.86,
          start: 0,
          duration: 5,
          in: 'rise-in',
          out: 'fade-out',
        },
      ];
    },
  },
  // ── quotes ──
  {
    id: 'quote-marks',
    name: 'Quote',
    category: 'quote',
    duration: 6,
    variables: [
      v('quote', 'Quote', 'Simplicity is the ultimate sophistication.'),
      v('author', 'Author', 'Leonardo da Vinci'),
    ],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '“',
          x: 0.5,
          y: 0.32,
          style: k.title({ size: 0.14, color: t.accent, shadow: null, outline: null }),
          start: 0,
          duration: 6,
          in: 'fade-in',
          out: 'fade-out',
        },
        {
          kind: 'text',
          content: '{quote}',
          x: 0.5,
          y: 0.47,
          style: k.body({ size: 0.042, fontFamily: fontOf(t.title).family, lineHeight: 1.3 }),
          maxWidth: 0.82,
          start: 0.3,
          duration: 5.7,
          in: 'words-in',
          out: 'fade-out',
        },
        {
          kind: 'text',
          content: '— {author}',
          x: 0.5,
          y: 0.62,
          style: k.body({ size: 0.026, color: t.accent }),
          start: 1.2,
          duration: 4.8,
          in: 'fade-in',
          out: 'fade-out',
        },
      ];
    },
  },
  {
    id: 'quote-card',
    name: 'Quote card',
    category: 'quote',
    duration: 6,
    variables: [v('quote', 'Quote', 'Done is better than perfect.')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{quote}',
          x: 0.5,
          y: 0.5,
          style: k.box(t.card, t.cardInk, {
            size: 0.045,
            fontFamily: fontOf(t.title).family,
            fontWeight: fontOf(t.title).weight,
            lineHeight: 1.25,
            background: { color: t.card, padding: 0.8, radius: 0.35 },
          }),
          maxWidth: 0.8,
          start: 0,
          duration: 6,
          in: 'zoom-in',
          out: 'fade-out',
        },
      ];
    },
  },
  {
    id: 'big-statement',
    name: 'Big statement',
    category: 'quote',
    duration: 5,
    variables: [v('line', 'Statement', 'Nobody tells you this')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{line}',
          x: 0.5,
          y: 0.5,
          style: k.title({ size: 0.085, lineHeight: 1.05 }),
          maxWidth: 0.88,
          start: 0,
          duration: 5,
          in: 'words-in',
          out: t.out,
        },
      ];
    },
  },
  // ── social ──
  {
    id: 'subscribe',
    name: 'Subscribe',
    category: 'social',
    duration: 4,
    variables: [v('cta', 'Button text', 'SUBSCRIBE')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{cta}',
          x: 0.5,
          y: 0.8,
          style: k.box('#e62117', '#ffffff', { size: 0.036, fontWeight: 800, letterSpacing: 0.06 }),
          start: 0,
          duration: 4,
          in: 'pop-in',
          loop: 'pulse',
          out: 'pop-out',
        },
        {
          kind: 'emoji',
          content: '🔔',
          x: 0.76,
          y: 0.79,
          scale: 0.08,
          start: 0.5,
          duration: 3.5,
          in: 'pop-in',
          loop: 'wiggle',
          out: 'pop-out',
        },
      ];
    },
  },
  {
    id: 'follow',
    name: 'Follow me',
    category: 'social',
    duration: 4,
    variables: [v('handle', 'Your handle', '@yourname')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: 'Follow',
          x: 0.5,
          y: 0.46,
          style: k.title({ size: 0.05 }),
          start: 0,
          duration: 4,
          in: t.in,
          out: t.out,
        },
        {
          kind: 'text',
          content: '{handle}',
          x: 0.5,
          y: 0.53,
          style: k.box(t.accent, t.boxInk, { size: 0.034 }),
          start: 0.3,
          duration: 3.7,
          in: 'pop-in',
          out: 'pop-out',
        },
      ];
    },
  },
  {
    id: 'like-share',
    name: 'Like & share',
    category: 'social',
    duration: 4,
    variables: [v('text', 'Text', 'Like & share!')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'emoji',
          content: '👍',
          x: 0.35,
          y: 0.78,
          scale: 0.1,
          start: 0,
          duration: 4,
          in: 'bounce-in',
          loop: 'heartbeat',
          out: 'pop-out',
        },
        {
          kind: 'emoji',
          content: '❤️',
          x: 0.65,
          y: 0.78,
          scale: 0.1,
          start: 0.2,
          duration: 3.8,
          in: 'bounce-in',
          loop: 'heartbeat',
          out: 'pop-out',
        },
        {
          kind: 'text',
          content: '{text}',
          x: 0.5,
          y: 0.87,
          style: k.title({ size: 0.04 }),
          start: 0.4,
          duration: 3.6,
          in: t.in,
          out: t.out,
        },
      ];
    },
  },
  {
    id: 'link-bio',
    name: 'Link in bio',
    category: 'social',
    duration: 4,
    variables: [v('text', 'Text', 'Link in bio')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{text}',
          x: 0.5,
          y: 0.82,
          style: k.box(t.card, t.cardInk, { size: 0.034 }),
          start: 0,
          duration: 4,
          in: 'rise-in',
          out: 'fade-out',
        },
        {
          kind: 'emoji',
          content: '👆',
          x: 0.5,
          y: 0.73,
          scale: 0.08,
          start: 0.3,
          duration: 3.7,
          in: 'pop-in',
          loop: 'float',
          out: 'fade-out',
        },
      ];
    },
  },
  // ── sale ──
  {
    id: 'sale-percent',
    name: 'Sale',
    category: 'sale',
    duration: 4,
    variables: [v('word', 'Word', 'SALE'), v('off', 'Offer', 'UP TO 50% OFF')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{word}',
          x: 0.5,
          y: 0.44,
          style: k.title({ size: 0.12, color: t.accent }),
          start: 0,
          duration: 4,
          in: 'stomp-in',
          loop: 'pulse',
          out: t.out,
        },
        {
          kind: 'text',
          content: '{off}',
          x: 0.5,
          y: 0.56,
          style: k.box(t.card, t.cardInk, { size: 0.034, fontWeight: 800 }),
          start: 0.3,
          duration: 3.7,
          in: 'wipe-right-in',
          out: 'fade-out',
        },
      ];
    },
  },
  {
    id: 'price-tag',
    name: 'Price tag',
    category: 'sale',
    duration: 4,
    variables: [v('product', 'Product', 'Classic sneakers'), v('price', 'Price', '$49')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{product}',
          x: 0.5,
          y: 0.74,
          style: k.body({ size: 0.034 }),
          maxWidth: 0.8,
          start: 0,
          duration: 4,
          in: 'rise-in',
          out: 'fade-out',
        },
        {
          kind: 'text',
          content: '{price}',
          x: 0.5,
          y: 0.82,
          style: k.box(t.accent, t.boxInk, {
            size: 0.06,
            fontFamily: fontOf(t.title).family,
            fontWeight: 900,
          }),
          start: 0.3,
          duration: 3.7,
          in: 'pop-in',
          out: 'pop-out',
        },
      ];
    },
  },
  {
    id: 'new-arrival',
    name: 'New arrival',
    category: 'sale',
    duration: 4,
    variables: [v('label', 'Label', 'NEW'), v('title', 'Title', 'Autumn collection')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{label}',
          x: 0.3,
          y: 0.2,
          rotation: -8,
          style: k.box(t.accent, t.boxInk, { size: 0.04, fontWeight: 900 }),
          start: 0,
          duration: 4,
          in: 'spin-in',
          out: 'pop-out',
        },
        {
          kind: 'text',
          content: '{title}',
          x: 0.5,
          y: 0.82,
          style: k.title({ size: 0.055 }),
          maxWidth: 0.86,
          start: 0.3,
          duration: 3.7,
          in: t.in,
          out: t.out,
        },
      ];
    },
  },
  {
    id: 'limited',
    name: 'Limited time',
    category: 'sale',
    duration: 4,
    variables: [v('text', 'Text', 'Limited time only'), v('code', 'Code', 'CODE: SAVE20')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'emoji',
          content: '⏰',
          x: 0.5,
          y: 0.36,
          scale: 0.12,
          start: 0,
          duration: 4,
          in: 'pop-in',
          loop: 'shake',
          out: 'pop-out',
        },
        {
          kind: 'text',
          content: '{text}',
          x: 0.5,
          y: 0.48,
          style: k.title({ size: 0.05 }),
          maxWidth: 0.86,
          start: 0.2,
          duration: 3.8,
          in: t.in,
          out: t.out,
        },
        {
          kind: 'text',
          content: '{code}',
          x: 0.5,
          y: 0.56,
          style: k.box(t.card, t.cardInk, { size: 0.03, letterSpacing: 0.08 }),
          start: 0.5,
          duration: 3.5,
          in: 'typewriter-in',
          out: 'fade-out',
        },
      ];
    },
  },
  // ── lists ──
  {
    id: 'step',
    name: 'Step',
    category: 'list',
    duration: 4,
    variables: [v('number', 'Step', 'STEP 1'), v('title', 'What to do', 'Rinse the rice')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{number}',
          x: 0.5,
          y: 0.16,
          style: k.box(t.accent, t.boxInk, { size: 0.03, letterSpacing: 0.1 }),
          start: 0,
          duration: 4,
          in: 'drop-in',
          out: 'fade-out',
        },
        {
          kind: 'text',
          content: '{title}',
          x: 0.5,
          y: 0.23,
          style: k.title({ size: 0.05 }),
          maxWidth: 0.86,
          start: 0.25,
          duration: 3.75,
          in: t.in,
          out: t.out,
        },
      ];
    },
  },
  {
    id: 'top-three',
    name: 'Top 3',
    category: 'list',
    duration: 6,
    variables: [
      v('title', 'Title', 'Top 3 tips'),
      v('one', 'First', 'Plan the shots'),
      v('two', 'Second', 'Use daylight'),
      v('three', 'Third', 'Keep it short'),
    ],
    elements: (t) => {
      const k = kit(t);
      const row = (text: string, y: number, start: number): TemplateElement => ({
        kind: 'text',
        content: text,
        x: 0.5,
        y,
        style: k.box(t.card, t.cardInk, { size: 0.032 }),
        maxWidth: 0.82,
        start,
        duration: 6 - start,
        in: 'slide-left-in',
        out: 'fade-out',
      });
      return [
        {
          kind: 'text',
          content: '{title}',
          x: 0.5,
          y: 0.3,
          style: k.title({ size: 0.06, color: t.accent }),
          start: 0,
          duration: 6,
          in: t.in,
          out: t.out,
        },
        row('1. {one}', 0.42, 0.6),
        row('2. {two}', 0.5, 1.2),
        row('3. {three}', 0.58, 1.8),
      ];
    },
  },
  {
    id: 'checklist',
    name: 'Checklist',
    category: 'list',
    duration: 6,
    variables: [
      v('one', 'First', 'Passport'),
      v('two', 'Second', 'Charger'),
      v('three', 'Third', 'Snacks'),
    ],
    elements: (t) => {
      const k = kit(t);
      const line = (text: string, y: number, start: number): TemplateElement => ({
        kind: 'text',
        content: `✅ ${text}`,
        x: 0.5,
        y,
        style: k.body({ size: 0.04 }),
        start,
        duration: 6 - start,
        in: 'pop-in',
        out: 'fade-out',
      });
      return [line('{one}', 0.4, 0), line('{two}', 0.48, 0.6), line('{three}', 0.56, 1.2)];
    },
  },
  // ── events ──
  {
    id: 'event-date',
    name: 'Save the date',
    category: 'event',
    duration: 5,
    variables: [v('event', 'Event', 'Summer Party'), v('date', 'Date', 'Saturday, 14 June')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: 'SAVE THE DATE',
          x: 0.5,
          y: 0.38,
          style: k.body({ size: 0.026, letterSpacing: 0.2, color: t.accent }),
          start: 0,
          duration: 5,
          in: 'fade-in',
          out: 'fade-out',
        },
        {
          kind: 'text',
          content: '{event}',
          x: 0.5,
          y: 0.46,
          style: k.title({ size: 0.07 }),
          maxWidth: 0.86,
          start: 0.3,
          duration: 4.7,
          in: t.in,
          out: t.out,
        },
        {
          kind: 'text',
          content: '{date}',
          x: 0.5,
          y: 0.55,
          style: k.box(t.card, t.cardInk, { size: 0.03 }),
          start: 0.6,
          duration: 4.4,
          in: 'rise-in',
          out: 'fade-out',
        },
      ];
    },
  },
  {
    id: 'countdown',
    name: 'Countdown',
    category: 'event',
    duration: 3,
    variables: [],
    elements: (t) => {
      const k = kit(t);
      const n = (text: string, start: number): TemplateElement => ({
        kind: 'text',
        content: text,
        x: 0.5,
        y: 0.5,
        style: k.title({ size: 0.2, color: t.accent }),
        start,
        duration: 1,
        in: 'zoom-in',
        out: 'zoom-out',
      });
      return [n('3', 0), n('2', 1), n('1', 2)];
    },
  },
  {
    id: 'birthday',
    name: 'Happy birthday',
    category: 'event',
    duration: 5,
    variables: [v('name', 'Name', 'Sam')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'emoji',
          content: '🎉',
          x: 0.25,
          y: 0.33,
          scale: 0.12,
          rotation: -12,
          start: 0,
          duration: 5,
          in: 'pop-in',
          loop: 'wiggle',
          out: 'pop-out',
        },
        {
          kind: 'emoji',
          content: '🎂',
          x: 0.75,
          y: 0.33,
          scale: 0.12,
          start: 0.2,
          duration: 4.8,
          in: 'pop-in',
          loop: 'float',
          out: 'pop-out',
        },
        {
          kind: 'text',
          content: 'Happy birthday',
          x: 0.5,
          y: 0.46,
          style: k.title({ size: 0.06 }),
          start: 0.3,
          duration: 4.7,
          in: t.in,
          out: t.out,
        },
        {
          kind: 'text',
          content: '{name}!',
          x: 0.5,
          y: 0.55,
          style: k.title({ size: 0.08, color: t.accent }),
          start: 0.6,
          duration: 4.4,
          in: 'bounce-in',
          out: t.out,
        },
      ];
    },
  },
  // ── vlog ──
  {
    id: 'day-number',
    name: 'Day number',
    category: 'vlog',
    duration: 4,
    variables: [v('day', 'Day', 'DAY 1'), v('place', 'Place', 'Arrival in Rome')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{day}',
          x: 0.5,
          y: 0.44,
          style: k.title({ size: 0.1 }),
          start: 0,
          duration: 4,
          in: t.in,
          out: t.out,
        },
        {
          kind: 'text',
          content: '{place}',
          x: 0.5,
          y: 0.53,
          style: k.body({ size: 0.03, color: t.accent }),
          maxWidth: 0.8,
          start: 0.4,
          duration: 3.6,
          in: 'fade-in',
          out: 'fade-out',
        },
      ];
    },
  },
  {
    id: 'recipe-card',
    name: 'Recipe card',
    category: 'vlog',
    duration: 5,
    variables: [v('dish', 'Dish', 'Easy pancakes'), v('time', 'Time', '15 min · serves 2')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'emoji',
          content: '🍳',
          x: 0.5,
          y: 0.34,
          scale: 0.12,
          start: 0,
          duration: 5,
          in: 'drop-in',
          loop: 'sway',
          out: 'fade-out',
        },
        {
          kind: 'text',
          content: '{dish}',
          x: 0.5,
          y: 0.46,
          style: k.title({ size: 0.065 }),
          maxWidth: 0.86,
          start: 0.2,
          duration: 4.8,
          in: t.in,
          out: t.out,
        },
        {
          kind: 'text',
          content: '{time}',
          x: 0.5,
          y: 0.55,
          style: k.box(t.card, t.cardInk, { size: 0.028 }),
          start: 0.5,
          duration: 4.5,
          in: 'rise-in',
          out: 'fade-out',
        },
      ];
    },
  },
  {
    id: 'headline',
    name: 'Headline bar',
    category: 'vlog',
    duration: 5,
    variables: [
      v('tag', 'Tag', 'BREAKING'),
      v('headline', 'Headline', 'Our first big trip is booked'),
    ],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{tag}',
          x: 0.2,
          y: 0.8,
          style: k.box('#e62117', '#ffffff', { size: 0.026, fontWeight: 900, letterSpacing: 0.08 }),
          start: 0,
          duration: 5,
          in: 'wipe-right-in',
          out: 'fade-out',
        },
        {
          kind: 'text',
          content: '{headline}',
          x: 0.5,
          y: 0.86,
          style: k.box(t.card, t.cardInk, { size: 0.03 }),
          maxWidth: 0.92,
          start: 0.2,
          duration: 4.8,
          in: 'wipe-right-in',
          out: 'fade-out',
        },
      ];
    },
  },
  // ── outros ──
  {
    id: 'thanks',
    name: 'Thanks for watching',
    category: 'outro',
    duration: 5,
    variables: [v('title', 'Title', 'Thanks for watching'), v('next', 'Line', 'See you next time')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{title}',
          x: 0.5,
          y: 0.46,
          style: k.title({ size: 0.065 }),
          maxWidth: 0.86,
          start: 0,
          duration: 5,
          in: t.in,
          out: t.out,
        },
        {
          kind: 'text',
          content: '{next}',
          x: 0.5,
          y: 0.55,
          style: k.body({ size: 0.03, color: t.accent }),
          start: 0.5,
          duration: 4.5,
          in: 'fade-in',
          out: 'fade-out',
        },
        {
          kind: 'emoji',
          content: '👋',
          x: 0.5,
          y: 0.35,
          scale: 0.12,
          start: 0.3,
          duration: 4.7,
          in: 'pop-in',
          loop: 'wiggle',
          out: 'pop-out',
        },
      ];
    },
  },
  {
    id: 'the-end',
    name: 'The end',
    category: 'outro',
    duration: 4,
    variables: [v('title', 'Title', 'The End')],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{title}',
          x: 0.5,
          y: 0.5,
          style: k.title({ size: 0.09, fontFamily: fontOf('elegant').family, fontWeight: 400 }),
          start: 0,
          duration: 4,
          in: 'blur-in',
          out: 'fade-out',
        },
      ];
    },
  },
  {
    id: 'credits',
    name: 'Credits',
    category: 'outro',
    duration: 6,
    variables: [
      v('by', 'Made by', 'Filmed & edited by Jo'),
      v('music', 'Music', 'Music: Sunny Days'),
    ],
    elements: (t) => {
      const k = kit(t);
      return [
        {
          kind: 'text',
          content: '{by}',
          x: 0.5,
          y: 0.46,
          style: k.body({ size: 0.034 }),
          maxWidth: 0.86,
          start: 0,
          duration: 6,
          in: 'rise-in',
          out: 'fade-out',
        },
        {
          kind: 'text',
          content: '{music}',
          x: 0.5,
          y: 0.53,
          style: k.body({ size: 0.026, color: t.accent }),
          maxWidth: 0.86,
          start: 0.5,
          duration: 5.5,
          in: 'rise-in',
          out: 'fade-out',
        },
      ];
    },
  },
];

/** Every template: each layout in each theme (27 × 6 = 162). */
export const TEMPLATE_PRESETS: readonly TemplatePreset[] = Object.freeze(
  LAYOUTS.flatMap((layout) =>
    TEMPLATE_THEMES.map((theme): TemplatePreset => ({
      id: `${layout.id}-${theme.id}`,
      name: `${layout.name} · ${theme.name}`,
      category: layout.category,
      theme: theme.id,
      duration: layout.duration,
      variables: layout.variables,
      elements: layout.elements(theme),
    })),
  ),
);

const BY_ID = new Map(TEMPLATE_PRESETS.map((t) => [t.id, t]));

/** The template with this id, or undefined. */
export function templatePreset(id: string): TemplatePreset | undefined {
  return BY_ID.get(id);
}

/** `text` with `{variable}`s filled from `values` (falling back to the template's examples). */
export function fillTemplateText(
  text: string,
  template: Pick<TemplatePreset, 'variables'>,
  values: Readonly<Record<string, string>> = {},
): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    if (value !== undefined) return value;
    return template.variables.find((x) => x.key === key)?.example ?? whole;
  });
}

/**
 * Adds a template at `at` (usually the playhead): its elements as lane items, filled with
 * `values`, grouped when there are several. Returns the new ids (empty when every text was left
 * empty).
 */
export function applyTemplate(
  project: Project,
  template: TemplatePreset,
  values: Readonly<Record<string, string>>,
  at: Time,
  ids: IdFactory,
): string[] {
  const made: string[] = [];
  for (const el of template.elements) {
    const content = fillTemplateText(el.content, template, values).trim();
    if (!content) continue;
    const start = at + fromSeconds(el.start);
    const duration = fromSeconds(el.duration);
    const animation = {
      ...(el.in ? { in: { type: el.in, duration: fromSeconds(0.5) } } : {}),
      ...(el.out ? { out: { type: el.out, duration: fromSeconds(0.5) } } : {}),
      ...(el.loop ? { loop: { type: el.loop } } : {}),
    };
    const transform = {
      ...DEFAULT_TRANSFORM,
      x: el.x,
      y: el.y,
      scale: el.kind === 'emoji' ? (el.scale ?? 0.15) : 1,
      rotation: el.rotation ?? 0,
    };
    const item: Item =
      el.kind === 'emoji'
        ? {
            id: ids(),
            kind: 'sticker',
            start,
            duration,
            assetId: null,
            emoji: content,
            transform,
            filter: null,
            adjust: {},
            animation,
          }
        : {
            id: ids(),
            kind: 'text',
            start,
            duration,
            text: content,
            style: { ...DEFAULT_TEXT_STYLE, ...el.style },
            transform,
            filter: null,
            adjust: {},
            animation,
            ...(el.maxWidth ? { maxWidth: el.maxWidth } : {}),
          };
    addToLane(project, item, ids);
    made.push(item.id);
  }
  if (made.length > 1) groupItems(project, made, ids);
  return made;
}
