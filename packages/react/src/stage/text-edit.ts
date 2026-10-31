import { transformAt, type TextItem } from '@video-ultra/core';
import { textFont, textFontPx } from '@video-ultra/core/internal';
import type { Box } from './geometry';

/**
 * iOS zooms the page in when a field under 16 px gets focus, so a smaller text's field is laid
 * out at this size and scaled back down with a transform.
 */
const MIN_FIELD_PX = 16;

/**
 * Lays the on-stage text field over a text item: same place, turn, font, size, colour, spacing,
 * outline, shadow and background as the engine draws it, so typing looks like typing into the
 * picture. `box` is the item's box (canvas px) for the text being typed; `scale` is screen px per
 * canvas px. While the field is open the engine hides the item, so only the field shows.
 * Returns the field's size on screen (CSS px, before rotation), which the selection frame follows.
 */
export function placeTextField(
  field: HTMLTextAreaElement,
  item: TextItem,
  box: Box,
  canvasW: number,
  canvasH: number,
  scale: number,
  at: number,
): { width: number; height: number } {
  const tf = item.keyframes ? (transformAt(item, at) ?? item.transform) : item.transform;
  const style = item.style;
  const shownPx = textFontPx({ ...item, transform: tf }, canvasH) * scale;
  // Everything is laid out `up` times larger, then scaled down by the same factor.
  const up = shownPx > 0 && shownPx < MIN_FIELD_PX ? MIN_FIELD_PX / shownPx : 1;
  const fontPx = shownPx * up;
  const pad = style.background ? style.background.padding * fontPx : 0;
  // The drawn text's own width (`box` is measured from the typed text, so it grows with the typing
  // up to a wrapping text's wrap width). A background's padding leaves room for the caret; bare
  // text gets two pixels, and so does wrapping text, so the field's wrap never breaks a line the
  // engine kept whole.
  const wrap = !!item.maxWidth;
  const width = Math.max(fontPx, (box.width * scale + (wrap || !pad ? 2 : 0)) * up);
  const s = field.style;
  s.width = `${width}px`;
  s.font = textFont(style, fontPx);
  s.lineHeight = String(style.lineHeight);
  s.letterSpacing = `${style.letterSpacing}em`;
  s.textAlign = style.align;
  s.color = style.color;
  s.whiteSpace = wrap ? 'pre-wrap' : 'pre';
  s.padding = `${pad}px`;
  s.background = style.background?.color ?? 'transparent';
  s.borderRadius = style.background ? `${style.background.radius * fontPx}px` : '0';
  s.setProperty(
    '-webkit-text-stroke',
    style.outline ? `${style.outline.width * fontPx * 2}px ${style.outline.color}` : '0',
  );
  const k = (canvasH / 1080) * scale * up;
  s.textShadow = style.shadow
    ? `${style.shadow.x * k}px ${style.shadow.y * k}px ${style.shadow.blur * k}px ${style.shadow.color}`
    : 'none';
  // Height follows the typed lines (the field's own wrapping may differ by a line from the
  // engine's balanced one, so measure the field rather than the box).
  s.height = '0px';
  const height = Math.max(box.height * scale * up, field.scrollHeight);
  s.height = `${height}px`;
  // Scaling about the centre keeps the centre on the text's centre.
  s.transform =
    `translate(${box.cx * scale - width / 2}px, ${box.cy * scale - height / 2}px) ` +
    `rotate(${tf.rotation}deg)${up === 1 ? '' : ` scale(${1 / up})`}`;
  return { width: width / up, height: height / up };
}
