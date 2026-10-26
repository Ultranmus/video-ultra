import {
  fps as toFps,
  exportLimits,
  exportSize,
  exportBitrate,
  exportAudioBitrate,
  maxExportHeight,
  projectDuration,
  resolveExportRange,
  setExportRange,
  FLICKS_PER_SECOND,
  type AudioExportFormat,
  type AudioExportResult,
  type ExportLimits,
  type ExportOptions,
  type ExportProgress,
  type ExportRange,
  type ExportResult,
  type FrameImage,
  type FrameImageFormat,
  type Project,
  type Time,
} from '@video-ultra/core';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Segmented } from './controls';
import { formatClock, formatDurationShort } from './format';
import { Icon } from './icons';

const HEIGHTS = [480, 720, 1080, 1440, 2160] as const;

/** What the dialog exports: the video, only its sound, or the frame under the playhead. */
type Kind = 'video' | 'audio' | 'image';

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
  codec: ExportOptions['videoCodec'] = 'auto',
) {
  const video = exportBitrate(
    width,
    height,
    fps,
    quality,
    codec === 'hevc' || codec === 'av1' ? codec : format === 'webm' ? 'vp9' : 'avc',
  );
  return ((video + exportAudioBitrate(quality)) * seconds) / 8 / 1e6;
}

/** Size (MB) of a sound-only export: AAC / Opus at the quality's bitrate, WAV 16-bit stereo. */
function estimateAudioMb(
  format: AudioExportFormat,
  quality: ExportOptions['quality'],
  seconds: number,
) {
  const bits = format === 'wav' ? 48_000 * 2 * 16 : exportAudioBitrate(quality);
  return (bits * seconds) / 8 / 1e6;
}

function formatMb(mb: number): string {
  return mb < 1
    ? `${Math.max(0.1, Math.round(mb * 10) / 10)} MB`
    : mb < 100
      ? `${mb.toFixed(1)} MB`
      : `${Math.round(mb)} MB`;
}

/** Some clip that plays sound (what a sound-only export needs). */
function hasSound(p: Project): boolean {
  return p.tracks.some(
    (t) =>
      !t.muted &&
      t.items.some(
        (i) =>
          (i.kind === 'audio' || (i.kind === 'video' && p.assets[i.assetId]?.hasAudio)) &&
          !i.muted &&
          i.volume > 0,
      ),
  );
}

/** The video's poster: one exact frame from the engine at `time`, drawn when it changes. */
function Poster({
  aspect,
  time,
  progress,
  children,
}: {
  aspect: number;
  time: Time;
  progress: number | null;
  children?: React.ReactNode;
}) {
  const ctl = useController();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const engine = ctl.engine;
    if (!engine) return;
    let live = true;
    const width =
      Math.round((Math.min(480, 480 * aspect) * Math.min(devicePixelRatio || 1, 2)) / 2) * 2;
    void engine
      .capture(time, { width, height: Math.round(width / aspect / 2) * 2 })
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
  }, [ctl, aspect, time]);
  return (
    <div
      className="vu-export-poster"
      style={{
        aspectRatio: String(aspect),
        ['--vu-export-aspect' as string]: aspect,
        ['--vu-export-progress' as string]: progress ?? 1,
      }}
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
  note,
  disabledReason,
  onPick,
}: {
  group: string;
  value: T;
  current: T | null;
  title: string;
  detail?: string;
  /** A third line (the file size). */
  note?: string;
  disabledReason?: string | null;
  onPick: (v: T) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={value === current}
      aria-disabled={disabledReason ? true : undefined}
      data-tooltip={disabledReason ?? undefined}
      className="vu-export-option"
      data-group={group}
      onClick={() => {
        if (!disabledReason) onPick(value);
      }}
    >
      <span className="vu-export-option-title">{title}</span>
      {detail ? <span className="vu-export-option-detail">{detail}</span> : null}
      {note ? <span className="vu-export-option-note">{note}</span> : null}
    </button>
  );
}

