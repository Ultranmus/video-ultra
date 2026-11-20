import type { Patch } from 'immer';
import { replayLog, type LogEntry } from '../edit/history';
import type { WaveformCache } from '../media/analyzer';
import type { Waveform } from '../media/peaks';
import { parseProject } from '../model/migrate';
import type { Asset, Project } from '../model/schema';
import { isQuotaError, MemoryFileStore, StorageFullError, type FileStore } from './files';
import { indexedDbHandleStore, memoryHandleStore, type HandleStore } from './handles';
import { OpfsFileStore } from './opfs';

/**
 * Local persistence: imported media, and projects as **snapshot + append-only operation log**.
 *
 * Layout (under the namespace folder, default `video-ultra/`):
 *
 * ```
 * projects/<id>/meta.json            name, updatedAt, asset ids (for the project list)
 * projects/<id>/snapshot-<S>.json    { format, seq: S, savedAt, project }
 * projects/<id>/log-<S>.jsonl        one line per edit after snapshot S: { seq, label, kind, patches }
 * media/<assetId>                    the imported file's bytes
 * media/<assetId>.peaks              cached waveform
 * ```
 *
 * Crash safety without atomic rename (OPFS `move()` isn't everywhere): files that matter are never
 * overwritten. A new snapshot gets a new name; only after it is fully written are older snapshots
 * and logs deleted. Loading takes the newest snapshot that parses, then replays its log while seqs
 * run on without a gap; a torn last line (crash mid-append) is ignored. `meta.json` is the only
 * file rewritten in place, and it's only a hint (the project list falls back to the files' dates).
 */

/** A project saved locally, for the "recent projects" list. */
export interface StoredProjectInfo {
  id: string;
  name: string;
  /** ISO time of the last saved change. */
  updatedAt: string;
}

/** What {@link ProjectStorage.status} reports. */
export interface StorageStatus {
  /** `false` → the browser may evict local data; the UI warns that the host's `onSave` is the durable save. */
  persistent: boolean;
  /** Bytes used / available to this origin, when the browser says. */
  usage: number | null;
  quota: number | null;
}

/** A project loaded by {@link ProjectStorage.loadProject}. */
export interface LoadedProject {
  project: Project;
  /** Things fixed or lost while loading (show them to the user). */
  warnings: string[];
  /** Sequence number of the last change included. */
  seq: number;
}

/** One edit as stored in the log (the undo half isn't needed to recover). */
export interface StoredLogEntry {
  label: string;
  kind: LogEntry['kind'];
  patches: Patch[];
}

/**
 * Appends edits and writes snapshots for one project. Used by {@link attachAutosave}; operations
 * run in call order. `seq` counts every entry handed to `append`.
 */
export interface ProjectWriter {
  readonly projectId: string;
  /** Sequence number of the last entry appended. */
  readonly seq: number;
  /** Appends entries (they get seqs `seq + 1…`). After a failed append, appends are skipped until the next snapshot. */
  append(entries: readonly StoredLogEntry[]): Promise<void>;
  /** Saves `project` — which must include every appended entry — as the new base, and compacts the log. */
  snapshot(project: Project): Promise<void>;
  /** A snapshot is due: an append failed, so the log has a hole. */
  readonly needsSnapshot: boolean;
}

/** Streams a recording into storage piece by piece. From {@link ProjectStorage.recordMedia}. */
export interface MediaRecordingWriter {
  /** Bytes stored so far. */
  readonly bytes: number;
  /** Adds a piece at the end (pieces are written in call order). */
  append(chunk: Blob): Promise<void>;
  /** Waits for every piece, then returns the stored file and its source. */
  finish(): Promise<{ file: File; source: Asset['source'] }>;
  /** Removes everything stored for this recording. */
  discard(): Promise<void>;
}

/** What {@link ProjectStorage.mediaAccess} reports. */
export type MediaAccess = 'ok' | 'ask' | 'missing';

