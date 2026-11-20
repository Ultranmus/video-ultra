/**
 * The playground's options: what can be changed, the editor's defaults, and the code that
 * reproduces a setup in an app.
 */
import type { Labels, ThemeOverrides } from '@video-ultra/react';

export type Mode = 'dark' | 'light' | 'auto';

export type ColorKey =
  | 'accent'
  | 'accentText'
  | 'bg'
  | 'stage'
  | 'surface1'
  | 'surface2'
  | 'surface3'
  | 'text'
  | 'textMuted'
  | 'timelineBg';

/** The editor's own colours (packages/react/src/styles/tokens.css), to start the pickers from. */
export const DEFAULT_COLORS: Record<'dark' | 'light', Record<ColorKey, string>> = {
  dark: {
    accent: '#9c479c',
    accentText: '#d08bd0',
    bg: '#0b0b0d',
    stage: '#141418',
    surface1: '#131316',
    surface2: '#1c1c21',
    surface3: '#26262d',
    text: '#f4f4f5',
    textMuted: '#a1a1aa',
    timelineBg: '#0e0e11',
  },
  light: {
    accent: '#4d194d',
    accentText: '#4d194d',
    bg: '#f4f4f6',
    stage: '#e2e2e8',
    surface1: '#ffffff',
    surface2: '#f1f1f4',
    surface3: '#e4e4ea',
    text: '#18181b',
    textMuted: '#5b5b66',
    timelineBg: '#ececf0',
  },
};

export const COLOR_FIELDS: { key: ColorKey; label: string }[] = [
  { key: 'accent', label: 'Accent' },
  { key: 'accentText', label: 'Accent text' },
  { key: 'bg', label: 'Background' },
  { key: 'surface1', label: 'Bars and panels' },
  { key: 'surface2', label: 'Inputs, hover' },
  { key: 'surface3', label: 'Pressed, menus' },
  { key: 'stage', label: 'Behind the video' },
  { key: 'timelineBg', label: 'Timeline' },
  { key: 'text', label: 'Text' },
  { key: 'textMuted', label: 'Quiet text' },
];

/** Quick accents: each with a lighter text tone for dark mode (readable on dark bars). */
export const ACCENTS: { name: string; accent: string; dark: string }[] = [
  { name: 'Plum', accent: '#9c479c', dark: '#d08bd0' },
  { name: 'Blue', accent: '#2563eb', dark: '#7aa7ff' },
  { name: 'Teal', accent: '#0e7490', dark: '#4fc7de' },
  { name: 'Green', accent: '#15803d', dark: '#5bd68a' },
  { name: 'Orange', accent: '#c2410c', dark: '#ff9a62' },
  { name: 'Rose', accent: '#be123c', dark: '#ff7b98' },
];

