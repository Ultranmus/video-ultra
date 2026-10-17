import { FLICKS_PER_SECOND, type Asset } from '@video-ultra/core';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Icon } from './icons';
import { stickerItem, textItem } from './items';
import { FONT_PRESETS, STICKER_EMOJI } from './pending';
import type { PanelId } from './state';
import { ToolPanel } from './ToolPanel';

/** The browse panel for an add-content category (desktop panel, phone sheet). */
export function AddPanel({ panel }: { panel: PanelId }): ReactElement {
  switch (panel) {
    case 'media':
      return <MediaPanel />;
    case 'text':
      return <TextPanel />;
    case 'stickers':
      return <StickersPanel />;
    case 'audio':
      return <AudioPanel />;
    case 'canvas':
      return <ToolPanel tool="canvas" />;
    case 'filters':
      return <ToolPanel tool="filter" />;
    case 'transitions':
      return <ToolPanel tool="transition" />;
  }
}

function formatDuration(asset: Asset): string {
  if (asset.kind === 'image') return '';
  const s = Math.round(asset.duration / FLICKS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ImportRows() {
  const ctl = useController();
  const l = useLabels();
  const imports = useUi((s) => s.imports);
  if (imports.length === 0) return null;
  return (
    <ul className="vu-imports" aria-live="polite">
      {imports.map((row) => (
        <li key={row.id} className="vu-import" data-status={row.status}>
          {row.status === 'working' ? (
            <span className="vu-spinner" aria-hidden="true" />
          ) : (
            <Icon name="warning" size={16} />
          )}
          <span className="vu-import-text">
            {row.status === 'working'
              ? l.importing(row.name)
              : l.importFailed(row.name, row.message ?? '')}
          </span>
          {row.status === 'error' ? (
            <button type="button" className="vu-link" onClick={() => ctl.dismissImport(row.id)}>
              {l.dismiss}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function MediaPanel() {
  const ctl = useController();
  const l = useLabels();
  const assets = useProject((p) => Object.values(p.assets).filter((a) => a.kind !== 'audio'));
  return (
    <div className="vu-panel-body">
      <button type="button" className="vu-primary vu-wide" onClick={() => ctl.pickFiles()}>
        <Icon name="plus" />
        <span>{l.addMedia}</span>
      </button>
      <p className="vu-hint">{l.addMediaHint}</p>
      <ImportRows />
      {assets.length ? (
        <ul className="vu-asset-grid">
          {assets.map((asset) => (
            <li key={asset.id}>
              <AssetTile asset={asset} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** An imported file: its thumbnail; tap to add it at the playhead. */
function AssetTile({ asset }: { asset: Asset }) {
  const ctl = useController();
  const l = useLabels();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const canvas = canvasRef.current!;
    const height = Math.round(72 * Math.min(devicePixelRatio || 1, 2));
    void ctl.analyzer
      ?.thumbnail(
        asset.id,
        Math.min(1, asset.duration / FLICKS_PER_SECOND / 2),
        height,
        controller.signal,
      )
      .then((bitmap) => {
        if (!bitmap) return;
        if (controller.signal.aborted) {
          bitmap.close();
          return;
        }
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        bitmap.close();
      });
    return () => controller.abort();
  }, [ctl, asset.id, asset.duration]);
  return (
    <button
      type="button"
      className="vu-asset"
      aria-label={`${l.addToTimeline}: ${asset.name}${asset.kind === 'video' ? `, ${formatDuration(asset)}` : ''}`}
      onClick={() => ctl.addAssetToTimeline(asset.id)}
    >
      <canvas ref={canvasRef} className="vu-asset-thumb" aria-hidden="true" />
      {asset.kind === 'video' ? (
        <span className="vu-asset-badge">{formatDuration(asset)}</span>
      ) : null}
    </button>
  );
}

function TextPanel() {
  const ctl = useController();
  const l = useLabels();
  return (
    <div className="vu-panel-body">
      <button
        type="button"
        className="vu-primary vu-wide"
        onClick={() => {
          ctl.addLaneItem(l.addText, (id, start) => textItem(id, start, l.textPlaceholder));
          ctl.openTool('text-edit');
        }}
      >
        <Icon name="plus" />
        <span>{l.addText}</span>
      </button>
      <ul className="vu-style-list">
        {FONT_PRESETS.map((font) => (
          <li key={font.id}>
            <button
              type="button"
              className="vu-style-preset"
              style={{ fontFamily: font.family, fontWeight: font.weight }}
              onClick={() => {
                ctl.addLaneItem(l.addText, (id, start) => textItem(id, start, font.label, font));
                ctl.openTool('text-edit');
              }}
            >
              {font.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StickersPanel() {
  const ctl = useController();
  const l = useLabels();
  return (
    <div className="vu-panel-body">
      <ul className="vu-emoji-grid" aria-label={l.stickers}>
        {STICKER_EMOJI.map((emoji) => (
          <li key={emoji}>
            <button
              type="button"
              className="vu-emoji"
              aria-label={emoji}
              onClick={() =>
                ctl.addLaneItem(l.stickers, (id, start) => stickerItem(id, start, { emoji }))
              }
            >
              {emoji}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AudioPanel() {
  const ctl = useController();
  const l = useLabels();
  const assets = useProject((p) => Object.values(p.assets).filter((a) => a.kind === 'audio'));
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="vu-panel-body">
      <button
        type="button"
        className="vu-primary vu-wide"
        onClick={() => inputRef.current?.click()}
      >
        <Icon name="audio" />
        <span>{l.addMusic}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          void ctl.importFiles(files);
        }}
      />
      <Voiceover />
      <ImportRows />
      {assets.length ? (
        <ul className="vu-list">
          {assets.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                className="vu-list-item"
                onClick={() => ctl.addAssetToTimeline(asset.id)}
              >
                <Icon name="audio" size={16} />
                <span className="vu-list-text">{asset.name}</span>
                <span className="vu-list-meta">{formatDuration(asset)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Records the microphone and adds it as an audio clip where recording started. */
function Voiceover() {
  const ctl = useController();
  const l = useLabels();
  const recording = useUi((s) => s.recording);
  const recorder = useRef<MediaRecorder | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => recorder.current?.stop(), []);

  const start = async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setError(l.microphoneBlocked);
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
    const chunks: Blob[] = [];
    const startAt = ctl.playhead.time;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      ctl.ui.setState({ recording: false });
      ctl.pause();
      const mime = rec.mimeType || type || 'audio/webm';
      const file = new File(
        chunks,
        `Voiceover ${new Date().toLocaleTimeString()}.${mime.includes('mp4') ? 'm4a' : 'webm'}`,
        { type: mime },
      );
      ctl.seek(startAt);
      void ctl.importFiles([file]);
    };
    recorder.current = rec;
    rec.start(1000);
    ctl.ui.setState({ recording: true });
    // Play along so the speaker can follow the video (sound would leak into the mic: muted engine
    // audio is a later improvement).
    ctl.play();
  };

  return (
    <div className="vu-voiceover">
      {recording ? (
        <button
          type="button"
          className="vu-danger-button vu-wide"
          onClick={() => recorder.current?.stop()}
        >
          <Icon name="stop" />
          <span>{l.stopRecording}</span>
        </button>
      ) : (
        <button type="button" className="vu-secondary vu-wide" onClick={() => void start()}>
          <Icon name="mic" />
          <span>{l.recordVoiceover}</span>
        </button>
      )}
      {error ? (
        <p className="vu-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
