'use client';

/**
 * Storage lab: autosave through the op log, crash recovery after a reload or a killed tab, media
 * copies into OPFS and big snapshots — with main-thread long tasks. scripts/storage-check.ts drives
 * `window.storageLab` in Chrome, WebKit and Firefox.
 *
 * Edits are deterministic: edit i renames the project to "edit i" (and every 5th adds a title), so
 * the state after edit i can be rebuilt from the name alone and compared with what was recovered.
 */
import {
  addToLane,
  createEditor,
  createProject,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  fromSeconds,
  insertMain,
  NO_CROP,
  renameProject,
  sequentialIds,
  updateItem,
  type Editor,
  type Project,
  type TextItem,
  type VideoItem,
} from '@video-ultra/core';
import {
  attachAutosave,
  createProjectStorage,
  type Autosave,
  type ProjectStorage,
  type StorageStatus,
} from '@video-ultra/core/internal';
import { useEffect, useState } from 'react';

const NAMESPACE = 'video-ultra-lab';
const PROJECT_ID = 'lab1';

function baseProject(): Project {
  // sequentialIds('lab') → the project id is "lab1".
  return createProject({ ids: sequentialIds('lab'), now: '2026-10-17T00:00:00.000Z' });
}

function applyEdit(editor: Editor, i: number): void {
  editor.apply(`Edit ${i}`, (draft, ctx) => {
    renameProject(draft, `edit ${i}`);
    if (i % 5 === 0) {
      const item: TextItem = {
        id: `t${i}`,
        kind: 'text',
        text: `Title ${i}`,
        start: fromSeconds(i * 0.1),
        duration: fromSeconds(0.5),
        style: structuredClone(DEFAULT_TEXT_STYLE),
        transform: { ...DEFAULT_TRANSFORM },
        filter: null,
        adjust: {},
      };
      addToLane(draft, item, ctx.ids);
    }
  });
}

/** The project after edits 1…n, rebuilt from scratch. */
function expectedAfter(n: number): Project {
  const editor = createEditor(baseProject(), { ids: sequentialIds('lane') });
  for (let i = 1; i <= n; i++) applyEdit(editor, i);
  return editor.getProject();
}

/** JSON with sorted keys (validation may reorder keys; values must match exactly). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

declare global {
  interface Window {
    storageLab?: {
      ready: boolean;
      kind: 'opfs' | 'memory';
      /** Time createProjectStorage took (opens OPFS, starts + probes the storage worker). */
      initMs: number;
      status(): Promise<StorageStatus>;
      reset(): Promise<void>;
      /** Starts a fresh project with autosave attached. */
      start(): Promise<void>;
      /** Edits 1…n (continuing the count), `intervalMs` apart. Resolves when done. */
      burst(n: number, intervalMs: number): Promise<number>;
      /** Edits made so far. */
      edits(): number;
      /** Loads the stored project; `matches` = equals the state after edit N (N from its name). */
      recover(): Promise<{
        found: boolean;
        edits: number;
        matches: boolean;
        warnings: string[];
        ms: number;
        projects: number;
      }>;
      media(file: string): Promise<{ bytes: number; ms: number; roundTrip: boolean }>;
      /** The same copy with main-thread `createWritable` (where it exists), for comparison. */
      writableCopy(file: string): Promise<{ bytes: number; ms: number } | null>;
      bigSnapshot(items: number): Promise<{ stringifyMs: number; saveMs: number; bytes: number }>;
      longTasks(): { count: number; max: number; maxRafGap: number };
      resetLongTasks(): void;
    };
  }
}

