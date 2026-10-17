import {
  findItem,
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
import { IconButton, ToolButton } from './controls';
import { Icon } from './icons';
import { itemTitle, ratioOf, RATIOS } from './items';
import { AddPanel } from './panels';
import type { PanelId, ToolId } from './state';
import { TimelineView } from './timeline/view';
import { ToolPanel } from './ToolPanel';
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
      {onClose ? <IconButton icon="close" label={l.close} onClick={onClose} /> : null}
      <IconButton
        icon="undo"
        label={history.undoLabel ? l.undoWhat(history.undoLabel) : l.undo}
        disabled={!history.canUndo}
        onClick={() => ctl.undo()}
      />
      <IconButton
        icon="redo"
        label={history.redoLabel ? l.redoWhat(history.redoLabel) : l.redo}
        disabled={!history.canRedo}
        onClick={() => ctl.redo()}
      />
      {layout !== 'phone' ? (
        <input
          className="vu-project-name"
          aria-label={l.projectName}
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
      <span className="vu-save-state" aria-live="polite">
        {save === 'saving' ? l.saving : save === 'saved' ? l.saved : ''}
      </span>
      <span className="vu-spacer" />
      <button type="button" className="vu-ratio-button" onClick={() => ctl.openTool('canvas')}>
        <span>{ratio ?? `${width}×${height}`}</span>
        <span className="vu-sr-only">{l.aspectRatio}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      <button
        type="button"
        className="vu-primary"
        onClick={() => ctl.ui.setState({ exportOpen: true })}
      >
        {l.export}
      </button>
    </header>
  );
}

// ── Rail + panel (tablet / desktop) ────────────────────────────────────────

const RAIL: {
  id: PanelId;
  icon: Parameters<typeof Icon>[0]['name'];
  key: 'media' | 'text' | 'audio' | 'stickers' | 'filters' | 'transitions' | 'canvas';
}[] = [
  { id: 'media', icon: 'media', key: 'media' },
  { id: 'text', icon: 'text', key: 'text' },
  { id: 'audio', icon: 'audio', key: 'audio' },
  { id: 'stickers', icon: 'sticker', key: 'stickers' },
  { id: 'filters', icon: 'filter', key: 'filters' },
  { id: 'transitions', icon: 'transition', key: 'transitions' },
  { id: 'canvas', icon: 'canvas', key: 'canvas' },
];

export function Rail(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const panel = useUi((s) => s.panel);
  return (
    <nav className="vu-rail" aria-label={l.media}>
      {RAIL.map((entry) => (
        <ToolButton
          key={entry.id}
          icon={entry.icon}
          label={l[entry.key]}
          active={panel === entry.id}
          pressed={panel === entry.id}
          onClick={() => ctl.openPanel(panel === entry.id ? null : entry.id)}
        />
      ))}
    </nav>
  );
}

export function Panel(): ReactElement | null {
  const l = useLabels();
  const panel = useUi((s) => s.panel);
  if (!panel) return null;
  const title = RAIL.find((r) => r.id === panel)!;
  return (
    <aside className="vu-panel" aria-label={l[title.key]}>
      <h2 className="vu-panel-title">{l[title.key]}</h2>
      <AddPanel panel={panel} />
    </aside>
  );
}

// ── Inspector (desktop) ────────────────────────────────────────────────────

const TOOL_TITLES: Partial<
  Record<
    ToolId,
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
  >
> = {
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
};

/** Desktop: the selected item's settings, all tools stacked; or the canvas settings. */
export function Inspector(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const selectedId = useUi((s) => s.selectedId);
  const tool = useUi((s) => s.tool);
  const item = useProject((p) => (selectedId ? (findItem(p, selectedId)?.item ?? null) : null));
  const project = ctl.project;
  const tools = item ? toolsFor(item, project, ctl, l).filter((t) => t.tool) : [];
  const active: ToolId = tool ?? (item ? (tools[0]?.tool ?? 'canvas') : 'canvas');
  return (
    <aside className="vu-inspector" aria-label={item ? itemTitle(item, project.assets) : l.canvas}>
      <h2 className="vu-panel-title">{item ? itemTitle(item, project.assets) : l.canvas}</h2>
      {item ? (
        <div className="vu-tabs" role="tablist">
          {tools.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.tool === active}
              className="vu-tab"
              onClick={() => ctl.ui.setState({ tool: t.tool! })}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="vu-inspector-body"
        role="tabpanel"
        aria-label={l[TOOL_TITLES[active] ?? 'canvas']}
      >
        <ToolPanel tool={active} />
      </div>
    </aside>
  );
}

// ── Transport ──────────────────────────────────────────────────────────────

/** Play/pause and timecode. The timecode updates through a playhead subscription, not React. */
export function Transport({
  stageRef,
}: {
  stageRef: React.RefObject<HTMLElement | null>;
}): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const playing = useUi((s) => s.playing);
  const duration = useProject((p) => projectDuration(p));
  const timeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = timeRef.current!;
    const update = (t: number) => {
      el.textContent = formatTime(t);
    };
    update(ctl.playhead.time);
    return ctl.playhead.subscribe(update);
  }, [ctl]);
  return (
    <div className="vu-transport">
      <button
        type="button"
        className="vu-play"
        aria-label={playing ? l.pause : l.play}
        aria-keyshortcuts="Space"
        disabled={duration === 0}
        onClick={() => ctl.togglePlay()}
      >
        <Icon name={playing ? 'pause' : 'play'} size={22} />
      </button>
      <span className="vu-timecode" aria-label={l.timecode('', formatTime(duration))}>
        <span ref={timeRef} />
        <span className="vu-timecode-total"> / {formatTime(duration)}</span>
      </span>
      <span className="vu-spacer" />
      <IconButton
        icon="fullscreen"
        label={l.fullscreen}
        onClick={() => {
          const el = stageRef.current;
          if (document.fullscreenElement) void document.exitFullscreen();
          else void el?.requestFullscreen?.().catch(() => {});
        }}
      />
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
  const l = useLabels();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<TimelineView | null>(null);
  const theme = useUi((s) => s.layout);
  useEffect(() => {
    const view = new TimelineView(rootRef.current!, canvasRef.current!, ctl, {
      onAddMedia: () => ctl.pickFiles(),
    });
    viewRef.current = view;
    // Theme changes (data attribute or OS setting) re-read the colour tokens.
    const media = matchMedia('(prefers-color-scheme: light)');
    const onTheme = () => view.refreshTheme();
    media.addEventListener('change', onTheme);
    const mo = new MutationObserver(onTheme);
    mo.observe(rootRef.current!, { attributes: true, attributeFilter: ['data-vu-theme', 'style'] });
    return () => {
      media.removeEventListener('change', onTheme);
      mo.disconnect();
      view.destroy();
      viewRef.current = null;
    };
  }, [ctl, rootRef]);
  void theme;
  return (
    <div className="vu-timeline" ref={hostRef}>
      <div className="vu-timeline-canvas">
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      <TimelineA11y onReveal={(item) => viewRef.current?.reveal(item)} />
      <div className="vu-zoom">
        <IconButton
          icon="zoomOut"
          label={l.zoomOut}
          onClick={() => viewRef.current?.zoomBy(1 / 1.5)}
        />
        <IconButton icon="zoomIn" label={l.zoomIn} onClick={() => viewRef.current?.zoomBy(1.5)} />
      </div>
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

// ── Toolbar + sheet (phone / tablet), timeline header tools (desktop) ─────

export function Toolbar(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const selectedId = useUi((s) => s.selectedId);
  const { tool, panel, sheetPanel } = useUi((s) => ({
    tool: s.tool,
    panel: s.panel,
    sheetPanel: s.sheetPanel,
  }));
  const layout = useUi((s) => s.layout);
  const item = useProject((p) => (selectedId ? (findItem(p, selectedId)?.item ?? null) : null));
  const project = ctl.project;
  const entries = toolsFor(item, project, ctl, l);
  const phone = layout !== 'desktop';
  return (
    <div
      className="vu-toolbar"
      role="toolbar"
      aria-label={item ? itemTitle(item, project.assets) : l.addMedia}
    >
      {item && phone ? (
        <IconButton icon="back" label={l.done} onClick={() => ctl.select(null)} />
      ) : null}
      {entries.map((entry) => {
        const active = entry.tool
          ? tool === entry.tool
          : entry.panel
            ? phone && panel === entry.panel && sheetPanel
            : false;
        return (
          <ToolButton
            key={entry.key}
            icon={entry.icon}
            label={entry.label}
            active={active}
            danger={entry.danger ?? false}
            onClick={() => {
              if (entry.run) entry.run();
              else if (entry.tool) ctl.openTool(entry.tool);
              else if (entry.panel) {
                if (phone) {
                  const open = sheetPanel && panel === entry.panel;
                  ctl.ui.setState({ panel: entry.panel, tool: null, sheetPanel: !open });
                } else ctl.openPanel(entry.panel);
              }
            }}
          />
        );
      })}
    </div>
  );
}

/** Phone / tablet: a tool's controls (or an add panel) above the toolbar. Never a modal. */
export function Sheet(): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const tool = useUi((s) => s.tool);
  const panel = useUi((s) => s.panel);
  const sheetPanel = useUi((s) => s.sheetPanel);
  const showPanel = !tool && sheetPanel && panel;
  if (!tool && !showPanel) return null;
  const close = () => ctl.ui.setState({ tool: null, sheetPanel: false });
  const title = tool ? l[TOOL_TITLES[tool] ?? 'edit'] : l[RAIL.find((r) => r.id === panel)!.key];
  return (
    <section className="vu-sheet" aria-label={title}>
      <div className="vu-sheet-head">
        <h2 className="vu-panel-title">{title}</h2>
        <button type="button" className="vu-done" onClick={close}>
          <Icon name="check" size={18} />
          <span>{l.done}</span>
        </button>
      </div>
      <div className="vu-sheet-body">
        {tool ? <ToolPanel tool={tool} /> : <AddPanel panel={panel!} />}
      </div>
    </section>
  );
}

// ── Toasts ─────────────────────────────────────────────────────────────────

export function Toasts(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="vu-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="vu-toast" data-tone={t.tone}>
          <span>{t.message}</span>
          <button type="button" className="vu-link" onClick={() => ctl.dismissToast(t.id)}>
            {l.dismiss}
          </button>
        </div>
      ))}
    </div>
  );
}

export { RATIOS };
