import type { Input, InputVideoTrack, VideoSample } from 'mediabunny';
import {
  colourParams,
  EFFECT_FLOATS,
  identityColour,
  isIdentityColour,
  noFx,
  writeEffects,
  type ColourParams,
  type LayerFx,
} from '../effects/colour';
import {
  fadeOverlay,
  plainLook,
  transitionLook,
  type TransitionLook,
} from '../effects/transitions';
import { DEFAULT_TRANSFORM, NO_CROP } from '../model/project';
import type { Project, TextStyle, Transform } from '../model/schema';
import { FLICKS_PER_SECOND, type Time } from '../model/time';
import {
  fullCanvasGeometry,
  layerGeometry,
  placedGeometry,
  shiftGeometry,
  type LayerMedia,
} from '../render/layout';
import type { Backdrop, LayerDraw, LayerSource, Renderer } from '../render/types';
import { FrameSource, type DecoderPool } from './frames';
import { RasterCache } from './rasters';
import { rasterizeEmoji, rasterizeText, rasterSize, textFontPx } from './text';
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

/** Blur transition: radius at full strength, in texture uv. */
const TRANSITION_BLUR_UV = 0.02;
/** The blurred background is enlarged a little so its soft edges stay outside the canvas. */
const BACKDROP_TRANSFORM: Transform = Object.freeze({ ...DEFAULT_TRANSFORM, scale: 1.08 });

const BLACK_EFFECTS: Float32Array = (() => {
  const block = new Float32Array(EFFECT_FLOATS);
  const black = identityColour();
  black.gainR = black.gainG = black.gainB = 0;
  black.contrast = 0;
  black.liftR = black.liftG = black.liftB = -0.5; // (c − .5)·0 + .5 − .5 = 0
  writeEffects(block, 0, black, noFx());
  return block;
})();

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
  private readonly scaleOne: Transform = { ...DEFAULT_TRANSFORM };
  private solid: OffscreenCanvas | null = null;
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
   * Colour + transition extras for a media layer into its slot; returns the effect block, or null
   * when the picture is unchanged.
   */
  private effectsFor(
    layer: ActiveLayer,
    slot: Slot,
    look: TransitionLook | null,
  ): Float32Array | null {
    const item = layer.item;
    if (item.kind !== 'video' && item.kind !== 'image' && item.kind !== 'freeze') return null;
    colourParams(item.filter, item.adjust, slot.colour);
    const fx = slot.fx;
    fx.blurX = fx.blurY = look ? look.blur * TRANSITION_BLUR_UV : 0;
    fx.wipe = look?.wipe ?? false;
    fx.wipeEdge = look?.wipeEdge ?? 0;
    fx.wipeSoft = look?.wipeSoft ?? 0;
    if (!fx.wipe && fx.blurX === 0 && isIdentityColour(slot.colour)) return null;
    writeEffects(slot.effects, 0, slot.colour, fx);
    return slot.effects;
  }

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
        };
      } else {
        draw = draft.draw;
      }
      if (draft.visible) draws.push(draw);
      const transition = draft.layer.transition;
      if (draft.layer.track.kind === 'main') {
        // The blurred background follows the clip that is mostly on screen.
        const leading = !transition || (transition.role === 'in') === transition.progress >= 0.5;
        if (leading) {
          backdropDraft = draft;
          backdropSource = draw.source;
        }
        if (transition?.role === 'in') {
          const black = fadeOverlay(transition.type, transition.progress);
          if (black > 0) {
            draws.push({
              source: this.solidSource(),
              geometry: this.overlayGeometry,
              opacity: black,
              hdr: false,
              effects: BLACK_EFFECTS,
            });
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
    const look = layer.transition
      ? transitionLook(
          layer.transition.type,
          layer.transition.progress,
          layer.transition.role,
          slot.look,
        )
      : null;
    const hidden = look !== null && !look.visible;
    const finish = (media: LayerMedia) => {
      if (look) shiftGeometry(slot.geometry, look.scale, look.dx, look.dy);
      return media;
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
        finish(media);
        const effects = this.effectsFor(layer, slot, look);
        const draw: LayerDraw = {
          source: bitmap,
          geometry: slot.geometry,
          opacity: item.transform.opacity * (look?.opacity ?? 1),
          hdr: false,
          effects,
        };
        return { kind: 'still', layer, draw, media, slot, visible: !hidden };
      }
      case 'text': {
        const fontPx = textFontPx(item, height);
        if (!(fontPx > 0.5) || item.text.length === 0) return null;
        const rasterPx = rasterSize(fontPx, this.exact);
        const k = fontPx / rasterPx;
        const key = `${rasterPx}|${height}|${item.text}|${styleKey(item.style)}`;
        const canvas = this.rasters.get(
          item.id,
          key,
          () => rasterizeText(item, rasterPx, height, k).canvas,
        );
        const tf = this.scaleOne;
        Object.assign(tf, item.transform);
        tf.scale = 1;
        placedGeometry(width, height, canvas.width * k, canvas.height * k, tf, slot.geometry);
        const media: LayerMedia = {
          width: canvas.width,
          height: canvas.height,
          rotation: 0,
          flip: false,
        };
        const draw: LayerDraw = {
          source: canvas,
          geometry: slot.geometry,
          opacity: item.transform.opacity,
          hdr: false,
        };
        return { kind: 'still', layer, draw, media, slot, visible: true };
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
        const draw: LayerDraw = {
          source,
          geometry: slot.geometry,
          opacity: item.transform.opacity,
          hdr: false,
        };
        return { kind: 'still', layer, draw, media, slot, visible: true };
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
        finish(media);
        // The picture itself is looked up after all layers are gathered (render), not here: a
        // late frame arriving while other layers are still decoding may replace and close it.
        return {
          kind: 'video',
          layer,
          itemId: item.id,
          slot,
          opacity: item.transform.opacity * (look?.opacity ?? 1),
          hdr: found.video.hdr,
          effects: this.effectsFor(layer, slot, look),
          media,
          visible: !hidden,
        };
      }
    }
  }
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