function formatEta(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

/**
 * The part of the video to export: a bar with two handles (drag, or arrow keys — Shift for a
 * whole second). Dragging stays local; one undoable edit is made on release.
 */
function RangeBar({
  duration,
  range,
  onCommit,
}: {
  duration: Time;
  range: ExportRange;
  onCommit: (range: ExportRange) => void;
}): ReactElement {
  const l = useLabels();
  const trackRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ExportRange | null>(null);
  const shown = draft ?? range;
  const minLength = Math.min(duration, FLICKS_PER_SECOND / 10);
  const clampEdge = (edge: 'start' | 'end', t: Time, base: ExportRange): ExportRange => {
    const r = Math.round(t);
    return edge === 'start'
      ? { start: Math.max(0, Math.min(r, base.end - minLength)), end: base.end }
      : { start: base.start, end: Math.min(duration, Math.max(r, base.start + minLength)) };
  };
  const timeAt = (clientX: number) => {
    const box = trackRef.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)));
    return f * duration;
  };
  const drag = (edge: 'start' | 'end') => (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    target.focus({ preventScroll: true });
    let latest = range;
    const move = (ev: PointerEvent) => {
      latest = clampEdge(edge, timeAt(ev.clientX), range);
      setDraft(latest);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDraft(null);
      if (latest.start !== range.start || latest.end !== range.end) onCommit(latest);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const key = (edge: 'start' | 'end') => (e: React.KeyboardEvent) => {
    const step = (e.shiftKey ? 1 : 0.1) * FLICKS_PER_SECOND;
    const value = edge === 'start' ? range.start : range.end;
    let next: Time | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = duration;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    const r = clampEdge(edge, next, range);
    if (r.start !== range.start || r.end !== range.end) onCommit(r);
  };
  const pct = (t: Time) => `${(t / Math.max(1, duration)) * 100}%`;
  const thumb = (edge: 'start' | 'end') => {
    const value = edge === 'start' ? shown.start : shown.end;
    return (
      <span
        className="vu-range-thumb"
        data-edge={edge}
        role="slider"
        tabIndex={0}
        aria-label={edge === 'start' ? l.partStart : l.partEnd}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / FLICKS_PER_SECOND)}
        aria-valuenow={Math.round((value / FLICKS_PER_SECOND) * 10) / 10}
        aria-valuetext={formatClock(value)}
        style={{ left: pct(value) }}
        onPointerDown={drag(edge)}
        onKeyDown={key(edge)}
      />
    );
  };
  return (
    <div className="vu-range">
      <div ref={trackRef} className="vu-range-track">
        <span
          className="vu-range-fill"
          style={{ left: pct(shown.start), width: pct(shown.end - shown.start) }}
        />
        {thumb('start')}
        {thumb('end')}
      </div>
      <p className="vu-range-summary">
        {l.partSummary(
          formatClock(shown.start),
          formatClock(shown.end),
          formatDurationShort(shown.end - shown.start),
        )}
      </p>
    </div>
  );
}

type Done =
  | { kind: 'video'; result: ExportResult; url: string }
  | { kind: 'audio'; result: AudioExportResult; url: string }
  | { kind: 'image'; image: FrameImage; url: string };

/**
 * Export settings, progress and result — one of the two modals the editor allows (UI_VISION §2.6).
 * Three kinds: the video (presets, part, resolution, quality…), its sound only (M4A / Opus / WAV)
 * or the frame under the playhead as a picture (PNG / JPEG).
 */
