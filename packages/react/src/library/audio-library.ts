/**
 * The music & sound-effects library slot: an asset source the host fills (its own catalogue, a
 * licensed stock service, a company sound kit…). The editor shows it in the Audio panel — search,
 * categories, a playable preview, the licence line — and adds a picked sound to the timeline like
 * an imported file (stored in the project, so exports never depend on the source). Without a
 * source the panel only offers the user's own files and voiceover: the editor ships no catalogue.
 */

/** One sound in an {@link AudioLibrary}. */
export interface AudioLibraryTrack {
  /** Stable id within the library. */
  id: string;
  /** Shown on the row and used as the clip's name. */
  title: string;
  /** Artist or creator, shown under the title. */
  artist?: string;
  /** Length in seconds, shown on the row. */
  duration?: number;
  /** `music` (default) or a short `sound` effect: picks the row's icon and spoken description. */
  kind?: 'music' | 'sound';
  /**
   * A short, browser-playable preview (MP3 / AAC / Opus / WAV URL) played when the user taps ▶.
   * Without it the editor previews the full file from {@link AudioLibrary.load}.
   */
  previewUrl?: string;
  /**
   * Licence / attribution line, e.g. `"Song — Artist · CC BY 4.0"`. Shown on the row and kept with
   * the media in the project (`Asset.credit`) so the host can credit it on publish.
   */
  credit?: string;
}

/** A category chip of an {@link AudioLibrary} (e.g. "Upbeat", "Whooshes"). */
export interface AudioLibraryCategory {
  id: string;
  /** Visible, already translated. */
  label: string;
}

/** What the user is looking for. */
export interface AudioLibraryQuery {
  /** The search box text, trimmed (empty = browse). */
  text: string;
  /** The chosen category id, or null for "All". */
  category: string | null;
  /** Null for the first page; then the `next` cursor of the previous page ("Show more"). */
  cursor: string | null;
}

/** One page of results. */
export interface AudioLibraryPage {
  tracks: readonly AudioLibraryTrack[];
  /** Cursor for the next page; missing / null when there are no more. */
  next?: string | null;
}

/**
 * A music & sound-effects source for the Audio panel — pass it as `audioLibrary` on
 * `<VideoEditor />`. Every call gets an `AbortSignal`: the editor aborts when the user types on,
 * switches category or closes the panel.
 *
 * ```tsx
 * const library: AudioLibrary = {
 *   categories: [{ id: 'chill', label: 'Chill' }],
 *   search: async ({ text, category, cursor }, signal) => {
 *     const res = await fetch(`/api/sounds?q=${text}&c=${category ?? ''}&page=${cursor ?? ''}`, { signal });
 *     return res.json(); // { tracks: [...], next }
 *   },
 *   load: async (track, signal) => (await fetch(`/api/sounds/${track.id}/file`, { signal })).blob(),
 * };
 * <VideoEditor audioLibrary={library} />
 * ```
 */
export interface AudioLibrary {
  /** Heading of the library section (default: the `audioLibrary` label, "Music & sounds"). */
  title?: string;
  /** Category chips; the editor puts "All" first. */
  categories?: readonly AudioLibraryCategory[];
  /** Search or browse (`text` empty). Called again for "Show more" with the page's cursor. */
  search(query: AudioLibraryQuery, signal: AbortSignal): Promise<AudioLibraryPage>;
  /** The full audio file to add to the project (any format the editor imports). */
  load(track: AudioLibraryTrack, signal: AbortSignal): Promise<Blob>;
  /** One line under the list, e.g. "Music by Example Audio · free for any use". */
  notice?: string;
}

/** A file extension for a library blob's type (the importer probes the bytes anyway). */
export function audioExtension(type: string): string {
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('wav') || type.includes('wave')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('webm')) return 'webm';
  if (type.includes('flac')) return 'flac';
  if (type.includes('mp4') || type.includes('aac') || type.includes('m4a')) return 'm4a';
  return 'audio';
}