/** Local storage for media and projects. Created with {@link createProjectStorage}. */
export interface ProjectStorage extends WaveformCache {
  readonly kind: 'opfs' | 'memory';
  /** navigator.storage.persist() + estimate; persistent=false → UI warns that the host's onSave is the durable save. */
  status(): Promise<StorageStatus>;
  /** Asks the browser to keep local data (it may say no, or ask the user). */
  requestPersistence(): Promise<boolean>;
  /**
   * Stores an imported file's bytes (streamed copy to OPFS, chunked, constant memory) and returns
   * the Asset.source to record. Throws {@link StorageFullError} when quota is exceeded, `AbortError`
   * when `signal` aborts (no partial file is left).
   */
  putMedia(assetId: string, file: Blob, signal?: AbortSignal): Promise<Asset['source']>;
  /**
   * Stores a recording that arrives in pieces (the camera): each `append` streams a piece onto the
   * end of the asset's file, so a long recording never sits in memory. `finish()` returns the
   * stored file (disk-backed) and the Asset.source to record; `discard()` removes it. A piece that
   * fails (e.g. {@link StorageFullError}) leaves what was stored before it intact.
   */
  recordMedia(assetId: string): MediaRecordingWriter;
  /**
   * Keeps a handle to the user's original file instead of copying it (File System Access API,
   * Chromium desktop) and returns the Asset.source to record.
   */
  putMediaHandle(assetId: string, handle: FileSystemFileHandle): Promise<Asset['source']>;
  /**
   * Gets the bytes for an asset (OPFS File; a `url` source is downloaded into storage once,
   * streamed to disk, and read from there after; or a stored FileSystemFileHandle where
   * supported). null if missing, if a url can't be fetched, or if a handle's permission isn't
   * granted — see {@link ProjectStorage.mediaAccess} to ask again inside a tap.
   */
  getMedia(asset: Asset): Promise<Blob | null>;
  /**
   * Why an asset's bytes can't be read, after {@link ProjectStorage.getMedia} gave `null`:
   * `'ask'` — a kept file handle needs the person's OK again (browsers ask only inside a tap:
   * call `getMedia` from the tap's handler); `'missing'` — the file is gone, unreachable, or access
   * was refused (pick the file again); `'ok'` — it can be read now.
   */
  mediaAccess(asset: Asset): Promise<MediaAccess>;
  /** Removes an asset's stored bytes, handle and cached waveform. */
  deleteMedia(assetId: string): Promise<void>;
  /**
   * Removes stored media that no saved project uses and that is older than `maxAgeMs` (default a
   * day; 0 = any age) — files left when a crash came between an import and the next save. Keeps everything if
   * any project can't be read (better a stray file than a lost one). Returns how many went.
   */
  sweepMedia(maxAgeMs?: number): Promise<number>;
  /** Projects saved locally, newest first. */
  listProjects(): Promise<StoredProjectInfo[]>;
  /**
   * Loads a project: latest snapshot + replay of the op log written after it (crash recovery).
   * Validates with parseProject/repairProject; returns warnings. `null` if there's no such project;
   * throws if its saved data is damaged beyond repair.
   */
  loadProject(id: string): Promise<LoadedProject | null>;
  /** Deletes a project and the media only it used. */
  deleteProject(id: string): Promise<void>;
  /**
   * Starts saving `project`: writes it as a fresh snapshot (it becomes the saved state, replacing
   * what was stored under its id) and returns the writer for its next edits.
   */
  openWriter(project: Project): Promise<ProjectWriter>;
  /** Releases the storage worker. */
  close(): void;
}

/** Options for {@link createProjectStorage}. */
export interface ProjectStorageOptions {
  /** Folder (and database) name, so several editors on one site don't mix. Default `video-ultra`. */
  namespace?: string;
  /** `auto` (default): OPFS when it works here, else memory. `memory` forces memory. */
  backend?: 'auto' | 'memory';
}

const FORMAT = 1;
const enc = encodeURIComponent;
const projectDir = (id: string) => `projects/${enc(id)}`;
const snapshotName = (seq: number) => `snapshot-${seq}.json`;
const logName = (base: number) => `log-${base}.jsonl`;
const mediaPath = (assetId: string) => `media/${enc(assetId)}`;
const SNAPSHOT_RE = /^snapshot-(\d+)\.json$/;
const LOG_RE = /^log-(\d+)\.jsonl$/;
/** Keep this much free beyond a media file before copying it (the log and snapshots need room too). */
const HEADROOM = 16 * 2 ** 20;

/**
 * Opens local storage: OPFS where available (writes go through a small storage worker), otherwise
 * memory (Safari Private Browsing, some webviews — nothing survives a reload there).
 * Browser only; call it from an effect.
 */
