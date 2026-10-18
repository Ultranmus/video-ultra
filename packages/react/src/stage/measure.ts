import type { MeasureText } from './geometry';

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

/** Text width in px for a CSS font, measured on a shared offscreen canvas (main thread). */
export const measureText: MeasureText = (font, text) => {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d');
  if (!measureCtx) return text.length * 10;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
};
