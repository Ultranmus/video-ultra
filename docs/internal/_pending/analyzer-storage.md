# Pending: media analyzer + persistence (Day 4 · 3.3/3.4 core, Day 6 · 4.2)

Notes to merge into DECISIONS / PERF / BACKLOG / PROGRESS / HANDOFF / PLAN. Written by the
analyzer + storage session (2026-10-17), branch `worktree-agent-a19eca026313a328c`.

## API (exported from `@video-ultra/core/internal`)

```ts
// Media analysis — its own worker (dist/analyzer.worker.js)
function createMediaAnalyzer(options?: {
  tier?: DeviceTier;
  thumbnails?: 'keyframe' | 'exact'; // default 'keyframe'
  waveformCache?: WaveformCache; // e.g. the ProjectStorage
}): MediaAnalyzer;
interface MediaAnalyzer {
  probe(file: Blob, name: string): Promise<ProbeResult>;
  addMedia(
    assetId: string,
    blob: Blob,
    kind: 'video' | 'audio' | 'image',
    options?: { audioTrack?: number },
  ): void;
  removeMedia(assetId: string): void;
  thumbnail(
    assetId: string,
    seconds: number,
    height: number,
    signal?: AbortSignal,
  ): Promise<ImageBitmap | null>;
  waveform(assetId: string, signal?: AbortSignal): Promise<Waveform | null>;
  stats(): Promise<AnalyzerStats>;
  destroy(): void;
}
interface Waveform {
  peaksPerSecond: number;
  peaks: Float32Array;
  duration: number;
}
interface WaveformCache {
  getWaveform(assetId): Promise<Waveform | null>;
  putWaveform(assetId, w): Promise<void>;
}

// Persistence — OPFS writes go through dist/storage.worker.js
function createProjectStorage(options?: {
  namespace?: string;
  backend?: 'auto' | 'memory';
}): Promise<ProjectStorage>;
function createProjectStorageOn(
  files: FileStore,
  handles?: HandleStore,
  close?: () => void,
): ProjectStorage; // tests
interface ProjectStorage extends WaveformCache {
  readonly kind: 'opfs' | 'memory';
  status(): Promise<{ persistent: boolean; usage: number | null; quota: number | null }>;
  requestPersistence(): Promise<boolean>;
  putMedia(assetId: string, file: Blob, signal?: AbortSignal): Promise<Asset['source']>;
  putMediaHandle(assetId: string, handle: FileSystemFileHandle): Promise<Asset['source']>;
  getMedia(asset: Asset): Promise<Blob | null>;
  deleteMedia(assetId: string): Promise<void>;
  listProjects(): Promise<{ id: string; name: string; updatedAt: string }[]>;
  loadProject(id: string): Promise<{ project: Project; warnings: string[]; seq: number } | null>;
  deleteProject(id: string): Promise<void>;
  openWriter(project: Project): Promise<ProjectWriter>; // used by attachAutosave
  close(): void;
}
class StorageFullError extends Error {}
function attachAutosave(
  editor: Editor,
  storage: ProjectStorage,
  options?: {
    snapshotEvery?: number; // 200
    onSave?: (project: Project) => void | Promise<void>;
    onError?: (error: Error) => void;
    debounceMs?: number; // 1000 (onSave)
    flushMs?: number; // 250 (log batch)
    idleSnapshotMs?: number; // 5000
  },
): { flush(): Promise<void>; detach(): void };
```

