import {
  findItem,
  FLICKS_PER_SECOND,
  formatTime,
  itemEnd,
  moveItem,
  projectDuration,
  projectFrame,
  renameProject,
  reorderMain,
  trimItem,
  type Item,
} from '@video-ultra/core';
import { useEffect, useRef, type ReactElement } from 'react';
import { useController, useHistory, useLabels, useProject, useUi } from './context';
import { Button, IconButton, Section, ToolButton } from './controls';
import { formatClock } from './format';
import { Icon, type IconName } from './icons';
import { itemTitle, ratioOf } from './items';
import { AddPanel } from './panels';
import type { PanelId, ToolId } from './state';
import { useTargets } from './targets';
import { clampPps, MAX_PPS, MIN_PPS } from './timeline/geometry';
import { TimelineView } from './timeline/view';
import { CanvasTool, InspectorSections, ToolPanel } from './ToolPanel';
import { toolsFor } from './tools';

// ── Top bar ─────────────────────────────────────────────────────────────────

export function TopBar({ onClose }: { onClose?: (() => void) | undefined }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const history = useHistory();
  const { name, width, height } = useProject((p) => ({
    name: p.name,
    width: p.settings.width,
    height: p.settings.height,
  }));
  const save = useUi((s) => s.save);
  const layout = useUi((s) => s.layout);
  const ratio = ratioOf(width, height);
  return (
    <header className="vu-topbar">
      <div className="vu-topbar-start">
        {onClose ? <IconButton icon="close" label={l.close} onClick={onClose} /> : null}
        {layout !== 'phone' ? (
          <input
            className="vu-project-name"
            aria-label={l.projectName}
            data-tooltip={l.renameTip}
            defaultValue={name}
            key={name}
            onBlur={(e) => {
              const value = e.currentTarget.value;
              if (value !== name) ctl.run(l.projectName, (d) => renameProject(d, value));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        ) : null}
        {save !== 'idle' && layout !== 'phone' ? (
          <span
            className="vu-save-state"
            data-state={save}
            aria-live="polite"
            data-tooltip={save === 'saved' ? l.savedTip : undefined}
          >
            {save === 'saving' ? (
              <span className="vu-spinner" aria-hidden="true" />
            ) : (
              <Icon name="check" size={14} />
            )}
            <span>{save === 'saving' ? l.saving : l.saved}</span>
          </span>
        ) : null}
      </div>
      <div className="vu-topbar-center">
        <IconButton
          icon="undo"
          label={l.undo}
          tip={history.undoLabel ? l.undoWhat(history.undoLabel) : l.undo}
          shortcut="⌘Z"
          disabledReason={history.canUndo ? null : l.nothingToUndo}
          onClick={() => ctl.undo()}
        />
        <IconButton
          icon="redo"
          label={l.redo}
          tip={history.redoLabel ? l.redoWhat(history.redoLabel) : l.redo}
          shortcut="⇧⌘Z"
          disabledReason={history.canRedo ? null : l.nothingToRedo}
          onClick={() => ctl.redo()}
        />
      </div>
      <div className="vu-topbar-end">
        <Button
          icon="canvas"
          label={ratio ?? `${width}×${height}`}
          tip={l.tipCanvas}
          className="vu-ratio-button"
          onClick={() => ctl.openCanvasSettings()}
        />
        {layout !== 'phone' ? (
          <IconButton
            icon="help"
            label={l.shortcuts}
            tip={l.tipHelp}
            shortcut="?"
            onClick={() => ctl.ui.setState({ helpOpen: true })}
          />
        ) : null}
        <Button
          icon="download"
          label={l.export}
          variant="primary"
          tip={l.tipExport}
          onClick={() => ctl.ui.setState({ exportOpen: true })}
        />
      </div>
    </header>
  );
}

// ── Rail + panel ───────────────────────────────────────────────────────────

const RAIL: {
  id: PanelId;
  icon: IconName;
  key: 'media' | 'text' | 'audio' | 'stickers' | 'filters' | 'transitions';
  tip: 'tipAddMedia' | 'tipText' | 'tipAudio' | 'tipStickers' | 'tipFilter' | 'tipTransitions';
}[] = [
  { id: 'media', icon: 'media', key: 'media', tip: 'tipAddMedia' },
  { id: 'text', icon: 'text', key: 'text', tip: 'tipText' },
  { id: 'audio', icon: 'audio', key: 'audio', tip: 'tipAudio' },
  { id: 'stickers', icon: 'sticker', key: 'stickers', tip: 'tipStickers' },
  { id: 'filters', icon: 'filter', key: 'filters', tip: 'tipFilter' },
  { id: 'transitions', icon: 'transition', key: 'transitions', tip: 'tipTransitions' },
];

export function Rail(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const panel = useUi((s) => s.panel);
  return (
    <nav className="vu-rail" aria-label={l.addContent}>
      {RAIL.map((entry) => (
        <ToolButton
          key={entry.id}
          icon={entry.icon}
          label={l[entry.key]}
          tip={l[entry.tip]}
          active={panel === entry.id}
          pressed={panel === entry.id}
          onClick={() => ctl.openPanel(panel === entry.id ? null : entry.id)}
        />
      ))}
    </nav>
  );
}

export function Panel(): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const panel = useUi((s) => s.panel);
  if (!panel) return null;
  const entry = RAIL.find((r) => r.id === panel);
  const title = entry ? l[entry.key] : l.canvas;
  return (
    <aside className="vu-panel" aria-label={title}>
      <div className="vu-panel-head">
        <h2 className="vu-panel-title">{title}</h2>
        <IconButton icon="close" label={l.closePanel} onClick={() => ctl.openPanel(null)} />
      </div>
      <div className="vu-panel-scroll">
        <AddPanel panel={panel} />
      </div>
    </aside>
  );
}

// ── Inspector (desktop) ────────────────────────────────────────────────────

const KIND_ICON: Record<Item['kind'], IconName> = {
  video: 'media',
  image: 'image',
  freeze: 'freeze',
  audio: 'audio',
  text: 'text',
  sticker: 'sticker',
};

/** Desktop: the selected item's settings; with nothing selected, the video's own settings. */
export function Inspector(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const selectedId = useUi((s) => s.selectedId);
  const item = useProject((p) => (selectedId ? (findItem(p, selectedId)?.item ?? null) : null));
  const clips = useProject((p) => p.tracks.reduce((n, t) => n + t.items.length, 0));
  if (!item) {
    return (
      <aside className="vu-inspector" aria-label={l.projectSettings}>
        <div className="vu-panel-head">
          <h2 className="vu-panel-title">{l.projectSettings}</h2>
        </div>
        <div className="vu-panel-scroll">
          <Section>
            <CanvasTool />
          </Section>
          {clips < 3 ? (
            <Section title={l.howTo}>
              <ol className="vu-steps">
                {l.howToSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </Section>
          ) : null}
        </div>
      </aside>
    );
  }
  const name = itemTitle(item, ctl.project.assets);
  return (
    <aside className="vu-inspector" aria-label={name}>
      <div className="vu-panel-head">
        <span className="vu-kind-badge" data-kind={item.kind}>
          <Icon name={KIND_ICON[item.kind]} size={16} />
        </span>
        <div className="vu-inspector-title">
          <h2 className="vu-panel-title">{name}</h2>
          <span className="vu-inspector-meta">
            {l.kindName(item.kind)} · {(item.duration / FLICKS_PER_SECOND).toFixed(1)} s
          </span>
        </div>
        <IconButton
          icon="close"
          label={l.deselect}
          shortcut="Esc"
          onClick={() => ctl.select(null)}
        />
      </div>
      <div className="vu-panel-scroll" key={item.id}>
        <InspectorSections item={item} />
      </div>
    </aside>
  );
}

// ── Transport ──────────────────────────────────────────────────────────────

/** The live timecode: updates through a playhead subscription, never React. */
function Clock() {
  const ctl = useController();
  const duration = useProject((p) => projectDuration(p));
  const timeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = timeRef.current!;
    let shown = '';
    const update = (t: number) => {
      const text = formatClock(t);
      if (text !== shown) el.textContent = shown = text;
    };
    update(ctl.playhead.time);
    return ctl.playhead.subscribe(update);
  }, [ctl]);
  return (
    <span className="vu-timecode">
      <span ref={timeRef} className="vu-timecode-now" />
      <span className="vu-timecode-total">{formatClock(duration)}</span>
    </span>
  );
}

