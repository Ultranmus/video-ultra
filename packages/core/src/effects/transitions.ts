import type { Direction, Ease } from '../model/schema';
import { BlurMode, MaskShape, noFx, resetFx, WarpKind, type LayerFx } from './colour';
import { TRANSITION_ALIASES, TRANSITION_PRESETS, type TransitionPreset } from './presets';

/**
 * Transitions between main-track clips. Each preset is a small function from progress (0…1 over
 * the window; 0.5 = the cut) to how its two clips are drawn — geometry moves plus the shader's
 * parameterised families (masks, warps, blurs, 3D turns, colour mixes) and an optional full-canvas
 * overlay (dips, light leaks, flashes) drawn above the main track and below every lane. Pure
 * numbers, no allocation: the compositor passes reused objects. One shader serves them all, on
 * both GPU backends. Ids, labels, directions and default curves are the catalogue's
 * (effects/presets.ts, `TRANSITION_PRESETS`); this module only holds the looks.
 */

/** How one clip of a transition is drawn this frame. */
export interface TransitionLook {
  /** False = don't draw this clip at all this frame. */
  visible: boolean;
  /** Multiplies the clip's opacity. */
  opacity: number;
  /** Scale (uniform × per axis) around the pivot. */
  scale: number;
  scaleX: number;
  scaleY: number;
  /** Clockwise degrees around the pivot. */
  rotate: number;
  /** Shift in canvas widths / heights (y down). */
  dx: number;
  dy: number;
  /** Pivot of scale and rotation, canvas fractions (0.5, 0.5 = centre). */
  pivotX: number;
  pivotY: number;
  /** Outgoing clip only: draw it above the incoming one (covers, page turns, doors). */
  onTop: boolean;
  /** Shader extras (masks, warps, blurs, 3D, colour mixes). */
  fx: LayerFx;
}

/** A full-canvas colour layer a transition draws over the main track (below the lanes). */
export interface TransitionOverlay {
  /** 0 = none. */
  opacity: number;
  r: number;
  g: number;
  b: number;
  /** Shader extras (a soft mask makes light leaks and flares). */
  fx: LayerFx;
}

/** Options of one transition (from the project's `Transition`). */
export interface TransitionOptions {
  direction?: Direction | undefined;
  ease?: Ease | undefined;
  /** Canvas width / height (3D depth, aspect-correct shapes). Default 16 / 9. */
  aspect?: number;
  /** Colour of "dip to colour" (RGB 0…1). Default black. */
  colour?: readonly [number, number, number];
}

/** A fresh "drawn normally" look. */
export function plainLook(): TransitionLook {
  return resetLook({ fx: noFx() } as TransitionLook);
}

/** A fresh empty overlay. */
export function noOverlay(): TransitionOverlay {
  return { opacity: 0, r: 0, g: 0, b: 0, fx: noFx() };
}

function resetLook(out: TransitionLook): TransitionLook {
  out.visible = true;
  out.opacity = 1;
  out.scale = 1;
  out.scaleX = 1;
  out.scaleY = 1;
  out.rotate = 0;
  out.dx = 0;
  out.dy = 0;
  out.pivotX = 0.5;
  out.pivotY = 0.5;
  out.onTop = false;
  resetFx(out.fx);
  return out;
}

// ── timing ────────────────────────────────────────────────────────────────

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Hermite smoothstep of x between a and b. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * A timing curve at t (0…1): `linear`; `smooth` (ease in-out); `snappy` (fast through the middle,
 * soft ends); `bounce` (overshoots and settles, like a spring). 0 → 0 and 1 → 1 for all.
 */
export function easeAt(ease: Ease, t: number): number {
  const x = clamp01(t);
  switch (ease) {
    case 'linear':
      return x;
    case 'snappy':
      return x < 0.5 ? 16 * x ** 5 : 1 - (2 - 2 * x) ** 5 / 2;
    case 'bounce':
      return x >= 1 ? 1 : 1 - Math.cos(x * Math.PI * 2.5) * Math.exp(-5 * x) * (1 - x);
    default:
      return x * x * (3 - 2 * x);
  }
}

/** 0 at both ends of the window, 1 at the cut. */
const peak = (p: number) => 1 - Math.abs(2 * p - 1);