export function ExportDialog(): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const open = useUi((s) => s.exportOpen);
  const { width, height, rate, duration, range, sound } = useProject((p) => ({
    width: p.settings.width,
    height: p.settings.height,
    rate: toFps(p.settings.frameRate),
    duration: projectDuration(p),
    range: p.settings.exportRange ?? null,
    sound: hasSound(p),
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
  const defaultFps: ExportOptions['fps'] = rate > 45 ? 60 : rate < 26 ? 24 : 30;
  const [kind, setKind] = useState<Kind>('video');
  const [options, setOptions] = useState<ExportOptions>(() => ({
    format: 'mp4',
    height: Math.min(1080, limit) as ExportOptions['height'],
    fps: 30,
    quality: 'medium',
  }));
  // Frame rate: the video's own, unless chosen in More settings.
  const [fpsChoice, setFpsChoice] = useState<'same' | ExportOptions['fps']>('same');
  const [more, setMore] = useState(false);
  const [audio, setAudio] = useState<{
    format: AudioExportFormat;
    quality: ExportOptions['quality'];
  }>({ format: 'm4a', quality: 'medium' });
  const [imageFormat, setImageFormat] = useState<FrameImageFormat>('png');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    // The dialog itself takes focus (Tab reaches its controls), so nothing is outlined on open.
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, [open, ctl]);

  useEffect(
    () => () => {
      if (done) URL.revokeObjectURL(done.url);
    },
    [done],
  );

  if (!open) return null;

  const available = HEIGHTS.filter(
    (h) => h <= limit && (!limits || limits[options.format].includes(h)),
  );
  // Keep the choice valid when the format or the device's limits change.
  const outHeight: ExportOptions['height'] = available.includes(options.height)
    ? options.height
    : (available[available.length - 1] ?? 480);
  // The frame a picture is made of: the playhead's (playback is paused while the dialog is open).
  const frameTime: Time = Math.min(ctl.playhead.time, Math.max(0, duration - 1));
  const span = resolveExportRange(range, duration);
  const part = range !== null && span !== null;
  const spanLength = span ? span.end - span.start : duration;

  const close = () => {
    abort.current?.abort();
    abort.current = null;
    setProgress(null);
    setError(null);
    if (done) URL.revokeObjectURL(done.url);
    setDone(null);
    ctl.ui.setState({ exportOpen: false });
  };

  const commitRange = (r: ExportRange | null) =>
    ctl.run(l.rangeChange, (d) => setExportRange(d, r), { coalesceKey: 'export-range' });

  /** Runs one export with progress, a screen wake lock and cancel. */
  const run = async (job: (signal: AbortSignal) => Promise<Done>) => {
    setError(null);
    setDone(null);
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
      setDone(await job(controller.signal));
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      void lock?.release();
      abort.current = null;
      setProgress(null);
    }
  };

  const startVideo = () =>
    run(async (signal) => {
      const result = await ctl.exportVideo(
        { ...videoOptions, ...(part && span ? { range: span } : {}) },
        setProgress,
        signal,
      );
      return { kind: 'video', result, url: URL.createObjectURL(result.blob) };
    });

  const startAudio = () =>
    run(async (signal) => {
      const result = await ctl.exportAudio(
        { ...audio, ...(part && span ? { range: span } : {}) },
        setProgress,
        signal,
      );
      return { kind: 'audio', result, url: URL.createObjectURL(result.blob) };
    });

  const saveImage = async () => {
    setError(null);
    setDone(null);
    setSavingImage(true);
    try {
      const image = await ctl.saveFrame({ format: imageFormat, quality: 0.92 });
      setDone({ kind: 'image', image, url: URL.createObjectURL(image.blob) });
    } catch (e) {
      setError(l.imageFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingImage(false);
    }
  };

  // Smaller files (HEVC in MP4, else AV1) where this device can encode them at this size.
  const smallerCodec: ExportOptions['videoCodec'] | null = !limits
    ? null
    : options.format === 'mp4' && limits.hevc.includes(outHeight)
      ? 'hevc'
      : limits.av1.includes(outHeight)
        ? 'av1'
        : null;
  const smaller = !!smallerCodec && options.videoCodec === smallerCodec;
  // What's exported: the choices above, the frame rate resolved, a codec only where it applies.
  const videoOptions: ExportOptions = {
    ...options,
    height: outHeight,
    fps: fpsChoice === 'same' ? defaultFps : fpsChoice,
    videoCodec: smaller ? smallerCodec! : 'auto',
  };

  const busy = progress !== null || savingImage;
  const percent = progress ? Math.floor(progress.fraction * 100) : 0;
  const base = ctl.project.name || 'video';
  const fileName = done
    ? done.kind === 'image'
      ? `${base} ${formatClock(frameTime).replace(/[:.]/g, '-')}.${done.image.extension}`
      : `${base}.${done.result.extension}`
    : `${base}.${options.format}`;
  const seconds = spanLength / FLICKS_PER_SECOND;
  const out = exportSize(width, height, outHeight);
  const sizeOf = (h: number, quality: ExportOptions['quality']) => {
    const o = exportSize(width, height, h);
    return estimateMb(
      o.width,
      o.height,
      videoOptions.fps,
      quality,
      seconds,
      videoOptions.format,
      videoOptions.videoCodec,
    );
  };
  const estimate = sizeOf(outHeight, options.quality);
  const aspect = width / height;
  const doneBlob = done ? (done.kind === 'image' ? done.image.blob : done.result.blob) : null;
  const shareFile =
    doneBlob && typeof navigator.canShare === 'function'
      ? new File([doneBlob], fileName, { type: doneBlob.type })
      : null;
  const canShare = shareFile ? navigator.canShare({ files: [shareFile] }) : false;
  const ring = 2 * Math.PI * 26;
  const posterTime: Time =
    kind === 'image'
      ? frameTime
      : part && span
        ? span.start
        : ctl.playhead.time < duration
          ? ctl.playhead.time
          : 0;
  const title = done
    ? l.exportReadyTitle
    : progress
      ? l.exporting
      : kind === 'audio'
        ? l.exportAudioTitle
        : kind === 'image'
          ? l.exportImageTitle
          : l.exportTitle;

  const lengthField = (
    <div className="vu-field">
      <Segmented
        label={l.exportLength}
        value={part ? 'part' : 'whole'}
        options={[
          { value: 'whole', label: l.lengthWhole },
          { value: 'part', label: l.lengthPart },
        ]}
        onChange={(v) => {
          if (v === 'whole') return void commitRange(null);
          if (part || duration === 0) return;
          // A first part: from the playhead to the end, or the middle third at the start / end.
          const t = ctl.playhead.time;
          const inside = t > 0 && t < duration - FLICKS_PER_SECOND;
          commitRange(
            inside
              ? { start: t, end: duration }
              : { start: Math.round(duration / 3), end: Math.round((duration * 2) / 3) },
          );
        }}
      />
      {part && span ? (
        <>
          <RangeBar duration={duration} range={span} onCommit={commitRange} />
          <p className="vu-hint">{l.partHint}</p>
        </>
      ) : null}
    </div>
  );

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
        tabIndex={-1}
        data-state={done ? 'done' : busy ? 'busy' : 'form'}
        data-kind={kind}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) close();
        }}
      >
        <div className="vu-modal-head">
          <h2 id="vu-export-title" className="vu-modal-title">
            {title}
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
        <div className="vu-export-body" data-wide={aspect >= 1 || undefined}>
          <div className="vu-export-side">
            {done?.kind === 'video' ? (
              <video
                className="vu-export-result"
                src={done.url}
                controls
                playsInline
                style={{ aspectRatio: String(done.result.width / done.result.height) }}
              />
            ) : done?.kind === 'image' ? (
              <img
                className="vu-export-result vu-export-image"
                src={done.url}
                alt={l.imageFrameAt(formatClock(frameTime))}
                style={{ aspectRatio: String(done.image.width / done.image.height) }}
              />
            ) : (
              <Poster
                aspect={aspect}
                time={posterTime}
                progress={progress ? progress.fraction : null}
              >
                {progress ? (
                  <div className="vu-export-ring" aria-hidden="true">
                    <svg viewBox="0 0 60 60">
                      <circle className="vu-export-ring-track" cx="30" cy="30" r="26" />
                      <circle
                        className="vu-export-ring-fill"
                        cx="30"
                        cy="30"
                        r="26"
                        strokeDasharray={ring}
                        strokeDashoffset={ring * (1 - progress.fraction)}
                      />
                    </svg>
                    <span>{percent}%</span>
                  </div>
                ) : (
                  <span className="vu-export-badge">
                    {kind === 'image' ? formatClock(frameTime) : formatDurationShort(spanLength)}
                  </span>
                )}
                {done?.kind === 'audio' ? (
                  <span className="vu-export-sound" aria-hidden="true">
                    <Icon name="audio" size={28} />
                  </span>
                ) : null}
              </Poster>
            )}
          </div>
          <div className="vu-export-main">
            {done ? (
              <div className="vu-export-done">
                <span className="vu-export-check" aria-hidden="true">
                  <svg viewBox="0 0 52 52">
                    <circle cx="26" cy="26" r="24" />
                    <path d="M15 27l7 7 15-16" />
                  </svg>
                </span>
                <p className="vu-export-done-title">
                  {done.kind === 'video'
                    ? l.exportDone
                    : done.kind === 'audio'
                      ? l.audioExportDone
                      : l.imageDone}
                </p>
                <p className="vu-hint">
                  {done.kind === 'image'
                    ? `${done.image.width}×${done.image.height} · ${formatMb(done.image.blob.size / 1e6)} · ${done.image.extension.toUpperCase()}`
                    : done.kind === 'audio'
                      ? `${formatDurationShort(done.result.durationSeconds * FLICKS_PER_SECOND)} · ${formatMb(done.result.blob.size / 1e6)} · ${done.result.extension.toUpperCase()}`
                      : `${done.result.width}×${done.result.height} · ${formatMb(done.result.blob.size / 1e6)} · ${done.result.extension.toUpperCase()}`}
                </p>
                {done.kind === 'audio' ? (
                  <audio className="vu-export-audio" src={done.url} controls />
                ) : null}
                <a
                  className="vu-btn vu-wide"
                  data-variant="primary"
                  data-layout="row"
                  href={done.url}
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
            ) : progress ? (
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
                {progress.framesTotal && kind === 'video' ? (
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
                <Segmented
                  label={l.exportWhat}
                  hideLabel
                  value={kind}
                  options={[
                    { value: 'video', label: l.exportKindVideo, icon: 'media' },
                    { value: 'audio', label: l.exportKindAudio, icon: 'audio' },
                    { value: 'image', label: l.exportKindImage, icon: 'image' },
                  ]}
                  onChange={(k) => {
                    setError(null);
                    setKind(k);
                  }}
                />
                {kind === 'video' ? (
                  <>
                    <div className="vu-field">
                      <span className="vu-field-row" id="vu-export-q">
                        {l.quality}
                      </span>
                      {/* One choice for size and sharpness: each resolution with its file size. */}
                      <div
                        className="vu-export-options"
                        role="radiogroup"
                        aria-labelledby="vu-export-q"
                      >
                        {available.map((h) => (
                          <Option
                            key={h}
                            group="resolution"
                            value={String(h)}
                            current={String(outHeight)}
                            title={l.resolutionName(h)}
                            detail={h === 2160 ? '4K' : `${h}p`}
                            note={l.aboutSize(formatMb(sizeOf(h, options.quality)))}
                            onPick={(v) =>
                              setOptions({
                                ...options,
                                height: Number(v) as ExportOptions['height'],
                              })
                            }
                          />
                        ))}
                      </div>
                      {limit < 2160 && maxExportHeight(tier) < 2160 ? (
                        <p className="vu-hint">{l.deviceLimit}</p>
                      ) : null}
                    </div>
                    {lengthField}
                    <button
                      type="button"
                      className="vu-export-more"
                      aria-expanded={more}
                      aria-controls="vu-export-more"
                      onClick={() => setMore(!more)}
                    >
                      <Icon name="chevronDown" size={16} />
                      <span>{l.moreSettings}</span>
                      {more ? null : <span className="vu-hint">{l.moreSettingsHint}</span>}
                    </button>
                    {more ? (
                      <div className="vu-export-more-body" id="vu-export-more">
                        <Segmented
                          label={l.frameRate}
                          value={String(fpsChoice)}
                          options={[
                            { value: 'same', label: l.sameAsVideo(defaultFps) },
                            ...(['24', '30', '60'] as const).map((f) => ({ value: f, label: f })),
                          ]}
                          onChange={(v) =>
                            setFpsChoice(
                              v === 'same' ? 'same' : (Number(v) as ExportOptions['fps']),
                            )
                          }
                        />
                        <Segmented
                          label={l.fileType}
                          value={options.format}
                          options={[
                            { value: 'mp4', label: l.fileTypeMp4, tip: l.formatMp4Tip },
                            { value: 'webm', label: 'WebM', tip: l.formatWebmTip },
                          ]}
                          onChange={(format) => setOptions({ ...options, format })}
                        />
                        <button
                          type="button"
                          role="switch"
                          aria-checked={options.quality === 'high'}
                          className="vu-switch-row"
                          onClick={() =>
                            setOptions({
                              ...options,
                              quality: options.quality === 'high' ? 'medium' : 'high',
                            })
                          }
                        >
                          <span className="vu-switch-text">
                            <span>{l.extraQuality}</span>
                            <span className="vu-hint">
                              {l.extraQualityNote(formatMb(sizeOf(outHeight, 'high')))}
                            </span>
                          </span>
                          <span className="vu-switch" aria-hidden="true">
                            <span className="vu-switch-knob" />
                          </span>
                        </button>
                        {smallerCodec ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={smaller}
                            className="vu-switch-row"
                            onClick={() =>
                              setOptions({
                                ...options,
                                videoCodec: smaller ? 'auto' : smallerCodec,
                              })
                            }
                          >
                            <span className="vu-switch-text">
                              <span>
                                {l.smallerFile}
                                <span className="vu-tag">{l.newerDevices}</span>
                              </span>
                              <span className="vu-hint">
                                {smallerCodec === 'hevc' ? l.codecHevcTip : l.codecAv1Tip}
                              </span>
                            </span>
                            <span className="vu-switch" aria-hidden="true">
                              <span className="vu-switch-knob" />
                            </span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : kind === 'audio' ? (
                  <>
                    <div className="vu-field">
                      <span className="vu-field-row" id="vu-export-afmt">
                        {l.format}
                      </span>
                      <div
                        className="vu-export-options"
                        role="radiogroup"
                        aria-labelledby="vu-export-afmt"
                      >
                        {(['m4a', 'ogg', 'wav'] as const).map((f) => (
                          <Option
                            key={f}
                            group="audio-format"
                            value={f}
                            current={audio.format}
                            title={
                              f === 'm4a'
                                ? l.audioFormatM4a
                                : f === 'ogg'
                                  ? l.audioFormatOgg
                                  : l.audioFormatWav
                            }
                            detail={
                              f === 'm4a'
                                ? l.audioFormatM4aTip
                                : f === 'ogg'
                                  ? l.audioFormatOggTip
                                  : l.audioFormatWavTip
                            }
                            disabledReason={
                              f === 'ogg' && limits && !limits.opus ? l.opusUnavailable : null
                            }
                            onPick={(format) => setAudio({ ...audio, format })}
                          />
                        ))}
                      </div>
                    </div>
                    {audio.format !== 'wav' ? (
                      <div className="vu-field">
                        <span className="vu-field-row" id="vu-export-aq">
                          {l.quality}
                        </span>
                        <div
                          className="vu-export-options"
                          role="radiogroup"
                          aria-labelledby="vu-export-aq"
                        >
                          {(['low', 'medium', 'high'] as const).map((q) => (
                            <Option
                              key={q}
                              group="audio-quality"
                              value={q}
                              current={audio.quality}
                              title={
                                q === 'low'
                                  ? l.qualityLow
                                  : q === 'medium'
                                    ? l.qualityMedium
                                    : l.qualityHigh
                              }
                              detail={`${exportAudioBitrate(q) / 1000} kb/s`}
                              onPick={(quality) => setAudio({ ...audio, quality })}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {lengthField}
                  </>
                ) : (
                  <>
                    <div className="vu-field">
                      <p className="vu-export-frame">{l.imageFrameAt(formatClock(frameTime))}</p>
                      <p className="vu-hint">{l.imagePickHint}</p>
                    </div>
                    <div className="vu-field">
                      <span className="vu-field-row" id="vu-export-ifmt">
                        {l.format}
                      </span>
                      <div
                        className="vu-export-options"
                        role="radiogroup"
                        aria-labelledby="vu-export-ifmt"
                      >
                        {(['png', 'jpeg'] as const).map((f) => (
                          <Option
                            key={f}
                            group="image-format"
                            value={f}
                            current={imageFormat}
                            title={f === 'png' ? l.imageFormatPng : l.imageFormatJpeg}
                            detail={f === 'png' ? l.imageFormatPngTip : l.imageFormatJpegTip}
                            onPick={setImageFormat}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {error ? (
                  <p className="vu-error" role="alert">
                    {kind === 'image' ? error : l.exportFailed(error)}
                  </p>
                ) : null}
              </div>
            )}
          </div>
          {done || progress ? null : (
            // What will be made, and the button — closing the settings column (on phones, kept in view).
            <div className="vu-export-actions">
              <div className="vu-export-summary">
                <span>
                  {kind === 'video'
                    ? `${out.width}×${out.height} · ${videoOptions.fps} fps · ${videoOptions.format.toUpperCase()}`
                    : kind === 'audio'
                      ? `48 kHz stereo · ${formatDurationShort(spanLength)}`
                      : `${width}×${height} · ${imageFormat === 'png' ? 'PNG' : 'JPEG'}`}
                </span>
                {kind === 'image' ? null : (
                  <span>
                    {l.aboutSize(
                      formatMb(
                        kind === 'video'
                          ? estimate
                          : estimateAudioMb(audio.format, audio.quality, seconds),
                      ),
                    )}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="vu-btn vu-wide vu-export-go"
                data-variant="primary"
                data-layout="row"
                aria-disabled={
                  duration === 0 || (kind === 'audio' && !sound) || savingImage || undefined
                }
                data-tooltip={
                  duration === 0
                    ? l.needClips
                    : kind === 'audio' && !sound
                      ? l.noSoundToExport
                      : undefined
                }
                onClick={() => {
                  if (duration === 0 || savingImage) return;
                  if (kind === 'video') void startVideo();
                  else if (kind === 'audio') {
                    if (sound) void startAudio();
                  } else void saveImage();
                }}
              >
                {savingImage ? (
                  <span className="vu-spinner" aria-hidden="true" />
                ) : (
                  <Icon name={kind === 'image' ? 'image' : 'download'} />
                )}
                <span>
                  {kind === 'video'
                    ? l.startExport
                    : kind === 'audio'
                      ? l.startAudioExport
                      : savingImage
                        ? l.savingImage
                        : l.saveImage}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
