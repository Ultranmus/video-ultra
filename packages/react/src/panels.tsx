import {
  findItem,
  FLICKS_PER_SECOND,
  updateItem,
  type Asset,
  type TextStyle,
} from '@video-ultra/core';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Icon } from './icons';
import { textItem } from './items';
import type { PanelId } from './state';
import { StickersPanel } from './library/StickersPanel';
import { CategoryBrowser } from './browse';
import { TEXT_STYLE_CATEGORIES, TEXT_STYLE_PRESETS } from './library/textStyles';
import { FilterStrip, TransitionGrid } from './looks';
import { CanvasTool } from './ToolPanel';

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
      return <CanvasTool />;
    case 'filters':
      return <FilterStrip />;
    case 'transitions':
      return <TransitionGrid />;
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
            <button
              type="button"
              className="vu-text-button"
              onClick={() => ctl.dismissImport(row.id)}
            >
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
      <button type="button" className="vu-dropcard" onClick={() => ctl.pickFiles()}>
        <span className="vu-dropcard-icon">
          <Icon name="plus" size={22} />
        </span>
        <span className="vu-dropcard-title">{l.addMedia}</span>
        <span className="vu-dropcard-hint">{l.addMediaHint}</span>
      </button>
      <button
        type="button"
        className="vu-btn vu-wide vu-camera-open"
        data-variant="secondary"
        data-layout="row"
        data-tooltip={l.recordCameraTip}
        onClick={() => ctl.setCameraOpen(true)}
      >
        <Icon name="camera" />
        <span>{l.recordCamera}</span>
      </button>
      <ImportRows />
      {assets.length ? (
        <>
          <p className="vu-hint">{l.tapToAdd}</p>
          <ul className="vu-asset-grid">
            {assets.map((asset) => (
              <li key={asset.id}>
                <AssetTile asset={asset} />
              </li>
            ))}
          </ul>
        </>
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

/** CSS that approximates a text style for the picker tiles (the engine draws the real thing). */
function previewCss(style: TextStyle, sample: string): React.CSSProperties {
  const em = 22;
  // Shrink long samples so they fit the tile (with room for outline, shadow and label box).
  const width =
    sample.length * (0.62 + style.letterSpacing) +
    (style.background ? 2 * style.background.padding : 0);
  const css: React.CSSProperties = {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.italic ? 'italic' : 'normal',
    color: style.color,
    letterSpacing: `${style.letterSpacing}em`,
    fontSize: `min(${em}px, ${(78 / width).toFixed(2)}cqi)`,
  };
  if (style.outline) {
    css.WebkitTextStroke = `${Math.max(1, style.outline.width * em * 2)}px ${style.outline.color}`;
    css.paintOrder = 'stroke fill';
  }
  if (style.shadow)
    css.textShadow = `${style.shadow.x * 0.5}px ${style.shadow.y * 0.5}px ${style.shadow.blur * 0.5}px ${style.shadow.color}`;
  if (style.background) {
    css.background = style.background.color;
    css.padding = `${style.background.padding * em * 0.6}px ${style.background.padding * em}px`;
    css.borderRadius = `${style.background.radius * em}px`;
  }
  return css;
}

function TextPanel() {
  const ctl = useController();
  const l = useLabels();
  const selectedId = useUi((s) => s.selectedId);
  const selected = useProject((p) => {
    const found = selectedId ? findItem(p, selectedId)?.item : null;
    return found && found.kind === 'text' ? found : null;
  });
  const apply = (preset: (typeof TEXT_STYLE_PRESETS)[number]) => {
    if (selected) {
      // Keep the user's size, alignment and line height; take the look.
      const style = {
        ...preset.style,
        size: selected.style.size,
        align: selected.style.align,
        lineHeight: selected.style.lineHeight,
      };
      ctl.run(l.style, (d) => updateItem(d, selected.id, { style }));
      return;
    }
    ctl.addLaneItem(l.addText, (id, start) => {
      const item = textItem(id, start, l.textPlaceholder);
      item.style = { ...preset.style };
      return item;
    });
    ctl.openTool('text-edit');
  };
  return (
    <div className="vu-panel-body">
      <button
        type="button"
        className="vu-btn vu-wide"
        data-variant="primary"
        data-layout="row"
        onClick={() => {
          ctl.addLaneItem(l.addText, (id, start) => textItem(id, start, l.textPlaceholder));
          ctl.openTool('text-edit');
        }}
      >
        <Icon name="plus" />
        <span>{l.addText}</span>
      </button>
      <p className="vu-target" data-active={selected ? '' : undefined}>
        {selected ? l.styleAppliesTo(selected.text.split('\n')[0] || l.text) : l.styleAddsNew}
      </p>
      <CategoryBrowser label={l.category} categories={TEXT_STYLE_CATEGORIES}>
        {(c) => (
          <ul className="vu-textstyle-grid" aria-label={c.label}>
            {TEXT_STYLE_PRESETS.filter((p) => p.category === c.id).map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  className="vu-textstyle"
                  aria-label={preset.label}
                  data-tooltip={preset.label}
                  onClick={() => apply(preset)}
                >
                  <span style={previewCss(preset.style, preset.sample)}>{preset.sample}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CategoryBrowser>
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
        className="vu-btn vu-wide"
        data-variant="primary"
        data-layout="row"
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
  // Without headphones the video's sound would be recorded too: muted while recording by default.
  const [muteWhile, setMuteWhile] = useState(() => {
    try {
      return localStorage.getItem('video-ultra:voiceover-mute') !== '0';
    } catch {
      return true;
    }
  });
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
      ctl.engine?.setOutputMuted(false);
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
    // Play along so the speaker can follow the video — silently unless they chose to hear it.
    ctl.engine?.setOutputMuted(muteWhile);
    ctl.play();
  };

  return (
    <div className="vu-voiceover">
      {recording ? (
        <button
          type="button"
          className="vu-btn vu-wide"
          data-variant="danger-solid"
          data-layout="row"
          onClick={() => recorder.current?.stop()}
        >
          <Icon name="stop" />
          <span>{l.stopRecording}</span>
        </button>
      ) : (
        <button
          type="button"
          className="vu-btn vu-wide"
          data-variant="secondary"
          data-layout="row"
          onClick={() => void start()}
        >
          <Icon name="mic" />
          <span>{l.recordVoiceover}</span>
        </button>
      )}
      {error ? (
        <p className="vu-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        role="switch"
        aria-checked={muteWhile}
        className="vu-switch-row"
        disabled={recording}
        onClick={() => {
          const next = !muteWhile;
          setMuteWhile(next);
          try {
            localStorage.setItem('video-ultra:voiceover-mute', next ? '1' : '0');
          } catch {
            /* not remembered */
          }
        }}
      >
        <span>{l.muteWhileRecording}</span>
        <span className="vu-switch" aria-hidden="true">
          <span className="vu-switch-knob" />
        </span>
      </button>
    </div>
  );
}