export async function createProjectStorage(
  options: ProjectStorageOptions = {},
): Promise<ProjectStorage> {
  const namespace = options.namespace ?? 'video-ultra';
  const opfs = options.backend === 'memory' ? null : await OpfsFileStore.open(namespace);
  if (opfs)
    return createProjectStorageOn(opfs, indexedDbHandleStore(namespace), () => opfs.close());
  return createProjectStorageOn(new MemoryFileStore(), memoryHandleStore());
}

/** Project storage over any {@link FileStore} (tests use a {@link MemoryFileStore}). */
export function createProjectStorageOn(
  files: FileStore,
  handles: HandleStore = memoryHandleStore(),
  close: () => void = () => undefined,
): ProjectStorage {
  const storageApi = () =>
    typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null;

  const estimate = async () => {
    try {
      const e = await storageApi()?.estimate?.();
      return { usage: e?.usage ?? null, quota: e?.quota ?? null };
    } catch {
      return { usage: null, quota: null };
    }
  };

  const readText = async (path: string) => {
    const file = await files.read(path);
    return file ? file.text() : null;
  };

  const readMeta = async (id: string) => {
    try {
      const text = await readText(`${projectDir(id)}/meta.json`);
      const meta = text ? (JSON.parse(text) as Partial<StoredMeta>) : null;
      return meta && typeof meta.name === 'string' ? meta : null;
    } catch {
      return null; // torn meta: only a hint
    }
  };

  /** The newest snapshot that parses (older ones are fallbacks for a torn newest). */
  const newestSnapshot = async (id: string, names: string[]) => {
    const seqs = names
      .map((n) => SNAPSHOT_RE.exec(n))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .sort((a, b) => b - a);
    for (const seq of seqs) {
      const parsed = parseSnapshot(await readText(`${projectDir(id)}/${snapshotName(seq)}`));
      if (parsed) return parsed;
    }
    return null;
  };

  /** Downloads in flight by asset id: two callers asking at once share one download. */
  const downloading = new Map<string, Promise<File | null>>();

  /**
   * A `url` source's bytes: downloaded once into `media/<id>` (streamed to disk, DECISIONS #200)
   * and read from there afterwards — offline too. `media/<id>.url` is written only after the
   * download completes and names the url and size, so a download cut short (tab killed) or a
   * changed url is fetched again. `null` if the server can't be reached or says no.
   */
  const downloaded = (assetId: string, url: string): Promise<File | null> => {
    const running = downloading.get(assetId);
    if (running) return running;
    const path = mediaPath(assetId);
    const task = (async () => {
      try {
        const marker = await readText(`${path}.url`).catch(() => null);
        const kept = marker ? parseUrlMarker(marker) : null;
        if (kept && kept.url === url) {
          const file = await files.read(path);
          if (file && file.size === kept.size) return file;
        }
        await files.remove(`${path}.url`);
        const bytes = await files.download(path, url);
        await files.write(`${path}.url`, JSON.stringify({ url, size: bytes }));
        return await files.read(path);
      } catch {
        return null;
      } finally {
        downloading.delete(assetId);
      }
    })();
    downloading.set(assetId, task);
    return task;
  };

  const storage: ProjectStorage = {
    kind: files.kind,

    async status() {
      const { usage, quota } = await estimate();
      let persistent = false;
      if (files.kind === 'opfs') {
        try {
          persistent = (await storageApi()?.persisted?.()) === true;
        } catch {
          persistent = false;
        }
      }
      return { persistent, usage, quota };
    },

    async requestPersistence() {
      if (files.kind === 'memory') return false;
      try {
        return (await storageApi()?.persist?.()) === true;
      } catch {
        return false;
      }
    },

    async putMedia(assetId, file, signal) {
      if (files.kind === 'opfs') {
        const { usage, quota } = await estimate();
        if (usage !== null && quota !== null && quota - usage < file.size + HEADROOM)
          throw new StorageFullError();
      }
      try {
        await files.copyIn(mediaPath(assetId), file, signal);
      } catch (error) {
        if (isQuotaError(error)) throw new StorageFullError();
        throw error;
      }
      return { type: 'opfs', key: assetId };
    },

    recordMedia(assetId) {
      const path = mediaPath(assetId);
      let chain: Promise<void> = Promise.resolve();
      let failure: unknown = null;
      let bytes = 0;
      return {
        get bytes() {
          return bytes;
        },
        append(chunk) {
          // In order, one after another; after a failure nothing more is written.
          chain = chain.then(async () => {
            if (failure) throw failure;
            try {
              await files.appendBlob(path, chunk);
              bytes += chunk.size;
            } catch (error) {
              failure = isQuotaError(error) ? new StorageFullError() : error;
              throw failure;
            }
          });
          return chain;
        },
        async finish() {
          await chain.catch(() => undefined);
          const file = await files.read(path);
          if (!file || file.size === 0) {
            if (failure) throw failure;
            throw new Error('Nothing was recorded.');
          }
          return { file, source: { type: 'opfs' as const, key: assetId } };
        },
        async discard() {
          failure ??= new Error('Recording discarded');
          await chain.catch(() => undefined);
          await files.remove(path);
        },
      };
    },

    async putMediaHandle(assetId, handle) {
      await handles.put(assetId, handle);
      return { type: 'handle', key: assetId };
    },

    async getMedia(asset) {
      const source = asset.source;
      // A combined clip has no file: it's made of the project's other items.
      if (source.type === 'compound') return null;
      if (source.type === 'opfs') {
        const file = await files.read(mediaPath(source.key));
        // A copy cut short by a crash has the wrong size: treat it as missing.
        if (!file || (asset.size > 0 && file.size !== asset.size)) return null;
        return file;
      }
      if (source.type === 'url') return downloaded(asset.id, source.url);
      const handle = (await handles.get(source.key).catch(() => null)) as PermissionedHandle | null;
      if (!handle) return null;
      try {
        let state = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
        // Only works inside a user gesture; otherwise the UI asks again from a tap (mediaAccess).
        if (state === 'prompt')
          state = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
        if (state !== 'granted') return null;
        return await handle.getFile();
      } catch {
        return null;
      }
    },

    async mediaAccess(asset) {
      const source = asset.source;
      if (source.type !== 'handle') return (await storage.getMedia(asset)) ? 'ok' : 'missing';
      const handle = (await handles.get(source.key).catch(() => null)) as PermissionedHandle | null;
      if (!handle) return 'missing';
      try {
        const state = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
        if (state === 'prompt') return 'ask';
        if (state !== 'granted') return 'missing';
        await handle.getFile(); // moved or deleted → NotFoundError
        return 'ok';
      } catch {
        return 'missing';
      }
    },

    async deleteMedia(assetId) {
      await files.remove(mediaPath(assetId));
      await files.remove(`${mediaPath(assetId)}.peaks`);
      await files.remove(`${mediaPath(assetId)}.url`);
      await handles.delete(assetId).catch(() => undefined);
    },

    async sweepMedia(maxAgeMs = 24 * 60 * 60 * 1000) {
      const used = new Set<string>();
      for (const info of await storage.listProjects()) {
        const loaded = await storage.loadProject(info.id).catch(() => null);
        if (!loaded) return 0;
        for (const id of Object.keys(loaded.project.assets)) used.add(id);
      }
      const now = Date.now();
      let removed = 0;
      for (const name of await files.list('media')) {
        if (name.endsWith('.peaks') || name.endsWith('.url')) continue;
        const id = decodeURIComponent(name);
        if (used.has(id)) continue;
        const file = await files.read(mediaPath(id));
        if (!file || (maxAgeMs > 0 && now - file.lastModified < maxAgeMs)) continue;
        await storage.deleteMedia(id);
        removed++;
      }
      return removed;
    },

    async getWaveform(assetId) {
      const file = await files.read(`${mediaPath(assetId)}.peaks`);
      if (!file || file.size < 32) return null;
      const buffer = await file.arrayBuffer();
      const header = new Float64Array(buffer, 0, 4);
      const count = header[3]!;
      if (header[0] !== FORMAT || buffer.byteLength !== 32 + count * 4) return null;
      return {
        peaksPerSecond: header[1]!,
        duration: header[2]!,
        peaks: new Float32Array(buffer, 32, count),
      };
    },

    async putWaveform(assetId, waveform: Waveform) {
      const buffer = new ArrayBuffer(32 + waveform.peaks.length * 4);
      new Float64Array(buffer, 0, 4).set([
        FORMAT,
        waveform.peaksPerSecond,
        waveform.duration,
        waveform.peaks.length,
      ]);
      new Float32Array(buffer, 32).set(waveform.peaks);
      await files.write(`${mediaPath(assetId)}.peaks`, buffer);
    },

    async listProjects() {
      const out: StoredProjectInfo[] = [];
      for (const dirName of await files.list('projects')) {
        const id = decodeURIComponent(dirName);
        const names = await files.list(projectDir(id));
        if (!names.some((n) => SNAPSHOT_RE.test(n))) continue;
        let meta: Partial<StoredMeta> | null = await readMeta(id);
        if (!meta) {
          // meta.json is written after the first complete snapshot; without it, list the project
          // only if a snapshot is readable (meta torn by a crash) — not a first save cut short.
          const snapshot = await newestSnapshot(id, names);
          if (!snapshot) continue;
          meta = { name: snapshot.project.name };
        }
        // The newest log/snapshot's date covers edits made after meta.json was written.
        let latest = meta?.updatedAt ? Date.parse(meta.updatedAt) || 0 : 0;
        for (const name of names) {
          if (!SNAPSHOT_RE.test(name) && !LOG_RE.test(name)) continue;
          const file = await files.read(`${projectDir(id)}/${name}`);
          if (file) latest = Math.max(latest, file.lastModified);
        }
        out.push({
          id,
          name: meta?.name ?? 'Untitled project',
          updatedAt: new Date(latest || Date.now()).toISOString(),
        });
      }
      return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async loadProject(id) {
      const dir = projectDir(id);
      const names = await files.list(dir);
      if (names.length === 0) return null;
      const warnings: string[] = [];
      const snapshots = names
        .map((n) => SNAPSHOT_RE.exec(n))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[1]))
        .sort((a, b) => b - a);

      const base = await newestSnapshot(id, names);
      // No complete snapshot: the first save never finished (crash) — nothing to recover.
      if (!base) return null;
      if (base.seq !== snapshots[0])
        warnings.push('The latest save was damaged; opened the one before it.');

      // Replay the log while it runs on without a gap.
      let project = base.project;
      let seq = base.seq;
      let lost = false;
      const text = (await readText(`${dir}/${logName(base.seq)}`)) ?? '';
      const lines = text.split('\n');
      for (const [index, line] of lines.entries()) {
        if (line.trim() === '') continue;
        const torn = index === lines.length - 1; // no newline after it: the write was cut short
        const entry = parseEntry(line);
        if (!entry || entry.seq !== seq + 1) {
          if (!torn) lost = true;
          break;
        }
        try {
          project = replayLog(project, seq, [entry]);
          seq = entry.seq;
        } catch {
          lost = true;
          break;
        }
      }
      if (lost) warnings.push("Some of the latest changes couldn't be recovered.");

      let result = parseProject(project);
      if (!result.ok && seq !== base.seq) {
        // The replayed edits made it invalid: fall back to the snapshot alone.
        result = parseProject(base.project);
        if (result.ok) {
          warnings.push("Some of the latest changes couldn't be recovered.");
          seq = base.seq;
        }
      }
      if (!result.ok) throw new Error(result.error);
      return {
        project: result.project,
        warnings: [...new Set([...warnings, ...result.warnings])],
        seq,
      };
    },

    async deleteProject(id) {
      const meta = await readMeta(id);
      const loaded = await storage.loadProject(id).catch(() => null);
      const mine = new Set([
        ...(meta?.assetIds ?? []),
        ...Object.keys(loaded?.project.assets ?? {}),
      ]);
      await files.remove(projectDir(id));
      const others = new Set<string>();
      for (const dirName of await files.list('projects')) {
        const other = await readMeta(decodeURIComponent(dirName));
        for (const assetId of other?.assetIds ?? []) others.add(assetId);
      }
      for (const assetId of mine) if (!others.has(assetId)) await storage.deleteMedia(assetId);
    },

    async openWriter(project) {
      const dir = projectDir(project.id);
      // Start after everything ever written for this id, so the new snapshot wins on load.
      let head = 0;
      for (const name of await files.list(dir)) {
        const snapshot = SNAPSHOT_RE.exec(name);
        if (snapshot) head = Math.max(head, Number(snapshot[1]));
        const log = LOG_RE.exec(name);
        if (log) {
          const text = (await readText(`${dir}/${name}`)) ?? '';
          head = Math.max(head, Number(log[1]) + text.split('\n').length);
        }
      }
      const writer = new Writer(files, project.id, head + 1);
      await writer.snapshot(project, true);
      return writer;
    },

    close,
  };
  return storage;
}

