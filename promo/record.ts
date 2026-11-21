/**
 * Makes the VideoUltra promo video from the real editor (v2: "from flat raw clips to a reel"):
 * prepare clips → voice → record scenes → compose (smart zoom, captions, payoff) → mix → encode.
 *
 * The editor runs in real Chrome on a laptop-sized screen (1470 × 956 at 2×) with a drawn
 * cursor. Every painted frame comes from the DevTools screencast with its time. A compositor page
 * then rebuilds constant 30 fps video at 1920 × 1248: it eases a camera in on the part of the
 * screen being worked on (the 2× frames keep zoom sharp), draws the caption pill, and builds the
 * before | after payoff from the editor's real export. Title, code and end cards and the poster
 * are promo/cards.html, recorded the same way.
 *
 * Usage: a dev server running the playground (with its speech + captions services), then
 *   node promo/record.ts [--base http://localhost:3203] [--env <dotenv>] [--headed] [--crf 23]
 *     [--publish]
 * The ElevenLabs key comes from the environment or --env (see voice.ts).
 * Outputs go to promo/work/out (promo.mp4, promo-poster.jpg, promo.vtt); --publish also copies
 * them to apps/playground/public/home.
 */
import { chromium, type Browser, type CDPSession, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LINES, WORK, renderVoice, type VoiceLine } from './voice.ts';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string): string | undefined =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const BASE = arg('base') ?? 'http://localhost:3203';
const HEADED = process.argv.includes('--headed');
const PUBLISH = process.argv.includes('--publish');
const CRF = Number(arg('crf') ?? '23');
const PUBLIC = resolve(here, '../apps/playground/public/home');
const OUT = join(WORK, 'out');
const CLIPS = join(here, 'clips');
const RAW = join(WORK, 'v2');
const FRAMES = join(WORK, 'frames');
const SCENES = join(WORK, 'scenes');
const PAYOFF = join(WORK, 'payoff');
/** The screen: a 14-inch laptop's browser window, recorded at 2×. */
const VW = 1470;
const VH = 956;
const DPR = 2;
/** The video: same aspect as the screen. */
const W = 1920;
const H = 1248;
const FPS = 30;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const ff = (args: string[]) => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args]);
const TICKS = 705_600_000;

// ── 1. prepare light working copies ─────────────────────────────────────────

/**
 * The six clips in story order: source id and the start of its best 4 s. They are graded a
 * little flat on purpose (the raw "before"); the editor's colour look brings them back.
 */
const CLIP_SPECS = [
  { id: '40102', from: 2, name: 'plane' },
  { id: '51500', from: 4, name: 'beach' },
  { id: '41576', from: 6, name: 'mountain-road' },
  { id: '43941', from: 2, name: 'coffee' },
  { id: '49878', from: 0, name: 'city-night' },
  { id: '2168', from: 0, name: 'sunset' },
] as const;
const CLIP_SECONDS = 4;
/** The reel after the two 1 s trims. */
const REEL_SECONDS = CLIP_SPECS.length * CLIP_SECONDS - 2;
const MUSIC_FILE = join(WORK, 'Summer Fun.mp3');
const MUSIC_SRC = join(CLIPS, 'music-13.mp3');
const NARRATION = 'Golden hours, open roads and city lights. Our weekend away.';
/** Where the narration starts in the reel (after the title). */
const NARRATION_AT = 3;
const REEL_FILE = join(WORK, 'reel.mp4');

function prepare(): void {
  mkdirSync(RAW, { recursive: true });
  for (const c of CLIP_SPECS) {
    const out = join(RAW, `${c.name}.mp4`);
    if (existsSync(out)) continue;
    const src = join(CLIPS, `${c.id}.mp4`);
    if (!existsSync(src)) throw new Error(`missing ${src}: run promo/fetch.sh first`);
    console.log(`  clip ${c.name}`);
    ff([
      '-ss',
      `${c.from}`,
      '-i',
      src,
      '-t',
      `${CLIP_SECONDS}`,
      '-an',
      '-vf',
      'eq=contrast=0.85:saturation=0.72:brightness=-0.02',
      '-c:v',
      'libx264',
      '-crf',
      '19',
      '-preset',
      'fast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      out,
    ]);
  }
  const want = `${REEL_SECONDS}`;
  const stamp = `${MUSIC_FILE}.len`;
  if (!existsSync(MUSIC_FILE) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== want) {
    ff([
      '-i',
      MUSIC_SRC,
      '-t',
      want,
      '-af',
      `afade=t=out:st=${REEL_SECONDS - 2}:d=2`,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      MUSIC_FILE,
    ]);
    writeFileSync(stamp, want);
  }
}

// ── 2. screencast recorder ──────────────────────────────────────────────────

interface Frame {
  /** Capture time, seconds since the epoch (same clock as Date.now). */
  t: number;
  file: string;
}

/** A recording's frames (a live Recorder, or one read back from disk). */
interface Footage {
  name: string;
  frames: Frame[];
}

/** Reads a finished recording back (frames/<name>/index.json holds the frame times). */
function loadFootage(name: string): Footage {
  const dir = join(FRAMES, name);
  const times = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as number[];
  return {
    name,
    frames: times.map((t, i) => ({ t, file: join(dir, `${String(i).padStart(6, '0')}.jpg`) })),
  };
}

/** Records every frame Chrome paints for one page, with its time. */
class Recorder {
  readonly frames: Frame[] = [];
  readonly name: string;
  readonly #writes: Promise<void>[] = [];
  readonly #cdp: CDPSession;
  readonly #dir: string;
  #count = 0;

  private constructor(cdp: CDPSession, name: string) {
    this.#cdp = cdp;
    this.name = name;
    this.#dir = join(FRAMES, name);
  }

