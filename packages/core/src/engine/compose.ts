import type { Input, InputVideoTrack, VideoSample } from 'mediabunny';
import {
  animationState,
  resetState,
  restingState,
  type AnimationState,
} from '../effects/animations';
import {
  captionWordTimes,
  charsWithSpaces,
  speechAt,
  type SpeechPosition,
} from '../captions/timing';
import {
  BLEND_IDS,
  colourParams,
  EFFECT_FLOATS,
  identityColour,
  isIdentityColour,
  isNoFx,
  isNoPictureFx,
  keyParams,
  MaskShape,
  noFx,
  noPictureFx,
  resetFx,
  resetPictureFx,
  writeEffects,
  type ColourParams,
  type LayerFx,
  type PictureFx,
} from '../effects/colour';
import type { CubeLut } from '../effects/lut';
import {
  noOverlay,
  plainLook,
  transitionLook,
  transitionOverlay,
  type TransitionLook,
  type TransitionOptions,
} from '../effects/transitions';
import { NO_CROP } from '../model/project';
import type {
  Adjust,
  CaptionWord,
  Item,
  ItemAnimation,
  Project,
  TextItem,
  TextStyle,
  Transform,
} from '../model/schema';
import { FLICKS_PER_SECOND, frameIndex, type Time } from '../model/time';
import {
  fullCanvasGeometry,
  layerGeometry,
  moveInBox,
  moveOnCanvas,
  placedGeometry,
  type LayerMedia,
} from '../render/layout';
import type { Backdrop, LayerDraw, LayerSource, Renderer } from '../render/types';
import { FrameSource, type DecoderPool } from './frames';
import { RasterCache } from './rasters';
import {
  rasterizeEmoji,
  rasterizeText,
  rasterSize,
  revealCuts,
  textFontPx,
  type RevealCuts,
  type TextHighlight,
  type TextRevealLayout,
} from './text';
import { activeLayers, type ActiveLayer } from './timeline';

/**
 * Builds and draws one frame of a project: gathers each layer's picture (decoded video frames,
 * photos, text and emoji rasters), applies filters, adjustments and transitions, and the blurred
 * background. Preview, capture and export each own one `Composer` (own decoders, own renderer):
 *
 * - preview (`exact = false`): waits for decoded frames only until a deadline; late layers reuse
 *   their previous picture (DECISIONS #40); text rasters are rounded to size steps.
 * - export / capture (`exact = true`): waits for every exact frame; rasters are exact.
 */

/** A loaded video asset. */
export interface VideoMedia {
  input: Input;
  track: InputVideoTrack;
  media: LayerMedia;
  hdr: boolean;
}

/** The media every composer reads (shared; GPU copies are per renderer). */
export interface MediaLibrary {
  videos: Map<string, Promise<VideoMedia>>;
  images: Map<string, Promise<ImageBitmap>>;
  /** Parsed `.cube` LUT files by asset id. */
  luts: Map<string, Promise<CubeLut>>;
}

/** Result of one {@link Composer.render}. */
export interface ComposeResult {
  /** Requests still decoding (preview only; empty = the frame was exact). */
  pending: Promise<unknown>[];
  /** At least one layer reused its previous picture. */
  late: boolean;
  /** Exact mode: a layer had no picture at all (decode failed). */
  missing: number;
  gatherMs: number;
  drawMs: number;
  layers: number;
}

/** The blurred background is enlarged a little so its soft edges stay outside the canvas. */
const BACKDROP_TRANSFORM: Transform = Object.freeze({
  x: 0.5,
  y: 0.5,
  scale: 1.08,
  rotation: 0,
  opacity: 1,
  flipX: false,
  flipY: false,
});
/** Animation blur at full strength: radius as a fraction of the picture's shorter side. */
const ANIMATION_BLUR = 0.12;

const styleKeys = new WeakMap<TextStyle, string>();
function styleKey(style: TextStyle): string {
  let key = styleKeys.get(style);
  if (key === undefined) {
    key = JSON.stringify(style);
    styleKeys.set(style, key);
  }
  return key;
}