interface StoredMeta {
  id: string;
  name: string;
  updatedAt: string;
  assetIds: string[];
}

/** A stored file handle with the permission methods (not in every DOM typing yet). */
type PermissionedHandle = FileSystemFileHandle & {
  queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
};

/** `media/<id>.url`: which url a finished download came from, and its size. */
function parseUrlMarker(text: string): { url: string; size: number } | null {
  try {
    const value = JSON.parse(text) as { url?: unknown; size?: unknown };
    return typeof value.url === 'string' && typeof value.size === 'number'
      ? { url: value.url, size: value.size }
      : null;
  } catch {
    return null;
  }
}

function parseSnapshot(text: string | null): { seq: number; project: Project } | null {
  if (!text) return null;
  try {
    const data = JSON.parse(text) as { format?: unknown; seq?: unknown; project?: unknown };
    if (data.format !== FORMAT || typeof data.seq !== 'number') return null;
    if (typeof data.project !== 'object' || data.project === null) return null;
    return { seq: data.seq, project: data.project as Project };
  } catch {
    return null;
  }
}

function parseEntry(line: string): (LogEntry & { seq: number }) | null {
  try {
    const data = JSON.parse(line) as Partial<LogEntry>;
    if (typeof data.seq !== 'number' || !Array.isArray(data.patches)) return null;
    return {
      seq: data.seq,
      label: typeof data.label === 'string' ? data.label : '',
      kind: data.kind ?? 'edit',
      patches: data.patches,
      inverse: [],
    };
  } catch {
    return null;
  }
}