  static async start(page: Page, name: string): Promise<Recorder> {
    const cdp = await page.context().newCDPSession(page);
    const rec = new Recorder(cdp, name);
    rmSync(rec.#dir, { recursive: true, force: true });
    mkdirSync(rec.#dir, { recursive: true });
    cdp.on('Page.screencastFrame', (f) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      const t = f.metadata.timestamp ?? now();
      const file = join(rec.#dir, `${String(rec.#count++).padStart(6, '0')}.jpg`);
      rec.frames.push({ t, file });
      rec.#writes.push(writeFile(file, Buffer.from(f.data, 'base64')));
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: VW * DPR,
      maxHeight: VH * DPR,
      everyNthFrame: 1,
    });
    return rec;
  }

  async stop(): Promise<void> {
    await this.#cdp.send('Page.stopScreencast').catch(() => {});
    await Promise.all(this.#writes);
    writeFileSync(join(this.#dir, 'index.json'), JSON.stringify(this.frames.map((f) => f.t)));
    const span = (this.frames.at(-1)?.t ?? 0) - (this.frames[0]?.t ?? 0);
    console.log(`  recorder ${this.name}: ${this.frames.length} frames over ${span.toFixed(1)} s`);
  }
}

// ── 3. overlay: cursor and click ring (captions are drawn later, over the zoom) ──

/** Runs in the page (init script): draws the cursor outside the editor's DOM. */
function overlay(): void {
  const install = (): void => {
    if (document.getElementById('promo-overlay')) return;
    const root = document.createElement('div');
    root.id = 'promo-overlay';
    root.innerHTML = `
<style>
  #promo-overlay, #promo-overlay * { pointer-events: none !important; box-sizing: border-box; }
  #promo-overlay { position: fixed; inset: 0; z-index: 2147483647; contain: strict; }
  #promo-cursor { position: absolute; left: 0; top: 0; width: 25px; height: 30px; opacity: 0;
    transform: translate(-100px, -100px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
  #promo-cursor svg { width: 100%; height: 100%; transition: transform .12s ease-out; transform-origin: 3px 2px; }
  #promo-cursor.down svg { transform: scale(.86); }
  .promo-ring { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
    border: 2.5px solid rgba(255,255,255,.95); background: rgba(213,144,213,.3);
    box-shadow: 0 0 0 1.5px rgba(0,0,0,.25); animation: promo-ring .55s ease-out forwards; }
  @keyframes promo-ring { from { transform: scale(.35); opacity: .95; } to { transform: scale(1.35); opacity: 0; } }
  .vu-toasts { display: none !important; }
</style>
<div id="promo-cursor"><svg viewBox="0 0 34 40" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 2 L3 31 L10.2 24.4 L15 35.2 L20.6 32.8 L15.9 22.2 L25.6 22.2 Z" fill="#fff" stroke="#111" stroke-width="2.2" stroke-linejoin="round"/>
</svg></div>`;
    document.documentElement.append(root);
    const cursor = root.querySelector<HTMLElement>('#promo-cursor')!;
    let x = -100;
    let y = -100;
    const place = (e: PointerEvent | MouseEvent): void => {
      x = e.clientX;
      y = e.clientY;
      cursor.style.transform = `translate(${x - 2}px, ${y - 1.5}px)`;
      cursor.style.opacity = '1';
    };
    window.addEventListener('pointermove', place, { capture: true, passive: true });
    window.addEventListener('mousemove', place, { capture: true, passive: true });
    window.addEventListener(
      'pointerdown',
      (e) => {
        place(e);
        cursor.classList.add('down');
        const ring = document.createElement('div');
        ring.className = 'promo-ring';
        ring.style.left = `${x}px`;
        ring.style.top = `${y}px`;
        root.insertBefore(ring, cursor);
        setTimeout(() => ring.remove(), 700);
      },
      { capture: true, passive: true },
    );
    window.addEventListener('pointerup', () => cursor.classList.remove('down'), {
      capture: true,
      passive: true,
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}

// ── 4. a human-looking mouse ────────────────────────────────────────────────

/** A rectangle in screen (CSS) pixels. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

class Hand {
  x = 1100;
  y = 420;
  readonly #page: Page;
  constructor(page: Page) {
    this.#page = page;
  }

  /** Moves along an eased, slightly curved path in about `ms`. */
  async move(x: number, y: number, ms?: number): Promise<void> {
    const dist = Math.hypot(x - this.x, y - this.y);
    const total = ms ?? Math.min(700, 260 + dist * 0.4);
    const x0 = this.x;
    const y0 = this.y;
    const bow = Math.min(40, dist * 0.07);
    const nx = dist ? -(y - y0) / dist : 0;
    const ny = dist ? (x - x0) / dist : 0;
    const start = performance.now();
    for (;;) {
      const p = Math.min(1, (performance.now() - start) / total);
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      const b = Math.sin(Math.PI * e) * bow;
      this.x = x0 + (x - x0) * e + nx * b;
      this.y = y0 + (y - y0) * e + ny * b;
      await this.#page.mouse.move(this.x, this.y);
      if (p >= 1) break;
      await sleep(12);
    }
  }

  async jump(x: number, y: number): Promise<void> {
    this.x = x;
    this.y = y;
    await this.#page.mouse.move(x, y);
  }

  /** Moves to a point, pauses like a person, clicks. */
  async clickAt(x: number, y: number, pause = 180): Promise<void> {
    await this.move(x, y);
    await sleep(pause);
    await this.#page.mouse.down();
    await sleep(80);
    await this.#page.mouse.up();
  }

  /** The middle of an element (scrolled into view first). */
  async centre(target: Locator): Promise<{ x: number; y: number; box: Box }> {
    await target.scrollIntoViewIfNeeded();
    const b = await target.boundingBox();
    if (!b) throw new Error(`not visible: ${target.toString()}`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
  }

  async click(target: Locator, pause = 180): Promise<void> {
    const c = await this.centre(target);
    await this.clickAt(c.x, c.y, pause);
  }

  async drag(x1: number, y1: number, x2: number, y2: number, ms = 800): Promise<void> {
    await this.move(x1, y1);
    await sleep(200);
    await this.#page.mouse.down();
    await sleep(100);
    await this.move(x2, y2, ms);
    await sleep(100);
    await this.#page.mouse.up();
  }
}

// ── 5. scenes ───────────────────────────────────────────────────────────────

/** From this time on, the camera frames this box (null: the whole screen). */
interface Focus {
  t: number;
  box: Box | null;
}

interface Scene {
  n: number;
  name: string;
  /** Screen scenes: the recording, the kept time ranges and the camera. */
  rec?: Footage;
  /**
   * Screen times where something pops in (a clip, a waveform, a filter): the picture eases from
   * the frame before into the new one over ~0.3 s instead of switching at once.
   */
  softs?: number[];
  keep: [number, number][];
  focus: Focus[];
  caption: string | null;
  fadeIn?: number;
  fadeOut?: number;
}

/** Minimum scene lengths (seconds); the voice can make a scene longer. */
const TARGET: Record<number, number> = {
  1: 2.4,
  2: 4,
  3: 5,
  4: 5,
  5: 6,
  6: 8,
  7: 4.5,
  9: 7,
  10: 4.5,
};
/** Voice starts this long into a scene and the scene keeps this much after it. */
const LEAD = 0.4;
const TAIL = 0.6;
/** The payoff: before | after split, then the finished reel playing. */
const SPLIT_SECONDS = 2.8;
const PLAY_SECONDS = 8.5;

function sceneMin(n: number, vo: VoiceLine[]): number {
  const line = vo[n - 1];
  return Math.max(TARGET[n] ?? 4, LEAD + (line?.seconds ?? 0) + TAIL);
}

const cardUrl = (query: string) => `${pathToFileURL(join(here, 'cards.html')).href}?${query}`;

async function recordCard(
  page: Page,
  card: 'title' | 'code' | 'end',
  n: number,
  seconds: number,
): Promise<Scene> {
  await page.goto(cardUrl(`card=${card}&d=${seconds.toFixed(2)}`));
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await sleep(300);
  const rec = await Recorder.start(page, `card-${card}`);
  await sleep(250);
  const t0 = now();
  await page.evaluate(() => document.body.classList.add('go'));
  await sleep(seconds * 1000 + 300);
  await rec.stop();
  return { n, name: card, rec, keep: [[t0, t0 + seconds]], focus: [], caption: null };
}

interface MainItem {
  id: string;
  name: string;
  start: number;
  duration: number;
  sourceIn: number;
}

interface EditorState {
  main: MainItem[];
  tracks: { kind: string; items: { id: string; name: string }[] }[];
  pps: number;
}

async function editorState(page: Page): Promise<EditorState> {
  return page.evaluate((ticks) => {
    interface Item {
      id: string;
      duration: number;
      start: number;
      sourceIn?: number;
      assetId?: string;
      text?: string;
    }
    interface Ctl {
      project: {
        tracks: { kind: string; items: Item[] }[];
        assets: Record<string, { name: string }>;
      };
      ui: { getState(): { pxPerSecond: number } };
    }
    const c = (window as unknown as { vuEditor: Ctl }).vuEditor;
    const p = c.project;
    const name = (i: Item) => (i.assetId && p.assets[i.assetId]?.name) || i.text || '';
    return {
      main: p.tracks[0]!.items.map((i) => ({
        id: i.id,
        name: name(i),
        start: i.start / ticks,
        duration: i.duration / ticks,
        sourceIn: (i.sourceIn ?? 0) / ticks,
      })),
      tracks: p.tracks.map((t) => ({
        kind: t.kind,
        items: t.items.map((i) => ({ id: i.id, name: name(i) })),
      })),
      pps: c.ui.getState().pxPerSecond,
    };
  }, TICKS);
}

/** Screen regions (CSS px) of the editor at 1470 × 956. */
const R = {
  railPanel: { x: 0, y: 48, width: 368, height: 607 },
  panelStage: { x: 0, y: 48, width: 1190, height: 607 },
  stageInspector: { x: 368, y: 48, width: 1102, height: 607 },
};

interface EditorResult {
  scenes: Scene[];
  /** The reel's main track at export time (for the before | after). */
  main: MainItem[];
  errors: string[];
  /** When the files were handed to the editor and when all six were on the timeline. */
  importAt: [number, number];
}

const audioItems = (s: EditorState) =>
  s.tracks.filter((t) => t.kind === 'audio').reduce((n, t) => n + t.items.length, 0);

async function recordEditor(page: Page): Promise<EditorResult> {
  const hand = new Hand(page);
  const ctl = <T>(fn: string) => page.evaluate(fn) as Promise<T>;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 300));
  });

  await page.goto(`${BASE}/editor?backend=webgl2&autosave=0&assistant=0&sounds=0`);
  await page.waitForFunction(
    () => (window as unknown as { vuEditor?: { engine?: unknown } }).vuEditor?.engine,
    null,
    { timeout: 60_000 },
  );
  await page.waitForSelector('.vu-stage-canvas');
  // A 16:9 project named for the trip. The stage's Add media then puts several files in the
  // order given (the "start" place; the default "playhead" place reverses them — see README).
  await ctl(`(() => {
    const c = vuEditor;
    c.run('Weekend away', (d) => { d.name = 'Weekend away'; d.settings.width = 1920; d.settings.height = 1080; });
    c.pickFiles = () => Object.getPrototypeOf(c).pickFiles.call(c, 'start');
  })()`);
  await sleep(1500);
  await hand.jump(1080, 420);
  const frame = (await page.locator('.vu-stage-frame').boundingBox())!;
  const tl = (await page.locator('.vu-timeline-canvas canvas').boundingBox())!;
  const header = await page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.querySelector('.vu-root')!).getPropertyValue(
        '--vu-size-timeline-header',
      ),
    ),
  );
  const x0 = tl.x + header + 16;
  const rowY = tl.y + 24 + 6 + 28;
  const timelineBox = { x: tl.x + 60, y: tl.y + 20, width: 760, height: 220 };

  const rec = await Recorder.start(page, 'editor');
  const scenes: Scene[] = [];
  let focus: Focus[] = [];
  const cam = (box: Box | null) => focus.push({ t: now(), box });
  let softs: number[] = [];
  /** Marks that something just popped in (call right after the click that caused it). */
  const soft = () => softs.push(now() - 0.06);
  const push = (
    n: number,
    name: string,
    keep: [number, number][],
    caption: string,
    extra: Partial<Scene> = {},
  ) => {
    scenes.push({ n, name, rec, keep, focus, softs, caption, ...extra });
    focus = [];
    softs = [];
  };
  await sleep(500);
  let importAt: [number, number] | undefined;

  // Scene 2: the raw clips, as they are.
  {
    const a = now();
    cam(null);
    const chooser = page.waitForEvent('filechooser');
    await hand.click(page.locator('.vu-stage button', { hasText: 'Add media' }), 250);
    // Vertical clips fill the 16:9 frame (no side bars) as soon as they land.
    await ctl(`window.__promoFill = setInterval(() => {
      const items = vuEditor.project.tracks[0].items;
      if (items.some((i) => i.fit !== 'fill'))
        vuEditor.run('Fill', (d) => { for (const i of d.tracks[0].items) i.fit = 'fill'; });
    }, 20)`);
    const handedAt = now();
    await (await chooser).setFiles(CLIP_SPECS.map((c) => join(RAW, `${c.name}.mp4`)));
    await page.waitForFunction(
      (n) =>
        (window as unknown as { vuEditor: { project: { tracks: { items: unknown[] }[] } } })
          .vuEditor.project.tracks[0]!.items.length === n,
      CLIP_SPECS.length,
      { timeout: 60_000 },
    );
    importAt = [handedAt, now()];
    await sleep(150);
    await ctl('clearInterval(window.__promoFill)');
    const names = (await editorState(page)).main.map((m) => m.name.replace(/\.mp4$/, ''));
    if (names.join() !== CLIP_SPECS.map((c) => c.name).join())
      throw new Error(`clips landed out of order: ${names.join(', ')}`);
    await sleep(1100);
    await hand.click(page.locator('.vu-play'), 200);
    cam(frame);
    await hand.move(1240, 600, 700);
    await sleep(2900);
    // The clips arrive one by one (rows and thumbnails fill in over ~1 s): cut from the hand-off
    // to when all six are in, so the shot goes straight from the click to the full timeline.
    push(
      2,
      'raw',
      [
        [a, handedAt + 0.15],
        [importAt[1] + 1.0, now()],
      ],
      'Six raw clips. Pretty flat.',
      { fadeIn: 0.3 },
    );
    await ctl('vuEditor.pause()');
    await ctl('vuEditor.seek(0)');
    await sleep(300);
  }

  // Scene 3: trim the plane and the beach to their best 3 s.
  {
    const a = now();
    cam({ x: tl.x + 90, y: tl.y + 20, width: 700, height: 70 });
    await sleep(350);
    for (const index of [0, 1]) {
      const s = await editorState(page);
      const clip = s.main[index]!;
      await hand.clickAt(x0 + (clip.start + clip.duration * 0.45) * s.pps, rowY, 150);
      await sleep(250);
      // The end handle sits just past the clip's end.
      const endX = x0 + (clip.start + clip.duration) * s.pps + 4;
      await hand.drag(endX, rowY, endX - 1 * s.pps, rowY, 650);
      await sleep(350);
    }
    const s = await editorState(page);
    console.log(
      `  after trims: ${s.main.map((m) => `${m.name}:${m.duration.toFixed(1)}`).join(' ')}`,
    );
    await sleep(400);
    push(3, 'trim', [[a, now()]], 'Trim to the best moments');
  }

  // Scene 4: a colour look on every clip, a dissolve on every cut.
  {
    const a = now();
    cam(R.railPanel);
    await sleep(300);
    await hand.click(page.locator('.vu-rail .vu-btn', { hasText: 'Filters' }), 160);
    await sleep(300);
    await hand.click(page.locator('.vu-panel .vu-filter-tile', { hasText: /^Vivid$/ }), 220);
    soft();
    await sleep(300);
    await hand.click(page.locator('.vu-panel .vu-btn', { hasText: 'Apply to all clips' }), 160);
    soft();
    cam(frame);
    await sleep(1300);
    cam(R.railPanel);
    await hand.click(page.locator('.vu-rail .vu-btn', { hasText: 'Transitions' }), 160);
    await sleep(300);
    await hand.click(page.locator('.vu-panel .vu-transition-tile', { hasText: /^Dissolve$/ }), 220);
    await sleep(350);
    await hand.click(page.locator('.vu-panel .vu-btn', { hasText: /^Apply to all$/ }).first(), 160);
    await sleep(600);
    push(4, 'look', [[a, now()]], 'Colour and transitions');
  }

  // Scene 5: music and a big animated title.
  {
    await page.keyboard.press('Escape');
    await ctl('vuEditor.seek(0)');
    const a = now();
    cam(R.railPanel);
    await hand.click(page.locator('.vu-rail .vu-btn', { hasText: 'Audio' }), 160);
    await sleep(300);
    const chooser = page.waitForEvent('filechooser');
    await hand.click(page.locator('.vu-panel .vu-btn', { hasText: 'Add music or sound' }), 200);
    await (await chooser).setFiles(MUSIC_FILE);
    await page.waitForFunction(
      () =>
        (
          window as unknown as { vuEditor: { project: { tracks: { kind: string }[] } } }
        ).vuEditor.project.tracks.some((t) => t.kind === 'audio'),
      null,
      { timeout: 30_000 },
    );
    softs.push(now() - 0.12);
    cam(timelineBox);
    await hand.move(520, tl.y + 200, 500);
    await sleep(500);
    cam(R.railPanel);
    await page.keyboard.press('Escape');
    await ctl('vuEditor.seek(0)');
    await hand.click(page.locator('.vu-rail .vu-btn', { hasText: 'Text' }), 160);
    await sleep(300);
    await hand.click(page.locator('.vu-textstyle[aria-label="Bold · Cream 3D"]'), 220);
    soft();
    await sleep(250);
    // Big and a little above centre (dragging the size slider on camera would take a while).
    soft();
    await ctl(`vuEditor.run('Title size', (d) => {
      for (const t of d.tracks) for (const i of t.items)
        if (i.kind === 'text') { i.style.size = 0.15; i.transform.y = 0.44; }
    })`);
    cam(R.stageInspector);
    const area = page.locator('.vu-inspector .vu-textarea').first();
    await area.waitFor();
    await hand.click(area, 160);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Weekend away', { delay: 55 });
    await sleep(300);
    cam(R.panelStage);
    await hand.click(page.locator('.vu-rail .vu-btn', { hasText: 'Transitions' }), 160);
    await sleep(350);
    await hand.click(page.locator('.vu-panel .vu-transition-tile', { hasText: /^Pop$/ }), 220);
    // Choosing an animation plays it in the preview.
    cam(frame);
    await hand.move(1240, 600, 500);
    await sleep(1300);
    push(5, 'title', [[a, now()]], 'Music and an animated title');
  }

  // Scene 6: AI voiceover from typed text, then auto captions on it.
  {
    await page.keyboard.press('Escape');
    await ctl(`vuEditor.seek(${NARRATION_AT * TICKS})`);
    const a = now();
    const cuts: [number, number][] = [];
    cam(R.railPanel);
    await hand.click(page.locator('.vu-rail .vu-btn', { hasText: 'Audio' }), 160);
    await sleep(300);
    await hand.click(page.locator('.vu-panel textarea[aria-label="Text to speech"]'), 160);
    await page.keyboard.type(NARRATION, { delay: 24 });
    await sleep(250);
    await hand.click(page.locator('.vu-panel .vu-chip', { hasText: /^Aoede$/ }), 160);
    const before = audioItems(await editorState(page));
    await hand.click(page.locator('.vu-panel .vu-btn', { hasText: 'Add voice' }), 200);
    await sleep(600);
    let cutFrom = now();
    await page
      .waitForFunction(
        (n) =>
          (
            window as unknown as {
              vuEditor: { project: { tracks: { kind: string; items: unknown[] }[] } };
            }
          ).vuEditor.project.tracks
            .filter((t) => t.kind === 'audio')
            .reduce((s, t) => s + t.items.length, 0) > n,
        before,
        { timeout: 90_000 },
      )
      .catch(async () => {
        const msg = await page
          .locator('.vu-panel .vu-error, .vu-panel [role=alert]')
          .allInnerTexts();
        throw new Error(`text to speech added no clip: ${msg.join(' ') || 'timed out'}`);
      });
    cuts.push([cutFrom, now() - 0.2]);
    cam(timelineBox);
    await hand.move(420, tl.y + 190, 450);
    await sleep(450);
    cam(R.railPanel);
    await hand.click(page.locator('.vu-rail .vu-btn', { hasText: 'Captions' }), 160);
    await sleep(300);
    await hand.click(page.locator('.vu-panel .vu-chip', { hasText: /^English$/ }), 160);
    await hand.click(page.locator('.vu-panel .vu-btn', { hasText: 'Make captions' }), 200);
    await sleep(600);
    cutFrom = now();
    await page
      .waitForFunction(
        () =>
          (
            window as unknown as {
              vuEditor: { project: { tracks: { kind: string; items: unknown[] }[] } };
            }
          ).vuEditor.project.tracks.some((t) => t.kind === 'caption' && t.items.length > 0),
        null,
        { timeout: 120_000 },
      )
      .catch(async () => {
        const msg = await page
          .locator('.vu-panel .vu-error, .vu-panel [role=alert]')
          .allInnerTexts();
        throw new Error(`auto captions made nothing: ${msg.join(' ') || 'timed out'}`);
      });
    // Speech to text sometimes hears "our weekend away" as "our week underway": fixed the way a
    // person would, in the caption's own text (logged, and in the report).
    const fixed = await ctl<string[]>(`(() => {
      const c = vuEditor;
      const out = [];
      for (const t of c.project.tracks) if (t.kind === 'caption') for (const i of t.items) {
        const next = i.text.replace(/\\bweek\\s*(end)?\\s*(under)?\\s*a?way\\b/i, 'weekend away');
        if (next !== i.text) { out.push(i.text + ' → ' + next); c.setCaptionText(i.id, next); }
      }
      return out;
    })()`);
    if (fixed.length) console.log(`  caption fixed: ${fixed.join('; ')}`);
    await sleep(200);
    cuts.push([cutFrom, now() - 0.2]);
    await sleep(300);
    await hand.click(page.locator('.vu-panel .vu-caption-preset', { hasText: 'Karaoke' }), 200);
    await sleep(300);
    // Watch them from the start of the narration.
    await ctl(`vuEditor.seek(${(NARRATION_AT + 0.2) * TICKS})`);
    cam(frame);
    await hand.move(1240, 600, 600);
    await ctl('vuEditor.play()');
    await sleep(2700);
    const end = now();
    await ctl('vuEditor.pause()');
    const keep: [number, number][] = [];
    let from = a;
    for (const [c0, c1] of cuts) {
      keep.push([from, c0]);
      from = c1;
    }
    keep.push([from, end]);
    push(6, 'ai', keep, 'AI voiceover and auto captions');
  }

  // Quietly: the music gets quieter under the narration.
  await ctl(`(() => {
    const c = vuEditor;
    const music = c.project.tracks.flatMap((t) => t.items).find((i) => i.kind === 'audio' && c.project.assets[i.assetId]?.name === 'Summer Fun.mp3');
    if (music) { c.select(music.id); c.toggleDuckSelected(); c.select(null); }
  })()`).catch((e: Error) => errors.push(`duck: ${e.message}`));
  const state = await editorState(page);
  console.log(`  tracks: ${state.tracks.map((t) => `${t.kind}:${t.items.length}`).join(' ')}`);

  // Scene 7: export, then save the file (the wait in the middle is cut).
  {
    await page.keyboard.press('Escape');
    await ctl('vuEditor.seek(0)');
    await sleep(200);
    const a = now();
    cam(null);
    await hand.click(page.locator('.vu-topbar .vu-btn', { hasText: 'Export' }), 200);
    await sleep(400);
    cam((await page.locator('.vu-modal').boundingBox())!);
    await hand.click(page.locator('.vu-modal .vu-export-option', { hasText: '1080p' }), 200);
    await sleep(250);
    await hand.click(page.locator('.vu-modal .vu-btn', { hasText: 'Export video' }), 200);
    await sleep(1100);
    const cut = now();
    const t0 = Date.now();
    const link = page.locator('.vu-modal a[download]');
    await link.waitFor({ timeout: 300_000 });
    console.log(`  export took ${((Date.now() - t0) / 1000 + 1.1).toFixed(1)} s`);
    const done = now();
    await sleep(900);
    const download = page.waitForEvent('download');
    await hand.click(link, 220);
    await (await download).saveAs(REEL_FILE);
    await sleep(700);
    push(
      7,
      'export',
      [
        [a, cut],
        // The Done preview's video player shows a loading ring for up to ~1 s first.
        [done + 1.1, now()],
      ],
      'Export MP4 in the browser',
      { fadeOut: 0.3 },
    );
  }
  await rec.stop();
  return { scenes, main: state.main, errors, importAt: importAt ?? [0, 0] };
}

// ── 6. compose ──────────────────────────────────────────────────────────────

/** Serves promo/work to the compositor page (same origin, so canvases stay readable). */
async function serveWork(): Promise<{ server: Server; url: string }> {
  const types: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png' };
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><body style="margin:0;background:#000"></body></html>');
      return;
    }
    const file = resolve(WORK, `.${path}`);
    if (!file.startsWith(WORK + sep) || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** One output frame, drawn by the compositor page. */
interface Draw {
  /** Screen frame (URL) and the camera: the visible CSS-px rect (height follows the aspect). */
  src?: string;
  cam?: { x: number; y: number; w: number };
  /** A crossfade: this screen frame is drawn first and the main one over it at opacity `a`. */
  under?: { src: string; cam: { x: number; y: number; w: number }; a: number; zoom?: number };
  /** Scale of the main picture about the centre (the push-in from the title). */
  zoom?: number;
  /** Payoff: the finished reel frame, the raw frame and the split position (0–1). */
  after?: string;
  before?: string;
  split?: number;
  caption: string | null;
  /** Caption opacity 0–1. */
  cap: number;
}

/** Runs in the compositor page: installs `window.compose(draw)` → JPEG data URL. */
function compositor(size: { W: number; H: number; DPR: number; VW: number; VH: number }): void {
  const { W, H, VW, VH } = size;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  document.body.append(canvas);
  const g = canvas.getContext('2d')!;
  const cache = new Map<string, ImageBitmap>();
  const load = async (src: string): Promise<ImageBitmap> => {
    const hit = cache.get(src);
    if (hit) return hit;
    const bmp = await createImageBitmap(await (await fetch(src)).blob());
    if (cache.size > 6) {
      const first = cache.keys().next().value!;
      cache.get(first)!.close();
      cache.delete(first);
    }
    cache.set(src, bmp);
    return bmp;
  };
  const sans = '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
  const pill = (text: string, alpha: number): void => {
    g.save();
    g.font = `600 30px ${sans}`;
    const w = g.measureText(text).width + 56;
    const h = 54;
    const x = (W - w) / 2;
    const y = 76 + (1 - alpha) * 8;
    g.globalAlpha = alpha;
    // Frosted glass: the picture under the pill, blurred, then a dark tint.
    g.save();
    g.beginPath();
    g.roundRect(x, y, w, h, h / 2);
    g.clip();
    g.filter = 'blur(14px)';
    g.drawImage(canvas, x - 20, y - 20, w + 40, h + 40, x - 20, y - 20, w + 40, h + 40);
    g.filter = 'none';
    g.fillStyle = 'rgba(14, 14, 18, 0.66)';
    g.fillRect(x, y, w, h);
    g.restore();
    g.beginPath();
    g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, h / 2);
    g.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(text, x + 28, y + h / 2 + 1);
    g.restore();
  };
  const chip = (text: string, x: number, y: number, right: boolean): void => {
    g.save();
    g.font = `600 26px ${sans}`;
    const w = g.measureText(text).width + 36;
    const left = right ? x - w : x;
    g.fillStyle = 'rgba(10, 10, 14, 0.62)';
    g.beginPath();
    g.roundRect(left, y, w, 44, 22);
    g.fill();
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(text, left + 18, y + 23);
    g.restore();
  };
  (window as unknown as { compose: (d: Draw) => Promise<string> }).compose = async (d) => {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (d.src && d.cam) {
      const img = await load(d.src);
      // Frame pixels per CSS px (2 when the screencast is at device pixels).
      const k = img.width / VW;
      const h = (d.cam.w * VH) / VW;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      // Destination rect for a scale about the centre.
      const dest = (z = 1): [number, number, number, number] => [
        (W - W * z) / 2,
        (H - H * z) / 2,
        W * z,
        H * z,
      ];
      if (d.under) {
        const u = await load(d.under.src);
        const uk = u.width / VW;
        const uh = (d.under.cam.w * VH) / VW;
        g.drawImage(
          u,
          d.under.cam.x * uk,
          d.under.cam.y * uk,
          d.under.cam.w * uk,
          uh * uk,
          ...dest(d.under.zoom),
        );
        g.globalAlpha = d.under.a;
      }
      g.drawImage(img, d.cam.x * k, d.cam.y * k, d.cam.w * k, h * k, ...dest(d.zoom));
      g.globalAlpha = 1;
    } else if (d.after) {
      // Payoff: the reel in a rounded card on the plum background.
      const bg = g.createRadialGradient(W / 2, -120, 40, W / 2, -120, 1300);
      bg.addColorStop(0, '#3a1d3a');
      bg.addColorStop(0.55, '#140f16');
      bg.addColorStop(1, '#0b0b0d');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      const cw = 1600;
      const ch = 900;
      const cx = (W - cw) / 2;
      const cy = 200;
      g.save();
      g.shadowColor = 'rgba(0, 0, 0, 0.6)';
      g.shadowBlur = 60;
      g.shadowOffsetY = 24;
      g.fillStyle = '#000';
      g.beginPath();
      g.roundRect(cx, cy, cw, ch, 28);
      g.fill();
      g.restore();
      g.save();
      g.beginPath();
      g.roundRect(cx, cy, cw, ch, 28);
      g.clip();
      g.drawImage(await load(d.after), cx, cy, cw, ch);
      if (d.before && d.split !== undefined) {
        const sx = cx + cw * d.split;
        g.save();
        g.beginPath();
        g.rect(cx, cy, sx - cx, ch);
        g.clip();
        g.drawImage(await load(d.before), cx, cy, cw, ch);
        g.restore();
        g.fillStyle = '#fff';
        g.fillRect(sx - 2, cy, 4, ch);
        g.beginPath();
        g.arc(sx, cy + ch / 2, 22, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#7a2f7a';
        g.beginPath();
        g.moveTo(sx - 13, cy + ch / 2);
        g.lineTo(sx - 4, cy + ch / 2 - 8);
        g.lineTo(sx - 4, cy + ch / 2 + 8);
        g.moveTo(sx + 13, cy + ch / 2);
        g.lineTo(sx + 4, cy + ch / 2 - 8);
        g.lineTo(sx + 4, cy + ch / 2 + 8);
        g.fill();
        if (d.split > 0.12) chip('Before', cx + 24, cy + 24, false);
        if (d.split < 0.88) chip('After', cx + cw - 24, cy + 24, true);
      }
      g.restore();
      g.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(cx, cy, cw, ch, 28);
      g.stroke();
    }
    if (d.caption && d.cap > 0.01) pill(d.caption, d.cap);
    return canvas.toDataURL('image/jpeg', 0.93);
  };
}

/** The camera rect for a focus box: zoom 1–1.6×, the box fully in view and clear of the caption. */
function cameraFor(box: Box | null, captioned: boolean): { x: number; y: number; w: number } {
  if (!box) return { x: 0, y: 0, w: VW };
  const pw = box.width * 1.16 + 40;
  const ph = box.height * 1.16 + 40;
  const z = Math.max(1, Math.min(1.6, VW / pw, VH / ph));
  const w = VW / z;
  const h = VH / z;
  let x = box.x + box.width / 2 - w / 2;
  let y = box.y + box.height / 2 - h / 2;
  // The caption pill takes the top ~11 % of the picture: keep the box below it.
  if (captioned) y = Math.min(y, box.y - 0.115 * h);
  x = Math.max(0, Math.min(VW - w, x));
  y = Math.max(0, Math.min(VH - h, y));
  return { x, y, w };
}

const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const CAM_EASE = 0.75;
/** Length of the crossfades over cuts and pop-ins. */
const CROSSFADE = 0.33;
/** Length of the push from the title card into the editor. */
const INTRO = 0.5;

/** The camera at screen time t: it eases from wherever it was to each new focus. */
function cameraAt(
  focus: Focus[],
  t: number,
  captioned: boolean,
): { x: number; y: number; w: number } {
  const full = { x: 0, y: 0, w: VW };
  let from = full;
  let to = full;
  let since = -Infinity;
  const at = (u: number) => {
    const e = Number.isFinite(since) ? ease(Math.min(1, (u - since) / CAM_EASE)) : 1;
    return {
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      w: from.w + (to.w - from.w) * e,
    };
  };
  for (const f of focus) {
    if (f.t > t) break;
    from = at(f.t);
    to = cameraFor(f.box, captioned);
    since = f.t;
  }
  return at(t);
}

/** Screen time shown at scene time u (kept ranges back to back; holds the last frame). */
function screenTime(keep: [number, number][], u: number): number {
  let left = u;
  for (const [a, b] of keep) {
    if (left < b - a) return a + left;
    left -= b - a;
  }
  return keep.at(-1)![1] - 1e-3;
}

const keptSeconds = (keep: [number, number][]) => keep.reduce((s, [a, b]) => s + b - a, 0);

function frameAt(frames: Frame[], t: number): Frame {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo]!;
}

const capAlpha = (u: number, seconds: number) =>
  Math.max(0, Math.min(1, (u - 0.25) / 0.35, (seconds - 0.2 - u) / 0.3));

class Composer {
  readonly #page: Page;
  readonly #url: string;
  constructor(page: Page, url: string) {
    this.#page = page;
    this.#url = url;
  }

