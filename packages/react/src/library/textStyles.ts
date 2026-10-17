import { DEFAULT_TEXT_STYLE, FONT_PRESETS, type TextStyle } from '@video-ultra/core';

/**
 * The text style library: ready-made looks built from the font families and the text style
 * options (colour, outline, hard and soft shadows, glow, label boxes, spacing). Generated, so it
 * stays consistent and small (no images, no font downloads).
 */

/** A text style category. */
export interface TextStyleCategory {
  id: string;
  label: string;
}

/** One ready-made text look. */
export interface TextStylePreset {
  id: string;
  label: string;
  category: string;
  /** A word that shows the look off in the picker. */
  sample: string;
  style: TextStyle;
}

export const TEXT_STYLE_CATEGORIES: readonly TextStyleCategory[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'outline', label: 'Outline' },
  { id: 'shadow', label: '3D shadow' },
  { id: 'neon', label: 'Neon' },
  { id: 'label', label: 'Label' },
  { id: 'subtitle', label: 'Subtitles' },
  { id: 'elegant', label: 'Elegant' },
  { id: 'spaced', label: 'Spaced' },
];

const font = (id: string) => FONT_PRESETS.find((f) => f.id === id) ?? FONT_PRESETS[0]!;

const COLORS = {
  white: '#ffffff',
  black: '#111111',
  yellow: '#ffd60a',
  coral: '#ff6b6b',
  pink: '#ff4fa3',
  purple: '#9b5de5',
  blue: '#3a86ff',
  cyan: '#00e5ff',
  green: '#38d996',
  orange: '#ff9f1c',
  cream: '#fff3d6',
} as const;

function base(fontId: string, patch: Partial<TextStyle>): TextStyle {
  const f = font(fontId);
  return {
    ...DEFAULT_TEXT_STYLE,
    fontFamily: f.family,
    fontWeight: f.weight,
    shadow: null,
    ...patch,
  };
}