/** Per-layer scratch, reused frame to frame (no allocation per frame once warmed up). */
interface Slot {
  geometry: Float32Array;
  effects: Float32Array;
  colour: ColourParams;
  fx: LayerFx;
  look: TransitionLook;
  anim: AnimationState;
  pic: PictureFx;
}

type Draft =
  | {
      kind: 'video';
      layer: ActiveLayer;
      itemId: string;
      slot: Slot;
      opacity: number;
      hdr: boolean;
      effects: Float32Array | null;
      media: LayerMedia;
      /** False while a transition hides the clip (its decoder keeps running). */
      visible: boolean;
      lut: CubeLut | null;
    }
  | {
      kind: 'still';
      layer: ActiveLayer;
      draw: LayerDraw;
      media: LayerMedia;
      slot: Slot;
      visible: boolean;
    };

export class Composer {
  /** Captions: word times per caption (items are immutable, so per object), reused objects. */
  private readonly wordTimes = new WeakMap<TextItem, CaptionWord[]>();
  private readonly graphemeCache = new WeakMap<TextItem, string[]>();
  private readonly speech: SpeechPosition = { word: -1, progress: 0, chars: 0, totalChars: 0 };
  private readonly highlight: TextHighlight = { mode: 'word', color: '', word: 0, chars: 0 };

  private captionTimes(item: TextItem): CaptionWord[] {
    let t = this.wordTimes.get(item);
    if (!t) this.wordTimes.set(item, (t = captionWordTimes(item)));
    return t;
  }

  private captionGraphemes(item: TextItem): string[] {
    let g = this.graphemeCache.get(item);
    if (!g) {
      const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
      g = Seg
        ? Array.from(
            new Seg(undefined, { granularity: 'grapheme' }).segment(item.text),
            (x) => x.segment,
          )
        : Array.from(item.text);
      this.graphemeCache.set(item, g);
    }
    return g;
  }

  /** One frame source per timeline item (each needs its own decode position). */
  readonly sources = new Map<string, FrameSource>();
  /** Last frame drawn per item (reused when the next one isn't decoded in time). */
  readonly lastFrames = new Map<string, VideoSample>();
  readonly rasters: RasterCache;
  private readonly slots: Slot[] = [];
  private readonly draws: LayerDraw[] = [];
  private readonly active: ActiveLayer[] = [];
  private readonly overlayGeometry = fullCanvasGeometry();
  private readonly backdropGeometry = new Float32Array(12);
  private readonly backdropEffects = new Float32Array(EFFECT_FLOATS);
  private readonly backdropColour = identityColour();
  private readonly backdrop: Backdrop = {
    source: null as unknown as VideoFrame,
    geometry: this.backdropGeometry,
    hdr: false,
    amount: 0,
  };
  private readonly scaleOne: Transform = { ...BACKDROP_TRANSFORM, scale: 1 };
  private solid: OffscreenCanvas | null = null;
  /** Transition overlay (dips, light leaks): one reused draw. */
  private readonly overlay = noOverlay();
  private readonly overlayColour = identityColour();
  private readonly overlayEffects = new Float32Array(EFFECT_FLOATS);
  private readonly overlayDraw: LayerDraw = {
    source: null as unknown as VideoFrame,
    geometry: this.overlayGeometry,
    opacity: 0,
    hdr: false,
    effects: this.overlayEffects,
  };
  private readonly transitionOptions: TransitionOptions = { aspect: 1, colour: [0, 0, 0] };
  private readonly dipColour: [number, number, number] = [0, 0, 0];
  /** Character / word positions of text rasters (typewriter reveals). */
  private readonly textLayouts = new WeakMap<OffscreenCanvas, TextRevealLayout>();
  private readonly cuts: RevealCuts = { line: 0, cutA: 1, cutB: 1, fadeB: 0 };
  /** Grain changes every frame (seeded by the frame number, so export matches preview). */
  private grainSeed = 0;
  /**
   * Low-tier preview: blurs take half the taps (quality before smoothness). Never for export or
   * capture, which always draw full quality.
   */
  cheapEffects = false;
  private destroyed = false;

