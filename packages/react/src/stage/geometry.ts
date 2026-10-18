import { itemEnd, type Item, type Project, type Time } from '@video-ultra/core';
import { measureTextBox, type MeasureText } from '@video-ultra/core/internal';

/** A layer's box on the canvas, in canvas pixels: centre, size, clockwise rotation (degrees). */
export interface Box {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

/** Measures a string's width in px for a CSS font (canvas 2D measureText on the main thread). */
export type { MeasureText };

/** Where an item draws on a `canvasW × canvasH` canvas, or null for audio. */
export function itemBox(
  item: Item,
  project: Project,
  canvasW: number,
  canvasH: number,
  measure: MeasureText,
): Box | null {
  if (item.kind === 'audio') return null;
  const tf = item.transform;
  const box = (width: number, height: number): Box => ({
    cx: tf.x * canvasW,
    cy: tf.y * canvasH,
    width,
    height,
    rotation: tf.rotation,
  });
  if (item.kind === 'text') {
    const size = measureTextBox(item, canvasW, canvasH, measure);
    return box(size.width, size.height);
  }
  if (item.kind === 'sticker' && item.emoji !== null) {
    const side = Math.min(canvasW, canvasH) * tf.scale;
    return box(side, side);
  }
  if (item.kind === 'region')
    return box(item.width * canvasW * tf.scale, item.height * canvasH * tf.scale);
  const asset = item.assetId ? project.assets[item.assetId] : undefined;
  const aw = asset?.width ?? canvasW;
  const ah = asset?.height ?? canvasH;
  const crop = 'crop' in item ? item.crop : { left: 0, right: 0, top: 0, bottom: 0 };
  const cw = aw * Math.max(1e-6, 1 - crop.left - crop.right);
  const ch = ah * Math.max(1e-6, 1 - crop.top - crop.bottom);
  const fill = 'fit' in item && item.fit === 'fill';
  const base = fill ? Math.max(canvasW / cw, canvasH / ch) : Math.min(canvasW / cw, canvasH / ch);
  return box(cw * base * tf.scale, ch * base * tf.scale);
}

/** Point (canvas px) inside a rotated box? */
export function boxContains(box: Box, x: number, y: number, slop = 0): boolean {
  const rad = (-box.rotation * Math.PI) / 180;
  const dx = x - box.cx;
  const dy = y - box.cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= box.width / 2 + slop && Math.abs(ly) <= box.height / 2 + slop;
}

/**
 * Visual items on screen at `t`, topmost first (lanes later in the list draw on top). Hidden items
 * aren't on screen.
 */
export function visibleItemsAt(project: Project, t: Time): Item[] {
  const out: Item[] = [];
  for (const track of project.tracks) {
    if (track.hidden || track.kind === 'audio') continue;
    for (const item of track.items) {
      if (!item.hidden && item.start <= t && t < itemEnd(item)) out.push(item);
    }
  }
  return out.reverse();
}

/** The topmost item under (x, y) at time `t`. */
export function hitStage(
  project: Project,
  t: Time,
  canvasW: number,
  canvasH: number,
  x: number,
  y: number,
  measure: MeasureText,
  slop: number,
): Item | null {
  for (const item of visibleItemsAt(project, t)) {
    const box = itemBox(item, project, canvasW, canvasH, measure);
    if (box && boxContains(box, x, y, slop)) return item;
  }
  return null;
}

/** Snaps a centre coordinate (fraction) to the canvas centre when within `threshold`. */
export function snapCentre(value: number, threshold: number): { value: number; snapped: boolean } {
  return Math.abs(value - 0.5) <= threshold
    ? { value: 0.5, snapped: true }
    : { value, snapped: false };
}