/** Deterministic pseudo-random 0…1 for an integer step (jitter, flicker). */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Unit travel vector of a direction (screen, y down). */
export function directionVector(direction: Direction): [number, number] {
  switch (direction) {
    case 'left':
      return [-1, 0];
    case 'right':
      return [1, 0];
    case 'up':
      return [0, -1];
    default:
      return [0, 1];
  }
}

// ── presets ───────────────────────────────────────────────────────────────

/** Everything a preset's function needs this frame. */
interface Ctx {
  /** Raw progress 0…1 (0.5 = cut). */
  p: number;
  /** Eased progress. */
  e: number;
  isOut: boolean;
  /** Travel direction (unit, y down) and its name. */
  dx: number;
  dy: number;
  dir: Direction;
  aspect: number;
  colour: readonly [number, number, number];
  look: TransitionLook;
  /** Set only when the overlay is asked for. */
  overlay: TransitionOverlay | null;
}

interface Spec {
  /** A `TRANSITION_PRESETS` id. */
  id: string;
  look(c: Ctx): void;
  overlay?(c: Ctx, o: TransitionOverlay): void;
}

/** The outgoing clip stays solid until the incoming one is opaque, so the mix never dips. */
function dissolve(c: Ctx, a = 0, b = 1, sharp = false): void {
  const t = sharp ? clamp01((c.p - a) / (b - a)) : smoothstep(a, b, c.p);
  if (c.isOut) c.look.opacity = Math.min(1, (1 - c.p) / Math.max(1e-6, 1 - a));
  else c.look.opacity = t;
}

/** Hard cut at the middle of the window. */
function cutAtMiddle(c: Ctx): void {
  c.look.visible = c.isOut ? c.p < 0.5 : c.p >= 0.5;
}

function push(c: Ctx, e = c.e): void {
  const k = c.isOut ? e : e - 1;
  c.look.dx = c.dx * k;
  c.look.dy = c.dy * k;
}

function solid(o: TransitionOverlay, rgb: readonly [number, number, number], alpha: number): void {
  o.r = rgb[0];
  o.g = rgb[1];
  o.b = rgb[2];
  o.opacity = alpha;
}

function mask(c: Ctx, shape: number, progress: number, soft: number): LayerFx {
  const fx = c.look.fx;
  fx.mask = shape;
  fx.maskProgress = progress;
  fx.maskSoft = soft;
  fx.maskDirX = c.dx;
  fx.maskDirY = c.dy;
  return fx;
}

/** The incoming clip, revealed by a mask; the outgoing one stays underneath. */
function reveal(shape: number, soft: number, extra?: (fx: LayerFx, c: Ctx) => void) {
  return (c: Ctx) => {
    if (c.isOut) return;
    const fx = mask(c, shape, c.e, soft);
    extra?.(fx, c);
  };
}

const WHITE = [1, 1, 1] as const;
const BLACK = [0, 0, 0] as const;
const WARM = [1, 0.62, 0.28] as const;

/** Diagonal travel for a direction: right ↘, left ↖, down ↙, up ↗. */
function diagonal(c: Ctx): void {
  const s = Math.SQRT1_2;
  const [x, y] =
    c.dir === 'right' ? [s, s] : c.dir === 'left' ? [-s, -s] : c.dir === 'down' ? [-s, s] : [s, -s];
  c.dx = x;
  c.dy = y;
}

/** Quick crossfade around the cut (for families whose motion hides the switch). */
function swapAtCut(c: Ctx, width = 0.12): void {
  dissolve(c, 0.5 - width, 0.5 + width);
}

/** 3D turn of this clip: angle in degrees, around a vertical (horizontal travel) or horizontal axis. */
function turn(c: Ctx, angle: number, pivotX: number, pivotY: number, pivotZ: number): void {
  const fx = c.look.fx;
  fx.rotAxis = c.dx !== 0 ? 1 : 2;
  fx.rotAngle = angle;
  fx.rotDistance = 3;
  fx.pivotX = pivotX;
  fx.pivotY = pivotY;
  fx.pivotZ = pivotZ;
  // Faces turned away get darker.
  fx.flash = 0.55 * Math.abs(Math.sin((angle * Math.PI) / 180));
}

