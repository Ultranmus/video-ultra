import { randomId, type Asset, type DeviceTier } from '@video-ultra/core';
import type { MediaRecordingWriter } from '@video-ultra/core/internal';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useUi } from './context';
import { Button, IconButton, ToolButton } from './controls';
import { Icon } from './icons';
import type { Labels } from './labels';

/**
 * Record from the camera inside the editor (v0.2 D1). The recorder covers the editor while open:
 * a live preview, front / back switch where the device has both, microphone on / off, one record
 * button with the elapsed time. MediaRecorder pieces (one a second) stream straight into the
 * editor's storage, so a long recording never sits in memory. On stop the clip is shown for
 * review and added to the main video at the playhead or as a layer, like an imported file.
 */

type Phase = 'starting' | 'live' | 'recording' | 'saving' | 'review' | 'error';

/** Recording size, bitrate and the longest recording per device tier. */
const PLAN: Record<
  DeviceTier,
  { width: number; height: number; bitrate: number; minutes: number }
> = {
  low: { width: 1280, height: 720, bitrate: 4_000_000, minutes: 10 },
  mid: { width: 1920, height: 1080, bitrate: 8_000_000, minutes: 20 },
  high: { width: 1920, height: 1080, bitrate: 8_000_000, minutes: 30 },
};
/** Without OPFS (private browsing) the pieces stay in memory: keep recordings short. */
const MEMORY_MINUTES = 5;
/** Below this much free storage a recording doesn't start. */
const MIN_FREE_BYTES = 64 * 2 ** 20;

/**
 * Containers in order of preference: MP4 / H.264 (iOS Safari, recent Chrome — plays everywhere),
 * then WebM (Chrome, Firefox). `''` = the browser's default.
 */
const TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** The recording type this browser supports, `''` for its default, `null` without MediaRecorder. */
export function pickRecordingType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return (
    TYPES.find((t) => {
      try {
        return MediaRecorder.isTypeSupported(t);
      } catch {
        return false;
      }
    }) ?? ''
  );
}

/** A calm, specific message for a failed camera start. */
function cameraError(error: unknown, l: Labels): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return l.cameraBlocked;
  if (
    name === 'NotFoundError' ||
    name === 'OverconstrainedError' ||
    name === 'DevicesNotFoundError'
  )
    return l.cameraNotFound;
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return l.cameraBusy;
  return l.cameraFailed(error instanceof Error ? error.message : String(error));
}

const stopStream = (stream: MediaStream | null) => {
  for (const track of stream?.getTracks() ?? []) track.stop();
};

/** `m:ss` for the recording clock. */
function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The camera recorder, shown while `cameraOpen` is set. */
export function CameraRecorder(): ReactElement | null {
  const open = useUi((s) => s.cameraOpen);
  return open ? <CameraView /> : null;
}