function PlayButton() {
  const ctl = useController();
  const l = useLabels();
  const playing = useUi((s) => s.playing);
  const duration = useProject((p) => projectDuration(p));
  return (
    <button
      type="button"
      className="vu-play"
      aria-label={playing ? l.pause : l.play}
      aria-keyshortcuts="Space"
      aria-disabled={duration === 0 || undefined}
      data-tooltip={duration === 0 ? l.needClips : `${playing ? l.pause : l.play}  ·  Space`}
      onClick={() => {
        if (duration > 0) ctl.togglePlay();
      }}
    >
      <Icon name={playing ? 'pause' : 'play'} size={22} />
    </button>
  );
}

/** Desktop/tablet bar above the timeline: play, time, clip actions, zoom. */
export function TimelineBar(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const targets = useTargets();
  const pps = useUi((s) => s.pxPerSecond);
  const desktop = useUi((s) => s.layout === 'desktop');
  // Zoom slider works on a log scale so both ends feel the same.
  const zoom = Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS);
  return (
    <div className="vu-timeline-bar">
      <div className="vu-bar-start">
        <PlayButton />
        <Clock />
      </div>
      {desktop ? (
        <div className="vu-bar-actions" role="toolbar" aria-label={l.clipActions}>
          <Button
            icon="split"
            label={l.split}
            tip={l.tipSplit}
            shortcut="S"
            disabledReason={targets.split.reason}
            onClick={() => ctl.split()}
          />
          <Button
            icon="duplicate"
            label={l.duplicate}
            tip={l.tipDuplicate}
            shortcut="⌘D"
            disabledReason={targets.selection.reason}
            onClick={() => ctl.duplicateSelected()}
          />
          <Button
            icon="freeze"
            label={l.freeze}
            tip={l.tipFreeze}
            disabledReason={targets.freeze.reason}
            onClick={() => ctl.freezeSelected()}
          />
          <Button
            icon="delete"
            label={l.delete}
            tip={l.tipDelete}
            shortcut="Del"
            variant="danger"
            disabledReason={targets.selection.reason}
            onClick={() => ctl.deleteSelected()}
          />
        </div>
      ) : null}
      <div className="vu-bar-end">
        <IconButton
          icon="fullscreen"
          label={l.previewMode}
          tip={l.tipPreview}
          onClick={() => ctl.setPreviewMode(true)}
        />
        <div className="vu-zoom">
          <IconButton icon="zoomOut" label={l.zoomOut} onClick={() => ctl.zoom(1 / 1.5)} />
          <input
            className="vu-slider vu-zoom-slider"
            type="range"
            min={0}
            max={1}
            step={0.001}
            aria-label={l.tipZoom}
            data-tooltip={l.tipZoom}
            value={zoom}
            style={{
              ['--vu-fill-from' as string]: '0%',
              ['--vu-fill-to' as string]: `${zoom * 100}%`,
            }}
            onChange={(e) =>
              ctl.ui.setState({
                pxPerSecond: clampPps(
                  MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, Number(e.currentTarget.value)),
                ),
              })
            }
          />
          <IconButton icon="zoomIn" label={l.zoomIn} onClick={() => ctl.zoom(1.5)} />
        </div>
      </div>
    </div>
  );
}