function build(): TextStylePreset[] {
  const out: TextStylePreset[] = [];
  const add = (category: string, label: string, sample: string, style: TextStyle) =>
    out.push({ id: `${category}-${out.length}`, label, category, sample, style });
  const softShadow = { color: 'rgba(0,0,0,0.55)', blur: 6, x: 0, y: 3 };

  // Basic: every family, light and dark.
  for (const f of FONT_PRESETS) {
    add(
      'basic',
      `${f.label} white`,
      f.label,
      base(f.id, { color: COLORS.white, shadow: softShadow }),
    );
    add('basic', `${f.label} black`, f.label, base(f.id, { color: COLORS.black }));
  }

  // Outline: bold families with a thick contrasting outline.
  const outlinePairs: [string, string, string][] = [
    ['White on black', COLORS.white, COLORS.black],
    ['Yellow on black', COLORS.yellow, COLORS.black],
    ['Black on white', COLORS.black, COLORS.white],
    ['Pink on white', COLORS.pink, COLORS.white],
    ['Blue on white', COLORS.blue, COLORS.white],
    ['Green on black', COLORS.green, COLORS.black],
  ];
  for (const fid of ['bold', 'rounded', 'classic', 'serif']) {
    for (const [name, color, outline] of outlinePairs) {
      add(
        'outline',
        `${font(fid).label} · ${name}`,
        name.split(' ')[0]!,
        base(fid, { color, outline: { color: outline, width: 0.12 } }),
      );
    }
  }

  // 3D: a hard offset shadow.
  const shadowPairs: [string, string, string][] = [
    ['Yellow', COLORS.yellow, '#c2410c'],
    ['White', COLORS.white, '#3a86ff'],
    ['Coral', COLORS.coral, '#3b0764'],
    ['Cyan', COLORS.cyan, '#1e1b4b'],
    ['Cream', COLORS.cream, '#9a3412'],
  ];
  for (const fid of ['bold', 'rounded', 'classic', 'serif']) {
    for (const [name, color, shade] of shadowPairs) {
      add(
        'shadow',
        `${font(fid).label} · ${name} 3D`,
        name.split(' ')[0]!,
        base(fid, { color, shadow: { color: shade, blur: 0, x: 5, y: 5 } }),
      );
    }
  }

  // Neon: a light core with a coloured glow.
  const glows: [string, string, string][] = [
    ['Pink', '#ffe4f1', COLORS.pink],
    ['Cyan', '#e0fdff', COLORS.cyan],
    ['Green', '#e6fff3', COLORS.green],
    ['Purple', '#f1e8ff', COLORS.purple],
    ['Orange', '#fff1df', COLORS.orange],
    ['Blue', '#e5efff', COLORS.blue],
  ];
  for (const fid of ['classic', 'rounded', 'handwritten', 'mono']) {
    for (const [name, color, glow] of glows) {
      add(
        'neon',
        `${font(fid).label} · ${name} neon`,
        name.split(' ')[0]!,
        base(fid, { color, shadow: { color: glow, blur: 18, x: 0, y: 0 } }),
      );
    }
  }

  // Label: text on a box (square and pill).
  const boxes: [string, string, string][] = [
    ['Black', COLORS.black, COLORS.white],
    ['White', COLORS.white, COLORS.black],
    ['Yellow', COLORS.yellow, COLORS.black],
    ['Coral', COLORS.coral, COLORS.white],
    ['Purple', COLORS.purple, COLORS.white],
    ['Blue', COLORS.blue, COLORS.white],
    ['Green', COLORS.green, COLORS.black],
    ['Pink', COLORS.pink, COLORS.white],
  ];
  for (const fid of ['classic', 'bold', 'rounded']) {
    for (const [name, box, color] of boxes) {
      add(
        'label',
        `${font(fid).label} · ${name} box`,
        name.split(' ')[0]!,
        base(fid, { color, background: { color: box, padding: 0.3, radius: 0.12 } }),
      );
    }
  }
  for (const [name, box, color] of boxes) {
    add(
      'label',
      `Pill · ${name}`,
      name.split(' ')[0]!,
      base('rounded', { color, background: { color: box, padding: 0.35, radius: 0.6 } }),
    );
  }

  // Subtitles: readable at small sizes.
  const sub = (label: string, patch: Partial<TextStyle>) =>
    add('subtitle', label, 'Subtitle', base('classic', { size: 0.04, fontWeight: 600, ...patch }));
  sub('Classic subtitle', {
    color: COLORS.white,
    background: { color: 'rgba(0,0,0,0.6)', padding: 0.25, radius: 0.1 },
  });
  sub('Yellow subtitle', {
    color: COLORS.yellow,
    background: { color: 'rgba(0,0,0,0.6)', padding: 0.25, radius: 0.1 },
  });
  sub('Outlined subtitle', { color: COLORS.white, outline: { color: COLORS.black, width: 0.1 } });
  sub('Shadow subtitle', {
    color: COLORS.white,
    shadow: { color: 'rgba(0,0,0,0.9)', blur: 4, x: 0, y: 2 },
  });
  sub('Bold caption', {
    fontWeight: 800,
    color: COLORS.white,
    outline: { color: COLORS.black, width: 0.14 },
  });
  sub('Light box', {
    color: COLORS.black,
    background: { color: 'rgba(255,255,255,0.85)', padding: 0.25, radius: 0.1 },
  });

  // Elegant: thin serif and script, airy.
  for (const fid of ['elegant', 'serif', 'handwritten']) {
    for (const [name, color] of [
      ['White', COLORS.white],
      ['Cream', COLORS.cream],
      ['Gold', '#e9c46a'],
      ['Black', COLORS.black],
    ] as const) {
      add(
        'elegant',
        `${font(fid).label} · ${name}`,
        'Elegant',
        base(fid, {
          color,
          italic: fid === 'serif',
          letterSpacing: 0.04,
          fontWeight: fid === 'serif' ? 400 : font(fid).weight,
          shadow:
            color === COLORS.black ? null : { color: 'rgba(0,0,0,0.35)', blur: 8, x: 0, y: 2 },
        }),
      );
    }
  }

  // Spaced: wide tracking, light weights.
  for (const fid of ['classic', 'mono', 'elegant']) {
    for (const [name, color] of [
      ['White', COLORS.white],
      ['Black', COLORS.black],
      ['Yellow', COLORS.yellow],
      ['Cyan', COLORS.cyan],
    ] as const) {
      add(
        'spaced',
        `${font(fid).label} · ${name} spaced`,
        'SPACE',
        base(fid, {
          color,
          fontWeight: 300,
          letterSpacing: 0.3,
          shadow: color === COLORS.black ? null : softShadow,
        }),
      );
    }
  }
  return out;
}

/** Every ready-made text style (≈ 140). */
export const TEXT_STYLE_PRESETS: readonly TextStylePreset[] = build();
