import {
  fps as toFps,
  exportLimits,
  exportSize,
  exportBitrate,
  exportAudioBitrate,
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
import { formatDurationShort } from './format';
import { Icon } from './icons';

const HEIGHTS = [480, 720, 1080, 1440, 2160] as const;

/**
 * The file size (MB) the export will have: the same video and audio bitrates the encoder uses
 * (`exportBitrate`), so the estimate holds in every browser.
 */
function estimateMb(
  width: number,
  height: number,
  fps: number,
  quality: ExportOptions['quality'],
  seconds: number,
  format: ExportOptions['format'],
) {
  const video = exportBitrate(width, height, fps, quality, format === 'webm' ? 'vp9' : 'avc');
  return ((video + exportAudioBitrate(quality)) * seconds) / 8 / 1e6;
}

function formatMb(mb: number): string {
  return mb < 1
    ? `${Math.max(0.1, Math.round(mb * 10) / 10)} MB`
    : mb < 100
      ? `${mb.toFixed(1)} MB`
      : `${Math.round(mb)} MB`;
}

/** The video's poster: one exact frame from the engine, drawn once when the dialog opens. */
function Poster({
  aspect,
  progress,
  children,
}: {
  aspect: number;
  progress: number | null;
  children?: React.ReactNode;
}) {
  const ctl = useController();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const engine = ctl.engine;
    if (!engine) return;
    let live = true;
    const duration = projectDuration(ctl.project);
    const t =
      ctl.playhead.time > 0 && ctl.playhead.time < duration
        ? ctl.playhead.time
        : Math.floor(duration / 3);
    const width =
      Math.round((Math.min(480, 480 * aspect) * Math.min(devicePixelRatio || 1, 2)) / 2) * 2;
    void engine
      .capture(t, { width, height: Math.round(width / aspect / 2) * 2 })
      .then((bitmap) => {
        const canvas = ref.current;
        if (live && canvas) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        }
        bitmap.close();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ctl, aspect]);
  return (
    <div
      className="vu-export-poster"
      style={{ aspectRatio: String(aspect), ['--vu-export-progress' as string]: progress ?? 1 }}
      data-busy={progress !== null || undefined}
    >
      <canvas ref={ref} aria-hidden="true" className="vu-export-poster-still" />
      {children}
    </div>
  );
}