// prettier-ignore
const SPECS: readonly Spec[] = [
  // ── Basic ──
  { id: 'fade',
    look: cutAtMiddle,
    overlay: (c, o) => solid(o, BLACK, peak(c.e)) },
  { id: 'dissolve',
    look: (c) => {
      if (c.isOut) c.look.opacity = Math.min(1, 2 * (1 - c.p));
      else c.look.opacity = c.e;
    } },
  { id: 'dip-white',
    look: cutAtMiddle,
    overlay: (c, o) => solid(o, WHITE, peak(c.e)) },
  { id: 'dip-color',
    look: cutAtMiddle,
    overlay: (c, o) => solid(o, c.colour, peak(c.e)) },
  { id: 'flash',
    look: cutAtMiddle,
    overlay: (c, o) => solid(o, WHITE, peak(c.e) ** 3) },
  { id: 'luma-dissolve',
    look: (c) => {
      if (!c.isOut) mask(c, MaskShape.luma, c.e, 0.25);
    } },
  { id: 'additive',
    look: (c) => {
      c.look.opacity = c.isOut ? 1 - c.e : c.e;
      c.look.fx.flash = 0.35 * peak(c.p);
      c.look.fx.flashR = c.look.fx.flashG = c.look.fx.flashB = 1;
    } },

  // ── Slide ──
  { id: 'push',
    look: (c) => push(c) },
  { id: 'cover',
    look: (c) => {
      if (!c.isOut) push(c);
    } },
  { id: 'reveal',
    look: (c) => {
      if (c.isOut) {
        c.look.onTop = true;
        push(c);
      }
    } },
  { id: 'slide-fade',
    look: (c) => {
      if (c.isOut) {
        c.look.dx = c.dx * c.e * 0.08;
        c.look.dy = c.dy * c.e * 0.08;
        c.look.opacity = Math.min(1, 2 * (1 - c.p));
      } else {
        c.look.dx = c.dx * (c.e - 1) * 0.25;
        c.look.dy = c.dy * (c.e - 1) * 0.25;
        c.look.opacity = smoothstep(0, 0.7, c.p);
      }
    } },
  { id: 'elastic-slide',
    look: (c) => push(c) },
  { id: 'whip',
    look: (c) => {
      push(c);
      lineBlur(c.look.fx, c.dx, c.dy, 0.35 * peak(c.p) ** 1.5);
    } },
  { id: 'swipe',
    look: (c) => {
      push(c);
      c.look.scale = 1 - 0.15 * Math.sin(Math.PI * c.p);
    } },
  { id: 'stack',
    look: (c) => {
      if (c.isOut) {
        c.look.scale = 1 - 0.12 * c.e;
        c.look.fx.flash = 0.5 * c.e;
      } else push(c);
    } },

  // ── Wipe ──
  { id: 'wipe',
    look: reveal(MaskShape.linear, 0.04) },
  { id: 'wipe-soft',
    look: reveal(MaskShape.linear, 0.3) },
  { id: 'wipe-diagonal',
    look: (c) => {
      diagonal(c);
      reveal(MaskShape.linear, 0.05)(c);
    } },
  { id: 'clock',
    look: reveal(MaskShape.clock, 0.01) },
  { id: 'circle-open',
    look: reveal(MaskShape.circle, 0.03) },
  { id: 'circle-close',
    look: (c) => {
      if (!c.isOut) return;
      c.look.onTop = true;
      mask(c, MaskShape.circle, 1 - c.e, 0.03);
    } },
  { id: 'diamond',
    look: reveal(MaskShape.diamond, 0.03) },
  { id: 'box',
    look: reveal(MaskShape.rect, 0.02) },
  { id: 'blinds',
    look: reveal(MaskShape.blinds, 0.03, (fx) => (fx.maskCount = 8)) },
  { id: 'checker',
    look: reveal(MaskShape.checker, 0.03, (fx) => (fx.maskCount = 6)) },
  { id: 'split',
    look: reveal(MaskShape.split, 0.02) },
  { id: 'barn-doors',
    look: (c) => {
      if (c.isOut) return;
      const fx = mask(c, MaskShape.split, 1 - c.e, 0.02);
      fx.maskInvert = true;
    } },
  { id: 'zigzag',
    look: reveal(MaskShape.zigzag, 0.01, (fx) => {
      fx.maskCount = 10;
      fx.maskCX = 0.12;
    }) },
  { id: 'wave-wipe',
    look: reveal(MaskShape.zigzag, 0.02, (fx, c) => {
      fx.maskCount = 4;
      fx.maskCX = 0.1;
      fx.maskPoly = 1;
      fx.maskCY = c.p * 6;
    }) },
  { id: 'fan',
    look: reveal(MaskShape.fan, 0.01) },

  // ── Zoom ──
  { id: 'zoom',
    look: (c) => {
      if (c.isOut) c.look.scale = 1 + c.e;
      else {
        c.look.scale = 0.5 + 0.5 * c.e;
        c.look.opacity = smoothstep(0.15, 0.65, c.p);
      }
    } },
  { id: 'zoom-in',
    look: (c) => {
      if (c.isOut) {
        c.look.scale = 1 + 0.6 * c.e;
        radialBlur(c.look.fx, 0.25 * c.e);
      } else c.look.opacity = smoothstep(0.25, 0.75, c.p);
    } },
  { id: 'zoom-out',
    look: (c) => {
      if (c.isOut) c.look.scale = 1 - 0.35 * c.e;
      else {
        c.look.scale = 1.4 - 0.4 * c.e;
        c.look.opacity = smoothstep(0.2, 0.7, c.p);
      }
    } },
  { id: 'zoom-blur',
    look: (c) => {
      c.look.scale = c.isOut ? 1 + 0.5 * c.e : 0.7 + 0.3 * c.e;
      radialBlur(c.look.fx, 0.3 * peak(c.p));
      swapAtCut(c);
    } },
  { id: 'spin-zoom',
    look: (c) => {
      const s = c.dir === 'left' ? -1 : 1;
      c.look.rotate = s * (c.isOut ? 90 * c.e : 90 * (c.e - 1));
      c.look.scale = c.isOut ? 1 + c.e : 0.5 + 0.5 * c.e;
      spinBlur(c.look.fx, s * 0.25 * peak(c.p));
      swapAtCut(c);
    } },
  { id: 'rotate',
    look: (c) => {
      if (c.isOut) return;
      const s = c.dir === 'left' ? -1 : 1;
      c.look.rotate = s * 30 * (c.e - 1);
      c.look.scale = 1.4 - 0.4 * c.e;
      c.look.opacity = smoothstep(0, 0.6, c.p);
    } },
  { id: 'swirl',
    look: (c) => {
      const fx = c.look.fx;
      fx.warp = WarpKind.swirl;
      fx.warpAmount = (c.dir === 'left' ? -1 : 1) * 6 * peak(c.p) ** 1.5;
      fx.warpFreq = 1.6;
      swapAtCut(c, 0.15);
    } },
  { id: 'punch',
    look: (c) => {
      cutAtMiddle(c);
      c.look.scale = c.isOut ? 1 + 0.3 * smoothstep(0, 0.5, c.e) : 1.15 - 0.15 * smoothstep(0.5, 1, c.e);
    },
    overlay: (c, o) => solid(o, WHITE, 0.35 * peak(c.p) ** 4) },
  { id: 'pop-in',
    look: (c) => {
      if (c.isOut) return;
      c.look.scale = Math.max(0.001, c.e);
      c.look.opacity = smoothstep(0, 0.15, c.p);
    } },
  { id: 'shrink',
    look: (c) => {
      if (!c.isOut) return;
      c.look.onTop = true;
      c.look.scale = Math.max(0.001, 1 - c.e);
    } },

  // ── Blur ──
  { id: 'blur',
    look: (c) => {
      const fx = c.look.fx;
      const k = c.isOut ? smoothstep(0, 0.5, c.p) : 1 - smoothstep(0.5, 1, c.p);
      fx.blurX = fx.blurY = 0.02 * k;
      c.look.opacity = c.isOut ? Math.min(1, 2 * (1 - c.p)) : smoothstep(0.25, 0.6, c.p);
    } },
  { id: 'motion-blur',
    look: (c) => {
      lineBlur(c.look.fx, c.dx, c.dy, 0.3 * peak(c.p));
      c.look.dx = c.dx * 0.04 * (c.isOut ? c.e : c.e - 1);
      c.look.dy = c.dy * 0.04 * (c.isOut ? c.e : c.e - 1);
      swapAtCut(c, 0.15);
    } },
  { id: 'radial-blur',
    look: (c) => {
      radialBlur(c.look.fx, 0.3 * peak(c.p));
      swapAtCut(c, 0.15);
    } },
  { id: 'spin-blur',
    look: (c) => {
      spinBlur(c.look.fx, (c.dir === 'left' ? -1 : 1) * 0.3 * peak(c.p));
      swapAtCut(c, 0.15);
    } },
  { id: 'focus',
    look: (c) => {
      const fx = c.look.fx;
      fx.blurX = fx.blurY = 0.025 * peak(c.p);
      c.look.scale = 1 + 0.06 * peak(c.p);
      swapAtCut(c, 0.1);
    } },

  // ── Light ──
  { id: 'light-leak',
    look: (c) => dissolve(c, 0.25, 0.75),
    overlay: (c, o) => {
      solid(o, WARM, 0.85 * Math.sin(Math.PI * c.p));
      const fx = o.fx;
      fx.mask = MaskShape.circle;
      fx.maskProgress = 0.55;
      fx.maskSoft = 0.6;
      fx.maskCX = (c.dir === 'left' ? 1 : -1) * c.aspect * (1.2 - 2.4 * c.e);
      fx.maskCY = -0.4 + 0.6 * c.e;
    } },
  { id: 'glow',
    look: (c) => {
      swapAtCut(c, 0.2);
      c.look.fx.flash = 0.4 * peak(c.p) ** 2;
      c.look.fx.flashR = c.look.fx.flashG = c.look.fx.flashB = 1;
    },
    overlay: (c, o) => {
      solid(o, [1, 0.97, 0.9], peak(c.p) ** 2);
      o.fx.mask = MaskShape.circle;
      o.fx.maskProgress = 0.35;
      o.fx.maskSoft = 0.8;
    } },
  { id: 'overexpose',
    look: (c) => {
      cutAtMiddle(c);
      const fx = c.look.fx;
      fx.flash = peak(c.e) ** 1.5;
      fx.flashR = 1;
      fx.flashG = 1;
      fx.flashB = 0.95;
      fx.blurX = fx.blurY = 0.008 * peak(c.p);
    } },
  { id: 'film-burn',
    look: (c) => dissolve(c, 0.4, 0.6),
    overlay: (c, o) => {
      solid(o, [1, 0.45, 0.12], 0.95 * Math.sin(Math.PI * c.p));
      const fx = o.fx;
      fx.mask = MaskShape.linear;
      fx.maskDirX = c.dir === 'left' ? -1 : 1;
      fx.maskDirY = 0;
      fx.maskProgress = 0.15 + 0.9 * c.e;
      fx.maskSoft = 0.45;
      fx.flash = 0.6 * peak(c.p) ** 3;
      fx.flashR = fx.flashG = 1;
      fx.flashB = 0.8;
    } },
  { id: 'flare',
    look: (c) => dissolve(c, 0.35, 0.65),
    overlay: (c, o) => {
      solid(o, [1, 0.92, 0.78], 0.9 * Math.sin(Math.PI * c.p));
      const fx = o.fx;
      fx.mask = MaskShape.split;
      fx.maskDirX = 1;
      fx.maskDirY = 0;
      fx.maskProgress = 0.12;
      fx.maskSoft = 0.5;
      fx.maskCX = (c.dir === 'left' ? 1 : -1) * c.aspect * (1.3 - 2.6 * c.e);
    } },
  { id: 'strobe',
    look: cutAtMiddle,
    overlay: (c, o) => solid(o, WHITE, Math.floor(c.p * 9) % 2 === 1 ? 0.9 * Math.sin(Math.PI * c.p) : 0) },

  // ── Glitch ──
  { id: 'rgb-split',
    look: (c) => {
      cutAtMiddle(c);
      const k = peak(c.p);
      c.look.fx.split = 0.08 * k;
      c.look.dx = (hash(Math.floor(c.p * 14)) - 0.5) * 0.03 * k;
    } },
  { id: 'pixelate',
    look: (c) => {
      cutAtMiddle(c);
      const fx = c.look.fx;
      const steps = Math.round(peak(c.p) * 6);
      if (steps > 0) {
        fx.warp = WarpKind.pixelate;
        fx.warpAmount = 0.012 * 2 ** steps * 0.25;
      }
    } },
  { id: 'vhs',
    look: (c) => {
      swapAtCut(c, 0.08);
      const k = peak(c.p);
      const fx = c.look.fx;
      fx.warp = WarpKind.glitch;
      fx.warpAmount = 0.06 * k;
      fx.warpFreq = 48;
      fx.warpPhase = Math.floor(c.p * 24);
      fx.split = 0.025 * k;
    } },
  { id: 'noise-dissolve',
    look: reveal(MaskShape.noise, 0.04, (fx) => (fx.maskCount = 90)) },
  { id: 'glitch',
    look: (c) => {
      const step = Math.floor(c.p * 20);
      const showIn = c.p >= 0.5 ? hash(step) > 0.2 || c.p > 0.7 : hash(step) > 0.75 && c.p > 0.3;
      c.look.visible = c.isOut ? !showIn : showIn;
      const k = peak(c.p);
      const fx = c.look.fx;
      fx.warp = WarpKind.glitch;
      fx.warpAmount = 0.16 * k;
      fx.warpFreq = 10;
      fx.warpPhase = step;
      fx.split = 0.05 * k;
    } },
  { id: 'digital',
    look: reveal(MaskShape.noise, 0.005, (fx) => (fx.maskCount = 14)) },
  { id: 'static',
    look: (c) => dissolve(c, 0.4, 0.6),
    overlay: (c, o) => {
      solid(o, [0.85, 0.85, 0.85], 0.9 * peak(c.p) ** 0.7);
      const fx = o.fx;
      fx.mask = MaskShape.noise;
      fx.maskCount = 260;
      fx.maskProgress = 0.5;
      fx.maskSoft = 0.3;
      fx.maskCY = Math.floor(c.p * 60);
    } },

  // ── Shape ──
  { id: 'heart',
    look: reveal(MaskShape.heart, 0.02) },
  { id: 'star',
    look: reveal(MaskShape.polar, 0.02, (fx) => (fx.maskPoly = 0)) },
  { id: 'spotlight',
    look: reveal(MaskShape.circle, 0.35) },
  { id: 'flower',
    look: reveal(MaskShape.polar, 0.02, (fx) => (fx.maskPoly = 1)) },
  { id: 'hexagon',
    look: reveal(MaskShape.polar, 0.02, (fx) => (fx.maskPoly = 2)) },
  { id: 'triangle',
    look: reveal(MaskShape.polar, 0.02, (fx) => (fx.maskPoly = 3)) },

  // ── Distort ──
  { id: 'ripple',
    look: (c) => {
      const fx = c.look.fx;
      fx.warp = WarpKind.ripple;
      fx.warpAmount = 0.04 * peak(c.p);
      fx.warpFreq = 28;
      fx.warpPhase = c.p * 24;
      swapAtCut(c, 0.2);
    } },
  { id: 'wave',
    look: (c) => {
      const fx = c.look.fx;
      fx.warp = WarpKind.wave;
      fx.warpAmount = 0.06 * peak(c.p);
      fx.warpFreq = 7;
      fx.warpPhase = c.p * 14;
      fx.warpDirX = c.dx;
      fx.warpDirY = c.dy;
      swapAtCut(c, 0.15);
    } },
  { id: 'page-curl',
    look: (c) => {
      if (!c.isOut) return;
      diagonalFrom(c);
      c.look.onTop = true;
      const fx = mask(c, MaskShape.linear, 1 - c.e, 0.008);
      fx.maskInvert = false;
      fx.maskDirX = -c.dx;
      fx.maskDirY = -c.dy;
      fx.maskShade = -0.55;
      fx.maskShadeWidth = 0.08;
    } },
  { id: 'squeeze',
    look: (c) => {
      // The outgoing clip folds into the edge it travels to; the incoming one unfolds from the
      // opposite edge, so together they fill the canvas.
      const k = c.isOut ? 1 - c.e : c.e;
      const toward = c.isOut ? 1 : -1;
      if (c.dx !== 0) {
        c.look.scaleX = Math.max(0.001, k);
        c.look.pivotX = 0.5 + 0.5 * toward * c.dx;
      } else {
        c.look.scaleY = Math.max(0.001, k);
        c.look.pivotY = 0.5 + 0.5 * toward * c.dy;
      }
    } },
  { id: 'stretch',
    look: (c) => {
      const k = c.isOut ? 1 + 1.5 * c.e : 2.5 - 1.5 * c.e;
      const toward = c.isOut ? -1 : 1;
      if (c.dx !== 0) {
        c.look.scaleX = k;
        c.look.pivotX = 0.5 + 0.5 * toward * c.dx;
      } else {
        c.look.scaleY = k;
        c.look.pivotY = 0.5 + 0.5 * toward * c.dy;
      }
      lineBlur(c.look.fx, c.dx, c.dy, 0.12 * peak(c.p));
      swapAtCut(c, 0.15);
    } },
  { id: 'lens',
    look: (c) => {
      const fx = c.look.fx;
      fx.warp = WarpKind.bulge;
      fx.warpAmount = 0.7 * peak(c.p);
      fx.warpFreq = 1.4;
      swapAtCut(c, 0.15);
    } },
  { id: 'shake',
    look: (c) => {
      swapAtCut(c, 0.06);
      const k = peak(c.p);
      const step = Math.floor(c.p * 30);
      const jx = (hash(step) - 0.5) * 0.06 * k;
      const jy = (hash(step + 101) - 0.5) * 0.06 * k;
      c.look.dx = jx;
      c.look.dy = jy;
      c.look.scale = 1 + 0.06 * k;
      const len = Math.hypot(jx, jy);
      if (len > 0) lineBlur(c.look.fx, jx / len, jy / len, len * 1.5);
    } },

  // ── 3D ──
  { id: 'cube',
    look: (c) => {
      // Faces of a cube turning about its centre (behind the screen).
      const t = c.isOut ? c.e : c.e - 1;
      const horizontal = c.dx !== 0;
      const sign = horizontal ? (c.dx < 0 ? 1 : -1) : c.dy < 0 ? 1 : -1;
      const depth = horizontal ? c.aspect : 1;
      turn(c, sign * 90 * t, 0, 0, depth);
    } },
  { id: 'flip',
    look: (c) => {
      cutAtMiddle(c);
      const horizontal = c.dx !== 0;
      const sign = horizontal ? (c.dx < 0 ? 1 : -1) : c.dy < 0 ? 1 : -1;
      const angle = c.isOut ? 180 * Math.min(c.e, 0.5) : 180 * (Math.max(c.e, 0.5) - 1);
      turn(c, sign * angle, 0, 0, 0);
    } },
  { id: 'door',
    look: (c) => {
      if (!c.isOut) return;
      c.look.onTop = true;
      // Hinged on the edge it swings towards; it turns away from the viewer.
      const horizontal = c.dx !== 0;
      const hinge = horizontal ? c.dx * c.aspect : c.dy;
      const angle = 92 * c.e * (horizontal ? Math.sign(c.dx) : -Math.sign(c.dy));
      turn(c, angle, horizontal ? hinge : 0, horizontal ? 0 : hinge, 0);
      c.look.opacity = 1 - smoothstep(0.75, 1, c.p);
    } },
  { id: 'tilt',
    look: (c) => {
      const horizontal = c.dx !== 0;
      const sign = horizontal ? -Math.sign(c.dx) : Math.sign(c.dy);
      if (c.isOut) {
        turn(c, sign * 60 * c.e, 0, 0, 0);
        c.look.scale = 1 - 0.3 * c.e;
        c.look.opacity = 1 - smoothstep(0.4, 0.8, c.p);
      } else {
        turn(c, sign * 40 * (c.e - 1), 0, 0, 0);
        c.look.scale = 1.2 - 0.2 * c.e;
        c.look.opacity = smoothstep(0.3, 0.7, c.p);
      }
    } },
  { id: 'swing',
    look: (c) => {
      if (c.isOut) return;
      // Hinged on the edge it comes from, swinging in from edge-on.
      const horizontal = c.dx !== 0;
      const hinge = horizontal ? -c.dx * c.aspect : -c.dy;
      const angle = 88 * (1 - c.e) * (horizontal ? -Math.sign(c.dx) : Math.sign(c.dy));
      turn(c, angle, horizontal ? hinge : 0, horizontal ? 0 : hinge, 0);
      c.look.opacity = smoothstep(0, 0.2, c.p);
    } },
];