**Additions to the agreed shapes** (all optional / additive): `addMedia(..., { audioTrack })` (the
analyzer can't see the Asset otherwise), `stats()`, `MediaAnalyzerOptions.thumbnails` and
`waveformCache`, `ProjectStorage.putMediaHandle`, `getWaveform`/`putWaveform`, `openWriter`,
`close()`, `loadProject(...).seq`, `createProjectStorage({ backend })`, autosave `flushMs` /
`idleSnapshotMs`, `attachAutosave` returns `{ flush, detach }` (named type `Autosave`).

**Behaviour the UI should know:**

- `thumbnail()` resolves `null` when aborted, superseded by the queue cap (512), for audio assets,
  for codecs this browser can't decode (Firefox + HEVC) and HEIC where unsupported. Never rejects.
- `waveform()` returns the **same object** to every caller (cached) — treat as read-only.
- `loadProject()` returns `null` for an unknown id **or a first save that never completed**; it
  throws only if the saved data can't be repaired (`parseProject` error message).
- `attachAutosave` writes a fresh snapshot of the editor's current project at once — it becomes
  the saved state for that id. Decide first between local recovery and the host's
  `initialProject` (compare `updatedAt` / ask the user), then attach.
- `editor.load(other)` while attached starts saving `other` (detected automatically).
- In `memory` storage (Safari Private Browsing, Playwright WebKit) nothing survives a reload;
  `status().persistent` is `false` → show the "your host's save is the durable save" warning.
- `putMedia` returns `{ type: 'opfs', key: assetId }` on both kinds ("stored by ProjectStorage").

### Integration sketch (React layer)

```ts
const analyzer = createMediaAnalyzer({ tier });
const storage = await createProjectStorage(); // in an effect; guard strict-mode double runs
// Import a file
const probe = await analyzer.probe(file, file.name);
if (!probe.ok) return showError(probe.message);
const id = randomId();
const source = handle
  ? await storage.putMediaHandle(id, handle)
  : await storage.putMedia(id, file, signal);
const asset = assetFromProbe(probe.media, id, source);
editor.apply('Import', (d) => addAsset(d, asset));
engine.addMedia(id, file);
analyzer.addMedia(
  id,
  file,
  asset.kind,
  asset.audioTrack !== undefined ? { audioTrack: asset.audioTrack } : {},
);
// Open (crash recovery)
const loaded = await storage.loadProject(projectId); // show loaded.warnings
for (const asset of Object.values(loaded.project.assets)) {
  const blob = await storage.getMedia(asset); // null → "re-link / missing media" UI
}
const autosave = attachAutosave(editor, storage, { onSave: props.onSave, onError });
if (!(await storage.status()).persistent) warn(); // and requestPersistence() after a gesture
```

## DECISIONS (proposed new entries)

45. **Media analysis runs in its own worker, not the engine worker** (2026-10-17). Thumbnail and
    waveform decoding must never take the engine's decoders or delay a preview frame, and gets its
    own tier budget (**low 1 decode job, else 2**). Cost: Mediabunny is loaded by two workers
    (one extra ~100 KB gz parse; a few MB of worker heap).
46. **Timeline thumbnails snap to the keyframe at or before the time** (2026-10-17, measured).
    One packet decode per thumbnail; requests that snap to the same keyframe + height share one
    decode. Measured 20-thumbnail strips (Chrome / WebKit / Firefox): 60 s 1080p 55–126 / 245 /
    72 ms vs exact 178 / 494 / 397 ms; long-GOP 4K 77 / 249 / 106 ms vs 697 / 1208 / 2016 ms;
    iPhone 4K60 HEVC 360 / 555 ms vs 874 / 1303 ms. `exact` mode stays available (cover frames).
    Decoding goes through Mediabunny `VideoSampleSink.samplesAtTimestamps` (one decoder per batch,
    keeps the per-browser workarounds of #34). Scaling happens in the worker: OffscreenCanvas 2D +
    `VideoSample.drawWithFit` (applies rotation) + `transferToImageBitmap`. `CanvasSink` would do
    the same decode + draw but hands out a canvas pool, not transferable bitmaps.
47. **Thumbnail scheduling: newest request first, batched per asset, abortable, byte-budgeted
    cache** (low 8 MB, mid 24 MB, high 48 MB of bitmaps). The caller owns every returned bitmap
    (the cache keeps its own copy). Watchdog 4 s per decode step.
48. **Waveforms: max |sample| over all channels per 10 ms bucket (100/s), capped at 262,144
    buckets (1 MB) per asset**; stream-decoded, never the whole PCM. A waveform job yields its
    decode slot to waiting thumbnails every 8 s of audio. Cached in memory and, through
    `WaveformCache`, in OPFS (`media/<id>.peaks`).
49. **Project files: `snapshot-<seq>.json` + `log-<seq>.jsonl`, never overwritten** (2026-10-17).
    OPFS has no atomic rename everywhere (`move()` is missing in older Safari/Firefox), so a new
    snapshot gets a new name and older snapshots/logs are deleted only after it is complete.
    Load = newest snapshot that parses + its log while seqs continue without a gap; a torn last
    line is ignored. Log entries store `patches` only (no `inverse`): undo history isn't restored
    after a crash. Seqs belong to the storage (the editor's restart at 1 per session).
50. **Every OPFS write goes through a storage worker using `createSyncAccessHandle`**
    (2026-10-17). It's the only OPFS write API on iOS 17/18 Safari (`createWritable` arrived in
    Safari 26) and keeps 1 GB copies off the main thread. Measured the same speed as main-thread
    `createWritable` (57 MB: 64 ms vs 64 ms Chrome, 56 vs 66 ms Firefox). Different files write in
    parallel (a big import doesn't hold up autosave); a locked file is retried briefly.
51. **Memory fallback, and OPFS is only given up after a retried probe** (2026-10-17). Falling
    back silently loses work on reload: in dev (strict mode) two storages probing one file made
    Firefox fall back once. Probe files are unique; both lock errors (`NoModificationAllowedError`,
    Firefox `InvalidStateError`) retry. `putMedia` checks `estimate()` first and maps
    `QuotaExceededError` to `StorageFullError`; a failed log append is reported and closed by a
    snapshot ~1 s later.
52. **Autosave makes the editor's project the saved state at attach** (fresh snapshot), batches
    log writes every 250 ms, snapshots every 200 entries / 5 s idle / tab hidden / pagehide /
    1 s after a rename, and calls `onSave` 1 s after the last edit. `listProjects` reads names
    from `meta.json` (written after each snapshot) and only lists projects whose first snapshot
    completed.

## PERF (new measurements)

### 2026-10-17 · Media analyzer (Mac M4, headless, `scripts/analyzer-check.ts`, tier mid)

20 thumbnails 96 px high requested at once (as a timeline strip), fresh analyzer each:

| File                                  | Mode     | Chrome first / all 20 | WebKit first / all 20 | Firefox first / all 20 |
| ------------------------------------- | -------- | --------------------- | --------------------- | ---------------------- |
| 60 s 1080p H.264 (keyframe every 1 s) | keyframe | 10 / 55 ms            | 25 / 245 ms           | 12 / 72 ms             |
|                                       | exact    | 22 / 178 ms           | 48 / 494 ms           | 30 / 397 ms            |
| 4K30 H.264, long GOP                  | keyframe | 33 / 77 ms            | 61 / 249 ms           | 42 / 106 ms            |
|                                       | exact    | 65 / 697 ms           | 104 / 1208 ms         | 99 / 2016 ms           |
| HEVC 1080p                            | keyframe | 8 / 14 ms             | 28 / 54 ms            | (no HEVC)              |
| iPhone 4K60 HDR HEVC portrait         | keyframe | 14 / 360 ms           | 46 / 555 ms           | (no HEVC)              |
|                                       | exact    | 59 / 874 ms           | 81 / 1303 ms          | (no HEVC)              |

Same strip again (cache): 1–7 ms. Cold start (new worker + first file): first thumbnail 56 ms
Chrome, 78 ms WebKit, 27 ms Firefox. Low tier (1 decoder, Chrome): 60 s strip 67 ms.
Photo 12 MP → 128×96: 39–59 ms. Probe in the worker: 6–30 ms.

Waveforms (100 peaks/s; levels match ffmpeg volumedetect to 3 decimals):

| File                     | Chrome | WebKit | Firefox |
| ------------------------ | ------ | ------ | ------- |
| 3-min MP3 (18,005 peaks) | 220 ms | 394 ms | 522 ms  |
| 60 s video (AAC)         | 86 ms  | 189 ms | 195 ms  |
| 20 s AAC m4a             | 25 ms  | 39 ms  | 59 ms   |

20 thumbnails requested while the 3-min waveform decodes: 50 / 229 / 115 ms (they don't wait for
it; low tier Chrome 60 ms). Abort: 30 of 40 aborted → all 30 resolve `null` at once, only the 10
live ones decode. **0 main-thread long tasks, 0 open frames after every scenario, in all three.**

### 2026-10-17 · Storage (`scripts/storage-check.ts`, `storage.test.ts`)

| Check                                      | Chrome                   | Firefox            | WebKit (Playwright) |
| ------------------------------------------ | ------------------------ | ------------------ | ------------------- |
| Backend · open time                        | OPFS · 14–17 ms          | OPFS · 28–45 ms    | memory (no OPFS)    |
| Reload after 40 edits (no explicit flush)  | 40 / 40, exact           | 40 / 40, exact     | in-page only        |
| Tab killed mid-burst (edit every 5 ms)     | crash: 373 of ~380       | close: 282 of ~310 | —                   |
| Load (snapshot + log replay)               | 2–6 ms                   | 2–5 ms             | —                   |
| Copy 57 MB into OPFS (worker, sync handle) | 64–87 ms (~650–890 MB/s) | 56–61 ms (~1 GB/s) | —                   |
| Same with main-thread `createWritable`     | 64–83 ms                 | 63–66 ms           | —                   |
| 500-item project: stringify / attach+flush | 0.1 ms / 5 ms            | ≤ 1 ms / 3–10 ms   | —                   |
| Main-thread long tasks                     | 0                        | 0                  | 0                   |

Killed-tab recovery is always exactly a saved state, and never older than what the 250 ms batch
had written (edits made ≥ 1 s before the kill are always there). Node (vitest): 500-item project
175 KB JSON, stringify 1.0 ms, load 14 ms. Crash property test (random edits, random flushes, a
crash at a random byte, random snapshotEvery 2–12): 2000 runs pass (`FC_RUNS=2000`).

## BACKLOG (new items)

- [ ] **Real Safari (iPhone batch):** storage worker with `createSyncAccessHandle` on iOS 17/18/26,
      `persist()` answer, recovery after the tab is killed by iOS; analyzer thumbnails of iPhone HEVC
      on the phone. Playwright's WebKit has no OPFS, so storage-check only covers memory there.
- [ ] **Two tabs on one project** corrupt each other's log (both append, both compact). Take a Web
      Lock (`navigator.locks`) per project in `attachAutosave`; the second tab opens read-only or asks.
- [ ] `url` sources: `getMedia` fetches the whole file into a Blob. Use range reads (Mediabunny
      `UrlSource`) in the engine/analyzer, or stream it into OPFS once.
- [ ] File handles: `requestPermission` only works inside a user gesture → the UI needs a
      "re-link / allow access" prompt when `getMedia` returns null for a `handle` source.
- [ ] Orphaned media: a crash between `putMedia` and the next snapshot leaves `media/<id>` that no
      project lists. Add a sweep (media not referenced by any project's meta, older than a day).
- [ ] HDR thumbnails show the browser's own HDR → SDR conversion (too bright, DECISIONS #33): the
      2D-canvas path has no correction. Fine for a strip; revisit if it looks wrong on iPhone.
- [ ] Two decode jobs on one asset can decode the same keyframe twice (long-GOP 4K: 5 decodes for 3
      keyframes). Share in-flight keyframe decodes across jobs.
- [ ] Analyzer watchdog isn't exercised by a test (needs a stalled fake decoder).
- [ ] `exact` thumbnails on long-GOP 4K take 0.7–2 s per strip — keep `keyframe` for strips; use
      `exact` only for single frames (cover / freeze preview).
- [ ] Mediabunny loads in two workers (engine + analyzer); measure the memory on a low-end phone.

## PROGRESS (entry)

**2026-10-17 · Media analyzer + persistence (Day 4 · 3.3/3.4 core, Day 6 · 4.2)**

- `media/analyzer.ts` + `analyzer-worker.ts` (→ `dist/analyzer.worker.js`): `createMediaAnalyzer`
  — probing in the worker, keyframe thumbnail batches (newest first, deduplicated, abortable,
  cached, tier decode budget, watchdog), streamed waveform peaks (`media/peaks.ts`, unit-tested
  against brute force).
- `storage/*`: `createProjectStorage` (OPFS via `storage.worker.js` sync access handles, memory
  fallback, IndexedDB file handles), snapshot + op-log format with compaction, crash-safe load,
  `StorageFullError`, waveform cache; `attachAutosave` (250 ms batches, snapshots every 200 / idle
  / hidden / pagehide, debounced `onSave`, follows `editor.load`).
- Tests: `storage.test.ts` (round trip, compaction, torn log line, torn snapshot, damaged line,
  editor.load, onSave debounce, full disk, media + waveform, 500-item project, crash property test),
  `peaks.test.ts`. Random-edit generator moved to `test/random-edits.ts` (shared with history tests).
- Browser checks: `scripts/analyzer-check.ts` (`/lab/analyzer`) and `scripts/storage-check.ts`
  (`/lab/storage`) — all pass in Chrome, WebKit, Firefox, 0 main-thread long tasks.
- Test media: `avc-1080p30-60s.mp4` (60 s, keyframe every 1 s) and `music-3min.mp3` (`pnpm media`).

## HANDOFF / how to run

```sh
pnpm media                        # adds avc-1080p30-60s.mp4 + music-3min.mp3
pnpm --filter playground dev      # then:
node scripts/analyzer-check.ts [--browsers chrome,webkit,firefox] [--port 3200] [--tier low] [--private]
node scripts/storage-check.ts  [--browsers chrome,webkit,firefox] [--port 3200] [--media file]
FC_RUNS=2000 pnpm --filter @video-ultra/core test   # deep crash-recovery property run
```

Next iPhone batch: open `/lab/analyzer` and `/lab/storage` (both expose `window.*Lab`; a phone
button UI isn't there yet — add buttons or drive from Web Inspector).

## PLAN

- Day 4 · 3.3 / 3.4: core side done (probe in a worker, thumbnails, waveforms); UI still open.
- Day 6 · 4.2: autosave via op log, crash recovery, `storage.persist()` done in core; React
  wiring (`initialProject` / `onSave`) still open.