  path(file: string): string {
    return `${this.#url}/${file
      .slice(WORK.length + 1)
      .split(sep)
      .map(encodeURIComponent)
      .join('/')}`;
  }

  /** Draws every frame of a scene into a numbered JPEG sequence, then encodes it. */
  async scene(scene: Scene, seconds: number, draw: (u: number) => Draw): Promise<string> {
    const dir = join(SCENES, `s${scene.n}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const count = Math.round(seconds * FPS);
    let last = '';
    let lastFile = '';
    for (let i = 0; i < count; i++) {
      const d = draw(i / FPS);
      const key = JSON.stringify(d);
      const file = join(dir, `${String(i).padStart(5, '0')}.jpg`);
      if (key === last) copyFileSync(lastFile, file);
      else {
        const url = await this.#page.evaluate(
          (x) => (window as unknown as { compose: (d: Draw) => Promise<string> }).compose(x),
          d,
        );
        writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
        last = key;
        lastFile = file;
      }
    }
    const out = join(SCENES, `scene-${scene.n}.mp4`);
    const filters = ['format=yuv420p'];
    if (scene.fadeIn) filters.push(`fade=t=in:st=0:d=${scene.fadeIn}`);
    if (scene.fadeOut)
      filters.push(`fade=t=out:st=${(seconds - scene.fadeOut).toFixed(3)}:d=${scene.fadeOut}`);
    ff([
      '-framerate',
      `${FPS}`,
      '-i',
      join(dir, '%05d.jpg'),
      '-vf',
      filters.join(','),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '12',
      '-r',
      `${FPS}`,
      out,
    ]);
    return out;
  }

  /** A screen scene; `intro`: a frame to push in from (the title's last frame). */
  screen(scene: Scene, seconds: number, intro?: string): Promise<string> {
    const rec = scene.rec!;
    const captioned = scene.caption !== null;
    const r = (v: number) => Math.round(v * 100) / 100;
    const view = (t: number) => {
      const c = cameraAt(scene.focus, t, captioned);
      return { x: r(c.x), y: r(c.y), w: r(c.w) };
    };
    // Crossfades: at each cut between kept ranges (from the last frame before the cut), and at
    // each "soft" moment (from the frame just before it).
    const fades: { u: number; from: number }[] = [];
    let at = 0;
    for (const [i, [a, b]] of scene.keep.entries()) {
      if (i > 0) fades.push({ u: at, from: scene.keep[i - 1]![1] - 0.02 });
      for (const soft of scene.softs ?? [])
        if (soft >= a && soft < b) fades.push({ u: at + soft - a, from: soft - 0.02 });
      at += b - a;
    }
    return this.scene(scene, seconds, (u) => {
      const t = screenTime(scene.keep, u);
      const d: Draw = {
        src: this.path(frameAt(rec.frames, t).file),
        cam: view(t),
        caption: scene.caption,
        cap: Math.round(capAlpha(u, seconds) * 50) / 50,
      };
      if (intro && u < INTRO) {
        // Keep pushing into the title while the editor comes forward from slightly larger.
        const e = ease(u / INTRO);
        d.under = { src: intro, cam: { x: 0, y: 0, w: VW }, a: r(e), zoom: r(1 + 0.45 * e) };
        d.zoom = r(1.14 - 0.14 * e);
        return d;
      }
      const f = fades.find((x) => u >= x.u && u < x.u + CROSSFADE);
      if (f)
        d.under = {
          src: this.path(frameAt(rec.frames, f.from).file),
          cam: view(f.from),
          a: Math.round(ease((u - f.u) / CROSSFADE) * 100) / 100,
        };
      return d;
    });
  }
}

/** Extracts a 30 fps JPEG sequence from a video (1920 × 1080, filled). */
function videoFrames(src: string, from: number, seconds: number, dir: string): string[] {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  ff([
    '-ss',
    from.toFixed(3),
    '-i',
    src,
    '-t',
    seconds.toFixed(3),
    '-vf',
    `fps=${FPS},scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080`,
    '-q:v',
    '2',
    join(dir, '%05d.jpg'),
  ]);
  return readdirSync(dir)
    .sort()
    .map((f) => join(dir, f));
}

// ── 7. mix ──────────────────────────────────────────────────────────────────

/** Loudness measurement (ffmpeg's loudnorm prints JSON to stderr). */
function loudness(args: string[]): Record<string, string> {
  const res = execFileSync(
    'sh',
    [
      '-c',
      `ffmpeg -nostdin -hide_banner -nostats ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')} -f null - 2>&1`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(res.slice(res.lastIndexOf('{'), res.lastIndexOf('}') + 1)) as Record<
    string,
    string
  >;
}

/** Where the promo's music bed starts in the song (its livelier middle). */
const BED_FROM = 30;

/**
 * Music bed (the song) → the finished reel's own sound during the payoff (the same song from its
 * start, plus its narration) → the song again from where the reel left off. Ducked ~20 dB under
 * the voiceover, voice on top, normalised to -16 LUFS.
 */
function mix(vo: VoiceLine[], starts: number[], total: number, play: [number, number]): string {
  const out = join(WORK, 'mix.wav');
  const voGain = vo.map(
    (v) => -16 - Number(loudness(['-i', v.file, '-af', 'loudnorm=print_format=json']).input_i),
  );
  const musicI = Number(
    loudness([
      '-ss',
      `${BED_FROM}`,
      '-t',
      '40',
      '-i',
      MUSIC_SRC,
      '-af',
      'loudnorm=print_format=json',
    ]).input_i,
  );
  const musicGain = -21 - musicI;
  const spans: [number, number][] = [];
  for (const [i, v] of vo.entries()) {
    const s = starts[i]!;
    const e = s + v.seconds;
    const last = spans.at(-1);
    if (last && s - last[1] < 1.2) last[1] = e;
    else spans.push([s, e]);
  }
  const ramp = (s: number, e: number) =>
    `clip(min((t-${(s - 0.3).toFixed(3)})/0.3\\,(${(e + 0.6).toFixed(3)}-t)/0.6)\\,0\\,1)`;
  const duckExpr = spans.reduce<string>(
    (acc, [s, e]) => (acc ? `max(${acc}\\,${ramp(s, e)})` : ramp(s, e)),
    '',
  );
  const [p0, p1] = play;
  const x = 0.4; // crossfades
  // Rendered in small steps, each part padded to the full length (one big graph with long
  // delays and an open-ended pad sometimes made ffmpeg spin forever).
  const fmt = 'aresample=48000,aformat=channel_layouts=stereo';
  const ms = (s: number) => Math.round(s * 1000);
  const len = total.toFixed(3);
  const part = (name: string, input: string[], filter: string): string => {
    const file = join(WORK, `mix-${name}.wav`);
    ff([
      ...input,
      '-af',
      `${fmt},${filter},apad=whole_dur=${len},atrim=0:${len}`,
      '-c:a',
      'pcm_s16le',
      file,
    ]);
    return file;
  };
  const bed = part(
    'bed',
    ['-ss', `${BED_FROM}`, '-t', (p0 + x).toFixed(3), '-i', MUSIC_SRC],
    `afade=t=in:d=1,afade=t=out:st=${(p0 - 0.05).toFixed(3)}:d=${x}`,
  );
  const reel = part(
    'reel',
    ['-t', (p1 - p0 + x).toFixed(3), '-i', REEL_FILE],
    `afade=t=in:d=${x},afade=t=out:st=${(p1 - p0).toFixed(3)}:d=${x},adelay=${ms(p0 - 0.05)}:all=1`,
  );
  const tail = part(
    'tail',
    ['-ss', (p1 - p0 - x).toFixed(3), '-t', (total - p1 + x).toFixed(3), '-i', MUSIC_SRC],
    `afade=t=in:d=${x},afade=t=out:st=${(total - p1 - 2 + x).toFixed(3)}:d=2,adelay=${ms(p1 - x)}:all=1`,
  );
  const music = join(WORK, 'mix-music.wav');
  ff([
    '-i',
    bed,
    '-i',
    reel,
    '-i',
    tail,
    '-filter_complex',
    `[0:a][1:a][2:a]amix=inputs=3:normalize=0:duration=first,volume=${musicGain.toFixed(2)}dB,` +
      `volume='1-0.9*(${duckExpr})':eval=frame[m]`,
    '-map',
    '[m]',
    '-c:a',
    'pcm_s16le',
    music,
  ]);
  const voices = vo.map((v, i) =>
    part(
      `vo-${i + 1}`,
      ['-i', v.file],
      `volume=${voGain[i]!.toFixed(2)}dB,adelay=${ms(starts[i]!)}:all=1`,
    ),
  );
  const pre = join(WORK, 'mix-pre.wav');
  ff([
    '-i',
    music,
    ...voices.flatMap((f) => ['-i', f]),
    '-filter_complex',
    `${[music, ...voices].map((_, i) => `[${i}:a]`).join('')}amix=inputs=${voices.length + 1}:normalize=0:duration=first[pre]`,
    '-map',
    '[pre]',
    '-c:a',
    'pcm_s16le',
    pre,
  ]);
  const m = loudness(['-i', pre, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json']);
  ff([
    '-i',
    pre,
    '-af',
    `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
      `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:` +
      'linear=true,aresample=48000',
    '-c:a',
    'pcm_s16le',
    out,
  ]);
  const after = loudness(['-i', out, '-af', 'loudnorm=print_format=json']);
  console.log(`  mix: ${after.input_i} LUFS, true peak ${after.input_tp} dBTP`);
  return out;
}

const vttTime = (s: number): string => {
  const ms = Math.round(s * 1000);
  const hh = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${String(ms % 1000).padStart(3, '0')}`;
};

// ── main ────────────────────────────────────────────────────────────────────

console.log('1. prepare clips');
prepare();
console.log('2. voice');
const vo = await renderVoice(LINES);

/** The timeline the mix and captions are built from (saved, so --from-mix can redo audio). */
interface Plan {
  total: number;
  starts: number[];
  playSpan: [number, number];
  importAt: [number, number];
  scenes: string[];
}

/** Records every scene and the poster (frames on disk, scene timing in recorded.json). */
async function record(vo: VoiceLine[]): Promise<Recorded> {
  console.log('3. record');
  const browser: Browser = await chromium.launch({
    channel: 'chrome',
    headless: !HEADED,
    // Screencast frames come at the window's device pixels: 2× and exactly the viewport.
    args: [`--force-device-scale-factor=${DPR}`, `--window-size=${VW},${VH}`],
  });
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: DPR,
    acceptDownloads: true,
  });
  const cardPage = await context.newPage();
  const editorPage = await context.newPage();
  await editorPage.addInitScript(overlay);

  const scenes: Scene[] = [];
  scenes.push(await recordCard(cardPage, 'title', 1, sceneMin(1, vo)));
  await editorPage.bringToFront();
  const edit = await recordEditor(editorPage);
  scenes.push(...edit.scenes);
  await cardPage.bringToFront();
  scenes.push(await recordCard(cardPage, 'code', 9, sceneMin(9, vo)));
  scenes.push(await recordCard(cardPage, 'end', 10, sceneMin(10, vo)));
  if (edit.errors.length)
    console.warn(`  page errors:\n    ${edit.errors.slice(0, 10).join('\n    ')}`);

  await browser.close();
  const recorded: Recorded = {
    scenes: scenes.map((sc) => ({ ...sc, rec: sc.rec?.name ?? null })),
    main: edit.main,
    importAt: edit.importAt,
  };
  writeFileSync(RECORDED, JSON.stringify(recorded, null, 2));
  return recorded;
}

/** What a recording run leaves for composing (saved, so --from-compose can redo the edit). */
interface Recorded {
  scenes: (Omit<Scene, 'rec'> & { rec: string | null })[];
  main: MainItem[];
  importAt: [number, number];
}
const RECORDED = join(WORK, 'recorded.json');

/** Composes the silent video (promo/work/video.mp4) from a recording. */
async function compose(vo: VoiceLine[], recorded: Recorded): Promise<Plan> {
  console.log('4. compose');
  const footage = new Map<string, Footage>();
  const scenes: Scene[] = recorded.scenes.map(({ rec, ...sc }) => {
    if (rec && !footage.has(rec)) footage.set(rec, loadFootage(rec));
    return rec ? { ...sc, rec: footage.get(rec)! } : sc;
  });
  const edit = recorded;
  const browser: Browser = await chromium.launch({ channel: 'chrome' });
  // The poster: a cover with the title card's look and a frame of the finished reel.
  const posterPage = await (
    await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR })
  ).newPage();
  mkdirSync(PAYOFF, { recursive: true });
  const posterFrame = join(PAYOFF, 'poster-reel.jpg');
  ff(['-ss', '2.4', '-i', REEL_FILE, '-frames:v', '1', '-q:v', '2', posterFrame]);
  await posterPage.goto(
    cardUrl(`card=cover&reel=${encodeURIComponent(pathToFileURL(posterFrame).href)}`),
  );
  await posterPage.evaluate(() => document.fonts.ready.then(() => undefined));
  await posterPage.waitForFunction(() => [...document.images].every((i) => i.complete));
  await posterPage.evaluate(() => document.body.classList.add('still'));
  await sleep(300);
  await posterPage.screenshot({ path: join(WORK, 'poster.png') });

  const { server, url } = await serveWork();
  const composePage = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await composePage.goto(`${url}/`);
  await composePage.evaluate(compositor, { W, H, DPR, VW, VH });
  const composer = new Composer(composePage, url);
  rmSync(SCENES, { recursive: true, force: true });
  mkdirSync(SCENES, { recursive: true });

  // The payoff (scene 8): the same moment raw | finished, then the reel from its start.
  const moment = edit.main.find((m) => m.name.startsWith('beach'))!;
  const afterSplit = videoFrames(
    REEL_FILE,
    moment.start + 0.15,
    SPLIT_SECONDS + 0.2,
    join(PAYOFF, 'after'),
  );
  const beforeSplit = videoFrames(
    join(RAW, 'beach.mp4'),
    moment.sourceIn + 0.15,
    SPLIT_SECONDS + 0.2,
    join(PAYOFF, 'before'),
  );
  const reelPlay = videoFrames(REEL_FILE, 0, PLAY_SECONDS + 0.2, join(PAYOFF, 'play'));
  scenes.push({
    n: 8,
    name: 'payoff',
    keep: [],
    focus: [],
    caption: 'Before → after, in a minute, in the browser',
    fadeIn: 0.3,
  });
  scenes.sort((a, b) => a.n - b.n);

  const starts: number[] = [];
  let clock = 0;
  const parts: string[] = [];
  let playSpan: [number, number] = [0, 0];
  const pick = (list: string[], u: number) =>
    list[Math.max(0, Math.min(list.length - 1, Math.floor(u * FPS)))]!;
  for (const s of scenes) {
    if (s.n === 8) {
      const seconds = SPLIT_SECONDS + PLAY_SECONDS;
      parts.push(
        await composer.scene(s, seconds, (u) => {
          const cap = Math.round(capAlpha(u, seconds) * 50) / 50;
          if (u < SPLIT_SECONDS) {
            // Raw first, then the divider sweeps to the middle to show the finished frame.
            const p = ease(Math.max(0, Math.min(1, (u - 0.5) / 0.9)));
            return {
              after: composer.path(pick(afterSplit, u)),
              before: composer.path(pick(beforeSplit, u)),
              split: Math.round((1 - 0.5 * p) * 1000) / 1000,
              caption: s.caption,
              cap,
            };
          }
          return {
            after: composer.path(pick(reelPlay, u - SPLIT_SECONDS)),
            caption: s.caption,
            cap,
          };
        }),
      );
      starts[7] = clock + LEAD;
      playSpan = [clock + SPLIT_SECONDS, clock + seconds];
      console.log(`  scene 8 payoff: ${clock.toFixed(2)} s + ${seconds.toFixed(2)} s`);
      clock += seconds;
      continue;
    }
    let intro: string | undefined;
    if (s.n === 2) {
      // Straight in from the title: at most ~0.8 s of the empty editor before Add media.
      const first = s.keep[0]!;
      first[0] = Math.max(first[0], recorded.importAt[0] + 0.15 - 1.0);
      delete s.fadeIn;
      const title = scenes.find((x) => x.n === 1)!;
      intro = composer.path(frameAt(title.rec!.frames, title.keep[0]![1] - 0.01).file);
    }
    const seconds = Math.round(Math.max(keptSeconds(s.keep), sceneMin(s.n, vo)) * FPS) / FPS;
    parts.push(await composer.screen(s, seconds, intro));
    starts[s.n - 1] = clock + (s.n === 1 ? 0.35 : s.n === 2 ? 0.25 : s.n >= 9 ? 0.6 : LEAD);
    console.log(`  scene ${s.n} ${s.name}: ${clock.toFixed(2)} s + ${seconds.toFixed(2)} s`);
    clock += seconds;
  }
  const total = clock;
  server.close();
  await browser.close();

  const concat = join(SCENES, 'all.txt');
  writeFileSync(concat, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const silent = join(WORK, 'video.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', silent]);
  return { total, starts, playSpan, importAt: edit.importAt, scenes: scenes.map((s) => s.name) };
}

/** Records the title card again into an existing recording (keeps everything else). */
async function rerecordTitle(vo: VoiceLine[], recorded: Recorded): Promise<void> {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: [`--force-device-scale-factor=${DPR}`, `--window-size=${VW},${VH}`],
  });
  const page = await (
    await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR })
  ).newPage();
  const title = await recordCard(page, 'title', 1, sceneMin(1, vo));
  await browser.close();
  recorded.scenes = recorded.scenes.map((sc) =>
    sc.n === 1 ? { ...title, rec: title.rec?.name ?? null } : sc,
  );
  writeFileSync(RECORDED, JSON.stringify(recorded, null, 2));
}