/** Blur along a screen direction (unit vector), `length` in screen units (0 = sharp). */
function lineBlur(fx: LayerFx, x: number, y: number, length: number): void {
  fx.blurMode = BlurMode.line;
  fx.blurX = length;
  fx.blurDirX = x;
  fx.blurDirY = y;
}

function radialBlur(fx: LayerFx, amount: number): void {
  fx.blurMode = BlurMode.radial;
  fx.blurX = amount;
}

function spinBlur(fx: LayerFx, radians: number): void {
  fx.blurMode = BlurMode.spin;
  fx.blurX = radians;
}

/** Page turns peel diagonally: the travel direction tilted 30°. */
function diagonalFrom(c: Ctx): void {
  const a = Math.PI / 6;
  const x = c.dx * Math.cos(a) - c.dy * Math.sin(a);
  const y = c.dx * Math.sin(a) + c.dy * Math.cos(a);
  c.dx = x;
  c.dy = y;
}

const BY_ID = new Map(SPECS.map((s) => [s.id, s]));
/** Ids that have a look (tests check they match the catalogue). */
export const TRANSITION_LOOK_IDS: readonly string[] = SPECS.map((s) => s.id);
const PRESET_BY_ID = new Map(TRANSITION_PRESETS.map((p) => [p.id, p]));

