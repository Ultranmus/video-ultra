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

function layoutBlock(
  text: string,
  style: TextStyle,
  fontPx: number,
  measure: MeasureText,
): BlockLayout {
  const font = textFont(style, fontPx);
  const lines = text.split('\n');
  const spacing = style.letterSpacing * fontPx;
  const widths = lines.map((line) => Math.max(0, measure(font, line) + spacing * charCount(line)));
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
  void canvasW; // positions are relative; the size only depends on the height
  const block = layoutBlock(item.text, item.style, textFontPx(item, canvasH), measure);
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
}

const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefe]/;
const MAX_RASTER = 4096;

/**
 * Draws a text item at `fontPx` (raster size) on an `OffscreenCanvas` (worker). `canvasH` is the
 * output canvas height (for the shadow's units); `displayScale` = shown px / raster px.
 * Straight alpha comes from the GPU upload (canvas sources un-premultiply), DECISIONS #39.
 */
export function rasterizeText(
  item: TextItem,
  fontPx: number,
  canvasH: number,
  displayScale: number,
): TextRaster {
  const style = item.style;
  const probe = new OffscreenCanvas(1, 1).getContext('2d')!;
  const measure: MeasureText = (font, text) => {
    probe.font = font;
    return probe.measureText(text).width;
  };
  const block = layoutBlock(item.text, style, fontPx, measure);
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

  block.lines.forEach((line, i) => {
    const lineW = block.widths[i]!;
    const free = contentW - lineW;
    const x =
      margin +
      block.padding +
      (style.align === 'left' ? 0 : style.align === 'right' ? free : free / 2);
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
  });
  return { canvas, margin, boxWidth: block.width, boxHeight: block.height };
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
