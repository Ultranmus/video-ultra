'use client';

/**
 * Media-analyzer lab: thumbnail strips, waveforms, probing and cancellation through the analyzer
 * worker, with timings and main-thread long tasks. scripts/analyzer-check.ts drives
 * `window.analyzerLab` in Chrome, WebKit and Firefox. Query: `?tier=low|mid|high`.
 */
import type { DeviceTier } from '@video-ultra/core';
import {
  createMediaAnalyzer,
  type AnalyzerStats,
  type MediaAnalyzer,
  type ThumbnailMode,
} from '@video-ultra/core/internal';
import { useEffect, useRef, useState } from 'react';

interface StripResult {
  file: string;
  mode: ThumbnailMode;
  probeMs: number;
  duration: number;
  /** Request → first bitmap, ms. */
  firstMs: number;
  /** Request → all bitmaps, ms. */
  allMs: number;
  delivered: number;
  nulls: number;
  /** Second strip at the same height (cache). */
  againMs: number;
  width: number;
  height: number;
  stats: AnalyzerStats;
  error?: string;
}

interface WaveResult {
  file: string;
  ms: number;
  peaks: number;
  peaksPerSecond: number;
  duration: number;
  max: number;
  /** Peak level around the middle of each tenth of the file (to see the envelope). */
  envelope: number[];
  /** Second call (in-memory cache). */
  againMs: number;
  stats: AnalyzerStats;
}

interface AbortResult {
  requested: number;
  aborted: number;
  abortedResolvedNull: number;
  delivered: number;
  ms: number;
  stats: AnalyzerStats;
}

declare global {
  interface Window {
    analyzerLab?: {
      ready: boolean;
      strip(
        file: string,
        mode: ThumbnailMode,
        count?: number,
        height?: number,
      ): Promise<StripResult>;
      waveform(file: string): Promise<WaveResult>;
      abortTest(file: string): Promise<AbortResult>;
      image(file: string): Promise<{ ms: number; width: number; height: number } | null>;
      concurrent(
        waveFile: string,
        stripFile: string,
      ): Promise<{ waveMs: number; thumbsMs: number; thumbs: number; stats: AnalyzerStats }>;
      longTasks(): { count: number; max: number; maxRafGap: number };
      resetLongTasks(): void;
    };
  }
}

const blobs = new Map<string, Promise<Blob>>();
const blobOf = (file: string) => {
  let blob = blobs.get(file);
  if (!blob) {
    blob = fetch(`/media/${file}`).then((r) => {
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
      return r.blob();
    });
    blobs.set(file, blob);
  }
  return blob;
};