/** One export choice as a tile: a title and a short detail (what it means, or the file size). */
function Option<T extends string>({
  group,
  value,
  current,
  title,
  detail,
  onPick,
}: {
  group: string;
  value: T;
  current: T;
  title: string;
  detail?: string;
  onPick: (v: T) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={value === current}
      className="vu-export-option"
      data-group={group}
      onClick={() => onPick(value)}
    >
      <span className="vu-export-option-title">{title}</span>
      {detail ? <span className="vu-export-option-detail">{detail}</span> : null}
    </button>
  );
}

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
  const seconds = duration / 705_600_000;
  const out = exportSize(width, height, outHeight);
  const estimate = estimateMb(
    out.width,
    out.height,
    options.fps,
    options.quality,
    seconds,
    options.format,
  );
  const aspect = width / height;
  const shareFile =
    result && typeof navigator.canShare === 'function'
      ? new File([result.result.blob], fileName, { type: result.result.blob.type })
      : null;
  const canShare = shareFile ? navigator.canShare({ files: [shareFile] }) : false;
  const ring = 2 * Math.PI * 26;

  return (
    <div
      className="vu-modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}
    >
      <div
        ref={dialogRef}
        className="vu-modal vu-export"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vu-export-title"
        data-state={result ? 'done' : busy ? 'busy' : 'form'}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) close();
        }}
      >
        <div className="vu-modal-head">
          <h2 id="vu-export-title" className="vu-modal-title">
            {result ? l.exportReadyTitle : busy ? l.exporting : l.exportTitle}
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
        <div className="vu-export-body">
          <div className="vu-export-side">
            {result ? (
              <video
                className="vu-export-result"
                src={result.url}
                controls
                playsInline
                style={{ aspectRatio: String(result.result.width / result.result.height) }}
              />
            ) : (
              <Poster aspect={aspect} progress={busy ? progress!.fraction : null}>
                {busy ? (
                  <div className="vu-export-ring" aria-hidden="true">
                    <svg viewBox="0 0 60 60">
                      <circle className="vu-export-ring-track" cx="30" cy="30" r="26" />
                      <circle
                        className="vu-export-ring-fill"
                        cx="30"
                        cy="30"
                        r="26"
                        strokeDasharray={ring}
                        strokeDashoffset={ring * (1 - progress!.fraction)}
                      />
                    </svg>
                    <span>{percent}%</span>
                  </div>
                ) : (
                  <span className="vu-export-badge">{formatDurationShort(duration)}</span>
                )}
              </Poster>
            )}
          </div>
          <div className="vu-export-main">
            {result ? (
              <div className="vu-export-done">
                <span className="vu-export-check" aria-hidden="true">
                  <svg viewBox="0 0 52 52">
                    <circle cx="26" cy="26" r="24" />
                    <path d="M15 27l7 7 15-16" />
                  </svg>
                </span>
                <p className="vu-export-done-title">{l.exportDone}</p>
                <p className="vu-hint">
                  {result.result.width}×{result.result.height} ·{' '}
                  {formatMb(result.result.blob.size / 1e6)} ·{' '}
                  {(result.result.extension ?? options.format).toUpperCase()}
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
                {canShare ? (
                  <button
                    type="button"
                    className="vu-btn vu-wide"
                    data-variant="secondary"
                    data-layout="row"
                    onClick={() => void navigator.share({ files: [shareFile!] }).catch(() => {})}
                  >
                    <Icon name="share" />
                    <span>{l.share}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="vu-btn vu-wide"
                  data-variant="ghost"
                  data-layout="row"
                  onClick={close}
                >
                  {l.backToEditing}
                </button>
              </div>
            ) : busy ? (
              <div className="vu-export-progress">
                <div
                  className="vu-progress"
                  role="progressbar"
                  aria-label={l.exporting}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                >
                  <div className="vu-progress-fill" style={{ width: `${percent}%` }} />
                </div>
                <p className="vu-export-status">
                  {l.exportProgress(
                    percent,
                    progress.etaSeconds != null ? formatEta(progress.etaSeconds) : null,
                  )}
                </p>
                {progress.framesTotal ? (
                  <p className="vu-hint">
                    {l.exportFrames(progress.framesDone, progress.framesTotal)}
                  </p>
                ) : null}
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
                <div className="vu-field">
                  <span className="vu-field-row" id="vu-export-res">
                    {l.resolution}
                  </span>
                  <div
                    className="vu-export-options"
                    role="radiogroup"
                    aria-labelledby="vu-export-res"
                  >
                    {available.map((h) => (
                      <Option
                        key={h}
                        group="resolution"
                        value={String(h)}
                        current={String(outHeight)}
                        title={h === 2160 ? '4K' : `${h}p`}
                        detail={l.resolutionName(h)}
                        onPick={(v) =>
                          setOptions({ ...options, height: Number(v) as ExportOptions['height'] })
                        }
                      />
                    ))}
                  </div>
                  {limit < 2160 && maxExportHeight(tier) < 2160 ? (
                    <p className="vu-hint">{l.deviceLimit}</p>
                  ) : null}
                </div>
                <div className="vu-field">
                  <span className="vu-field-row" id="vu-export-q">
                    {l.quality}
                  </span>
                  <div
                    className="vu-export-options"
                    role="radiogroup"
                    aria-labelledby="vu-export-q"
                  >
                    {(['low', 'medium', 'high'] as const).map((q) => (
                      <Option
                        key={q}
                        group="quality"
                        value={q}
                        current={options.quality}
                        title={
                          q === 'low'
                            ? l.qualityLow
                            : q === 'medium'
                              ? l.qualityMedium
                              : l.qualityHigh
                        }
                        detail={formatMb(
                          estimateMb(
                            out.width,
                            out.height,
                            options.fps,
                            q,
                            seconds,
                            options.format,
                          ),
                        )}
                        onPick={(quality) => setOptions({ ...options, quality })}
                      />
                    ))}
                  </div>
                </div>
                <div className="vu-export-pair">
                  <Segmented
                    label={l.frameRate}
                    value={String(options.fps)}
                    options={(['24', '30', '60'] as const).map((f) => ({ value: f, label: f }))}
                    onChange={(v) =>
                      setOptions({ ...options, fps: Number(v) as ExportOptions['fps'] })
                    }
                  />
                  <Segmented
                    label={l.format}
                    value={options.format}
                    options={[
                      { value: 'mp4', label: 'MP4', tip: l.formatMp4Tip },
                      { value: 'webm', label: 'WebM', tip: l.formatWebmTip },
                    ]}
                    onChange={(format) => setOptions({ ...options, format })}
                  />
                </div>
                {error ? (
                  <p className="vu-error" role="alert">
                    {l.exportFailed(error)}
                  </p>
                ) : null}
                <div className="vu-export-summary">
                  <span>
                    {out.width}×{out.height} · {options.fps} fps
                  </span>
                  <span>{l.aboutSize(formatMb(estimate))}</span>
                </div>
                <button
                  type="button"
                  className="vu-btn vu-wide vu-export-go"
                  data-variant="primary"
                  data-layout="row"
                  disabled={duration === 0}
                  onClick={() => void start()}
                >
                  <Icon name="download" />
                  <span>{l.startExport}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
