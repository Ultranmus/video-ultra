import { createStarterSounds, type AudioLibrary, type AudioLibraryTrack } from '@video-ultra/react';

/**
 * The playground's demo music & sounds source: shows how a host fills the `audioLibrary` slot.
 * "Music" = the generated test-media files (served at /media, made by `pnpm media` with ffmpeg
 * tone generators — no licence concerns); the rest = the package's synthesised starter sounds.
 * A short artificial delay and pages of 6 show the loading state and "Show more".
 */
const MUSIC: (AudioLibraryTrack & { file: string })[] = [
  {
    id: 'music-tone',
    file: 'music.mp3',
    title: 'Steady tone',
    artist: 'video-ultra test media',
    duration: 30,
    credit: 'Generated test tone · CC0',
  },
  {
    id: 'music-pulse',
    file: 'music-3min.mp3',
    title: 'Slow pulse',
    artist: 'video-ultra test media',
    duration: 180,
    credit: 'Generated test tone · CC0',
  },
  {
    id: 'music-low',
    file: 'voice.m4a',
    title: 'Low hum',
    artist: 'video-ultra test media',
    duration: 20,
    credit: 'Generated test tone · CC0',
  },
].map((t) => ({ ...t, kind: 'music' as const, previewUrl: `/media/${t.file}` }));

const PAGE = 6;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

export function createDemoSounds(): AudioLibrary {
  const starter = createStarterSounds();
  return {
    title: 'Music & sounds (demo)',
    categories: [{ id: 'music', label: 'Music' }, ...(starter.categories ?? [])],
    notice: 'Demo source: generated test tones and video-ultra starter sounds · CC0',
    async search(query, signal) {
      await wait(250, signal);
      const words = query.text.toLowerCase().split(/\s+/).filter(Boolean);
      const music =
        !query.category || query.category === 'music'
          ? MUSIC.filter((t) => words.every((w) => t.title.toLowerCase().includes(w)))
          : [];
      const sounds =
        query.category === 'music'
          ? []
          : (await starter.search({ ...query, cursor: null }, signal)).tracks;
      const all = [...music, ...sounds];
      const from = Number(query.cursor ?? 0);
      return {
        tracks: all.slice(from, from + PAGE),
        next: from + PAGE < all.length ? String(from + PAGE) : null,
      };
    },
    async load(track, signal) {
      const music = MUSIC.find((t) => t.id === track.id);
      if (!music) return starter.load(track, signal);
      const response = await fetch(`/media/${music.file}`, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    },
  };
}
