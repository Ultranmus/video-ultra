import {
  fps as toFps,
  exportLimits,
  maxExportHeight,
  type ExportLimits,
  projectDuration,
  type ExportOptions,
  type ExportProgress,
  type ExportResult,
} from '@video-ultra/core';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Segmented } from './controls';
import { Icon } from './icons';

const HEIGHTS = [480, 720, 1080, 1440, 2160] as const;

function formatEta(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

/** Export settings, progress and result — one of the two modals the editor allows (UI_VISION §2.6). */
export function ExportDialog(): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const open = useUi((s) => s.exportOpen);
  const { width, height, rate, duration } = useProject((p) => ({
    width: p.settings.width,
    height: p.settings.height,
    rate: toFps(p.settings.frameRate),
    duration: projectDuration(p),
  }));
  const tier = ctl.caps?.tier ?? 'mid';
  const shortSide = Math.min(width, height);
  const limit = Math.min(maxExportHeight(tier), Math.max(480, shortSide));
  // What this device's encoders can really do (checked once, off the hot path).
  const [limits, setLimits] = useState<ExportLimits | null>(null);
  useEffect(() => {
    if (!open || limits) return;
    let live = true;
    void exportLimits(tier).then((l) => {
      if (live) setLimits(l);
    });
    return () => {
      live = false;
    };
  }, [open, limits, tier]);
  const [options, setOptions] = useState<ExportOptions>(() => ({
    format: 'mp4',
    height: Math.min(1080, limit) as ExportOptions['height'],
    fps: rate > 45 ? 60 : rate < 26 ? 24 : 30,
    quality: 'medium',
  }));
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<{ result: ExportResult; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
    return () => previous?.focus?.();
  }, [open]);

  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );

  if (!open) return null;

  const available = HEIGHTS.filter(
    (h) => h <= limit && (!limits || limits[options.format].includes(h)),
  );
  // Keep the choice valid when the format or the device's limits change.
  const outHeight: ExportOptions['height'] = available.includes(options.height)
    ? options.height
    : (available[available.length - 1] ?? 480);

  const close = () => {
    abort.current?.abort();
    abort.current = null;
    setProgress(null);
    setError(null);
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    ctl.ui.setState({ exportOpen: false });
  };

  const start = async () => {
    setError(null);
    setResult(null);
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ fraction: 0, framesDone: 0, framesTotal: 0, etaSeconds: null });
    // Keep the screen on during long exports on phones (where supported).
    const lock = await (
      navigator as Navigator & {
        wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
      }
    ).wakeLock
      ?.request('screen')
      .catch(() => null);
    try {
      const out = await ctl.exportVideo(
        { ...options, height: outHeight },
        setProgress,
        controller.signal,
      );
      setResult({ result: out, url: URL.createObjectURL(out.blob) });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      void lock?.release();
      abort.current = null;
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const percent = progress ? Math.floor(progress.fraction * 100) : 0;
  const fileName = `${ctl.project.name || 'video'}.${result?.result.extension ?? options.format}`;

  return (
    <div
      className="vu-modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}
    >
      <div
        ref={dialogRef}
        className="vu-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vu-export-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) close();
        }}
      >
        <div className="vu-modal-head">
          <h2 id="vu-export-title" className="vu-modal-title">
            {l.exportTitle}
          </h2>
          <button
            type="button"
            className="vu-btn"
            data-layout="icon"
            aria-label={l.close}
            onClick={close}
            disabled={busy}
          >
            <Icon name="close" />
          </button>
        </div>
        {result ? (
          <div className="vu-export-done">
            <Icon name="check" size={28} />
            <p>{l.exportDone}</p>
            <p className="vu-hint">
              {result.result.width}×{result.result.height} ·{' '}
              {(result.result.blob.size / 1e6).toFixed(1)} MB
            </p>
            <a
              className="vu-btn vu-wide"
              data-variant="primary"
              data-layout="row"
              href={result.url}
              download={fileName}
            >
              <Icon name="download" />
              <span>{l.download}</span>
            </a>
          </div>
        ) : busy ? (
          <div className="vu-export-progress">
            <p>{l.exporting}</p>
            <div
              className="vu-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="vu-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="vu-hint">
              {l.exportProgress(
                percent,
                progress.etaSeconds != null ? formatEta(progress.etaSeconds) : null,
              )}
            </p>
            <p className="vu-hint">{l.exportKeepOpen}</p>
            <button
              type="button"
              className="vu-btn vu-wide"
              data-variant="secondary"
              data-layout="row"
              onClick={() => abort.current?.abort()}
            >
              {l.cancel}
            </button>
          </div>
        ) : (
          <div className="vu-export-form">
            <Segmented
              label={l.resolution}
              value={String(outHeight)}
              options={available.map((h) => ({
                value: String(h),
                label: h === 2160 ? '4K' : `${h}p`,
              }))}
              onChange={(v) =>
                setOptions({ ...options, height: Number(v) as ExportOptions['height'] })
              }
            />
            {limit < 2160 && maxExportHeight(tier) < 2160 ? (
              <p className="vu-hint">{l.deviceLimit}</p>
            ) : null}
            <Segmented
              label={l.frameRate}
              value={String(options.fps)}
              options={(['24', '30', '60'] as const).map((f) => ({ value: f, label: f }))}
              onChange={(v) => setOptions({ ...options, fps: Number(v) as ExportOptions['fps'] })}
            />
            <Segmented
              label={l.quality}
              value={options.quality}
              options={[
                { value: 'low', label: l.qualityLow },
                { value: 'medium', label: l.qualityMedium },
                { value: 'high', label: l.qualityHigh },
              ]}
              onChange={(quality) => setOptions({ ...options, quality })}
            />
            <Segmented
              label={l.format}
              value={options.format}
              options={[
                { value: 'mp4', label: 'MP4' },
                { value: 'webm', label: 'WebM' },
              ]}
              onChange={(format) => setOptions({ ...options, format })}
            />
            {error ? (
              <p className="vu-error" role="alert">
                {l.exportFailed(error)}
              </p>
            ) : null}
            <button
              type="button"
              className="vu-btn vu-wide"
              data-variant="primary"
              data-layout="row"
              disabled={duration === 0}
              onClick={() => void start()}
            >
              {l.startExport}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
