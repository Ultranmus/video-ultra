import { useEffect, useRef, useState, type ReactElement } from 'react';
import { SCOPE_ROWS, VECTOR_SIZE, vectorPoint, type ScopeData } from '@video-ultra/core/internal';
import { useController, useLabels, useProject } from './context';
import { Segmented } from './controls';

/**
 * Video scopes (v0.4, desktop inspector): Waveform, Parade, Histogram or Vectorscope of the
 * whole picture under the playhead. The engine worker renders a small copy and counts; this
 * draws the counts into one small canvas. Only while the section is open; at most 4 updates a
 * second while playing, one shortly after each seek or edit while paused.
 */

type Mode = 'waveform' | 'parade' | 'histogram' | 'vector';

const PLAYING_INTERVAL_MS = 250;
const PAUSED_DELAY_MS = 60;

type Rgb = [number, number, number];

/** Resolves a CSS colour (token value) to RGB bytes. */
function toRgb(css: string, fallback: Rgb): Rgb {
  try {
    const c = new OffscreenCanvas(1, 1).getContext('2d')!;
    c.fillStyle = css || `rgb(${fallback.join(',')})`;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!];
  } catch {
    return fallback;
  }
}

interface Palette {
  bg: Rgb;
  trace: Rgb;
  red: Rgb;
  green: Rgb;
  blue: Rgb;
  grid: string;
}

function readPalette(el: Element): Palette {
  const s = getComputedStyle(el);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    bg: toRgb(v('--vu-scope-bg'), [0, 0, 0]),
    trace: toRgb(v('--vu-scope-trace'), [255, 255, 255]),
    red: toRgb(v('--vu-scope-red'), [255, 0, 0]),
    green: toRgb(v('--vu-scope-green'), [0, 255, 0]),
    blue: toRgb(v('--vu-scope-blue'), [0, 0, 255]),
    grid: v('--vu-scope-grid'),
  };
}

/** Paints `count`-weighted colour into an image (additive, clamped). */
function add(px: Uint8ClampedArray, i: number, c: Rgb, amount: number): void {
  px[i] = px[i]! + c[0] * amount;
  px[i + 1] = px[i + 1]! + c[1] * amount;
  px[i + 2] = px[i + 2]! + c[2] * amount;
}

function draw(canvas: HTMLCanvasElement, mode: Mode, data: ScopeData, p: Palette): void {
  const rows = SCOPE_ROWS;
  const w =
    mode === 'parade'
      ? data.width * 3
      : mode === 'histogram'
        ? 256
        : mode === 'vector'
          ? VECTOR_SIZE
          : data.width;
  const h = mode === 'vector' ? VECTOR_SIZE : rows;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(w, h);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = p.bg[0];
    px[i + 1] = p.bg[1];
    px[i + 2] = p.bg[2];
    px[i + 3] = 255;
  }
  const columnPixels = data.pixels / data.width;
  // A cell holding 1/16 of a column (or 1/512 of the frame on the vectorscope) is full brightness.
  const level = (count: number, full: number) => (count ? Math.min(1, Math.sqrt(count / full)) : 0);
  if (mode === 'waveform') {
    for (let i = 0; i < data.waveform.length; i++)
      add(px, i * 4, p.trace, level(data.waveform[i]!, columnPixels / 16));
  } else if (mode === 'parade') {
    const plane = data.width * rows;
    const colours = [p.red, p.green, p.blue];
    for (let c = 0; c < 3; c++)
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < data.width; x++) {
          const count = data.parade[c * plane + y * data.width + x]!;
          if (count)
            add(px, (y * w + c * data.width + x) * 4, colours[c]!, level(count, columnPixels / 16));
        }
  } else if (mode === 'vector') {
    for (let i = 0; i < data.vector.length; i++)
      add(px, i * 4, p.trace, level(data.vector[i]!, data.pixels / 512));
  } else {
    // Histogram: red, green, blue as overlapping filled columns, linear, scaled to the tallest
    // level that isn't clipped (pure black / white spikes would flatten everything else; they
    // run off the top instead).
    let max = 1;
    for (let c = 0; c < 3; c++)
      for (let x = 2; x < 254; x++) max = Math.max(max, data.histogram[c * 256 + x]!);
    const colours = [p.red, p.green, p.blue];
    for (let c = 0; c < 3; c++)
      for (let x = 0; x < 256; x++) {
        const height = Math.min(h, Math.round((data.histogram[c * 256 + x]! / max) * h));
        for (let y = h - height; y < h; y++) add(px, (y * w + x) * 4, colours[c]!, 0.6);
      }
  }
  ctx.putImageData(image, 0, 0);
  // Guides: 0 / 25 / 50 / 75 / 100 % on the waveforms; colour targets on the vectorscope.
  ctx.strokeStyle = p.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (mode === 'vector') {
    ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    // Targets at 75 % for red, yellow, green, cyan, blue, magenta.
    for (const [r, g, b] of [
      [191, 0, 0],
      [191, 191, 0],
      [0, 191, 0],
      [0, 191, 191],
      [0, 0, 191],
      [191, 0, 191],
    ] as const) {
      const t = vectorPoint(r, g, b);
      ctx.rect(t.x * (w - 1) - 3, t.y * (h - 1) - 3, 6, 6);
    }
    // Skin tones gather along this line.
    const skin = vectorPoint(224, 172, 140);
    const dx = skin.x - 0.5;
    const dy = skin.y - 0.5;
    const len = Math.hypot(dx, dy);
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + (dx / len) * (w / 2), h / 2 + (dy / len) * (h / 2));
  } else if (mode !== 'histogram') {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const y = Math.round((1 - f) * (h - 1)) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
  }
  ctx.stroke();
}