export default function StorageLab() {
  const [status, setStatus] = useState('Loading…');

  useEffect(() => {
    let cancelled = false;
    let storage: ProjectStorage | null = null;
    let editor: Editor | null = null;
    let autosave: Autosave | null = null;
    let count = 0;
    const longTasks: number[] = [];
    let maxRafGap = 0;
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longTasks.push(e.duration);
      });
      observer.observe({ type: 'longtask' });
    } catch {
      observer = null;
    }
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      maxRafGap = Math.max(maxRafGap, now - last);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    void (async () => {
      const t0 = performance.now();
      const opened = await createProjectStorage({ namespace: NAMESPACE });
      const initMs = performance.now() - t0;
      if (cancelled) {
        opened.close();
        return;
      }
      storage = opened;
      const s = opened;
      window.storageLab = {
        ready: true,
        kind: s.kind,
        initMs,
        status: () => s.status(),
        async reset() {
          autosave?.detach();
          autosave = null;
          for (const p of await s.listProjects()) await s.deleteProject(p.id);
          await s.deleteMedia('lab-media');
        },
        async start() {
          autosave?.detach();
          await s.deleteProject(PROJECT_ID);
          count = 0;
          editor = createEditor(baseProject(), { ids: sequentialIds('lane') });
          autosave = attachAutosave(editor, s, {
            onError: (e) => console.error(`autosave: ${e.message}`),
          });
        },
        async burst(n, intervalMs) {
          for (let i = 0; i < n; i++) {
            applyEdit(editor!, ++count);
            // The check script reads progress from the console (it survives a killed tab).
            if (count % 10 === 0) console.log(`edits ${count}`);
            if (intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
          }
          console.log(`edits ${count}`);
          return count;
        },
        edits: () => count,
        async recover() {
          const t0 = performance.now();
          const loaded = await s.loadProject(PROJECT_ID);
          const ms = performance.now() - t0;
          const projects = (await s.listProjects()).length;
          if (!loaded)
            return { found: false, edits: 0, matches: false, warnings: [], ms, projects };
          const edits = Number(/^edit (\d+)$/.exec(loaded.project.name)?.[1] ?? 0);
          const matches = canonical(loaded.project) === canonical(expectedAfter(edits));
          return { found: true, edits, matches, warnings: loaded.warnings, ms, projects };
        },
        async media(file) {
          const blob = await (await fetch(`/media/${file}`)).blob();
          const t0 = performance.now();
          const source = await s.putMedia('lab-media', blob);
          const ms = performance.now() - t0;
          const back = await s.getMedia({
            id: 'lab-media',
            kind: 'video',
            name: file,
            mimeType: blob.type,
            size: blob.size,
            duration: 0,
            hasAudio: false,
            source,
          });
          // Compare the first and last MB byte for byte.
          const same = async (a: Blob, b: Blob) => {
            const x = new Uint8Array(await a.arrayBuffer());
            const y = new Uint8Array(await b.arrayBuffer());
            return x.length === y.length && x.every((v, i) => v === y[i]);
          };
          const mb = 2 ** 20;
          const roundTrip =
            !!back &&
            back.size === blob.size &&
            (await same(back.slice(0, mb), blob.slice(0, mb))) &&
            (await same(back.slice(-mb), blob.slice(-mb)));
          await s.deleteMedia('lab-media');
          return { bytes: blob.size, ms, roundTrip };
        },
        async writableCopy(file) {
          const blob = await (await fetch(`/media/${file}`)).blob();
          const root = await navigator.storage.getDirectory();
          const handle = await root.getFileHandle('writable-copy.bin', { create: true });
          const create = (
            handle as FileSystemFileHandle & { createWritable?: () => Promise<WritableStream> }
          ).createWritable;
          if (!create) return null;
          const t0 = performance.now();
          await blob.stream().pipeTo(await create.call(handle));
          const ms = performance.now() - t0;
          await root.removeEntry('writable-copy.bin');
          return { bytes: blob.size, ms };
        },
        async bigSnapshot(items) {
          const project = createProject({ ids: sequentialIds('big'), now: '2026-10-17T00:00:00Z' });
          project.assets.v = {
            id: 'v',
            kind: 'video',
            name: 'v.mp4',
            mimeType: 'video/mp4',
            size: 1,
            duration: fromSeconds(10),
            hasAudio: true,
            source: { type: 'opfs', key: 'v' },
          };
          for (let i = 0; i < items; i++) {
            const item: VideoItem = {
              id: `v${i}`,
              kind: 'video',
              assetId: 'v',
              start: 0,
              duration: fromSeconds(1),
              sourceIn: 0,
              speed: 1,
              volume: 1,
              muted: false,
              fadeIn: 0,
              fadeOut: 0,
              transform: { ...DEFAULT_TRANSFORM },
              crop: { ...NO_CROP },
              fit: 'fit',
              filter: null,
              adjust: {},
              transitionIn: null,
            };
            insertMain(project, item);
          }
          const t0 = performance.now();
          const text = JSON.stringify(project);
          const stringifyMs = performance.now() - t0;
          const big = createEditor(project);
          const t1 = performance.now();
          const save = attachAutosave(big, s);
          big.apply('Volume', (d) => updateItem(d, 'v1', { volume: 0.5 }));
          await save.flush();
          const saveMs = performance.now() - t1;
          save.detach();
          await s.deleteProject(project.id);
          return { stringifyMs, saveMs, bytes: text.length };
        },
        longTasks: () => ({ count: longTasks.length, max: Math.max(0, ...longTasks), maxRafGap }),
        resetLongTasks() {
          longTasks.length = 0;
          maxRafGap = 0;
          last = performance.now();
        },
      };
      setStatus(`Ready · ${s.kind}`);
    })().catch((e: unknown) => setStatus(`FAILED ${String(e)}`));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      autosave?.detach();
      storage?.close();
      delete window.storageLab;
    };
  }, []);

  return (
    <main className="page">
      <h1>Storage lab</h1>
      <p id="status">{status}</p>
    </main>
  );
}