export const FONTS = [
  { label: 'Your page’s font', value: '' },
  { label: 'System sans', value: 'ui-sans-serif, system-ui, sans-serif' },
  { label: 'Rounded', value: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" },
  { label: 'Serif', value: "ui-serif, Georgia, 'Times New Roman', serif" },
  { label: 'Monospace', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
];

export const DEFAULT_RADIUS = 8;

/** Preview sizes. Width picks the editor's layout (phone, tablet, desktop). */
export const SIZES = {
  fill: { label: 'Fill', width: 0, height: 0 },
  desktop: { label: 'Laptop', width: 1280, height: 800 },
  tablet: { label: 'Tablet', width: 1024, height: 768 },
  'tablet-portrait': { label: 'Tablet tall', width: 820, height: 1180 },
  phone: { label: 'Phone', width: 393, height: 852 },
  'phone-small': { label: 'Small phone', width: 360, height: 740 },
  custom: { label: 'Custom', width: 0, height: 0 },
} as const;
export type SizeId = keyof typeof SIZES;

/** Built-in parts a host can hide (`customize.hide`), in groups. */
export const TOOL_GROUPS: { title: string; items: { id: string; label: string }[] }[] = [
  {
    title: 'Left menu',
    items: [
      { id: 'templates', label: 'Templates' },
      { id: 'text', label: 'Text' },
      { id: 'captions', label: 'Captions' },
      { id: 'audio', label: 'Audio' },
      { id: 'stickers', label: 'Stickers' },
      { id: 'filters', label: 'Filters' },
      { id: 'transitions', label: 'Transitions' },
      { id: 'blur', label: 'Blur areas' },
    ],
  },
  {
    title: 'Clip tools',
    items: [
      { id: 'speed', label: 'Speed' },
      { id: 'mask', label: 'Shape mask' },
      { id: 'key', label: 'Green screen' },
      { id: 'cutout', label: 'Remove background' },
    ],
  },
  {
    title: 'Pro tools',
    items: [
      { id: 'keyframes', label: 'Keyframes' },
      { id: 'protrim', label: 'Fine trim (roll, slip, slide)' },
      { id: 'soundfx', label: 'Sound effects' },
      { id: 'scenes', label: 'Split into scenes' },
    ],
  },
  {
    title: 'Top bar',
    items: [{ id: 'videos', label: 'Your videos' }],
  },
];

/** Optional services (props the app passes). */
export const SERVICES = [
  { id: 'audioLibrary', label: 'Music and sounds library' },
  { id: 'transcriber', label: 'Auto captions' },
  { id: 'assistant', label: 'AI Assistant' },
  { id: 'backgroundRemover', label: 'Background removal' },
] as const;
export type ServiceId = (typeof SERVICES)[number]['id'];

/** Words the playground lets people change (any label can be, through `labels`). */
export const WORDS: { key: keyof Labels; label: string }[] = [
  { key: 'export', label: 'Export button' },
  { key: 'media', label: 'Media' },
  { key: 'text', label: 'Text' },
  { key: 'audio', label: 'Audio' },
  { key: 'untitledVideo', label: 'New video name' },
];

/** Everything the playground can set. */
export interface Setup {
  mode: Mode;
  colors: Partial<Record<ColorKey, string>>;
  radius: number;
  font: string;
  contrast: 'normal' | 'high' | 'auto';
  density: 'auto' | 'touch' | 'compact';
  size: SizeId;
  custom: { width: number; height: number };
  hide: string[];
  services: Record<ServiceId, boolean>;
  dir: 'ltr' | 'rtl';
  words: Partial<Record<keyof Labels, string>>;
}

export const DEFAULT_SETUP: Setup = {
  mode: 'dark',
  colors: {},
  radius: DEFAULT_RADIUS,
  font: '',
  contrast: 'normal',
  density: 'auto',
  size: 'fill',
  custom: { width: 900, height: 700 },
  hide: [],
  services: { audioLibrary: true, transcriber: true, assistant: true, backgroundRemover: true },
  dir: 'ltr',
  words: {},
};

/** The theme overrides a setup makes. */
export function overridesOf(s: Setup): ThemeOverrides {
  return {
    ...s.colors,
    ...(s.radius !== DEFAULT_RADIUS ? { radius: `${s.radius}px` } : {}),
    ...(s.font ? { fontFamily: s.font } : {}),
  };
}

const TOKEN: Record<keyof ThemeOverrides, string> = {
  accent: '--vu-accent',
  accentHover: '--vu-accent-hover',
  accentContrast: '--vu-accent-contrast',
  accentText: '--vu-accent-text',
  bg: '--vu-bg',
  stage: '--vu-stage',
  surface1: '--vu-surface-1',
  surface2: '--vu-surface-2',
  surface3: '--vu-surface-3',
  text: '--vu-text',
  textMuted: '--vu-text-muted',
  border: '--vu-border',
  fontFamily: '--vu-font-family',
  radius: '--vu-radius-md',
  timelineBg: '--vu-timeline-bg',
};

const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function objectCode(o: Record<string, string>, indent: string): string {
  const entries = Object.entries(o);
  if (entries.length === 0) return '{}';
  const key = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k));
  return `{\n${entries.map(([k, v]) => `${indent}  ${key(k)}: ${quote(v)},`).join('\n')}\n${indent}}`;
}

/** The JSX that gives an app this setup. */
export function propsCode(s: Setup): string {
  const lines: string[] = [];
  if (s.mode !== 'dark') lines.push(`theme="${s.mode}"`);
  const overrides = overridesOf(s) as Record<string, string>;
  if (Object.keys(overrides).length) lines.push(`themeOverrides={${objectCode(overrides, '  ')}}`);
  if (s.contrast !== 'normal') lines.push(`contrast="${s.contrast}"`);
  if (s.density !== 'auto') lines.push(`density="${s.density}"`);
  if (s.dir !== 'ltr') lines.push(`dir="${s.dir}"`);
  const words = Object.fromEntries(Object.entries(s.words).filter(([, v]) => v)) as Record<
    string,
    string
  >;
  if (Object.keys(words).length) lines.push(`labels={${objectCode(words, '  ')}}`);
  if (s.hide.length)
    lines.push(`customize={{ hide: [${s.hide.map((id) => quote(id)).join(', ')}] }}`);
  for (const service of SERVICES) {
    if (s.services[service.id]) lines.push(`${service.id}={${service.id}}`);
  }
  lines.push('onSave={(project) => save(project)}');
  lines.push('onExport={({ blob }) => upload(blob)}');
  return [
    "import { VideoEditor } from '@video-ultra/react';",
    "import '@video-ultra/react/styles.css';",
    '',
    '<VideoEditor',
    ...lines.map((l) => `  ${l}`),
    '/>',
  ].join('\n');
}

/** The same theme as CSS (for apps that theme with a stylesheet). */
export function cssCode(s: Setup): string {
  const overrides = overridesOf(s);
  const keys = Object.keys(overrides) as (keyof ThemeOverrides)[];
  const scope = s.mode === 'auto' ? '.vu-root' : `.vu-root[data-vu-theme='${s.mode}']`;
  if (keys.length === 0) return `/* No colour, corner or font changes yet. */\n${scope} {\n}`;
  return `${scope} {\n${keys.map((k) => `  ${TOKEN[k]}: ${overrides[k]};`).join('\n')}\n}`;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}
