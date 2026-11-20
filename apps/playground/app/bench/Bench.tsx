'use client';

import { detectCapabilities, type Capabilities } from '@video-ultra/core';
import {
  createLabSession,
  type BackendChoice,
  type Distribution,
  type LabSession,
  type MediaInfo,
} from '@video-ultra/core/internal';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

interface ManifestEntry {
  file: string;
  label: string;
  kind: 'video' | 'audio' | 'image' | 'broken';
}

type Rows = [string, string][];

/** One headline number of a result card (for reading at a glance; the rows hold everything). */
interface Metric {
  label: string;
  value: string;
  unit?: string;
  /** Shown under the value when there is no target. */
  note?: string;
  /** The target, in words ("under 100 ms"). */
  target?: string;
  pass?: boolean;
}

interface ResultBlock {
  title: string;
  rows: Rows;
  /** Display only: left out of the report file. */
  metrics?: Metric[];
}

const fmtDist = (d: Distribution) =>
  `avg ${d.avg} · p50 ${d.p50} · p95 ${d.p95} · max ${d.max} (n=${d.count})`;
const yesNo = (v: boolean) => (v ? 'yes' : 'no');

interface MainThreadResult {
  rows: Rows;
  /** Long tasks over 50 ms, or `null` where the browser can't observe them. */
  longTasks: number | null;
  gapsOver50: number;
}

/** Watches the main thread while a test runs: long tasks (Chrome) and rAF gaps (every browser). */
function startMainThreadMonitor() {
  let longTasks = 0;
  let maxLongTask = 0;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks++;
        maxLongTask = Math.max(maxLongTask, entry.duration);
      }
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    observer = null;
  }
  let last = performance.now();
  let maxGap = 0;
  let gapsOver50 = 0;
  let running = true;
  const tick = (now: number) => {
    const gap = now - last;
    last = now;
    if (gap > maxGap) maxGap = gap;
    if (gap > 50) gapsOver50++;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return (): MainThreadResult => {
    running = false;
    observer?.disconnect();
    return {
      rows: [
        [
          'Main thread: long tasks > 50 ms',
          observer
            ? `${longTasks} (max ${Math.round(maxLongTask)} ms)`
            : 'not measurable in this browser',
        ],
        ['Main thread: frame gaps > 50 ms', `${gapsOver50} (max gap ${Math.round(maxGap)} ms)`],
        ['Main thread: JS heap', heap()],
      ],
      longTasks: observer ? longTasks : null,
      gapsOver50,
    };
  };
}

/** The main-thread headline: long tasks where the browser reports them, frame gaps elsewhere. */
function mainThreadMetric(main: MainThreadResult): Metric {
  return main.longTasks !== null
    ? {
        label: 'Main-thread long tasks',
        value: String(main.longTasks),
        target: '0',
        pass: main.longTasks === 0,
      }
    : {
        label: 'Frame gaps over 50 ms',
        value: String(main.gapsOver50),
        target: '0',
        pass: main.gapsOver50 === 0,
      };
}

function openFramesMetric(open: number): Metric {
  return { label: 'Video frames left open', value: String(open), target: '0', pass: open === 0 };
}

function heap(): string {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory
    ? `${(memory.usedJSHeapSize / 1048576).toFixed(1)} MB`
    : 'not exposed by this browser';
}

function exportSize(info: MediaInfo | null): { width: number; height: number } {
  const w = info?.video?.displayWidth ?? 1920;
  const h = info?.video?.displayHeight ?? 1080;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return w >= h
    ? { width: 1920, height: even((1920 * h) / w) }
    : { width: even((1920 * w) / h), height: 1920 };
}

/** `?play=600` turns the play test into a soak test of that many seconds. */
function playSeconds(): number {
  if (typeof window === 'undefined') return 10;
  const value = Number(new URLSearchParams(window.location.search).get('play'));
  return Number.isFinite(value) && value > 0 ? value : 10;
}

/** The URL query doesn't change while the bench is open. */
const noSubscribe = () => () => {};