function CameraView(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const plan = PLAN[ctl.caps?.tier ?? 'mid'];
  const maxMinutes =
    ctl.storage?.kind === 'memory' ? Math.min(MEMORY_MINUTES, plan.minutes) : plan.minutes;

  const videoRef = useRef<HTMLVideoElement>(null);
  const recordRef = useRef<HTMLButtonElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const camRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  /** The recording being written (null once it has been added or thrown away). */
  const pendingRef = useRef<{ writer: MediaRecordingWriter; assetId: string } | null>(null);
  /** Set when the recorder is stopped to throw the recording away (close while recording). */
  const discardRef = useRef(false);
  const startedRef = useRef(0);
  const liveRef = useRef(true);
  const generation = useRef(0);

  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [micOn, setMicOn] = useState(true);
  const [cameras, setCameras] = useState(0);
  const [review, setReview] = useState<{
    file: File;
    source: Asset['source'];
    assetId: string;
    url: string;
  } | null>(null);
  const [adding, setAdding] = useState(false);

  const stopCamera = () => {
    stopStream(camRef.current);
    stopStream(micRef.current);
    camRef.current = null;
    micRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const throwAway = () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) void pending.writer.discard().catch(() => undefined);
  };

  const attachPreview = () => {
    const v = videoRef.current;
    const cam = camRef.current;
    if (v && cam && v.srcObject !== cam) {
      v.srcObject = cam;
      void v.play().catch(() => undefined);
    }
  };
  /** Starts (or restarts) the camera, with the microphone if `withMic`. */
  const startCamera = async (mode: 'user' | 'environment', withMic: boolean) => {
    const gen = ++generation.current;
    stopCamera();
    setPhase('starting');
    setError(null);
    const fail = (message: string) => {
      if (gen !== generation.current || !liveRef.current) return;
      setError(message);
      setPhase('error');
    };
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia)
      return fail(globalThis.isSecureContext === false ? l.cameraInsecure : l.cameraUnsupported);
    if (pickRecordingType() === null) return fail(l.cameraUnsupported);
    const video: MediaTrackConstraints = {
      facingMode: { ideal: mode },
      width: { ideal: plan.width },
      height: { ideal: plan.height },
      frameRate: { ideal: 30, max: 30 },
    };
    let stream: MediaStream;
    let micBlocked = false;
    try {
      // One request for both, so phones ask once for camera and microphone.
      stream = await media.getUserMedia(
        withMic
          ? { video, audio: { echoCancellation: true, noiseSuppression: true } }
          : { video, audio: false },
      );
    } catch (first) {
      // Maybe only the microphone was refused: try the camera alone.
      if (!withMic) return fail(cameraError(first, l));
      try {
        stream = await media.getUserMedia({ video, audio: false });
        micBlocked = true;
      } catch (second) {
        return fail(cameraError(second, l));
      }
    }
    if (gen !== generation.current || !liveRef.current) {
      stopStream(stream);
      return;
    }
    camRef.current = new MediaStream(stream.getVideoTracks());
    const audio = stream.getAudioTracks();
    micRef.current = audio.length ? new MediaStream(audio) : null;
    if (micBlocked) {
      setMicOn(false);
      setNote(l.cameraMicBlocked);
    }
    attachPreview();
    try {
      const devices = await media.enumerateDevices();
      if (gen === generation.current)
        setCameras(devices.filter((d) => d.kind === 'videoinput').length);
    } catch {
      /* no device list: no switch button */
    }
    if (gen === generation.current && liveRef.current) setPhase('live');
  };

  // The preview element is re-created after a review: hand it the stream again.
  useEffect(attachPreview);

  useEffect(() => {
    liveRef.current = true;
    // Started from a timer, not the effect itself (a strict-mode remount never starts it twice).
    const timer = setTimeout(() => void startCamera('user', true), 0);
    const gens = generation;
    return () => {
      // Closing (or unmounting) never leaves the camera or microphone on.
      clearTimeout(timer);
      liveRef.current = false;
      gens.current++;
      const rec = recRef.current;
      recRef.current = null;
      if (rec && rec.state !== 'inactive') {
        discardRef.current = true;
        rec.stop();
      }
      stopCamera();
      throwAway();
      ctl.ui.setState({ recording: false });
    };
    // Mount-only: the camera starts once; switches restart it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!review) return;
    return () => URL.revokeObjectURL(review.url);
  }, [review]);

  useEffect(() => {
    if (phase === 'live') recordRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const stopRecording = () => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  // The recording clock: a text update 4× a second (no React render), auto-stop at the limit.
  useEffect(() => {
    if (phase !== 'recording') return;
    let warned = false;
    const tick = () => {
      const elapsed = performance.now() - startedRef.current;
      if (timeRef.current) timeRef.current.textContent = clock(elapsed);
      const left = maxMinutes * 60_000 - elapsed;
      if (left <= 60_000 && !warned) {
        warned = true;
        setNote(l.recordingEndsSoon);
      }
      if (left <= 0) stopRecording();
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const finishRecording = async (rec: MediaRecorder) => {
    ctl.ui.setState({ recording: false });
    const pending = pendingRef.current;
    if (discardRef.current || !pending) {
      discardRef.current = false;
      throwAway();
      return;
    }
    if (!liveRef.current) return;
    setPhase('saving');
    try {
      const { file: stored, source } = await pending.writer.finish();
      const mime = (rec.mimeType || stored.type || 'video/webm').split(';')[0]!;
      const stamp = new Date().toLocaleTimeString().replace(/:/g, '.');
      // Wraps the stored (disk-backed) file: no copy.
      const file = new File(
        [stored],
        `${l.recordingName(stamp)}.${mime.includes('mp4') ? 'mp4' : 'webm'}`,
        {
          type: mime,
        },
      );
      if (!liveRef.current) return;
      stopCamera(); // free the camera (and its light) while reviewing
      setReview({ file, source, assetId: pending.assetId, url: URL.createObjectURL(file) });
      setPhase('review');
    } catch (e) {
      throwAway();
      if (!liveRef.current) return;
      setError(
        (e as { name?: string }).name === 'StorageFullError'
          ? l.recordingNoSpace
          : l.recordingFailed(e instanceof Error ? e.message : String(e)),
      );
      setPhase('error');
    }
  };

  const startRecording = async () => {
    const cam = camRef.current;
    const storage = ctl.storage;
    if (!cam || !storage || phase !== 'live') return;
    setNote(null);
    const status = await storage.status().catch(() => null);
    if (
      status?.quota != null &&
      status.usage != null &&
      status.quota - status.usage < MIN_FREE_BYTES
    ) {
      setNote(l.recordingNoSpace);
      return;
    }
    const type = pickRecordingType();
    const tracks = [
      ...cam.getVideoTracks(),
      ...(micOn ? (micRef.current?.getAudioTracks() ?? []) : []),
    ];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(new MediaStream(tracks), {
        ...(type ? { mimeType: type } : {}),
        videoBitsPerSecond: plan.bitrate,
        audioBitsPerSecond: 128_000,
      });
    } catch (e) {
      setError(l.cameraFailed(e instanceof Error ? e.message : String(e)));
      setPhase('error');
      return;
    }
    const assetId = randomId();
    const writer = storage.recordMedia(assetId);
    pendingRef.current = { writer, assetId };
    discardRef.current = false;
    let failed = false;
    rec.ondataavailable = (event) => {
      if (!event.data.size) return;
      // Each piece goes straight to storage; a failure (storage full) stops the recording but
      // keeps what was stored.
      writer.append(event.data).catch((e: unknown) => {
        if (failed) return;
        failed = true;
        setNote(
          (e as { name?: string }).name === 'StorageFullError'
            ? l.recordingNoSpace
            : l.recordingFailed(e instanceof Error ? e.message : String(e)),
        );
        if (rec.state !== 'inactive') rec.stop();
      });
    };
    rec.onstop = () => void finishRecording(rec);
    recRef.current = rec;
    rec.start(1000);
    startedRef.current = performance.now();
    ctl.ui.setState({ recording: true });
    setPhase('recording');
  };

  const close = () => ctl.setCameraOpen(false);

  const retake = () => {
    throwAway();
    setReview(null);
    setNote(null);
    void startCamera(facing, micOn);
  };

  const add = async (place: 'main' | 'layer') => {
    const r = review;
    if (!r || adding) return;
    setAdding(true);
    const ok = await ctl.addRecording(r.file, r.assetId, r.source, place);
    if (!liveRef.current) return;
    if (ok) {
      pendingRef.current = null; // it belongs to the project now
      close();
    } else setAdding(false);
  };

  const toggleMic = async () => {
    if (phase !== 'live') return;
    if (micOn) {
      stopStream(micRef.current);
      micRef.current = null;
      setMicOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!liveRef.current) return stopStream(stream);
      micRef.current = stream;
      setMicOn(true);
      setNote(null);
    } catch {
      setNote(l.cameraMicBlocked);
    }
  };

  const switchCamera = () => {
    const next = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    void startCamera(next, micOn);
  };

  const recording = phase === 'recording';
  return (
    <div
      className="vu-camera"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vu-camera-title"
      data-phase={phase}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        // Escape never throws a recording away: it stops it (and keeps it) first.
        if (recording) stopRecording();
        else close();
      }}
    >
      <div className="vu-camera-head">
        <h2 id="vu-camera-title" className="vu-camera-title">
          {l.camera}
        </h2>
        {recording ? (
          <span className="vu-camera-time">
            <span className="vu-camera-dot" aria-hidden="true" />
            <span ref={timeRef}>0:00</span>
          </span>
        ) : null}
        <IconButton icon="close" label={l.closeCamera} onClick={close} />
      </div>
      <div className="vu-camera-view">
        {review ? (
          <video
            key="review"
            className="vu-camera-video"
            src={review.url}
            controls
            playsInline
            aria-label={review.file.name}
          />
        ) : (
          <video
            key="live"
            ref={videoRef}
            className="vu-camera-video"
            data-mirror={facing === 'user' || undefined}
            data-hidden={phase === 'error' || undefined}
            muted
            autoPlay
            playsInline
            aria-hidden="true"
          />
        )}
        {phase === 'starting' || phase === 'saving' ? (
          <div className="vu-camera-status">
            <span className="vu-spinner" aria-hidden="true" />
            <span>{phase === 'starting' ? l.cameraStarting : l.recordingSaving}</span>
          </div>
        ) : null}
        {phase === 'error' ? (
          <div className="vu-camera-status" role="alert">
            <Icon name="warning" size={28} />
            <p>{error}</p>
            <Button
              label={l.cameraRetry}
              variant="secondary"
              onClick={() => {
                setNote(null);
                void startCamera(facing, true);
              }}
            />
          </div>
        ) : null}
      </div>
      <p className="vu-sr-only" aria-live="polite">
        {phase === 'recording'
          ? l.cameraRecordingNow
          : phase === 'review'
            ? l.cameraStopped
            : phase === 'live'
              ? l.cameraLive
              : ''}
      </p>
      {note ? (
        <p className="vu-camera-note" role="status">
          {note}
        </p>
      ) : null}
      {phase === 'live' ? <p className="vu-camera-limit">{l.recordingLimit(maxMinutes)}</p> : null}
      {review ? (
        <div className="vu-camera-bar" data-review="">
          <Button icon="undo" label={l.retake} onClick={retake} />
          <Button
            icon="media"
            label={l.addAsLayer}
            tip={l.addAsLayerTip}
            variant="secondary"
            disabledReason={adding ? l.recordingSaving : null}
            onClick={() => void add('layer')}
          />
          <Button
            icon="plus"
            label={l.addToVideo}
            tip={l.addToVideoTip}
            variant="primary"
            disabledReason={adding ? l.recordingSaving : null}
            onClick={() => void add('main')}
          />
        </div>
      ) : phase === 'error' ? null : (
        <div className="vu-camera-bar">
          <ToolButton
            icon={micOn ? 'mic' : 'micOff'}
            label={l.microphone}
            tip={micOn ? l.micOnTip : l.micOffTip}
            pressed={micOn}
            disabledReason={
              phase === 'live' ? null : recording ? l.cameraRecordingNow : l.cameraStarting
            }
            onClick={() => void toggleMic()}
          />
          <button
            ref={recordRef}
            type="button"
            className="vu-record"
            data-recording={recording || undefined}
            aria-label={recording ? l.stopCameraRecording : l.startRecording}
            aria-disabled={!(phase === 'live' || recording) || undefined}
            data-tooltip={recording ? l.stopCameraRecording : l.startRecording}
            onClick={() => {
              if (recording) stopRecording();
              else void startRecording();
            }}
          >
            <span className="vu-record-mark" aria-hidden="true" />
          </button>
          {cameras > 1 ? (
            <ToolButton
              icon="switchCamera"
              label={l.switchCamera}
              disabledReason={
                phase === 'live' ? null : recording ? l.cameraRecordingNow : l.cameraStarting
              }
              onClick={switchCamera}
            />
          ) : (
            <span className="vu-camera-spacer" aria-hidden="true" />
          )}
        </div>
      )}
    </div>
  );
}