  constructor(
    readonly renderer: Renderer,
    readonly pool: DecoderPool,
    private readonly media: MediaLibrary,
    readonly exact: boolean,
    rasterBudget: number,
    /** Low tier: no keyframe-preview decoder. */
    private readonly allowPreviews = pool.budget > 2,
  ) {
    this.rasters = new RasterCache(renderer, rasterBudget);
  }

  /** The item's frame source (made on first use), or null when the asset isn't loaded. */
  async sourceFor(
    itemId: string,
    assetId: string,
  ): Promise<{ source: FrameSource; video: VideoMedia } | null> {
    const pending = this.media.videos.get(assetId);
    if (!pending) return null;
    const video = await pending;
    if (this.destroyed) return null;
    let source = this.sources.get(itemId);
    if (!source) {
      source = new FrameSource(video.track, this.pool, this.allowPreviews);
      this.sources.set(itemId, source);
    }
    return { source, video };
  }

  /** Keeps `sample` as the newest picture of `itemId` (closing the previous one). */
  keep(itemId: string, sample: VideoSample): void {
    if (this.destroyed) {
      sample.close();
      return;
    }
    this.lastFrames.get(itemId)?.close();
    this.lastFrames.set(itemId, sample);
  }

  /** Frees decoders and frames of items not in `alive`. */
  prune(alive: Set<string>): void {
    for (const [id, source] of this.sources) {
      if (alive.has(id)) continue;
      source.destroy();
      this.sources.delete(id);
      this.lastFrames.get(id)?.close();
      this.lastFrames.delete(id);
    }
  }

  /** Gives back the decoder and held frame of every item not in `keep`. */
  releaseExcept(keep: Set<string>): void {
    for (const [id, source] of this.sources) {
      if (keep.has(id)) continue;
      source.releaseDecoder();
      this.lastFrames.get(id)?.close();
      this.lastFrames.delete(id);
    }
  }

  /** Frees decoders, frames and rasters. The renderer stays (its owner destroys it). */
  destroy(): void {
    this.destroyed = true;
    for (const source of this.sources.values()) source.destroy();
    this.sources.clear();
    for (const sample of this.lastFrames.values()) sample.close();
    this.lastFrames.clear();
    this.rasters.clear();
    if (this.solid) this.renderer.release(this.solid);
    this.solid = null;
  }

  private slot(index: number): Slot {
    return (this.slots[index] ??= {
      geometry: new Float32Array(12),
      effects: new Float32Array(EFFECT_FLOATS),
      colour: identityColour(),
      fx: noFx(),
      look: plainLook(),
      anim: restingState(),
      pic: noPictureFx(),
    });
  }