/** Phone: play, time and preview above the timeline. */
export function PhoneTransport(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  return (
    <div className="vu-timeline-bar" data-compact="">
      <div className="vu-bar-start">
        <PlayButton />
        <Clock />
      </div>
      <div className="vu-bar-end">
        <Button
          icon="fullscreen"
          label={l.previewMode}
          tip={l.tipPreview}
          onClick={() => ctl.setPreviewMode(true)}
        />
      </div>
    </div>
  );
}

// ── Timeline ───────────────────────────────────────────────────────────────

export function Timeline({
  rootRef,
}: {
  rootRef: React.RefObject<HTMLElement | null>;
}): ReactElement {
  const ctl = useController();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<TimelineView | null>(null);
  useEffect(() => {
    const view = new TimelineView(rootRef.current!, canvasRef.current!, ctl, {
      onAddMedia: () => ctl.pickFiles(),
    });
    viewRef.current = view;
    const offZoom = ctl.setZoomHandler((factor) => view.zoomBy(factor));
    const media = matchMedia('(prefers-color-scheme: light)');
    const onTheme = () => view.refreshTheme();
    media.addEventListener('change', onTheme);
    const mo = new MutationObserver(onTheme);
    mo.observe(rootRef.current!, { attributes: true, attributeFilter: ['data-vu-theme', 'style'] });
    return () => {
      offZoom();
      media.removeEventListener('change', onTheme);
      mo.disconnect();
      view.destroy();
      viewRef.current = null;
    };
  }, [ctl, rootRef]);
  return (
    <div className="vu-timeline">
      <div className="vu-timeline-canvas">
        <canvas ref={canvasRef} aria-hidden="true" data-tooltip-follow="" />
      </div>
      <TimelineA11y onReveal={(item) => viewRef.current?.reveal(item)} />
    </div>
  );
}