const PLAN = join(WORK, 'plan.json');
let plan: Plan;
if (process.argv.includes('--from-mix')) plan = JSON.parse(readFileSync(PLAN, 'utf8')) as Plan;
else {
  const recorded = process.argv.includes('--from-compose')
    ? (JSON.parse(readFileSync(RECORDED, 'utf8')) as Recorded)
    : await record(vo);
  if (process.argv.includes('--rerecord-title')) await rerecordTitle(vo, recorded);
  plan = await compose(vo, recorded);
  writeFileSync(PLAN, JSON.stringify(plan, null, 2));
  // Mix and encode in a fresh process: run inside this long recording process, the mix's ffmpeg
  // sometimes spun forever (the same command finishes in seconds on its own).
  const rest = process.argv.slice(2).filter((a) => a !== '--from-compose');
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--from-mix', ...rest], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  process.exit(0);
}
const { total, starts, playSpan } = plan;
const silent = join(WORK, 'video.mp4');

console.log('5. mix');
const audio = mix(vo, starts, total, playSpan);

console.log('6. encode');
mkdirSync(OUT, { recursive: true });
const mp4 = join(OUT, 'promo.mp4');
ff([
  '-i',
  silent,
  '-i',
  audio,
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-c:v',
  'libx264',
  '-profile:v',
  'high',
  '-preset',
  'slow',
  '-crf',
  `${CRF}`,
  '-pix_fmt',
  'yuv420p',
  '-r',
  `${FPS}`,
  '-g',
  `${FPS * 2}`,
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-ar',
  '48000',
  '-movflags',
  '+faststart',
  '-shortest',
  mp4,
]);
console.log(
  `  promo.mp4 ${total.toFixed(2)} s, ${(statSync(mp4).size / 1e6).toFixed(1)} MB (crf ${CRF})`,
);

const vtt = ['WEBVTT', ''];
vo.forEach((v, i) => {
  vtt.push(`${i + 1}`, `${vttTime(starts[i]!)} --> ${vttTime(starts[i]! + v.seconds)}`, v.text, '');
});
writeFileSync(join(OUT, 'promo.vtt'), vtt.join('\n'));
execFileSync(
  'sips',
  [
    '-s',
    'format',
    'jpeg',
    '-s',
    'formatOptions',
    '82',
    '--resampleWidth',
    '1600',
    join(WORK, 'poster.png'),
    '--out',
    join(OUT, 'promo-poster.jpg'),
  ],
  { stdio: 'ignore' },
);
writeFileSync(
  join(WORK, 'timing.json'),
  JSON.stringify(
    {
      total,
      starts,
      playSpan,
      importAt: plan.importAt,
      scenes: plan.scenes,
      voice: vo,
    },
    null,
    2,
  ),
);
if (PUBLISH) {
  mkdirSync(PUBLIC, { recursive: true });
  for (const f of ['promo.mp4', 'promo.vtt', 'promo-poster.jpg'])
    copyFileSync(join(OUT, f), join(PUBLIC, f));
  console.log(`  published to ${PUBLIC}`);
}
console.log('done');