const fallback = BY_ID.get('dissolve')!;
const fallbackPreset = PRESET_BY_ID.get('dissolve')!;
const ctx: Ctx = {
  p: 0,
  e: 0,
  isOut: true,
  dx: 1,
  dy: 0,
  dir: 'right',
  aspect: 16 / 9,
  colour: BLACK,
  look: null as unknown as TransitionLook,
  overlay: null,
};

function prepare(
  type: string,
  progress: number,
  role: 'out' | 'in',
  options: TransitionOptions,
): Spec {
  const alias = TRANSITION_ALIASES[type];
  const id = alias?.id ?? type;
  const spec = BY_ID.get(id) ?? fallback;
  const preset: TransitionPreset = PRESET_BY_ID.get(spec.id) ?? fallbackPreset;
  const p = clamp01(progress);
  const direction =
    (options.direction && preset.directions?.includes(options.direction)
      ? options.direction
      : null) ??
    alias?.direction ??
    preset.directions?.[0] ??
    'right';
  const [dx, dy] = directionVector(direction);
  ctx.p = p;
  ctx.e = easeAt(options.ease ?? preset.ease, p);
  ctx.isOut = role === 'out';
  ctx.dir = direction;
  ctx.dx = dx;
  ctx.dy = dy;
  ctx.aspect = options.aspect ?? 16 / 9;
  ctx.colour = options.colour ?? BLACK;
  return spec;
}