export function ScopesView(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const [mode, setMode] = useState<Mode>('waveform');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const dataRef = useRef<ScopeData | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const requestRef = useRef<() => void>(() => {});
  const project = useProject((p) => p);

  // One loop for the section's lifetime: a request at a time, paced by playback.
  useEffect(() => {
    let live = true;
    let busy = false;
    let again = false;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const engine = ctl.engine;
      if (!engine || !live) return;
      busy = true;
      last = performance.now();
      try {
        const data = await engine.scopes(ctl.playhead.time);
        if (!live) return;
        dataRef.current = data;
        const canvas = canvasRef.current;
        if (canvas) {
          paletteRef.current ??= readPalette(canvas);
          draw(canvas, modeRef.current, data, paletteRef.current);
        }
      } catch {
        // No project yet / engine busy: the next change asks again.
      } finally {
        busy = false;
        if (again && live) {
          again = false;
          want();
        }
      }
    };
    const want = () => {
      if (busy) {
        again = true;
        return;
      }
      const wait = ctl.ui.getState().playing
        ? Math.max(0, PLAYING_INTERVAL_MS - (performance.now() - last))
        : PAUSED_DELAY_MS;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), wait);
    };
    requestRef.current = want;
    want();
    const off = ctl.playhead.subscribe(want);
    return () => {
      live = false;
      clearTimeout(timer);
      off();
    };
  }, [ctl]);

  // Edits change the picture: measure again.
  useEffect(() => requestRef.current(), [project]);

  // Another view: redraw the last counts right away.
  useEffect(() => {
    modeRef.current = mode;
    const canvas = canvasRef.current;
    if (canvas && dataRef.current) {
      paletteRef.current ??= readPalette(canvas);
      draw(canvas, mode, dataRef.current, paletteRef.current);
    }
  }, [mode]);

  return (
    <div className="vu-scopes">
      <Segmented
        label={l.scopeView}
        hideLabel
        value={mode}
        options={[
          { value: 'waveform', label: l.scopeWaveform, tip: l.tipScopeWaveform },
          { value: 'parade', label: l.scopeParade, tip: l.tipScopeParade },
          { value: 'histogram', label: l.scopeHistogram, tip: l.tipScopeHistogram },
          { value: 'vector', label: l.scopeVector, tip: l.tipScopeVector },
        ]}
        onChange={setMode}
      />
      <canvas
        ref={canvasRef}
        className="vu-scope-canvas"
        data-mode={mode}
        role="img"
        aria-label={l.scopeAria(
          mode === 'waveform'
            ? l.scopeWaveform
            : mode === 'parade'
              ? l.scopeParade
              : mode === 'histogram'
                ? l.scopeHistogram
                : l.scopeVector,
        )}
      />
    </div>
  );
}