/**
 * The canvas timeline's accessible layer (DECISIONS #25): every clip is a focusable item with a
 * label. Arrows move (main track: reorder), Shift + arrows trim the end, Delete removes.
 * Re-renders on project changes only — never per frame.
 */
function TimelineA11y({ onReveal }: { onReveal: (item: Item) => void }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const tracks = useProject((p) => p.tracks);
  const assets = useProject((p) => p.assets);
  const selectedId = useUi((s) => s.selectedId);
  const onKey = (e: React.KeyboardEvent, item: Item, trackKind: string, index: number) => {
    const frame = projectFrame(ctl.project);
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dir !== 0) {
      e.preventDefault();
      e.stopPropagation();
      const amount = (e.altKey ? 30 : 1) * frame * dir;
      if (e.shiftKey) ctl.run(l.edit, (d) => trimItem(d, item.id, 'end', amount));
      else if (trackKind === 'main') ctl.run(l.edit, (d) => reorderMain(d, item.id, index + dir));
      else
        ctl.run(l.edit, (d, ctx) =>
          moveItem(d, item.id, Math.max(0, item.start + amount), ctx.ids),
        );
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      ctl.select(item.id);
      ctl.deleteSelected();
    }
  };
  let n = 0;
  return (
    <div
      className="vu-sr-only"
      role="group"
      aria-label={l.timeline}
      aria-description={l.timelineHelp}
    >
      {tracks.map((track, ti) => {
        const sound = track.kind === 'main' || track.kind === 'audio';
        const name =
          ti === 0 ? l.mainTrack : l.lane(l.kind[track.items[0]?.kind ?? 'video'] ?? '', ti);
        return (
          <div key={track.id} role="group" aria-label={name}>
            <button
              type="button"
              aria-pressed={sound ? track.muted : track.hidden}
              onClick={() => ctl.toggleTrack(track.id)}
            >
              {sound ? l.muteTrack(name) : l.hideTrack(name)}
            </button>
            <div role="listbox" aria-label={name}>
              {track.items.map((item, index) => {
                n++;
                return (
                  <div
                    key={item.id}
                    role="option"
                    tabIndex={selectedId === item.id || (selectedId === null && n === 1) ? 0 : -1}
                    aria-selected={selectedId === item.id}
                    aria-label={`${l.clipLabel(index + 1, l.kind[item.kind] ?? item.kind, formatTime(item.start), formatTime(itemEnd(item)))}: ${itemTitle(item, assets)}`}
                    onFocus={() => {
                      ctl.select(item.id);
                      ctl.seek(item.start);
                      onReveal(item);
                    }}
                    onKeyDown={(e) => onKey(e, item, track.kind, index)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Phone / tablet: toolbar + dock ────────────────────────────────────────

/** The contextual toolbar (phone/tablet): add tools, or the selected clip's tools. */
export function Toolbar(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const targets = useTargets();
  const selectedId = useUi((s) => s.selectedId);
  const { tool, panel, sheetPanel } = useUi((s) => ({
    tool: s.tool,
    panel: s.panel,
    sheetPanel: s.sheetPanel,
  }));
  const item = useProject((p) => (selectedId ? (findItem(p, selectedId)?.item ?? null) : null));
  const entries = toolsFor(item, ctl.project, ctl, l, targets);
  return (
    <div
      className="vu-toolbar"
      role="toolbar"
      aria-label={item ? itemTitle(item, ctl.project.assets) : l.addContent}
    >
      {item ? (
        <>
          <ToolButton
            icon="back"
            label={l.back}
            tip={l.deselect}
            onClick={() => ctl.select(null)}
          />
          <span className="vu-toolbar-divider" aria-hidden="true" />
        </>
      ) : null}
      {entries.map((entry) => {
        const active = entry.tool
          ? tool === entry.tool
          : entry.panel
            ? sheetPanel && panel === entry.panel
            : false;
        return (
          <ToolButton
            key={entry.key}
            icon={entry.icon}
            label={entry.label}
            {...(entry.tip ? { tip: entry.tip } : {})}
            active={active}
            danger={entry.danger ?? false}
            disabledReason={entry.disabledReason ?? null}
            onClick={() => {
              if (entry.run) entry.run();
              else if (entry.tool) ctl.openTool(entry.tool);
              else if (entry.panel) {
                const open = sheetPanel && panel === entry.panel;
                ctl.ui.setState({ panel: entry.panel, tool: null, sheetPanel: !open });
              }
            }}
          />
        );
      })}
    </div>
  );
}

type TitleKey =
  | 'speed'
  | 'volume'
  | 'fade'
  | 'filter'
  | 'adjust'
  | 'crop'
  | 'rotate'
  | 'transition'
  | 'edit'
  | 'style'
  | 'opacity'
  | 'duration'
  | 'canvas'
  | 'text'
  | 'stickers'
  | 'audio'
  | 'media'
  | 'animate';

const TOOL_TITLE: Record<ToolId, TitleKey> = {
  speed: 'speed',
  volume: 'volume',
  fade: 'fade',
  filter: 'filter',
  adjust: 'adjust',
  crop: 'crop',
  transform: 'rotate',
  transition: 'transition',
  'text-edit': 'edit',
  'text-style': 'style',
  opacity: 'opacity',
  duration: 'duration',
  canvas: 'canvas',
  'add-text': 'text',
  'add-sticker': 'stickers',
  'add-audio': 'audio',
  'add-media': 'media',
  animate: 'animate',
};

/**
 * Phone/tablet: a tool's controls (or an add panel) docked exactly over the timeline area — the
 * same box, never a second floating panel — with an obvious Done.
 */
export function Dock(): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const tool = useUi((s) => s.tool);
  const panel = useUi((s) => s.panel);
  const sheetPanel = useUi((s) => s.sheetPanel);
  const showPanel = !tool && sheetPanel && panel;
  if (!tool && !showPanel) return null;
  const close = () => ctl.ui.setState({ tool: null, sheetPanel: false });
  const entry = RAIL.find((r) => r.id === panel);
  const title = tool ? l[TOOL_TITLE[tool]] : entry ? l[entry.key] : l.canvas;
  return (
    <section
      className="vu-dock"
      aria-label={title}
      // Libraries (text styles, stickers, filters…) need room; quick tools fit the timeline's box.
      data-tall={
        !tool ||
        tool === 'filter' ||
        tool === 'transition' ||
        tool === 'text-style' ||
        tool === 'animate' ||
        undefined
      }
    >
      <div className="vu-dock-head">
        <h2 className="vu-dock-title">{title}</h2>
        <button type="button" className="vu-done" onClick={close}>
          <Icon name="check" size={18} />
          <span>{l.done}</span>
        </button>
      </div>
      <div className="vu-dock-body">
        {tool ? <ToolPanel tool={tool} /> : <AddPanel panel={panel!} />}
      </div>
    </section>
  );
}

// ── Toasts, help, preview ─────────────────────────────────────────────────

export function Toasts(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="vu-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="vu-toast" data-tone={t.tone}>
          {t.tone === 'success' ? (
            <Icon name="check" size={16} />
          ) : t.tone === 'error' ? (
            <Icon name="warning" size={16} />
          ) : null}
          <span className="vu-toast-text">{t.message}</span>
          {t.action ? (
            <button
              type="button"
              className="vu-toast-action"
              onClick={() => {
                t.action!.run();
                ctl.dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="vu-toast-close"
            aria-label={l.dismiss}
            onClick={() => ctl.dismissToast(t.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Keyboard shortcuts and how-to (the "?" button). */
export function HelpSheet(): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const open = useUi((s) => s.helpOpen);
  if (!open) return null;
  const close = () => ctl.ui.setState({ helpOpen: false });
  return (
    <div
      className="vu-modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="vu-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vu-help-title"
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className="vu-modal-head">
          <h2 id="vu-help-title" className="vu-modal-title">
            {l.shortcuts}
          </h2>
          <IconButton icon="close" label={l.close} onClick={close} />
        </div>
        <dl className="vu-shortcuts">
          {l.shortcutList.map(([keys, what]) => (
            <div key={keys} className="vu-shortcut">
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <Section title={l.howTo}>
          <ol className="vu-steps">
            {l.howToSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}

/** Preview mode: only the video and play controls (iPhone has no element fullscreen). */
export function PreviewBar(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  return (
    <div className="vu-preview-bar">
      <PlayButton />
      <Clock />
      <span className="vu-spacer" />
      <Button
        icon="close"
        label={l.exitPreview}
        variant="secondary"
        onClick={() => ctl.setPreviewMode(false)}
      />
    </div>
  );
}