const NO_OPTIONS: TransitionOptions = {};

/**
 * The look of the `role` clip of a `type` transition at `progress`, written into `out` (reused).
 * Unknown types play as a dissolve.
 */
export function transitionLook(
  type: string,
  progress: number,
  role: 'out' | 'in',
  out: TransitionLook = plainLook(),
  options: TransitionOptions = NO_OPTIONS,
): TransitionLook {
  const spec = prepare(type, progress, role, options);
  resetLook(out);
  ctx.look = out;
  ctx.overlay = null;
  spec.look(ctx);
  ctx.look = null as unknown as TransitionLook;
  if (out.opacity <= 0) out.visible = false;
  return out;
}

/** The full-canvas overlay of a `type` transition at `progress`, into `out` (opacity 0 = none). */
export function transitionOverlay(
  type: string,
  progress: number,
  out: TransitionOverlay = noOverlay(),
  options: TransitionOptions = NO_OPTIONS,
): TransitionOverlay {
  const spec = prepare(type, progress, 'in', options);
  out.opacity = 0;
  out.r = out.g = out.b = 0;
  resetFx(out.fx);
  if (spec.overlay) spec.overlay(ctx, out);
  out.opacity = clamp01(out.opacity);
  return out;
}

/** Opacity of the black layer a `type` transition draws over the main track (fade: through black). */
export function fadeOverlay(type: string, progress: number): number {
  if (type !== 'fade') return 0;
  return transitionOverlay(type, progress, scratchOverlay).opacity;
}
const scratchOverlay = noOverlay();
