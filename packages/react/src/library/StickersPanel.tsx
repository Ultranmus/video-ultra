import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels } from '../context';
import { CategoryBrowser } from '../browse';
import { Button, Segmented } from '../controls';
import { Icon } from '../icons';
import { stickerItem } from '../items';
import type { EmojiRow } from './emoji.generated';
import { SHAPE_STICKERS, shapeSvg, type ShapeSticker } from './shapes';

/** Default home of the 3D sticker art (MIT), pinned so files never change under a project. */
export const DEFAULT_STICKER_LIBRARY =
  'https://cdn.jsdelivr.net/npm/@lobehub/fluent-emoji-3d@1.1.0/assets/';

const GROUPS = [
  'smileys',
  'people',
  'animals',
  'food',
  'travel',
  'activities',
  'objects',
  'symbols',
  'flags',
] as const;
const SEARCH_LIMIT = 160;

let emojiPromise: Promise<readonly EmojiRow[]> | null = null;
/** The emoji list loads only when the sticker panel first opens (≈ 40 KB gzipped). */
function loadEmoji(): Promise<readonly EmojiRow[]> {
  emojiPromise ??= import('./emoji.generated').then((m) => m.EMOJI_ROWS);
  return emojiPromise;
}

/** One emoji per Unicode emoji version, newest first, to find what this device's font can draw. */
const PROBES: readonly [number, string][] = [
  [15.1, '\u{1F642}\u200D\u2194\uFE0F'],
  [15, '\u{1FAE8}'],
  [14, '\u{1FAE0}'],
  [13.1, '\u{1F62E}\u200D\u{1F4A8}'],
  [13, '\u{1F972}'],
  [12, '\u{1F971}'],
  [11, '\u{1F970}'],
];

let supported: number | null = null;
/**
 * The newest emoji version this device draws (a colour glyph of one emoji's width — not a grey
 * box, and not a sequence falling apart into its parts). Checked once, on a tiny canvas.
 */
function supportedEmojiVersion(): number {
  if (supported !== null) return supported;
  supported = Infinity; // can't tell: show everything
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return supported;
    g.font = '24px sans-serif';
    g.textBaseline = 'top';
    const base = g.measureText('\u{1F642}').width;
    const draws = (emoji: string) => {
      if (g.measureText(emoji).width > base * 1.4) return false; // fell apart into parts
      g.clearRect(0, 0, 32, 32);
      g.fillText(emoji, 2, 2);
      const px = g.getImageData(0, 0, 32, 32).data;
      for (let i = 0; i < px.length; i += 4) {
        // Any clearly coloured pixel: a colour emoji, not a monochrome "missing glyph" box.
        if (
          px[i + 3]! > 0 &&
          Math.max(px[i]!, px[i + 1]!, px[i + 2]!) - Math.min(px[i]!, px[i + 1]!, px[i + 2]!) > 40
        )
          return true;
      }
      return false;
    };
    const hit = PROBES.find(([, emoji]) => draws(emoji));
    supported = hit ? hit[0] : PROBES[PROBES.length - 1]![0];
  } catch {
    /* no canvas: show everything */
  }
  return supported;
}