class Writer implements ProjectWriter {
  seq: number;
  /** Seq of the snapshot the current log builds on. */
  private base: number;
  private broken = false;
  private chain: Promise<void> = Promise.resolve();
  private readonly dir: string;

  constructor(
    private readonly files: FileStore,
    readonly projectId: string,
    start: number,
  ) {
    this.seq = start;
    this.base = start - 1;
    this.dir = projectDir(projectId);
  }

  get needsSnapshot(): boolean {
    return this.broken;
  }

  private run(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  append(entries: readonly StoredLogEntry[]): Promise<void> {
    if (entries.length === 0) return this.chain;
    const first = this.seq + 1;
    this.seq += entries.length;
    return this.run(async () => {
      if (this.broken) return; // the next snapshot covers these
      let text = '';
      for (const [i, e] of entries.entries()) {
        text += `${JSON.stringify({ seq: first + i, label: e.label, kind: e.kind, patches: e.patches })}\n`;
      }
      try {
        await this.files.append(`${this.dir}/${logName(this.base)}`, text);
      } catch (error) {
        this.broken = true;
        throw isQuotaError(error) ? new StorageFullError() : error;
      }
    });
  }

  snapshot(project: Project, force = false): Promise<void> {
    const seq = this.seq;
    return this.run(async () => {
      if (!force && !this.broken && seq === this.base) return; // nothing new
      const savedAt = new Date().toISOString();
      const text = JSON.stringify({ format: FORMAT, seq, savedAt, project });
      try {
        await this.files.write(`${this.dir}/${snapshotName(seq)}`, text);
      } catch (error) {
        throw isQuotaError(error) ? new StorageFullError() : error;
      }
      this.base = seq;
      this.broken = false;
      const meta: StoredMeta = {
        id: project.id,
        name: project.name,
        updatedAt: savedAt,
        assetIds: Object.keys(project.assets),
      };
      await this.files.write(`${this.dir}/meta.json`, JSON.stringify(meta));
      // Compact: everything older is covered by this snapshot.
      for (const name of await this.files.list(this.dir)) {
        const s = SNAPSHOT_RE.exec(name) ?? LOG_RE.exec(name);
        if (s && Number(s[1]) < seq) await this.files.remove(`${this.dir}/${name}`);
      }
    });
  }
}