  private solidSource(): OffscreenCanvas {
    if (!this.solid) {
      this.solid = new OffscreenCanvas(2, 2);
      const ctx = this.solid.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 2, 2);
    }
    return this.solid;
  }

  /**
   * Colour + transition / animation extras for a layer into its slot; returns the effect block,
   * or null when the picture is unchanged. `texW × texH` is the source's size (blur radii).
   */
  private effectsFor(
    layer: ActiveLayer,
    slot: Slot,
    look: TransitionLook | null,
    anim: AnimationState | null,
    texW: number,
    texH: number,
    textLayout: TextRevealLayout | null,
    lut: CubeLut | null = null,
  ): Float32Array | null {
    const item = layer.item;
    this.pictureFx(layer, slot.pic, lut);
    // Pictures, text and stickers all take a colour look.
    if ('filter' in item) colourParams(item.filter, item.adjust, slot.colour);
    else colourParams(null, NO_ADJUST, slot.colour);
    const fx = slot.fx;
    if (look) Object.assign(fx, look.fx);
    else resetFx(fx);
    if (anim) {
      const a = anim.fx;
      if (a.mask) {
        fx.mask = a.mask;
        fx.maskLocal = a.maskLocal;
        fx.maskProgress = a.maskProgress;
        fx.maskSoft = a.maskSoft;
        fx.maskInvert = a.maskInvert;
        fx.maskDirX = a.maskDirX;
        fx.maskDirY = a.maskDirY;
        fx.maskCX = a.maskCX;
        fx.maskCY = a.maskCY;
      }
      if (a.flash > fx.flash) {
        fx.flash = a.flash;
        fx.flashR = a.flashR;
        fx.flashG = a.flashG;
        fx.flashB = a.flashB;
      }
      if (a.split) fx.split = a.split;
      if (a.rotAxis) {
        // The turn's pivot: a point of the box, on screen (after the move).
        const g = slot.geometry;
        const cx = g[0]! * a.pivotX + g[1]! * a.pivotY + g[4]!;
        const cy = g[2]! * a.pivotX + g[3]! * a.pivotY + g[5]!;
        fx.rotAxis = a.rotAxis;
        fx.rotAngle = a.rotAngle;
        fx.rotDistance = a.rotDistance;
        fx.pivotX = cx * this.aspect;
        fx.pivotY = -cy;
        fx.pivotZ = 0;
      }
      if (anim.blur > 0) {
        const r = anim.blur * ANIMATION_BLUR * Math.min(texW, texH);
        fx.blurMode = 0;
        fx.blurX = Math.max(fx.blurX, r / texW);
        fx.blurY = Math.max(fx.blurY, r / texH);
      }
      if (anim.revealBy && textLayout) {
        const cuts = revealCuts(textLayout, anim.reveal, anim.revealBy, this.cuts);
        fx.mask = MaskShape.text;
        fx.textTop = textLayout.top / textLayout.height;
        fx.textLineH = textLayout.lineHeight / textLayout.height;
        fx.textLines = textLayout.lines.length;
        fx.textLine = cuts.line;
        fx.textCutA = cuts.cutA;
        fx.textCutB = cuts.cutB;
        fx.textFadeB = cuts.fadeB;
        fx.textRtl = textLayout.rtl;
      }
    }
    fx.grainSeed = this.grainSeed;
    fx.cheapBlur = this.cheapEffects;
    if (isNoFx(fx) && isIdentityColour(slot.colour) && isNoPictureFx(slot.pic)) return null;
    writeEffects(slot.effects, 0, slot.colour, fx, slot.pic);
    return slot.effects;
  }

  /** Green screen, LUT, blend mode and blurred area of a layer, into `pic` (reused). */
  private pictureFx(layer: ActiveLayer, pic: PictureFx, lut: CubeLut | null): void {
    resetPictureFx(pic);
    const item = layer.item;
    if (item.kind === 'region') {
      pic.region = item.effect === 'pixelate' ? 2 : 1;
      pic.regionShape = item.shape === 'ellipse' ? 1 : 0;
      // About 1.5 canvas px of anti-aliased edge, in box units (half the box = 1).
      const s = item.transform.scale;
      pic.regionEdgeX = Math.min(1, 3 / Math.max(1e-3, item.width * this.width * s));
      pic.regionEdgeY = Math.min(1, 3 / Math.max(1e-3, item.height * this.height * s));
      return;
    }
    if ('key' in item && item.key) {
      keyParams(
        this.colourOf(item.key.color),
        item.key.tolerance,
        item.key.softness,
        item.key.spill,
        pic,
      );
    }
    if (lut && 'lut' in item && item.lut && item.lut.intensity > 0) {
      pic.lutAmount = Math.min(1, item.lut.intensity);
      pic.lutSize = lut.size;
    }
    // Lanes only: the main video is the bottom of the stack.
    if (layer.track.kind !== 'main' && 'blend' in item && item.blend)
      pic.blend = BLEND_IDS[item.blend] ?? 0;
  }

  /** Parsed `#rrggbb` colours (key colours), cached so frames don't parse strings. */
  private readonly colours = new Map<string, [number, number, number]>();
  private colourOf(color: string): [number, number, number] {
    let rgb = this.colours.get(color);
    if (!rgb) {
      rgb = parseColor(color);
      if (this.colours.size > 64) this.colours.clear();
      this.colours.set(color, rgb);
    }
    return rgb;
  }

  /** The item's LUT, when it has one and the file is loaded. */
  private async lutOf(item: Item): Promise<CubeLut | null> {
    if (!('lut' in item) || !item.lut || item.lut.intensity <= 0) return null;
    const pending = this.media.luts.get(item.lut.assetId);
    if (!pending) return null;
    try {
      return await pending;
    } catch {
      return null;
    }
  }

  /** Canvas aspect and size of the frame being drawn. */
  private aspect = 1;
  private width = 1;
  private height = 1;

  /**
   * Draws the frame at timeline time `t` on a `width × height` target. Preview: waits for decoded
   * frames until `deadlineMs` (performance.now() time). Exact (`deadlineMs` null): waits for all.
   */
  async render(
    project: Project,
    t: Time,
    width: number,
    height: number,
    deadlineMs: number | null,
  ): Promise<ComposeResult> {
    const result: ComposeResult = {
      pending: [],
      late: false,
      missing: 0,
      gatherMs: 0,
      drawMs: 0,
      layers: 0,
    };
    const t0 = performance.now();
    this.aspect = width / height;
    this.width = width;
    this.height = height;
    this.grainSeed = frameIndex(t, project.settings.frameRate) % 997;
    const options = this.transitionOptions;
    options.aspect = this.aspect;
    const bg0 = project.settings.background;
    if (bg0.type === 'color') {
      const [r, g, b] = backgroundColor(project);
      this.dipColour[0] = r;
      this.dipColour[1] = g;
      this.dipColour[2] = b;
    } else this.dipColour[0] = this.dipColour[1] = this.dipColour[2] = 0;
    options.colour = this.dipColour;
    activeLayers(project, t, this.active);
    const jobs = this.active.map((layer, index) =>
      this.gather(project, layer, index, width, height, deadlineMs, result),
    );
    const drafts = await Promise.all(jobs);
    result.gatherMs = performance.now() - t0;
    if (this.destroyed) return result;

    // From here to render() nothing awaits, so no held picture can be closed under our feet
    // (DECISIONS #42).
    const temporary: VideoFrame[] = [];
    const frameOf = (itemId: string): VideoFrame | null => {
      const picture = this.lastFrames.get(itemId);
      if (!picture) return null;
      const frame = picture.toVideoFrame();
      temporary.push(frame);
      return frame;
    };
    const draws = this.draws;
    draws.length = 0;
    let backdropDraft: Draft | null = null;
    let backdropSource: LayerSource | null = null;
    /** Index in `draws` of the outgoing clip of a transition (it may go on top). */
    let outIndex = -1;
    let outOnTop = false;
    for (const draft of drafts) {
      if (!draft) continue;
      let draw: LayerDraw;
      if (draft.kind === 'video') {
        const frame = frameOf(draft.itemId);
        if (!frame) {
          if (this.exact) result.missing++;
          continue;
        }
        draw = {
          source: frame,
          geometry: draft.slot.geometry,
          opacity: draft.opacity,
          hdr: draft.hdr,
          effects: draft.effects,
          blend: draft.slot.pic.blend,
          lut: draft.lut,
        };
      } else {
        draw = draft.draw;
      }
      const transition = draft.layer.transition;
      if (draft.visible) {
        draws.push(draw);
        if (transition?.role === 'out') {
          outIndex = draws.length - 1;
          outOnTop = draft.slot.look.onTop;
        } else if (transition?.role === 'in' && outOnTop && outIndex === draws.length - 2) {
          // Covers, page turns, doors: the outgoing clip is drawn above the incoming one.
          const last = draws.length - 1;
          draws[last] = draws[outIndex]!;
          draws[outIndex] = draw;
        }
      }
      if (draft.layer.track.kind === 'main') {
        // The blurred background follows the clip that is mostly on screen.
        const leading = !transition || (transition.role === 'in') === transition.progress >= 0.5;
        if (leading) {
          backdropDraft = draft;
          backdropSource = draw.source;
        }
        if (transition?.role === 'in') {
          // Dips, flashes, light leaks: one full-canvas layer above the main track, below lanes.
          const overlay = transitionOverlay(
            transition.type,
            transition.progress,
            this.overlay,
            this.optionsFor(transition),
          );
          if (overlay.opacity > 0) {
            const colour = this.overlayColour;
            colour.gainR = overlay.r;
            colour.gainG = overlay.g;
            colour.gainB = overlay.b;
            overlay.fx.grainSeed = this.grainSeed;
            writeEffects(this.overlayEffects, 0, colour, overlay.fx);
            const od = this.overlayDraw;
            od.source = this.solidSource();
            od.opacity = overlay.opacity;
            draws.push(od);
          }
        }
      }
    }

    const bg = project.settings.background;
    let backdrop: Backdrop | null = null;
    if (bg.type === 'blur' && backdropDraft && backdropSource) {
      const item = backdropDraft.layer.item;
      if (item.kind === 'video' || item.kind === 'image' || item.kind === 'freeze') {
        layerGeometry(
          width,
          height,
          backdropDraft.media,
          { transform: BACKDROP_TRANSFORM, crop: item.crop, fit: 'fill' },
          this.backdropGeometry,
        );
        colourParams(item.filter, item.adjust, this.backdropColour);
        let effects: Float32Array | null = null;
        if (!isIdentityColour(this.backdropColour)) {
          writeEffects(this.backdropEffects, 0, this.backdropColour, noFx());
          effects = this.backdropEffects;
        }
        backdrop = this.backdrop;
        backdrop.source = backdropSource;
        backdrop.hdr = backdropDraft.kind === 'video' ? backdropDraft.hdr : false;
        backdrop.amount = bg.amount;
        backdrop.effects = effects;
      }
    }
    const t1 = performance.now();
    this.renderer.render(draws, backgroundColor(project), backdrop);
    result.drawMs = performance.now() - t1;
    result.layers = draws.length;
    for (const frame of temporary) frame.close();
    if (backdrop) backdrop.source = null as unknown as VideoFrame;
    for (const draw of draws) draw.source = null as unknown as VideoFrame;
    this.rasters.endFrame();
    return result;
  }

  /** Transition options of a layer's transition (reused object). */
  private optionsFor(transition: NonNullable<ActiveLayer['transition']>): TransitionOptions {
    const options = this.transitionOptions;
    options.direction = transition.direction;
    options.ease = transition.ease;
    return options;
  }

  private async gather(
    project: Project,
    layer: ActiveLayer,
    index: number,
    width: number,
    height: number,
    deadlineMs: number | null,
    result: ComposeResult,
  ): Promise<Draft | null> {
    const item = layer.item;
    const slot = this.slot(index);
    // A transition moves only the two clips of its own cut (main track, or two touching pictures
    // on one layer); other layers are never touched by it.
    const transition = layer.transition;
    const onLayer = layer.track.kind !== 'main';
    const look = transition
      ? transitionLook(
          transition.type,
          transition.progress,
          transition.role,
          slot.look,
          this.optionsFor(transition),
        )
      : null;
    // Animations play on lane items only (main-track clips have transitions instead).
    const animation = layer.track.kind !== 'main' ? itemAnimation(item) : undefined;
    let anim = animation
      ? animationState(animation, layer.localTime, item.duration, item.kind === 'text', slot.anim)
      : null;
    // Captions follow the speech (v0.2 A6): words appear (reveal / type) through the text reveal
    // mask, or the raster marks the word being said (word / box / fill).
    let highlight: TextHighlight | null = null;
    const captionLook = layer.track.kind === 'caption' ? layer.track.caption : undefined;
    if (item.kind === 'text' && captionLook && captionLook.highlight !== 'none') {
      const speech = speechAt(this.captionTimes(item), layer.localTime, this.speech);
      const mode = captionLook.highlight;
      if (mode === 'reveal' || mode === 'type') {
        anim ??= resetState(slot.anim);
        if (mode === 'reveal') {
          const words = this.captionTimes(item).length || 1;
          anim.revealBy = 'word';
          anim.reveal = speech.word < 0 ? 0 : (speech.word + speech.progress) / words;
        } else {
          const g = this.captionGraphemes(item);
          anim.revealBy = 'char';
          anim.reveal = g.length ? charsWithSpaces(g, speech.chars) / g.length : 1;
        }
      } else if (speech.word >= 0) {
        // Fill: half-letter steps (smooth enough, few re-rasters).
        const chars =
          mode === 'fill'
            ? Math.round(charsWithSpaces(this.captionGraphemes(item), speech.chars) * 2) / 2
            : 0;
        highlight = this.highlight;
        highlight.mode = mode;
        highlight.color = captionLook.highlightColor;
        highlight.word = speech.word;
        highlight.chars = chars;
      }
    }
    const hidden = (look !== null && !look.visible) || (anim !== null && anim.opacity <= 0);
    const opacity = (look?.opacity ?? 1) * (anim?.opacity ?? 1);
    const finish = () => {
      // On a layer the clip moves within its own box (a picture-in-picture stays an element).
      if (look) (onLayer ? moveInBox : moveOnCanvas)(slot.geometry, width, height, look);
      if (anim) moveInBox(slot.geometry, width, height, anim);
    };

    switch (item.kind) {
      case 'image': {
        const bitmap = await this.media.images.get(item.assetId);
        if (!bitmap) return null;
        const media: LayerMedia = {
          width: bitmap.width,
          height: bitmap.height,
          rotation: 0,
          flip: false,
        };
        layerGeometry(width, height, media, item, slot.geometry);
        finish();
        const lut = await this.lutOf(item);
        const effects = this.effectsFor(
          layer,
          slot,
          look,
          anim,
          bitmap.width,
          bitmap.height,
          null,
          lut,
        );
        const draw: LayerDraw = {
          source: bitmap,
          geometry: slot.geometry,
          opacity: item.transform.opacity * opacity,
          hdr: false,
          effects,
          blend: slot.pic.blend,
          lut,
        };
        return { kind: 'still', layer, draw, media, slot, visible: !hidden };
      }
      case 'text': {
        const fontPx = textFontPx(item, height);
        if (!(fontPx > 0.5) || item.text.length === 0) return null;
        const rasterPx = rasterSize(fontPx, this.exact);
        const k = fontPx / rasterPx;
        const withLayout = anim?.revealBy != null;
        const marked = highlight
          ? `|${highlight.mode}:${highlight.mode === 'fill' ? highlight.chars : highlight.word}:${highlight.color}`
          : '';
        const key = `${rasterPx}|${height}|${withLayout ? 'L' : ''}|${item.text}|${styleKey(item.style)}${marked}`;
        const canvas = this.rasters.get(item.id, key, () => {
          const raster = rasterizeText(item, rasterPx, height, k, withLayout, highlight);
          if (raster.layout) this.textLayouts.set(raster.canvas, raster.layout);
          return raster.canvas;
        });
        // The raster's size follows the item's own scale; animation scales are geometry only, so
        // an animated title is never re-rasterised per frame.
        const tf = this.scaleOne;
        Object.assign(tf, item.transform);
        tf.scale = 1;
        placedGeometry(width, height, canvas.width * k, canvas.height * k, tf, slot.geometry);
        finish();
        const media: LayerMedia = {
          width: canvas.width,
          height: canvas.height,
          rotation: 0,
          flip: false,
        };
        const draw: LayerDraw = {
          source: canvas,
          geometry: slot.geometry,
          opacity: item.transform.opacity * opacity,
          hdr: false,
          effects: this.effectsFor(
            layer,
            slot,
            look,
            anim,
            canvas.width,
            canvas.height,
            this.textLayouts.get(canvas) ?? null,
          ),
          blend: slot.pic.blend,
        };
        return { kind: 'still', layer, draw, media, slot, visible: !hidden };
      }
      case 'sticker': {
        let source: ImageBitmap | OffscreenCanvas;
        if (item.emoji) {
          // A square that contain-fits the canvas at scale 1.
          const side = Math.min(width, height) * item.transform.scale;
          const px = Math.round(rasterSize(side, this.exact));
          const emoji = item.emoji;
          source = this.rasters.get(item.id, `${px}|${emoji}`, () => rasterizeEmoji(emoji, px));
        } else if (item.assetId) {
          const bitmap = await this.media.images.get(item.assetId);
          if (!bitmap) return null;
          source = bitmap;
        } else {
          return null;
        }
        const media: LayerMedia = {
          width: source.width,
          height: source.height,
          rotation: 0,
          flip: false,
        };
        layerGeometry(
          width,
          height,
          media,
          { transform: item.transform, crop: NO_CROP, fit: 'fit' },
          slot.geometry,
        );
        finish();
        const draw: LayerDraw = {
          source,
          geometry: slot.geometry,
          opacity: item.transform.opacity * opacity,
          hdr: false,
          effects: this.effectsFor(layer, slot, look, anim, source.width, source.height, null),
          blend: slot.pic.blend,
        };
        return { kind: 'still', layer, draw, media, slot, visible: !hidden };
      }
      case 'region': {
        // Draws what's under its box, blurred or pixelated (the renderer copies the pixels).
        const tf = item.transform;
        placedGeometry(width, height, item.width * width, item.height * height, tf, slot.geometry);
        const draw: LayerDraw = {
          source: this.solidSource(),
          geometry: slot.geometry,
          opacity: tf.opacity,
          hdr: false,
          effects: this.effectsFor(layer, slot, null, null, 2, 2, null),
          region: { pixelate: item.effect === 'pixelate', amount: item.amount },
        };
        const media: LayerMedia = { width: 2, height: 2, rotation: 0, flip: false };
        return { kind: 'still', layer, draw, media, slot, visible: tf.opacity > 0 };
      }
      case 'video':
      case 'freeze': {
        const found = await this.sourceFor(item.id, item.assetId);
        if (!found) return null;
        const request = found.source.frameAt(layer.sourceTime / FLICKS_PER_SECOND);
        if (deadlineMs === null) {
          const sample = await request;
          if (sample) this.keep(item.id, sample);
        } else {
          // Wait for the exact frame until the deadline; otherwise show the previous one.
          const remaining = Math.max(0, deadlineMs - performance.now());
          let timer: ReturnType<typeof setTimeout> | undefined;
          const sample = await Promise.race([
            request,
            new Promise<'late'>(
              (resolve) => (timer = setTimeout(() => resolve('late'), remaining)),
            ),
          ]).finally(() => clearTimeout(timer));
          if (sample === 'late') {
            result.late = true;
            result.pending.push(request);
            // When it does arrive, keep it as the newest picture for this item.
            void request.then((s) => {
              if (s) this.keep(item.id, s);
            });
          } else if (sample) {
            this.keep(item.id, sample);
          }
        }
        const media = found.video.media;
        layerGeometry(width, height, media, item, slot.geometry);
        finish();
        const lut = await this.lutOf(item);
        // The picture itself is looked up after all layers are gathered (render), not here: a
        // late frame arriving while other layers are still decoding may replace and close it.
        return {
          kind: 'video',
          layer,
          itemId: item.id,
          slot,
          opacity: item.transform.opacity * opacity,
          hdr: found.video.hdr,
          effects: this.effectsFor(layer, slot, look, anim, media.width, media.height, null, lut),
          media,
          visible: !hidden,
          lut,
        };
      }
    }
  }
}

const NO_ADJUST: Adjust = Object.freeze({});

function itemAnimation(item: Item): ItemAnimation | undefined {
  return 'animation' in item ? item.animation : undefined;
}

/** The project's background colour as RGB 0…1 (black under a blurred background). */
export function backgroundColor(p: Project): [number, number, number] {
  const bg = p.settings.background;
  if (bg.type !== 'color') return [0, 0, 0];
  return parseColor(bg.color);
}

function parseColor(color: string): [number, number, number] {
  const hex = color.trim().replace('#', '');
  if (!/^[0-9a-f]{3,8}$/i.test(hex)) return [0, 0, 0];
  const full =
    hex.length === 3 || hex.length === 4
      ? [...hex.slice(0, 3)].map((c) => c + c).join('')
      : hex.slice(0, 6);
  const value = parseInt(full, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