/** Draws an SVG sticker to a PNG (the engine worker can't decode SVG). */
async function rasterise(shape: ShapeSticker, size = 512): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([shapeSvg(shape)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas.getContext('2d')!.drawImage(img, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not draw the sticker'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Tab = '3d' | 'emoji' | 'shapes';

/**
 * Stickers: 3D art, every Unicode emoji (by category, with search), our own shapes, and your own
 * images. Placed at the playhead and selected, so they can be moved straight away.
 */
export function StickersPanel(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const library =
    ctl.options.stickerLibrary === undefined ? DEFAULT_STICKER_LIBRARY : ctl.options.stickerLibrary;
  const [tab, setTab] = useState<Tab>(library ? '3d' : 'emoji');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<readonly EmojiRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    if (tab !== 'shapes')
      void loadEmoji().then((r) => {
        if (live) setRows(r);
      });
    return () => {
      live = false;
    };
  }, [tab]);

  // The 3D tab draws images; the emoji tab only shows what this device's font can draw.
  const pool = useMemo(() => {
    if (!rows) return [];
    if (tab === '3d') return rows.filter((r) => r[4]);
    const max = supportedEmojiVersion();
    return rows.filter((r) => r[5] <= max);
  }, [rows, tab]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pool;
    const words = q.split(/\s+/);
    return pool.filter((r) => words.every((w) => r[3].includes(w))).slice(0, SEARCH_LIMIT);
  }, [pool, query]);
  const groups = useMemo(
    () =>
      GROUPS.filter((g) => pool.some((r) => r[2] === g)).map((g) => ({
        id: g,
        label: l.emojiGroup(g),
      })),
    [pool, l],
  );

  const addEmoji = (emoji: string) =>
    ctl.addLaneItem(l.stickers, (id, start) => stickerItem(id, start, { emoji }));

  const addFile = async (key: string, make: () => Promise<Blob>, name: string) => {
    if (busy) return;
    setBusy(key);
    try {
      const blob = await make();
      await ctl.importFiles([new File([blob], name, { type: blob.type })], { asSticker: true });
    } catch {
      ctl.toast(l.stickerFailed, 'error');
    } finally {
      setBusy(null);
    }
  };

  const renderGrid = (label: string, list: readonly EmojiRow[]) => (
    <ul className={tab === '3d' ? 'vu-sticker-grid' : 'vu-emoji-grid'} aria-label={label}>
      {list.map(([emoji, name, , , file]) => (
        <li key={emoji}>
          {tab === '3d' && library ? (
            <button
              type="button"
              className="vu-sticker"
              aria-label={name}
              data-tooltip={name}
              aria-busy={busy === emoji || undefined}
              onClick={() =>
                void addFile(
                  emoji,
                  async () => {
                    const res = await fetch(`${library}${file}.webp`);
                    if (!res.ok) throw new Error(String(res.status));
                    return res.blob();
                  },
                  `${name}.webp`,
                )
              }
            >
              <img
                alt=""
                src={`${library}${file}.webp`}
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            </button>
          ) : (
            <button
              type="button"
              className="vu-emoji"
              aria-label={name}
              data-tooltip={name}
              onClick={() => addEmoji(emoji)}
            >
              {emoji}
            </button>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="vu-panel-body vu-stickers">
      <Segmented
        label={l.stickers}
        hideLabel
        value={tab}
        options={[
          ...(library ? [{ value: '3d' as const, label: l.stickers3d }] : []),
          { value: 'emoji' as const, label: l.emoji },
          { value: 'shapes' as const, label: l.shapes },
        ]}
        onChange={(t) => {
          setTab(t);
          setQuery('');
        }}
      />
      <Button
        icon="plus"
        label={l.uploadSticker}
        variant="secondary"
        tip={l.uploadStickerTip}
        onClick={() => uploadRef.current?.click()}
      />
      {tab !== 'shapes' ? (
        <>
          <label className="vu-search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder={l.searchStickers}
              aria-label={l.searchStickers}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
          </label>
        </>
      ) : null}

      {tab === 'shapes' ? (
        <ul className="vu-sticker-grid" aria-label={l.shapes}>
          {SHAPE_STICKERS.map((shape) => (
            <li key={shape.id}>
              <button
                type="button"
                className="vu-sticker"
                aria-label={shape.label}
                data-tooltip={shape.label}
                aria-busy={busy === shape.id || undefined}
                onClick={() => void addFile(shape.id, () => rasterise(shape), `${shape.label}.png`)}
              >
                <img
                  alt=""
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(shapeSvg(shape))}`}
                  draggable={false}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : !rows ? (
        <p className="vu-hint">{l.loading}</p>
      ) : shown.length === 0 ? (
        <p className="vu-hint">{l.noStickersFound}</p>
      ) : query ? (
        renderGrid(l.stickers, shown)
      ) : (
        <CategoryBrowser key={tab} label={l.category} categories={groups}>
          {(g) =>
            renderGrid(
              g.label,
              pool.filter((r) => r[2] === g.id),
            )
          }
        </CategoryBrowser>
      )}
      <input
        ref={uploadRef}
        type="file"
        accept="image/png,image/webp,image/gif,image/jpeg"
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length) void ctl.importFiles(files, { asSticker: true });
        }}
      />
    </div>
  );
}
