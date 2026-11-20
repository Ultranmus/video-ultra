'use client';

import { detectCapabilities, type Capabilities } from '@video-ultra/core';
import {
  createLabSession,
  type BackendChoice,
  type Distribution,
  type LabSession,
  type MediaInfo,
} from '@video-ultra/core/internal';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ManifestEntry {
  file: string;
  label: string;
  kind: 'video' | 'audio' | 'image' | 'broken';
}

type Rows = [string, string][];
interface ResultBlock {
  title: string;
  rows: Rows;
}

const fmtDist = (d: Distribution) =>
  `avg ${d.avg} · p50 ${d.p50} · p95 ${d.p95} · max ${d.max} (n=${d.count})`;
const yesNo = (v: boolean) => (v ? 'yes' : 'no');

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
  return (): Rows => {
    running = false;
    observer?.disconnect();
    return [
      [
        'Main thread: long tasks > 50 ms',
        observer
          ? `${longTasks} (max ${Math.round(maxLongTask)} ms)`
          : 'not measurable in this browser',
      ],
      ['Main thread: frame gaps > 50 ms', `${gapsOver50} (max gap ${Math.round(maxGap)} ms)`],
      ['Main thread: JS heap', heap()],
    ];
  };
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

/** `?decoders=2` runs the scrub test with a low-tier decoder budget. */
function scrubDecoders(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = Number(new URLSearchParams(window.location.search).get('decoders'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
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
        ...main,
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
        ...main,
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
        ...main,
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
    const body = `${report()}\n\n<!-- raw results -->\n\n\`\`\`json\n${JSON.stringify({ capabilities: caps, results }, null, 2)}\n\`\`\`\n`;
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

  const capRows: Rows = caps
    ? [
        ['Supported', yesNo(caps.supported)],
        ['Tier', caps.tier],
        ['WebGPU / WebGL2', `${yesNo(caps.webgpu)} / ${yesNo(caps.webgl2)}`],
        [
          'WebCodecs video / audio',
          `${yesNo(caps.webcodecs.video)} / ${yesNo(caps.webcodecs.audio)}`,
        ],
        [
          'Decode H.264 / HEVC / VP9 / AV1',
          [caps.decode.avc, caps.decode.hevc, caps.decode.vp9, caps.decode.av1]
            .map(yesNo)
            .join(' / '),
        ],
        [
          'Encode H.264 1080p / 4K / VP9',
          [caps.encode.avc1080, caps.encode.avc4k, caps.encode.vp9].map(yesNo).join(' / '),
        ],
        ['Encode AAC / Opus', `${yesNo(caps.encode.aac)} / ${yesNo(caps.encode.opus)}`],
        [
          'OffscreenCanvas / OPFS / File System Access',
          [caps.offscreenCanvas, caps.opfs, caps.fileSystemAccess].map(yesNo).join(' / '),
        ],
        [
          'Device',
          `${caps.mobile ? 'mobile' : 'desktop'}, ${caps.cores} cores, ${caps.deviceMemoryGb ?? '?'} GB RAM`,
        ],
        ['GPU', caps.gpu ?? 'not exposed'],
        ['Secure context', yesNo(window.isSecureContext)],
      ]
    : [];

  const ready = Boolean(session) && !busy;

  return (
    <main className="page">
      <h1>Bench</h1>

      <h2>This device</h2>
      {capsError && <p className="error">{capsError}</p>}
      {!caps && !capsError && <p className="status">Detecting…</p>}
      {caps && (
        <table>
          <tbody>
            {capRows.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td className={v === 'no' ? 'no' : v === 'yes' ? 'yes' : undefined}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Test</h2>
      <div className="row">
        <label>
          Renderer{' '}
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
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setUpload(null);
          }}
          disabled={busy || manifest.length === 0}
        >
          {manifest.length === 0 && <option value="">No test media — run `pnpm media`</option>}
          {manifest
            .filter((m) => m.kind === 'video' || m.kind === 'broken')
            .map((m) => (
              <option key={m.file} value={m.file}>
                {m.label}
              </option>
            ))}
        </select>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setUpload(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </div>
      <div className="row">
        <button className="primary" onClick={runAll} disabled={!ready}>
          Run all
        </button>
        <button onClick={load} disabled={!ready}>
          Load
        </button>
        <button onClick={play} disabled={!ready || !info}>
          Play {playSeconds()} s
        </button>
        <button onClick={scrub} disabled={!ready || !info}>
          Scrub ×30
        </button>
        <button onClick={() => exportVideo('mp4')} disabled={!ready || !info}>
          Export MP4
        </button>
        <button onClick={() => exportVideo('webm')} disabled={!ready || !info}>
          Export WebM
        </button>
        <button onClick={hdrCheck} disabled={!ready || !info?.video?.hdr}>
          HDR check
        </button>
        {hdrFile && (
          <>
            {typeof navigator !== 'undefined' && navigator.canShare?.({ files: [hdrFile] }) && (
              <button className="primary" onClick={shareHdrFile}>
                Share (AirDrop)
              </button>
            )}
            <button onClick={downloadHdrFile}>Download HDR check</button>
          </>
        )}
        <button onClick={() => session?.cancel()} disabled={!busy}>
          Cancel
        </button>
      </div>
      <p className="status">
        {status} {progress !== null && <progress value={progress} max={1} />}
      </p>
      {error && <p className="error">{error}</p>}

      <div className="stage" ref={stageRef} />

      {exportUrl && (
        <>
          <h2>Last export</h2>
          <video src={exportUrl} controls playsInline />
          <p>
            <a href={exportUrl} download="video-ultra-export">
              Download
            </a>
          </p>
        </>
      )}

      {results.length > 0 && (
        <>
          <h2>Results</h2>
          <div className="row">
            {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
              <button className="primary" onClick={shareReport}>
                Share report (AirDrop)
              </button>
            )}
            <button onClick={() => downloadFile(reportFile())}>Download report</button>
            <button onClick={copyReport}>{copied ? 'Copied' : 'Copy report (Markdown)'}</button>
            <button onClick={() => setResults([])}>Clear</button>
          </div>
          {results.map((block, i) => (
            <div key={i}>
              <h2>{block.title}</h2>
              <table>
                <tbody>
                  {block.rows.map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <pre>{report()}</pre>
        </>
      )}
    </main>
  );
}
