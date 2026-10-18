import type { TextItem, TextStyle } from '../model/schema';

/**
 * Text layout shared by the UI (selection boxes) and the engine worker (rasterising), so both
 * agree to the pixel. Units, all relative so text looks the same at every output size:
 *
 * - font size px = `style.size` × canvas height × `transform.scale`
 * - `letterSpacing`: em (× font size), added after every character
 * - `lineHeight`: × font size
 * - `background.padding` / `background.radius`: × font size
 * - `outline.width`: × font size (the visible outline outside the glyphs)
 * - `shadow.blur` / `.x` / `.y`: px at a 1080-px-tall canvas (scaled by canvas height / 1080)
 *
 * The layer box is the text block (widest line × lines × line height) plus the background padding
 * on every side; it is centred on (x × W, y × H) and rotated by `transform.rotation`.
 */

/** Measures `text` drawn with CSS `font` (no letter spacing), in px — e.g. canvas measureText. */
export type MeasureText = (font: string, text: string) => number;

/** The CSS font shorthand for a style at `fontPx`. */
export function textFont(style: TextStyle, fontPx: number): string {
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${fontPx}px ${style.fontFamily}`;
}

/** Font size in px of a text item on a `canvasH`-tall canvas (transform scale included). */
export function textFontPx(item: TextItem, canvasH: number): number {
  return item.style.size * canvasH * item.transform.scale;
}

/** Characters as the user sees them (so emoji and accents count once for letter spacing). */
function charCount(line: string): number {
  return Array.from(line).length;
}

interface BlockLayout {
  lines: string[];
  widths: number[];
  width: number;
  height: number;
  padding: number;
  lineHeightPx: number;
}

/**
 * Breaks a paragraph at spaces so no line is wider than `max` px, with lines about the same
 * length (the narrowest width that still needs no more lines than filling greedily would).
 */
function wrapLine(line: string, max: number, width: (s: string) => number): string[] {
  const words = line.split(/ +/).filter(Boolean);
  if (words.length < 2 || width(line) <= max) return [line];
  const greedy = (limit: number) => {
    const out: string[] = [];
    let current = '';
    for (const w of words) {
      const next = current ? `${current} ${w}` : w;
      if (current && width(next) > limit) {
        out.push(current);
        current = w;
      } else current = next;
    }
    if (current) out.push(current);
    return out;
  };
  const target = greedy(max).length;
  let lo = Math.max(...words.map(width));
  let hi = max;
  for (let i = 0; i < 12 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    if (greedy(mid).length <= target) hi = mid;
    else lo = mid;
  }
  return greedy(hi);
}

function layoutBlock(
  text: string,
  style: TextStyle,
  fontPx: number,
  measure: MeasureText,
  /** Wrap width in the same px as `fontPx` (null: no wrapping). */
  maxWidth: number | null = null,
): BlockLayout {
  const font = textFont(style, fontPx);
  const spacing = style.letterSpacing * fontPx;
  const lineWidth = (line: string) => Math.max(0, measure(font, line) + spacing * charCount(line));
  const padding0 = style.background ? style.background.padding * fontPx : 0;
  const lines =
    maxWidth !== null
      ? text
          .split('\n')
          .flatMap((p) => wrapLine(p, Math.max(fontPx, maxWidth - 2 * padding0), lineWidth))
      : text.split('\n');
  const widths = lines.map(lineWidth);
  const padding = style.background ? style.background.padding * fontPx : 0;
  const lineHeightPx = style.lineHeight * fontPx;
  return {
    lines,
    widths,
    width: Math.max(0, ...widths) + 2 * padding,
    height: lines.length * lineHeightPx + 2 * padding,
    padding,
    lineHeightPx,
  };
}

/**
 * The on-canvas size (px, before rotation) of a text item's box on a `canvasW × canvasH` canvas:
 * the text block plus background padding. Pass a 2D context's measureText as `measure`.
 */
export function measureTextBox(
  item: TextItem,
  canvasW: number,
  canvasH: number,
  measure: MeasureText,
): { width: number; height: number } {
  const block = layoutBlock(
    item.text,
    item.style,
    textFontPx(item, canvasH),
    measure,
    item.maxWidth ? item.maxWidth * canvasW : null,
  );
  return { width: block.width, height: block.height };
}

/** A rasterised text block: the canvas holds the box plus `margin` px on every side. */
export interface TextRaster {
  canvas: OffscreenCanvas;
  /** Extra room around the box for the outline and shadow, in raster px. */
  margin: number;
  /** Box size in raster px. */
  boxWidth: number;
  boxHeight: number;
  /** Where each character and word sits (asked for with `withLayout`, for typewriter reveals). */
  layout?: TextRevealLayout;
}

/** Positions of a raster's characters and words, for typewriter / word-by-word reveals. */
export interface TextRevealLayout {
  /** Raster size, px. */
  width: number;
  height: number;
  /** Top of the first line and the line height, px. */
  top: number;
  lineHeight: number;
  /** Right-to-left text: lines fill from their right end. */
  rtl: boolean;
  lines: {
    /** Left and right end of the line's text, px. */
    left: number;
    right: number;
    /** Characters: start / end x (px from `left`, reading order) of each. */
    charStart: Float64Array;
    charEnd: Float64Array;
    /** Words: start / end x of each (spaces between words belong to neither). */
    wordStart: Float64Array;
    wordEnd: Float64Array;
  }[];
  chars: number;
  words: number;
}

/** Where a reveal is: shown up to `cutA` on `line`, `fadeB` opacity up to `cutB` (fractions). */
export interface RevealCuts {
  line: number;
  cutA: number;
  cutB: number;
  fadeB: number;
}

/**
 * The cut positions of a reveal `fraction` (0…1) of a text's characters or words, as fractions
 * of the raster width (mirrored for right-to-left text), into `out`. Words fade in one after
 * another; characters appear whole.
 */
export function revealCuts(
  layout: TextRevealLayout,
  fraction: number,
  by: 'char' | 'word',
  out: RevealCuts,
): RevealCuts {
  const units = by === 'char' ? layout.chars : layout.words;
  const f = Math.max(0, Math.min(1, fraction)) * units;
  // Characters: the next one appears as soon as its turn starts (the last just before the end).
  // Words: whole ones show, the next fades in over its turn.
  let next = by === 'char' ? Math.ceil(f - 1e-9) : Math.floor(f + 1e-9);
  const partial = by === 'word' ? f - next : 0;
  out.fadeB = 0;
  if (next >= units) {
    out.line = layout.lines.length;
    out.cutA = out.cutB = 1;
    return out;
  }
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!;
    const starts = by === 'char' ? line.charStart : line.wordStart;
    const ends = by === 'char' ? line.charEnd : line.wordEnd;
    if (next >= starts.length) {
      next -= starts.length;
      continue;
    }
    const x0 = starts[next]!;
    const x1 = ends[next]!;
    const w = layout.width;
    if (layout.rtl) {
      out.cutA = (w - line.right + x0) / w;
      out.cutB = (w - line.right + x1) / w;
    } else {
      out.cutA = (line.left + x0) / w;
      out.cutB = (line.left + x1) / w;
    }
    out.line = l;
    out.fadeB = partial;
    return out;
  }
  out.line = layout.lines.length;
  out.cutA = out.cutB = 1;
  return out;
}

/** Splits text into user-perceived characters (grapheme clusters where the engine can). */
function graphemes(text: string): string[] {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg)
    return Array.from(
      new Seg(undefined, { granularity: 'grapheme' }).segment(text),
      (s) => s.segment,
    );
  return Array.from(text);
}

/**
 * Measures where each character and word of the lines of a text block sits (px), with the same
 * maths as the rasteriser: the line's measured prefix widths plus letter spacing.
 */
export function measureReveal(
  lines: readonly string[],
  lefts: readonly number[],
  widths: readonly number[],
  font: string,
  spacingPx: number,
  measure: MeasureText,
  size: { width: number; height: number; top: number; lineHeight: number; rtl: boolean },
): TextRevealLayout {
  let chars = 0;
  let words = 0;
  const out = lines.map((text, i) => {
    const g = graphemes(text);
    const charStart = new Float64Array(g.length);
    const charEnd = new Float64Array(g.length);
    let prefix = '';
    let x = 0;
    g.forEach((ch, k) => {
      charStart[k] = x;
      prefix += ch;
      x = measure(font, prefix) + spacingPx * (k + 1);
      charEnd[k] = x;
    });
    const ws: number[] = [];
    const we: number[] = [];
    let inWord = false;
    g.forEach((ch, k) => {
      const space = /^\s+$/.test(ch);
      if (!space && !inWord) ws.push(charStart[k]!);
      if (space && inWord) we.push(charEnd[k - 1]!);
      inWord = !space;
    });
    if (inWord) we.push(charEnd[g.length - 1]!);
    chars += g.length;
    words += ws.length;
    return {
      left: lefts[i]!,
      right: lefts[i]! + widths[i]!,
      charStart,
      charEnd,
      wordStart: Float64Array.from(ws),
      wordEnd: Float64Array.from(we),
    };
  });
  return { ...size, lines: out, chars, words };
}

const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefe]/;
const MAX_RASTER = 4096;

/**
 * Draws a text item at `fontPx` (raster size) on an `OffscreenCanvas` (worker). `canvasH` is the
 * output canvas height (for the shadow's units); `displayScale` = shown px / raster px.
 * Straight alpha comes from the GPU upload (canvas sources un-premultiply), DECISIONS #39.
 */
/**
 * Caption word highlight drawn into the raster (v0.2 A6): `word` recolours word `word`, `box`
 * puts a box behind it, `fill` recolours the first `chars` characters (spaces included).
 */
export interface TextHighlight {
  mode: 'word' | 'box' | 'fill';
  color: string;
  word: number;
  chars: number;
}

export function rasterizeText(
  item: TextItem,
  fontPx: number,
  canvasH: number,
  displayScale: number,
  withLayout = false,
  highlight: TextHighlight | null = null,
  /** Output canvas width (px), for the wrap width. */
  canvasW = 0,
): TextRaster {
  const style = item.style;
  const probe = new OffscreenCanvas(1, 1).getContext('2d')!;
  const measure: MeasureText = (font, text) => {
    probe.font = font;
    return probe.measureText(text).width;
  };
  const block = layoutBlock(
    item.text,
    style,
    fontPx,
    measure,
    item.maxWidth && canvasW ? (item.maxWidth * canvasW) / displayScale : null,
  );
  const outline = style.outline ? style.outline.width * fontPx : 0;
  const shadowUnit = canvasH / 1080 / displayScale;
  const shadow = style.shadow;
  const shadowReach = shadow
    ? shadow.blur * shadowUnit * 2 + Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) * shadowUnit
    : 0;
  const margin = Math.ceil(outline + shadowReach + 2);
  const w = Math.min(MAX_RASTER, Math.max(1, Math.ceil(block.width + 2 * margin)));
  const h = Math.min(MAX_RASTER, Math.max(1, Math.ceil(block.height + 2 * margin)));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.font = textFont(style, fontPx);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (RTL.test(item.text)) ctx.direction = 'rtl';
  const spacingPx = style.letterSpacing * fontPx;
  const nativeSpacing = 'letterSpacing' in (ctx as object);
  if (nativeSpacing) (ctx as { letterSpacing: string }).letterSpacing = `${spacingPx}px`;

  if (style.background) {
    ctx.fillStyle = style.background.color;
    const r = Math.min(style.background.radius * fontPx, block.width / 2, block.height / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function')
      ctx.roundRect(margin, margin, block.width, block.height, r);
    else ctx.rect(margin, margin, block.width, block.height);
    ctx.fill();
  }

  const contentW = block.width - 2 * block.padding;
  const rtl = RTL.test(item.text);
  // Where each word and character sits (for the highlight; also returned as the layout).
  const spacing = style.letterSpacing * fontPx;
  const layoutOf = () =>
    measureReveal(
      block.lines,
      block.lines.map((_, i) => lineLeft(i)),
      block.widths,
      textFont(style, fontPx),
      spacing,
      measure,
      {
        width: w,
        height: h,
        top: margin + block.padding,
        lineHeight: block.lineHeightPx,
        rtl,
      },
    );
  const lineLeft = (i: number) => {
    const free = contentW - block.widths[i]!;
    return (
      margin +
      block.padding +
      (style.align === 'left' ? 0 : style.align === 'right' ? free : free / 2)
    );
  };
  const drawLine = (line: string, x: number, y: number, stroke: boolean) => {
    if (nativeSpacing || spacingPx === 0) {
      if (stroke) ctx.strokeText(line, x, y);
      else ctx.fillText(line, x, y);
      return;
    }
    // No canvas letterSpacing (older engines): place characters one by one.
    let cx = x;
    for (const ch of line) {
      if (stroke) ctx.strokeText(ch, cx, y);
      else ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + spacingPx;
    }
  };
  const setShadow = (on: boolean) => {
    if (on && shadow) {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur * shadowUnit;
      ctx.shadowOffsetX = shadow.x * shadowUnit;
      ctx.shadowOffsetY = shadow.y * shadowUnit;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  };

  const layout = withLayout || (highlight && !rtl) ? layoutOf() : null;
  // Which line and x-range (px) the highlight covers on each line: [from, to] or null.
  const ranges: ([number, number] | null)[] = block.lines.map(() => null);
  if (highlight && layout) {
    let wordsBefore = 0;
    let charsBefore = 0;
    layout.lines.forEach((ln, i) => {
      const n = ln.wordStart.length;
      const c = ln.charStart.length;
      if (highlight.mode === 'fill') {
        const k = highlight.chars - charsBefore;
        if (k >= c) ranges[i] = [ln.left, ln.right];
        else if (k > 0) {
          const whole = Math.floor(k);
          const x0 = whole > 0 ? ln.charEnd[whole - 1]! : 0;
          const x1 = whole < c ? ln.charEnd[whole]! : x0;
          ranges[i] = [ln.left, ln.left + x0 + (x1 - x0) * (k - whole)];
        }
      } else {
        const k = highlight.word - wordsBefore;
        if (k >= 0 && k < n) ranges[i] = [ln.left + ln.wordStart[k]!, ln.left + ln.wordEnd[k]!];
      }
      wordsBefore += n;
      charsBefore += c;
    });
  }
  if (highlight?.mode === 'box') {
    ctx.fillStyle = highlight.color;
    ranges.forEach((r, i) => {
      if (!r) return;
      const pad = fontPx * 0.14;
      const top =
        margin + block.padding + i * block.lineHeightPx + (block.lineHeightPx - fontPx) / 2;
      ctx.beginPath();
      const bw = r[1] - r[0] + 2 * pad;
      const bh = fontPx + 2 * pad * 0.6;
      if (typeof ctx.roundRect === 'function')
        ctx.roundRect(r[0] - pad, top - pad * 0.6, bw, bh, fontPx * 0.18);
      else ctx.rect(r[0] - pad, top - pad * 0.6, bw, bh);
      ctx.fill();
    });
  }

  block.lines.forEach((line, i) => {
    const x = lineLeft(i);
    const y = margin + block.padding + (i + 0.5) * block.lineHeightPx;
    // The background box carries no shadow; the glyphs (outline first) do.
    if (style.outline && outline > 0) {
      setShadow(true);
      ctx.strokeStyle = style.outline.color;
      ctx.lineWidth = outline * 2;
      ctx.lineJoin = 'round';
      drawLine(line, x, y, true);
      setShadow(false);
    } else {
      setShadow(true);
    }
    ctx.fillStyle = style.color;
    drawLine(line, x, y, false);
    setShadow(false);
    // Word / fill highlight: the same glyphs again in the highlight colour, clipped to its range.
    const r = ranges[i];
    if (r && highlight) {
      // Word / fill: the glyphs again in the highlight colour. Box: the word in a colour that
      // reads on the box (dark on a light box, white on a dark one).
      const color =
        highlight.mode === 'box'
          ? luminance(highlight.color) > 0.55
            ? '#111111'
            : '#ffffff'
          : highlight.color;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r[0], y - block.lineHeightPx, r[1] - r[0], block.lineHeightPx * 2);
      ctx.clip();
      ctx.fillStyle = color;
      drawLine(line, x, y, false);
      ctx.restore();
    }
  });
  const raster: TextRaster = { canvas, margin, boxWidth: block.width, boxHeight: block.height };
  if (withLayout) raster.layout = layout ?? layoutOf();
  return raster;
}

/** Square emoji raster `sizePx` wide (the system's colour emoji font). */
export function rasterizeEmoji(emoji: string, sizePx: number): OffscreenCanvas {
  const side = Math.max(8, Math.min(MAX_RASTER, Math.round(sizePx)));
  const canvas = new OffscreenCanvas(side, side);
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${Math.round(side * 0.82)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, side / 2, side * 0.54);
  return canvas;
}

/**
 * Raster size for a wanted on-screen size: preview rounds to quarter-octave steps (re-rasterising
 * only every ~19 % of zoom, scaled by the GPU in between); export is exact.
 */
export function rasterSize(px: number, exact: boolean): number {
  if (exact || px <= 0) return Math.max(1, px);
  return Math.max(1, 2 ** (Math.round(Math.log2(px) * 4) / 4));
}

/** Relative luminance (0…1) of a #rgb / #rrggbb colour; other colour forms count as dark. */
function luminance(color: string): number {
  const hex = color.trim().replace('#', '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) return 0;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