export default function AnalyzerLab() {
  const [status, setStatus] = useState('Loading…');
  const [log, setLog] = useState<string[]>([]);
  const stripRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const tier = (new URLSearchParams(location.search).get('tier') ?? 'mid') as DeviceTier;
    const longTasks: number[] = [];
    let maxRafGap = 0;
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longTasks.push(e.duration);
      });
      observer.observe({ type: 'longtask' });
    } catch {
      observer = null; // Safari / Firefox: rely on the rAF gap
    }
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      maxRafGap = Math.max(maxRafGap, now - last);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const analyzers = new Set<MediaAnalyzer>();
    const fresh = (mode: ThumbnailMode) => {
      const a = createMediaAnalyzer({ tier, thumbnails: mode });
      analyzers.add(a);
      return a;
    };
    const done = (a: MediaAnalyzer) => {
      a.destroy();
      analyzers.delete(a);
    };
    const note = (line: string) => setLog((l) => [...l, line]);

    const draw = (bitmaps: (ImageBitmap | null)[]) => {
      const canvas = stripRef.current;
      if (!canvas) return;
      const h = bitmaps.find(Boolean)?.height ?? 1;
      const widths = bitmaps.map((b) => b?.width ?? 0);
      canvas.width = Math.max(
        1,
        widths.reduce((a, b) => a + b, 0),
      );
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      let x = 0;
      for (const b of bitmaps) {
        if (b) ctx.drawImage(b, x, 0);
        x += b?.width ?? 0;
      }
    };

    window.analyzerLab = {
      ready: true,
      async strip(file, mode, count = 20, height = 96) {
        const analyzer = fresh(mode);
        try {
          const blob = await blobOf(file);
          const t0 = performance.now();
          const probe = await analyzer.probe(blob, file);
          const probeMs = performance.now() - t0;
          if (!probe.ok) {
            return {
              file,
              mode,
              probeMs,
              duration: 0,
              firstMs: 0,
              allMs: 0,
              delivered: 0,
              nulls: count,
              againMs: 0,
              width: 0,
              height: 0,
              stats: await analyzer.stats(),
              error: `${probe.code}: ${probe.message}`,
            };
          }
          const duration = probe.media.duration / 705_600_000;
          analyzer.addMedia('a', blob, probe.media.kind);
          const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration);
          const t1 = performance.now();
          let firstMs = 0;
          const bitmaps = await Promise.all(
            times.map((t) =>
              analyzer.thumbnail('a', t, height).then((b) => {
                if (b && !firstMs) firstMs = performance.now() - t1;
                return b;
              }),
            ),
          );
          const allMs = performance.now() - t1;
          draw(bitmaps);
          const first = bitmaps.find(Boolean);
          const width = first?.width ?? 0;
          const thumbHeight = first?.height ?? 0;
          const delivered = bitmaps.filter(Boolean).length;
          for (const b of bitmaps) b?.close();
          const t2 = performance.now();
          const again = await Promise.all(times.map((t) => analyzer.thumbnail('a', t, height)));
          const againMs = performance.now() - t2;
          for (const b of again) b?.close();
          const result: StripResult = {
            file,
            mode,
            probeMs,
            duration,
            firstMs,
            allMs,
            delivered,
            nulls: count - delivered,
            againMs,
            width,
            height: thumbHeight,
            stats: await analyzer.stats(),
          };
          note(
            `${file} [${mode}] first ${firstMs.toFixed(0)} ms, ${count} in ${allMs.toFixed(0)} ms, cached ${againMs.toFixed(0)} ms`,
          );
          return result;
        } finally {
          done(analyzer);
        }
      },

      async waveform(file) {
        const analyzer = fresh('keyframe');
        try {
          const blob = await blobOf(file);
          const probe = await analyzer.probe(blob, file);
          if (!probe.ok) throw new Error(probe.message);
          analyzer.addMedia(
            'a',
            blob,
            probe.media.kind,
            probe.media.audioTrack !== undefined ? { audioTrack: probe.media.audioTrack } : {},
          );
          const t0 = performance.now();
          const wave = await analyzer.waveform('a');
          const ms = performance.now() - t0;
          if (!wave) throw new Error('no waveform');
          const t1 = performance.now();
          const again = await analyzer.waveform('a');
          const againMs = performance.now() - t1;
          if (again !== wave) throw new Error('waveform cache returned a different object');
          let max = 0;
          for (const p of wave.peaks) max = Math.max(max, p);
          // Peak level around each tenth of the file (max over 0.1 s there).
          const span = Math.max(1, Math.round(wave.peaksPerSecond / 10));
          const envelope = Array.from({ length: 10 }, (_, i) => {
            const at = Math.floor(((i + 0.5) / 10) * wave.peaks.length);
            let m = 0;
            for (let j = at; j < Math.min(wave.peaks.length, at + span); j++)
              m = Math.max(m, wave.peaks[j]!);
            return Math.round(m * 1000) / 1000;
          });
          note(`${file} waveform ${ms.toFixed(0)} ms, ${wave.peaks.length} peaks`);
          return {
            file,
            ms,
            peaks: wave.peaks.length,
            peaksPerSecond: wave.peaksPerSecond,
            duration: wave.duration,
            max,
            envelope,
            againMs,
            stats: await analyzer.stats(),
          };
        } finally {
          done(analyzer);
        }
      },

      async abortTest(file) {
        const analyzer = fresh('keyframe');
        try {
          const blob = await blobOf(file);
          const probe = await analyzer.probe(blob, file);
          if (!probe.ok) throw new Error(probe.message);
          analyzer.addMedia('a', blob, probe.media.kind);
          const duration = probe.media.duration / 705_600_000;
          const controllers = Array.from({ length: 40 }, () => new AbortController());
          const t0 = performance.now();
          const results = controllers.map((c, i) =>
            analyzer.thumbnail('a', (i / 40) * duration, 64, c.signal),
          );
          // Abort the 30 oldest (a fast scroll past them).
          for (const c of controllers.slice(0, 30)) c.abort();
          const bitmaps = await Promise.all(results);
          const ms = performance.now() - t0;
          const abortedResolvedNull = bitmaps.slice(0, 30).filter((b) => b === null).length;
          const delivered = bitmaps.filter(Boolean).length;
          for (const b of bitmaps) b?.close();
          // Let in-flight work settle, then check nothing leaked.
          await new Promise((r) => setTimeout(r, 300));
          return {
            requested: 40,
            aborted: 30,
            abortedResolvedNull,
            delivered,
            ms,
            stats: await analyzer.stats(),
          };
        } finally {
          done(analyzer);
        }
      },

      async image(file) {
        const analyzer = fresh('keyframe');
        try {
          const blob = await blobOf(file);
          analyzer.addMedia('img', blob, 'image');
          const t0 = performance.now();
          const bitmap = await analyzer.thumbnail('img', 0, 96);
          const ms = performance.now() - t0;
          if (!bitmap) return null;
          const out = { ms, width: bitmap.width, height: bitmap.height };
          bitmap.close();
          return out;
        } finally {
          done(analyzer);
        }
      },

      async concurrent(waveFile, stripFile) {
        const analyzer = fresh('keyframe');
        try {
          const [waveBlob, stripBlob] = await Promise.all([blobOf(waveFile), blobOf(stripFile)]);
          analyzer.addMedia('w', waveBlob, 'audio');
          const probe = await analyzer.probe(stripBlob, stripFile);
          if (!probe.ok) throw new Error(probe.message);
          analyzer.addMedia('v', stripBlob, probe.media.kind);
          const duration = probe.media.duration / 705_600_000;
          const t0 = performance.now();
          const wave = analyzer.waveform('w').then(() => performance.now() - t0);
          // The timeline scrolls while the waveform is still decoding.
          await new Promise((r) => setTimeout(r, 30));
          const t1 = performance.now();
          const bitmaps = await Promise.all(
            Array.from({ length: 20 }, (_, i) =>
              analyzer.thumbnail('v', ((i + 0.5) / 20) * duration, 96),
            ),
          );
          const thumbsMs = performance.now() - t1;
          const thumbs = bitmaps.filter(Boolean).length;
          for (const b of bitmaps) b?.close();
          const waveMs = await wave;
          return { waveMs, thumbsMs, thumbs, stats: await analyzer.stats() };
        } finally {
          done(analyzer);
        }
      },

      longTasks: () => ({
        count: longTasks.length,
        max: Math.max(0, ...longTasks),
        maxRafGap,
      }),
      resetLongTasks() {
        longTasks.length = 0;
        maxRafGap = 0;
        last = performance.now();
      },
    };
    // Status text is set from a microtask, not synchronously inside the effect.
    void Promise.resolve().then(() => !cancelled && setStatus(`Ready · tier ${tier}`));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      for (const a of analyzers) a.destroy();
      delete window.analyzerLab;
    };
  }, []);

  return (
    <main className="page">
      <h1>Analyzer lab</h1>
      <p id="status">{status}</p>
      <canvas ref={stripRef} style={{ maxWidth: '100%', imageRendering: 'auto' }} />
      <pre id="log">{log.join('\n')}</pre>
    </main>
  );
}
