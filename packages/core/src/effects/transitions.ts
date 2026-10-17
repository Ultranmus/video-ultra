/**
 * What each transition does to its two clips at a given progress (0…1 over the window; 0.5 = the
 * cut). Pure numbers; the engine turns them into geometry shifts and shader uniforms. The incoming
 * clip is drawn on top of the outgoing one.
 */

/** How one clip of a transition is drawn this frame. */
export interface TransitionLook {
  /** False = don't draw this clip at all this frame. */
  visible: boolean;
  /** Multiplies the clip's opacity. */
  opacity: number;
  /** Scale around the canvas centre. */
  scale: number;
  /** Shift in canvas widths / heights (y down). */
  dx: number;
  dy: number;
  /** Blur strength 0…1 (the engine maps it to a radius). */
  blur: number;
  /** Wipe mask: draw only left of `wipeEdge` (clip space −1…1), soft edge `wipeSoft`. */
  wipe: boolean;
  wipeEdge: number;
  wipeSoft: number;
}

/** A fresh "drawn normally" look. */
export function plainLook(): TransitionLook {
  return {
    visible: true,
    opacity: 1,
    scale: 1,
    dx: 0,
    dy: 0,
    blur: 0,
    wipe: false,
    wipeEdge: 0,
    wipeSoft: 0,
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const WIPE_SOFT = 0.04;

/**
 * The look of the `role` clip of a `type` transition at `progress`, written into `out` (reused).
 * Unknown types play as a dissolve.
 */
export function transitionLook(
  type: string,
  progress: number,
  role: 'out' | 'in',
  out: TransitionLook = plainLook(),
): TransitionLook {
  const p = Math.max(0, Math.min(1, progress));
  const e = smoothstep(0, 1, p);
  out.visible = true;
  out.opacity = 1;
  out.scale = 1;
  out.dx = 0;
  out.dy = 0;
  out.blur = 0;
  out.wipe = false;
  out.wipeEdge = 0;
  out.wipeSoft = 0;
  const isOut = role === 'out';
  switch (type) {
    case 'fade':
      // Through black: the outgoing clip until the cut, then the incoming one; the black comes
      // from fadeOverlay() drawn on top.
      out.visible = isOut ? p < 0.5 : p >= 0.5;
      break;
    case 'slide-left':
      out.dx = isOut ? -e : 1 - e;
      break;
    case 'slide-up':
      out.dy = isOut ? -e : 1 - e;
      break;
    case 'zoom':
      // Zoom through: both pictures grow; the incoming one fades in from half size.
      if (isOut) out.scale = 1 + e;
      else {
        out.scale = 0.5 + 0.5 * e;
        out.opacity = smoothstep(0.15, 0.65, p);
      }
      break;
    case 'wipe':
      if (!isOut) {
        out.wipe = true;
        out.wipeSoft = WIPE_SOFT;
        out.wipeEdge = -1 - WIPE_SOFT + (2 + 2 * WIPE_SOFT) * e;
      }
      break;
    case 'blur':
      if (isOut) {
        out.blur = smoothstep(0, 0.5, p);
        out.opacity = Math.min(1, 2 * (1 - p));
      } else {
        out.blur = 1 - smoothstep(0.5, 1, p);
        out.opacity = smoothstep(0.25, 0.6, p);
      }
      break;
    default:
      // dissolve: the outgoing clip stays solid until the cut, so the mix never dips.
      out.opacity = isOut ? Math.min(1, 2 * (1 - p)) : e;
      break;
  }
  if (out.opacity <= 0) out.visible = false;
  return out;
}

/** Opacity of the black layer a `type` transition draws over the main track (fade: through black). */
export function fadeOverlay(type: string, progress: number): number {
  if (type !== 'fade') return 0;
  const p = Math.max(0, Math.min(1, progress));
  return 1 - Math.abs(2 * p - 1);
}
