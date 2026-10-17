import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels } from '../context';
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
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('smileys');
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

  const shown = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const pool = tab === '3d' ? rows.filter((r) => r[4]) : rows;
    if (q) {
      const words = q.split(/\s+/);
      return pool.filter((r) => words.every((w) => r[3].includes(w))).slice(0, SEARCH_LIMIT);
    }
    return pool.filter((r) => r[2] === group);
  }, [rows, tab, group, query]);

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
          {query ? null : (
            <div className="vu-chips vu-chips-scroll" role="radiogroup" aria-label={l.category}>
              {GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={g === group}
                  className="vu-chip"
                  onClick={() => setGroup(g)}
                >
                  {l.emojiGroup(g)}
                </button>
              ))}
            </div>
          )}
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
      ) : (
        <ul className={tab === '3d' ? 'vu-sticker-grid' : 'vu-emoji-grid'} aria-label={l.stickers}>
          {shown.map(([emoji, name, , , file]) => (
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
      )}
      <Button
        icon="plus"
        label={l.uploadSticker}
        variant="secondary"
        tip={l.uploadStickerTip}
        onClick={() => uploadRef.current?.click()}
      />
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