/** `?decoders=2` runs the scrub test with a low-tier decoder budget. */
function scrubDecoders(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = Number(new URLSearchParams(window.location.search).get('decoders'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

interface Verdict {
  kind: 'good' | 'warn' | 'bad';
  title: string;
  detail: string;
}

/** A one-line answer to "can I edit video here?", from the detected capabilities. */
function verdictFor(c: Capabilities): Verdict {
  const renderer = c.webgpu ? 'WebGPU' : 'WebGL2';
  if (!c.supported) {
    const missing = [
      !c.webcodecs.video && 'WebCodecs video',
      !c.offscreenCanvas && 'OffscreenCanvas',
      !c.webgpu && !c.webgl2 && 'WebGPU or WebGL2',
      !c.decode.avc && 'H.264 decoding',
    ].filter((m): m is string => Boolean(m));
    return {
      kind: 'bad',
      title: 'Not supported in this browser',
      detail: `It lacks ${missing.join(', ')}. Try the latest Chrome, Edge, Safari or Firefox.`,
    };
  }
  if (c.encode.avc4k) {
    return {
      kind: 'good',
      title: 'Ready for 1080p editing, and 4K too',
      detail: `Plays, edits and exports H.264 video up to 4K here, drawn with ${renderer}.`,
    };
  }
  if (c.encode.avc1080) {
    return {
      kind: 'good',
      title: 'Ready for 1080p editing',
      detail: `Plays, edits and exports H.264 video up to 1080p here, drawn with ${renderer}. 4K export isn't available.`,
    };
  }
  if (c.encode.vp9) {
    return {
      kind: 'warn',
      title: 'Ready to edit; exports as WebM',
      detail: `There is no H.264 encoder here, so exports use VP9 (WebM). Drawn with ${renderer}.`,
    };
  }
  return {
    kind: 'warn',
    title: 'Ready to edit, but not to export',
    detail: 'This browser has no video encoder VideoUltra can use, so exporting won’t work here.',
  };
}

type CapValue = boolean | string;

/** The capability tables, grouped. Each is a real table (scripts/bench.ts reads them as text). */
function capGroups(c: Capabilities): { title: string; rows: [string, CapValue][] }[] {
  return [
    {
      title: 'Device',
      rows: [
        ['Supported', c.supported],
        ['Performance tier', c.tier],
        [
          'Device',
          `${c.mobile ? 'mobile' : 'desktop'}, ${c.cores} cores, ${c.deviceMemoryGb ?? '?'} GB RAM`,
        ],
        ['GPU', c.gpu ?? 'not exposed'],
      ],
    },
    {
      title: 'Drawing',
      rows: [
        ['WebGPU', c.webgpu],
        ['WebGL2', c.webgl2],
        ['OffscreenCanvas', c.offscreenCanvas],
      ],
    },
    {
      title: 'Playing (decode)',
      rows: [
        ['WebCodecs video', c.webcodecs.video],
        ['WebCodecs audio', c.webcodecs.audio],
        ['H.264', c.decode.avc],
        ['HEVC', c.decode.hevc],
        ['VP9', c.decode.vp9],
        ['AV1', c.decode.av1],
      ],
    },
    {
      title: 'Exporting (encode)',
      rows: [
        ['H.264 1080p', c.encode.avc1080],
        ['H.264 4K', c.encode.avc4k],
        ['VP9', c.encode.vp9],
        ['AAC audio', c.encode.aac],
        ['Opus audio', c.encode.opus],
      ],
    },
    {
      title: 'Storage and security',
      rows: [
        ['OPFS (disk space for exports)', c.opfs],
        ['File System Access', c.fileSystemAccess],
        ['Secure context', window.isSecureContext],
      ],
    },
  ];
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M4.5 4.5l7 7m0-7l-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M8 2.5l6 11H2z M8 6.5v3 M8 11.5v.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A yes / no (or pass / fail) badge: icon and word, never colour alone. */
function Badge({ ok, yes = 'Yes', no = 'No' }: { ok: boolean; yes?: string; no?: string }) {
  return (
    <span className={`bench-badge ${ok ? 'is-good' : 'is-bad'}`}>
      {ok ? <CheckIcon /> : <CrossIcon />}
      {ok ? yes : no}
    </span>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  return (
    <div className="bench-metric">
      <span className="bench-metric-label">{metric.label}</span>
      <span className="bench-metric-value">
        {metric.value}
        {metric.unit && <span className="bench-metric-unit"> {metric.unit}</span>}
      </span>
      {metric.target !== undefined ? (
        <span className="bench-metric-target">
          {metric.pass !== undefined && <Badge ok={metric.pass} yes="Pass" no="Fail" />}
          <span>Target: {metric.target}</span>
        </span>
      ) : (
        metric.note && <span className="bench-metric-target">{metric.note}</span>
      )}
    </div>
  );
}

export function Bench() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ManifestEntry[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [upload, setUpload] = useState<File | null>(null);
  const [backend, setBackend] = useState<BackendChoice>('auto');
  const [session, setSession] = useState<LabSession | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [results, setResults] = useState<ResultBlock[]>([]);
  const [status, setStatus] = useState('Starting…');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hdrFile, setHdrFile] = useState<File | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // `?play=` for the labels: 10 on the server and in the first client render, then the real value.
  const playLabel = useSyncExternalStore(noSubscribe, playSeconds, () => 10);

  useEffect(() => {
    detectCapabilities().then(setCaps, (e: unknown) => setCapsError(String(e)));
    fetch('/media/manifest.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((entries: ManifestEntry[]) => {
        setManifest(entries);
        const first = entries.find((e) => e.kind === 'video');
        if (first) setSelected(first.file);
      })
      .catch(() => setManifest([]));
  }, []);

  // A canvas can be handed to a worker only once, so each backend choice gets a fresh canvas.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(stage.clientWidth * dpr);
    canvas.height = Math.round(stage.clientHeight * dpr);
    stage.appendChild(canvas);
    let disposed = false;
    let created: LabSession | null = null;
    setSession(null);
    setInfo(null);
    setStatus('Starting the engine worker…');
    createLabSession(canvas, backend).then(
      (s) => {
        if (disposed) {
          s.destroy();
          return;
        }
        created = s;
        s.onProgress = (p) => setProgress(p);
        setSession(s);
        setStatus(
          `Engine ready · renderer: ${s.backend}` +
            (s.fallbackReason ? ` (WebGPU unavailable: ${s.fallbackReason})` : ''),
        );
      },
      (e: unknown) => {
        if (!disposed) {
          setError(`Engine failed to start: ${String(e)}`);
          setStatus('');
        }
      },
    );
    return () => {
      disposed = true;
      created?.destroy();
      canvas.remove();
    };
  }, [backend]);

  const addResult = useCallback((block: ResultBlock) => setResults((r) => [...r, block]), []);

  /** Pass / fail lines follow PERF.md: high-tier targets on a high-tier device, low-tier ones elsewhere. */
  const highTier = caps?.tier === 'high';

  async function getFile(): Promise<File> {
    if (upload) return upload;
    if (!selected) throw new Error('Pick a test file or upload one');
    const response = await fetch(`/media/${selected}`);
    if (!response.ok) throw new Error(`Could not fetch ${selected} (${response.status})`);
    return new File([await response.blob()], selected);
  }

  async function run<T>(label: string, task: (s: LabSession) => Promise<T>): Promise<T | null> {
    if (!session) return null;
    setBusy(true);
    setError(null);
    setStatus(`${label}…`);
    try {
      const value = await task(session);
      setStatus(`${label}: done`);
      return value;
    } catch (e) {
      setError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
      setStatus('');
      return null;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function load(): Promise<MediaInfo | null> {
    return run('Loading', async (s) => {
      const file = await getFile();
      const t0 = performance.now();
      const loaded = await s.load(file);
      const ms = Math.round(performance.now() - t0);
      setInfo(loaded);
      const v = loaded.video;
      const a = loaded.audio;
      addResult({
        title: `Load · ${loaded.name}`,
        rows: [
          [
            'File',
            `${loaded.name} (${(loaded.sizeBytes / 1048576).toFixed(1)} MB, ${loaded.container})`,
          ],
          ['Probe time', `${ms} ms`],
          ['Duration', `${loaded.durationS.toFixed(2)} s`],
          [
            'Video',
            v
              ? `${v.codec} ${v.codedWidth}×${v.codedHeight} → display ${v.displayWidth}×${v.displayHeight}, rotation ${v.rotation}°, ${v.fps ?? '?'} fps${v.variableFrameRate ? ' (VFR)' : ''}, HDR ${yesNo(v.hdr)}, transfer ${v.colorSpace.transfer ?? '?'}, decodable ${yesNo(v.canDecode)}`
              : 'none',
          ],
          [
            'Audio',
            a
              ? `${a.codec} ${a.sampleRate} Hz × ${a.channels} ch, decodable ${yesNo(a.canDecode)}`
              : 'none',
          ],
        ],
        metrics: [
          { label: 'Time to open', value: String(ms), unit: 'ms', note: loaded.container },
          {
            label: 'Video',
            value: v ? `${v.displayWidth}×${v.displayHeight}` : 'none',
            note: v
              ? `${v.codec ?? '?'} · ${v.fps ?? '?'} fps${v.hdr ? ' · HDR' : ''}`
              : 'audio only',
          },
          {
            label: 'Length',
            value: loaded.durationS.toFixed(1),
            unit: 's',
            note: `${(loaded.sizeBytes / 1048576).toFixed(1)} MB`,
          },
          ...(v
            ? [
                {
                  label: 'Video decodes here',
                  value: v.canDecode ? 'Yes' : 'No',
                  target: 'yes',
                  pass: v.canDecode,
                },
              ]
            : []),
        ],
      });
      return loaded;
    });
  }

  async function play() {
    const seconds = playSeconds();
    const heapBefore = heap();
    const stop = startMainThreadMonitor();
    const r = await run(`Playing ${seconds} s`, (s) => s.play(seconds));
    const main = stop();
    if (!r) return;
    addResult({
      title: `Play · ${r.backend}`,
      rows: [
        [
          'Presented / dropped',
          `${r.presented} / ${r.dropped} (${r.effectiveFps} fps over ${r.seconds} s)`,
        ],
        ['Decode wait (ms)', fmtDist(r.decodeWaitMs)],
        ['Draw CPU (ms)', fmtDist(r.drawMs)],
        ['Frame interval (ms)', fmtDist(r.intervalMs)],
        ['Open frames: max / after', `${r.maxOpenFrames} / ${r.openFramesAfter}`],
        ['Main thread: JS heap before', heapBefore],
        ...main.rows,
      ],
      metrics: [
        {
          label: 'Frames per second',
          value: String(r.effectiveFps),
          unit: 'fps',
          note: `${r.presented} frames over ${r.seconds} s`,
        },
        { label: 'Dropped frames', value: String(r.dropped), target: '0', pass: r.dropped === 0 },
        mainThreadMetric(main),
        openFramesMetric(r.openFramesAfter),
      ],
    });
  }

  async function scrub() {
    const stop = startMainThreadMonitor();
    const decoders = scrubDecoders();
    const r = await run('Scrubbing 30 seeks', (s) =>
      s.scrub(30, decoders ? { decoders } : undefined),
    );
    const main = stop();
    if (!r) return;
    const settleTarget = highTier ? 100 : 250;
    addResult({
      title: `Scrub · ${r.backend}`,
      rows: [
        ['Seek → frame (ms)', fmtDist(r.latencyMs)],
        [
          'Decoders / previews / continued / restarts',
          `${r.sessions} / ${r.previews} / ${r.continued} / ${r.restarts}`,
        ],
        [
          'Previews skipped (no free decoder) / peak decoders',
          `${r.previewsSkipped} / ${r.peakDecoders} of ${r.decoderBudget}`,
        ],
        [
          'Drag (45 seeks, 16 ms apart)',
          r.drag
            ? `${r.drag.framesShown} frames shown, final frame ${r.drag.settleMs} ms after release, ${r.drag.skipped} requests skipped`
            : '-',
        ],
        ['Open frames after', String(r.openFramesAfter)],
        ...main.rows,
      ],
      metrics: [
        {
          label: 'Jump to a frame (median)',
          value: String(r.latencyMs.p50),
          unit: 'ms',
          note: `slowest ${r.latencyMs.max} ms, ${r.latencyMs.count} jumps`,
        },
        ...(r.drag
          ? [
              {
                label: 'Frame after a drag stops',
                value: String(r.drag.settleMs),
                unit: 'ms',
                target: `under ${settleTarget} ms`,
                pass: r.drag.settleMs < settleTarget,
              },
            ]
          : []),
        mainThreadMetric(main),
        openFramesMetric(r.openFramesAfter),
      ],
    });
  }

  async function exportVideo(container: 'mp4' | 'webm', current: MediaInfo | null = info) {
    const { width, height } = exportSize(current);
    const stop = startMainThreadMonitor();
    setProgress(0);
    const r = await run(`Exporting ${container.toUpperCase()} ${width}×${height}`, (s) =>
      s.exportVideo({ width, height, fps: 30, seconds: 5, container }),
    );
    const main = stop();
    if (!r) return;
    const file =
      r.blob ??
      (await (await (await navigator.storage.getDirectory()).getFileHandle(r.fileName)).getFile());
    setExportUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    // PERF.md: faster than real time on high-tier devices, at most 2× real time elsewhere.
    const speedTarget = highTier ? 1 : 0.5;
    addResult({
      title: `Export · ${container} · ${r.backend}`,
      rows: [
        [
          'Output',
          `${r.width}×${r.height} @ ${r.fps} fps, ${r.videoCodec}${r.audioCodec ? ` + ${r.audioCodec}` : ' (no audio)'}`,
        ],
        ['Size', `${(r.sizeBytes / 1048576).toFixed(2)} MB for ${r.mediaSeconds} s`],
        ['Written to', r.storage === 'opfs' ? 'OPFS (disk)' : 'memory (no OPFS here)'],
        [
          'HDR-corrected frames',
          `${r.hdrFrames}${r.otherTransfers.length ? ` (others: ${r.otherTransfers.join(', ')})` : ''}`,
        ],
        [
          'AAC encoder',
          r.audioCodec === 'aac' ? (r.aacFallback ? 'WASM fallback' : 'native') : 'n/a',
        ],
        ['Time', `${r.wallMs} ms → ${r.realtimeFactor}× real time`],
        ['Open frames after', String(r.openFramesAfter)],
        ...main.rows,
      ],
      metrics: [
        {
          label: 'Export speed',
          value: `${r.realtimeFactor}×`,
          unit: 'real time',
          target: highTier ? 'faster than real time' : 'at least 0.5×',
          pass: highTier ? r.realtimeFactor > speedTarget : r.realtimeFactor >= speedTarget,
        },
        {
          label: 'Output',
          value: `${r.width}×${r.height}`,
          note: `${r.videoCodec}${r.audioCodec ? ` + ${r.audioCodec}` : ''} · ${(r.sizeBytes / 1048576).toFixed(1)} MB`,
        },
        mainThreadMetric(main),
        openFramesMetric(r.openFramesAfter),
      ],
    });
  }

  /**
   * HDR check: the browser's own HDR conversion of 6 frames, per GPU path, saved as a file the
   * owner sends back (AirDrop) to fit this device's HDR calibration.
   */
  async function hdrCheck() {
    if (!info) return;
    const fractions = [0.08, 0.25, 0.42, 0.58, 0.75, 0.92];
    const times = fractions.map((f) => Math.round(info.durationS * f * 100) / 100);
    const result = await run('HDR check', (s) => s.hdrCheck(times, 320));
    if (!result) return;
    const report = {
      kind: 'video-ultra-hdr-check',
      version: 1,
      createdAt: new Date().toISOString(),
      file: { name: info.name, sizeBytes: info.sizeBytes, durationS: info.durationS },
      ...result,
    };
    const file = new File([JSON.stringify(report)], 'video-ultra-hdr-check.json', {
      type: 'application/json',
    });
    const paths = Object.entries(result.paths)
      .map(([k, v]) => `${k}: ${'error' in v ? `error (${v.error})` : `${v.frames.length} frames`}`)
      .join(', ');
    addResult({
      title: 'HDR check',
      rows: [
        ['Captured', paths],
        ['Engine', result.engine],
      ],
    });
    // Sharing needs a fresh tap on iOS (the check takes seconds), so offer buttons instead.
    setHdrFile(file);
    setStatus(
      'HDR check ready — tap "Share (AirDrop)" or "Download" and send the file to the developer.',
    );
  }

  async function shareHdrFile() {
    if (!hdrFile) return;
    try {
      await navigator.share({ files: [hdrFile], title: 'VideoUltra HDR check' });
    } catch (e) {
      setError(
        `Sharing didn't work (${e instanceof Error ? e.message : String(e)}). Use Download instead.`,
      );
    }
  }

  function downloadHdrFile() {
    if (hdrFile) downloadFile(hdrFile);
  }

  async function runAll() {
    const loaded = await load();
    if (!loaded) return;
    await play();
    await scrub();
    await exportVideo('mp4', loaded);
  }

  function report(): string {
    const lines = [`## ${new Date().toISOString().slice(0, 16)} · ${navigator.userAgent}`, ''];
    if (caps) {
      lines.push(
        `Tier **${caps.tier}** · GPU ${caps.gpu ?? '?'} · RAM ${caps.deviceMemoryGb ?? '?'} GB · ${caps.cores} cores · WebGPU ${yesNo(caps.webgpu)} · WebGL2 ${yesNo(caps.webgl2)}`,
        '',
      );
    }
    for (const block of results) {
      lines.push(`### ${block.title}`, '', '| | |', '| --- | --- |');
      for (const [k, v] of block.rows) lines.push(`| ${k} | ${v} |`);
      lines.push('');
    }
    return lines.join('\n');
  }

  /** The report as a file: Markdown for reading + the raw results as JSON, for AirDrop/download. */
  function reportFile(): File {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const raw = results.map(({ title, rows }) => ({ title, rows }));
    const body = `${report()}\n\n<!-- raw results -->\n\n\`\`\`json\n${JSON.stringify({ capabilities: caps, results: raw }, null, 2)}\n\`\`\`\n`;
    return new File([body], `video-ultra-bench-${stamp}.md`, { type: 'text/markdown' });
  }

  async function shareReport() {
    const file = reportFile();
    try {
      await navigator.share({ files: [file], title: 'VideoUltra bench report' });
    } catch (e) {
      // Cancelled, or sharing files isn't supported here: fall back to a download.
      if (e instanceof Error && e.name === 'AbortError') return;
      downloadFile(file);
    }
  }

  function downloadFile(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed — select the report text below and copy it manually.');
    }
  }

  const ready = Boolean(session) && !busy;
  const verdict = caps ? verdictFor(caps) : null;

  return (
    <>
      <section className="bench-card bench-device" aria-labelledby="bench-device-title">
        <h2 id="bench-device-title">This device</h2>
        {capsError && <p className="error">{capsError}</p>}
        {!caps && !capsError && <p className="bench-muted">Checking what this browser can do…</p>}
        {verdict && (
          <div className={`bench-verdict is-${verdict.kind}`}>
            <span className="bench-verdict-icon" aria-hidden="true">
              {verdict.kind === 'good' ? (
                <CheckIcon />
              ) : verdict.kind === 'bad' ? (
                <CrossIcon />
              ) : (
                <WarnIcon />
              )}
            </span>
            <div>
              <p className="bench-verdict-title">{verdict.title}</p>
              <p className="bench-verdict-detail">{verdict.detail}</p>
            </div>
          </div>
        )}
        {caps && (
          <div className="bench-caps">
            {capGroups(caps).map((group) => (
              <table key={group.title}>
                <caption>{group.title}</caption>
                <tbody>
                  {group.rows.map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row">{k}</th>
                      <td>{typeof v === 'boolean' ? <Badge ok={v} /> : v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        )}
      </section>

      <section className="bench-card bench-test" aria-labelledby="bench-test-title">
        <div className="bench-controls">
          <h2 id="bench-test-title">Run a test</h2>
          <p className="bench-muted">
            Pick a sample video or your own, then press Run all. It opens the video, plays{' '}
            {playLabel} s, jumps to 30 places and exports 5 s as MP4.
          </p>

          <div className="bench-fields">
            <label className="bench-field">
              <span>Renderer</span>
              <select
                value={backend}
                onChange={(e) => setBackend(e.target.value as BackendChoice)}
                disabled={busy}
              >
                <option value="auto">Auto (WebGPU → WebGL2)</option>
                <option value="webgpu">WebGPU only</option>
                <option value="webgl2">WebGL2 only</option>
              </select>
            </label>
            <label className="bench-field">
              <span>Sample video</span>
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setUpload(null);
                }}
                disabled={busy || manifest.length === 0}
              >
                {manifest.length === 0 && (
                  <option value="">No test media — run `pnpm media`</option>
                )}
                {manifest
                  .filter((m) => m.kind === 'video' || m.kind === 'broken')
                  .map((m) => (
                    <option key={m.file} value={m.file}>
                      {m.label}
                    </option>
                  ))}
              </select>
            </label>
            <div className="bench-field">
              <span id="bench-own-label">Or your own video</span>
              <label className={`s-btn s-btn-quiet s-btn-small bench-file${busy ? ' is-off' : ''}`}>
                <input
                  className="site-sr"
                  type="file"
                  accept="video/*"
                  aria-describedby="bench-own-label"
                  onChange={(e) => setUpload(e.target.files?.[0] ?? null)}
                  disabled={busy}
                />
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path
                    d="M8 10.5V2.5m0 0L5 5.5m3-3l3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="bench-file-name">{upload ? upload.name : 'Choose a file'}</span>
              </label>
            </div>
          </div>

          <div className="bench-actions">
            <button className="s-btn bench-run" onClick={runAll} disabled={!ready}>
              Run all
            </button>
            <button
              className="s-btn s-btn-quiet bench-cancel"
              onClick={() => session?.cancel()}
              disabled={!busy}
            >
              Cancel
            </button>
          </div>

          <div className="bench-steps" role="group" aria-labelledby="bench-steps-label">
            <span id="bench-steps-label" className="bench-steps-label">
              One step at a time
            </span>
            <div className="bench-steps-buttons">
              <button className="s-btn s-btn-quiet s-btn-small" onClick={load} disabled={!ready}>
                Load
              </button>
              <button
                className="s-btn s-btn-quiet s-btn-small"
                onClick={play}
                disabled={!ready || !info}
              >
                Play {playLabel} s
              </button>
              <button
                className="s-btn s-btn-quiet s-btn-small"
                onClick={scrub}
                disabled={!ready || !info}
              >
                Scrub ×30
              </button>
              <button
                className="s-btn s-btn-quiet s-btn-small"
                onClick={() => exportVideo('mp4')}
                disabled={!ready || !info}
              >
                Export MP4
              </button>
              <button
                className="s-btn s-btn-quiet s-btn-small"
                onClick={() => exportVideo('webm')}
                disabled={!ready || !info}
              >
                Export WebM
              </button>
              <button
                className="s-btn s-btn-quiet s-btn-small"
                onClick={hdrCheck}
                disabled={!ready || !info?.video?.hdr}
              >
                HDR check
              </button>
            </div>
            {hdrFile && (
              <div className="bench-steps-buttons">
                {typeof navigator !== 'undefined' && navigator.canShare?.({ files: [hdrFile] }) && (
                  <button className="s-btn s-btn-small" onClick={shareHdrFile}>
                    Share (AirDrop)
                  </button>
                )}
                <button className="s-btn s-btn-quiet s-btn-small" onClick={downloadHdrFile}>
                  Download HDR check
                </button>
              </div>
            )}
          </div>

          <div className="bench-status" role="status" aria-live="polite">
            {busy && <span className="bench-spinner" aria-hidden="true" />}
            <span>{status}</span>
            {progress !== null && (
              <progress value={progress} max={1} aria-label="Export progress" />
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="bench-stage" ref={stageRef} role="img" aria-label="Engine preview" />
      </section>

      {exportUrl && (
        <section className="bench-card bench-export" aria-labelledby="bench-export-title">
          <div className="bench-section-head">
            <h2 id="bench-export-title">Last export</h2>
            <a
              className="s-btn s-btn-quiet s-btn-small"
              href={exportUrl}
              download="video-ultra-export"
            >
              Download
            </a>
          </div>
          <video src={exportUrl} controls playsInline />
        </section>
      )}

      {results.length > 0 && (
        <section className="bench-results" aria-labelledby="bench-results-title">
          <div className="bench-section-head">
            <h2 id="bench-results-title">Results</h2>
            <div className="bench-steps-buttons">
              {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                <button className="s-btn s-btn-small" onClick={shareReport}>
                  Share report (AirDrop)
                </button>
              )}
              <button
                className="s-btn s-btn-quiet s-btn-small"
                onClick={() => downloadFile(reportFile())}
              >
                Download report
              </button>
              <button className="s-btn s-btn-quiet s-btn-small" onClick={copyReport}>
                {copied ? 'Copied' : 'Copy report (Markdown)'}
              </button>
              <button className="s-btn s-btn-quiet s-btn-small" onClick={() => setResults([])}>
                Clear
              </button>
            </div>
          </div>
          {results.map((block, i) => (
            <article key={i} className="bench-card bench-result">
              <h3>{block.title}</h3>
              {block.metrics && block.metrics.length > 0 && (
                <div className="bench-metrics">
                  {block.metrics.map((m) => (
                    <MetricCard key={m.label} metric={m} />
                  ))}
                </div>
              )}
              <details className="bench-details" open={!block.metrics}>
                <summary>All measurements</summary>
                <table>
                  <tbody>
                    {block.rows.map(([k, v]) => (
                      <tr key={k}>
                        <th scope="row">{k}</th>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </article>
          ))}
          <details className="bench-card bench-details bench-report">
            <summary>Full report (Markdown)</summary>
            <pre>{report()}</pre>
          </details>
        </section>
      )}
    </>
  );
}
