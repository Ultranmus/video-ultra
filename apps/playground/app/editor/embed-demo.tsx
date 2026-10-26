'use client';

/**
 * `?embed=1`: the embedding API in use (and what scripts/embed-check.ts drives) — a host panel,
 * a top-bar button, a media source of generated backgrounds, hidden tools and an event log on
 * `window.vuEvents`.
 */
import type {
  EditorController,
  EditorCustomization,
  EditorEvent,
  MediaSource,
} from '@video-ultra/react';

const GRADIENTS: [string, string, string][] = [
  ['Sunset', '#ff7e5f', '#feb47b'],
  ['Ocean', '#2193b0', '#6dd5ed'],
  ['Forest', '#134e5e', '#71b280'],
  ['Berry', '#8e2de2', '#4a00e0'],
  ['Peach', '#ffecd2', '#fcb69f'],
  ['Night', '#0f2027', '#2c5364'],
  ['Lime', '#a8e063', '#56ab2f'],
  ['Rose', '#f857a6', '#ff5858'],
  ['Sky', '#89f7fe', '#66a6ff'],
  ['Gold', '#f7971e', '#ffd200'],
  ['Mint', '#d4fc79', '#96e6a1'],
  ['Coal', '#232526', '#414345'],
];

/** A tiny 1080 × 1920 gradient PNG made in the browser (no network). */
async function gradientPng(from: string, to: string, w = 1080, h = 1920): Promise<Blob> {
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d')!;
  const fill = g.createLinearGradient(0, 0, w, h);
  fill.addColorStop(0, from);
  fill.addColorStop(1, to);
  g.fillStyle = fill;
  g.fillRect(0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/png' });
}

const thumbs = new Map<string, string>();

const backgrounds: MediaSource = {
  id: 'backgrounds',
  label: 'Backgrounds',
  async search({ text }) {
    const q = text.toLowerCase();
    const items = [];
    for (const [name, from, to] of GRADIENTS) {
      if (q && !name.toLowerCase().includes(q)) continue;
      if (!thumbs.has(name))
        thumbs.set(name, URL.createObjectURL(await gradientPng(from, to, 72, 128)));
      items.push({
        id: name,
        name: `${name} background`,
        kind: 'image' as const,
        thumbnailUrl: thumbs.get(name)!,
        credit: 'Made in the playground',
      });
    }
    return { items };
  },
  async load(item) {
    const g = GRADIENTS.find(([name]) => name === item.id)!;
    return gradientPng(g[1], g[2]);
  },
};

function BrandPanel({ ctl }: { ctl: EditorController }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p className="vu-hint">The host's own panel: one tap adds the brand title.</p>
      <button
        type="button"
        className="vu-btn vu-wide"
        data-variant="primary"
        onClick={() => {
          ctl.addTemplate(
            {
              id: 'brand',
              name: 'Brand title',
              category: 'intro',
              theme: 'bold',
              duration: 3,
              variables: [],
              elements: [
                {
                  kind: 'text',
                  content: 'ACME STUDIO',
                  x: 0.5,
                  y: 0.12,
                  style: { size: 0.045, color: '#ffd60a', letterSpacing: 0.2 },
                  start: 0,
                  duration: 3,
                  in: 'fade-in',
                  out: 'fade-out',
                },
              ],
            },
            {},
          );
        }}
      >
        Add brand title
      </button>
    </div>
  );
}

let sharing = false;

/**
 * What a host's Share might do: render a small MP4 with the editor's own export, then hand it
 * to the system share sheet (phones), or offer to save it where there's none.
 */
async function share(ctl: EditorController): Promise<void> {
  if (sharing) return;
  if (ctl.project.tracks.every((t) => t.items.length === 0)) {
    ctl.toast('Add something to the video first', 'info');
    return;
  }
  sharing = true;
  ctl.toast('Making a small video to share…', 'info');
  try {
    const result = await ctl.exportVideo(
      { format: 'mp4', height: 480, fps: 30, quality: 'medium' },
      () => {},
      new AbortController().signal,
    );
    const file = new File([result.blob], `Shared video.${result.extension}`, {
      type: result.mimeType,
    });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'My video' }).catch(() => {});
      return;
    }
    ctl.toast('Ready to share (demo)', 'success', {
      label: 'Save',
      run: () => {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      },
    });
  } catch (error) {
    ctl.toast(`Couldn't share: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    sharing = false;
  }
}

export const embedDemo: EditorCustomization = {
  hide: ['blur', 'duplicate'],
  railOrder: ['media', 'brand', 'templates'],
  panels: [
    {
      id: 'brand',
      label: 'Brand',
      icon: 'M12 3l2.6 5.3L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.4-.7z',
      tip: 'Your brand kit',
      render: (ctl) => <BrandPanel ctl={ctl} />,
    },
  ],
  buttons: [
    {
      id: 'share',
      label: 'Share',
      icon: 'M4 12v7h16v-7M12 3v12M7 8l5-5 5 5',
      onClick: (ctl) => {
        (window as unknown as { vuShared: number }).vuShared = ctl.project.tracks.reduce(
          (n, t) => n + t.items.length,
          0,
        );
        void share(ctl);
      },
    },
  ],
  mediaSources: [backgrounds],
};

/** Collects every editor event on `window.vuEvents` (the check reads it). */
export function logEvent(event: EditorEvent): void {
  const w = window as unknown as { vuEvents?: EditorEvent[] };
  (w.vuEvents ??= []).push(event);
}
