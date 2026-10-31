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
import { VideosPopover } from './videos';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useHistory, useLabels, useProject, useUi } from './context';
import { Button, IconButton, Ruler, Section, ToolButton } from './controls';
import { formatClock } from './format';
import { Icon, type IconName, type IconSpec } from './icons';
import { inHostOrder, isHidden } from './embed';
import type { EditorController } from './controller';
import type { Labels } from './labels';
import { itemTitle, kindLabel, ratioOf } from './items';
import { AddPanel } from './panels';
import type { PanelId, ToolId } from './state';
import { useTargets } from './targets';
import { clampPps, MAX_PPS, MIN_PPS } from './timeline/geometry';
import { TimelineView } from './timeline/view';
import { CanvasTool, InspectorSections, ToolPanel } from './ToolPanel';
import { toolsFor } from './tools';
import { LevelMeter } from './meter';
import { ScopesView } from './scopes';
import { ArrangeControls, CommandButton, LockedNote, SelectionInspector } from './organize';

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
  const readOnly = useUi((s) => s.readOnly);
  const layout = useUi((s) => s.layout);
  const videosOpen = useUi((s) => s.videosOpen);
  const layersOpen = useUi(
    (s) => s.panel === 'layers' && (s.layout !== 'phone' || (s.sheetPanel && !s.tool)),
  );
  const historyOpen = useUi(
    (s) => s.panel === 'history' && (s.layout !== 'phone' || (s.sheetPanel && !s.tool)),
  );
  const ratio = ratioOf(width, height);
  return (
    <header className="vu-topbar">
      <div className="vu-topbar-start">
        {onClose ? <IconButton icon="close" label={l.close} onClick={onClose} /> : null}
        {ctl.options.autosave !== false && !isHidden(ctl.options.customize, 'videos') ? (
          <span className="vu-popover-anchor vu-videos-anchor" data-videos-toggle="">
            <IconButton
              icon="videos"
              label={l.yourVideos}
              tip={l.tipYourVideos}
              pressed={videosOpen}
              onClick={() => ctl.ui.setState({ videosOpen: !videosOpen, menu: null })}
            />
            <VideosPopover />
          </span>
        ) : null}
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
        {readOnly && layout !== 'phone' ? (
          <span className="vu-save-state" data-state="off">
            <Icon name="warning" size={14} />
            <span>{l.notSavedHere}</span>
          </span>
        ) : save !== 'idle' && layout !== 'phone' ? (
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
        <span className="vu-topbar-divider" aria-hidden="true" />
        <IconButton
          icon="history"
          label={l.history}
          tip={l.tipHistory}
          pressed={historyOpen}
          onClick={() => ctl.toggleSidePanel('history')}
        />
        <IconButton
          icon="layers"
          label={l.layers}
          tip={l.tipLayers}
          pressed={layersOpen}
          onClick={() => ctl.toggleSidePanel('layers')}
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
        {ctl.options.customize?.buttons?.map((b) => (
          <Button
            key={b.id}
            {...(b.icon ? { icon: { path: b.icon } } : {})}
            label={b.label}
            variant={b.variant ?? 'secondary'}
            className="vu-host-button"
            onClick={() => b.onClick(ctl)}
          />
        ))}
        <Button
          icon="download"
          label={l.export}
          variant="primary"
          className="vu-export-button"
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
  key:
    | 'media'
    | 'templates'
    | 'text'
    | 'audio'
    | 'stickers'
    | 'filters'
    | 'transitions'
    | 'blurAreas'
    | 'captions'
    | 'assistant';
  tip:
    | 'tipAddMedia'
    | 'tipText'
    | 'tipAudio'
    | 'tipStickers'
    | 'tipFilter'
    | 'tipTransitions'
    | 'tipBlurAreas'
    | 'tipCaptions'
    | 'tipTemplates'
    | 'tipAssistant';
}[] = [
  { id: 'media', icon: 'media', key: 'media', tip: 'tipAddMedia' },
  { id: 'templates', icon: 'template', key: 'templates', tip: 'tipTemplates' },
  { id: 'text', icon: 'text', key: 'text', tip: 'tipText' },
  { id: 'captions', icon: 'captions', key: 'captions', tip: 'tipCaptions' },
  { id: 'audio', icon: 'audio', key: 'audio', tip: 'tipAudio' },
  { id: 'stickers', icon: 'sticker', key: 'stickers', tip: 'tipStickers' },
  { id: 'filters', icon: 'filter', key: 'filters', tip: 'tipFilter' },
  { id: 'transitions', icon: 'transition', key: 'transitions', tip: 'tipTransitions' },
  { id: 'blur', icon: 'blurArea', key: 'blurAreas', tip: 'tipBlurAreas' },
  // Only when the host gives the editor an assistant (railEntries).
  { id: 'assistant', icon: 'sparkle', key: 'assistant', tip: 'tipAssistant' },
];

/** The left menu: built-in panels the host didn't hide, the host's own panels, in its order. */
export function railEntries(
  ctl: EditorController,
  l: Labels,
): { id: PanelId; icon: IconSpec; label: string; tip: string }[] {
  const customize = ctl.options.customize;
  const entries = [
    ...RAIL.filter(
      (r) => !isHidden(customize, r.id) && (r.id !== 'assistant' || !!ctl.options.assistant),
    ).map((r) => ({
      id: r.id as PanelId,
      icon: r.icon as IconSpec,
      label: l[r.key],
      tip: l[r.tip],
    })),
    ...(customize?.panels ?? []).map((p) => ({
      id: `custom:${p.id}` as PanelId,
      icon: { path: p.icon } as IconSpec,
      label: p.label,
      tip: p.tip ?? p.label,
    })),
  ];
  // The host names its panels by their own id in `railOrder`.
  const order = customize?.railOrder?.map((id) =>
    customize.panels?.some((p) => p.id === id) ? `custom:${id}` : id,
  );
  return inHostOrder(entries, order);
}

export function Rail(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const panel = useUi((s) => s.panel);
  return (
    <nav className="vu-rail" aria-label={l.addContent}>
      {railEntries(ctl, l).map((entry) => (
        <ToolButton
          key={entry.id}
          icon={entry.icon}
          label={entry.label}
          tip={entry.tip}
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
  // Each panel keeps its own scroll place (a fresh box per panel, so one panel's place never
  // carries over to the next); a panel opened for the first time starts at the top.
  const places = useRef(new Map<string, number>());
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (panel && scroller.current) scroller.current.scrollTop = places.current.get(panel) ?? 0;
  }, [panel]);
  if (!panel) return null;
  const entry = RAIL.find((r) => r.id === panel);
  const custom = ctl.options.customize?.panels?.find((p) => `custom:${p.id}` === panel);
  const title = custom
    ? custom.label
    : entry
      ? l[entry.key]
      : panel === 'layers'
        ? l.layers
        : panel === 'history'
          ? l.history
          : l.canvas;
  return (
    <aside className="vu-panel" aria-label={title}>
      <div className="vu-panel-head">
        <h2 className="vu-panel-title">{title}</h2>
        <IconButton icon="close" label={l.closePanel} onClick={() => ctl.openPanel(null)} />
      </div>
      <div
        className="vu-panel-scroll"
        key={panel}
        ref={scroller}
        onScroll={(e) => places.current.set(panel, e.currentTarget.scrollTop)}
      >
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
  region: 'blurArea',
};

/** Desktop: the selected item's settings; with nothing selected, the video's own settings. */
export function Inspector(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const selectedId = useUi((s) => s.selectedId);
  const several = useUi((s) => s.selectedIds.length > 1);
  const item = useProject((p) => (selectedId ? (findItem(p, selectedId)?.item ?? null) : null));
  const locked = useProject((p) => {
    const found = selectedId ? findItem(p, selectedId) : null;
    return !!found && (!!found.item.locked || found.track.locked);
  });
  const clips = useProject((p) => p.tracks.reduce((n, t) => n + t.items.length, 0));
  if (several) return <SelectionInspector />;
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
          {clips > 0 ? (
            <Section title={l.scopes} collapsible defaultOpen={false}>
              <ScopesView />
            </Section>
          ) : null}
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
            {ctl.isCombined(item) ? l.combinedKind : kindLabel(l, item.kind, true)} ·{' '}
            {(item.duration / FLICKS_PER_SECOND).toFixed(1)} s
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
        <LockedNote item={item} />
        <div
          className="vu-inspector-body"
          inert={locked || undefined}
          data-locked={locked || undefined}
        >
          <InspectorSections item={item} />
        </div>
        <Section title={l.arrange}>
          <ArrangeControls />
        </Section>
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
  // Re-render when what the actions act on changes (the buttons compute their state then).
  useTargets();
  useUi((s) => s.selectedIds);
  useProject((p) => p.tracks);
  const pps = useUi((s) => s.pxPerSecond);
  const desktop = useUi((s) => s.layout === 'desktop');
  // Zoom slider works on a log scale so both ends feel the same.
  const zoom = Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS);
  return (
    <div className="vu-timeline-bar">
      <div className="vu-bar-start">
        <PlayButton />
        <Clock />
        {desktop ? <LevelMeter /> : null}
      </div>
      {desktop ? (
        <div className="vu-bar-actions" role="toolbar" aria-label={l.clipActions}>
          <CommandButton id="split" />
          <CommandButton id="duplicate" />
          <CommandButton id="freeze" />
          <CommandButton id="delete" />
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
          <div className="vu-zoom-ruler">
            <Ruler
              label={l.tipZoom}
              compact
              value={zoom}
              min={0}
              max={1}
              step={0.005}
              format={(v) => `${Math.round(MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v))} px/s`}
              onChange={(v) =>
                ctl.ui.setState({
                  pxPerSecond: clampPps(MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v)),
                })
              }
            />
          </div>
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
      onAddMedia: (atStart) => ctl.pickFiles(atStart ? 'start' : 'playhead'),
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
  const inside = useUi((s) => s.inside.length > 0);
  return (
    <div className="vu-timeline" data-inside={inside || undefined}>
      <InsideBar />
      <div className="vu-timeline-canvas">
        <canvas ref={canvasRef} aria-hidden="true" data-tooltip-follow="" />
      </div>
      <TimelineA11y onReveal={(item) => viewRef.current?.reveal(item)} />
    </div>
  );
}

/**
 * While a combined clip is open (DECISIONS #155): where you are (the clips it sits in) and the way
 * back out. Over the timeline, on every layout.
 */
function InsideBar(): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const inside = useUi((s) => s.inside);
  if (inside.length === 0) return null;
  return (
    <div className="vu-inside-bar" role="region" aria-label={l.insideCombined(inside.at(-1)!.name)}>
      <Button
        icon="back"
        label={l.backToTimeline}
        tip={l.tipBackToTimeline}
        variant="secondary"
        onClick={() => ctl.closeCombined()}
      />
      <Icon name="combine" size={16} />
      <span className="vu-inside-path">
        {inside.map((i, k) => (
          <span key={i.assetId + k} aria-current={k === inside.length - 1 ? 'location' : undefined}>
            {i.name}
          </span>
        ))}
      </span>
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
          ti === 0 ? l.mainTrack : l.lane(kindLabel(l, track.items[0]?.kind ?? 'video'), ti);
        return (
          <div key={track.id} role="group" aria-label={name}>
            <button
              type="button"
              aria-pressed={sound ? track.muted : track.hidden}
              onClick={() => ctl.toggleTrack(track.id)}
            >
              {sound ? l.muteTrack(name) : l.hideTrack(name)}
            </button>
            <button
              type="button"
              aria-pressed={track.locked}
              onClick={() => ctl.toggleTrackLock(track.id)}
            >
              {`${l.lockLane}: ${name}`}
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
                    aria-label={`${l.clipLabel(index + 1, kindLabel(l, item.kind), formatTime(item.start), formatTime(itemEnd(item)))}: ${itemTitle(item, assets)}${item.locked || track.locked ? `, ${l.lockedState}` : ''}${item.hidden ? `, ${l.hiddenState}` : ''}`}
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
  const count = useUi((s) => s.selectedIds.length);
  useProject((p) => p); // lock / group state shows on the tools
  useUi((s) => s.stickerChecks); // a sticker's background check finished: Remove background may show
  const entries = toolsFor(item, ctl.project, ctl, l, targets, count);
  // Fades at the edges show there are more tools to scroll to (phones show ~6 at a time).
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const update = () => {
      const max = bar.scrollWidth - bar.clientWidth;
      bar.toggleAttribute('data-more-start', bar.scrollLeft > 2);
      bar.toggleAttribute('data-more-end', bar.scrollLeft < max - 2);
    };
    update();
    bar.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(bar);
    return () => {
      bar.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [entries.length, item?.id]);
  return (
    <div className="vu-toolbar">
      <div
        ref={barRef}
        className="vu-toolbar-scroll"
        role="toolbar"
        aria-label={
          count > 1
            ? l.selectedCount(count)
            : item
              ? itemTitle(item, ctl.project.assets)
              : l.addContent
        }
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
  | 'animate'
  | 'arrange'
  | 'greenScreen'
  | 'blend'
  | 'opacityBlend'
  | 'blurArea'
  | 'shape'
  | 'removeBackground'
  | 'keyframes'
  | 'fineTrim'
  | 'splitAtScenes'
  | 'soundEffects'
  | 'readAloud';

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
  opacity: 'opacityBlend',
  duration: 'duration',
  canvas: 'canvas',
  'add-text': 'text',
  'add-sticker': 'stickers',
  'add-audio': 'audio',
  'add-media': 'media',
  animate: 'animate',
  arrange: 'arrange',
  key: 'greenScreen',
  blend: 'opacityBlend',
  region: 'blurArea',
  mask: 'shape',
  cutout: 'removeBackground',
  keyframes: 'keyframes',
  protrim: 'fineTrim',
  scenes: 'splitAtScenes',
  soundfx: 'soundEffects',
  readaloud: 'readAloud',
};

/**
 * Phone/tablet: a tool's controls (or an add panel) docked exactly over the timeline area — the
 * same box, never a second floating panel — with an obvious Done.
 */
export function Dock(): ReactElement | null {
  const tool = useUi((s) => s.tool);
  const panel = useUi((s) => s.panel);
  const sheetPanel = useUi((s) => s.sheetPanel);
  const showPanel = !tool && sheetPanel && panel;
  if (!tool && !showPanel) return null;
  // One sheet while it's open: picking another tool swaps its contents in place (a quick fade),
  // it doesn't slide in again (owner, 2026-10-19).
  return <Sheet tool={tool} panel={panel} />;
}

function Sheet({ tool, panel }: { tool: ToolId | null; panel: PanelId | null }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const [expanded, setExpanded] = useState(false);
  // Green screen "pick from video": the sheet steps down out of the way so the video can be
  // tapped, and comes back once the colour is picked (or picking stops).
  const picking = useUi((s) => s.picking !== null);
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; y: number; t: number; base: number; dy: number } | null>(null);
  const leaving = useRef(false);
  // The sheet's full height is the editor's room above the tab bar, measured — the editor is a
  // width-only container, so CSS can't know its height (cqh would be the browser window's).
  useLayoutEffect(() => {
    const sheet = ref.current;
    const area = sheet?.parentElement;
    const root = sheet?.closest<HTMLElement>('.vu-root');
    if (!sheet || !area || !root) return;
    const measure = () => {
      const full = area.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
      sheet.style.setProperty('--vu-sheet-full', `${Math.max(0, Math.round(full))}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(area);
    return () => ro.disconnect();
  }, []);
  const entry = RAIL.find((r) => r.id === panel);
  const custom = ctl.options.customize?.panels?.find((p) => `custom:${p.id}` === panel);
  const title = tool
    ? l[TOOL_TITLE[tool]]
    : custom
      ? custom.label
      : entry
        ? l[entry.key]
        : panel === 'layers'
          ? l.layers
          : panel === 'history'
            ? l.history
            : l.canvas;

  /**
   * The sheet is always full height and only ever moves with `transform` (no height animation,
   * no layout per frame): "open" shows its top part, "expanded" all of it. `--vu-sheet-y` is how
   * far it is pushed down; CSS computes it from the two heights.
   */
  const offsetOf = (sheet: HTMLElement) => {
    const y = new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;
    return Number.isFinite(y) ? y : 0;
  };
  /** Cancels a close that's under way (another tool was picked while the sheet slid out). */
  const cancelLeave = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    cancelLeave.current?.();
  }, [tool, panel]);
  // Closed some other way meanwhile (Back, a selection): the late close mustn't shut what opens next.
  useEffect(() => () => cancelLeave.current?.(), []);
  const dismiss = () => {
    const sheet = ref.current;
    if (!sheet || leaving.current) return;
    leaving.current = true;
    let cancelled = false;
    const done = () => {
      if (cancelled) return;
      cancelled = true;
      ctl.ui.setState({ tool: null, sheetPanel: false });
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    sheet.dataset.leaving = '';
    // Only the sheet's own slide counts (child hover transitions bubble up too).
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== sheet || e.propertyName !== 'transform') return;
      sheet.removeEventListener('transitionend', onEnd);
      done();
    };
    sheet.addEventListener('transitionend', onEnd);
    // Safety net if no transition runs (hidden tab, zero duration).
    const timer = setTimeout(done, 400);
    cancelLeave.current = () => {
      cancelLeave.current = null;
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      sheet.removeEventListener('transitionend', onEnd);
      leaving.current = false;
      delete sheet.dataset.leaving;
    };
  };

  // Dragging the handle / header: down closes, up expands, a short drag springs back. The sheet
  // follows the finger through inline styles only (no React render per move).
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const sheet = ref.current;
    if (!sheet) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (already ended): the drag still works while the finger stays on the head.
    }
    drag.current = {
      id: e.pointerId,
      y: e.clientY,
      t: performance.now(),
      base: offsetOf(sheet),
      dy: 0,
    };
    sheet.dataset.dragging = '';
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const sheet = ref.current;
    if (!d || d.id !== e.pointerId || !sheet) return;
    d.dy = e.clientY - d.y;
    // Can't go above fully expanded; a little give past it.
    const y = Math.max(-12, d.base + d.dy);
    sheet.style.transform = `translateY(${y}px)`;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    const sheet = ref.current;
    if (!d || d.id !== e.pointerId || !sheet) return;
    drag.current = null;
    delete sheet.dataset.dragging;
    sheet.style.transform = '';
    const speed = d.dy / Math.max(1, performance.now() - d.t); // px per ms
    const shown = sheet.getBoundingClientRect().height - d.base; // visible height at the start
    const flickDown = d.dy > 24 && speed > 0.5;
    if (expanded) {
      if (d.dy > shown * 0.5 && flickDown) dismiss();
      else if (d.dy > 64 || flickDown) setExpanded(false);
      return;
    }
    if (d.dy > shown * 0.25 || flickDown) dismiss();
    else if (d.dy < -48) setExpanded(true);
  };

  return (
    <section
      ref={ref}
      className="vu-dock"
      aria-label={title}
      data-expanded={expanded || undefined}
      data-picking={picking || undefined}
    >
      <div
        className="vu-dock-head"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <span className="vu-dock-grab" aria-hidden="true" />
        <h2 className="vu-dock-title">{title}</h2>
        <button type="button" className="vu-done" onClick={dismiss}>
          <Icon name="check" size={16} />
          <span>{l.done}</span>
        </button>
      </div>
      <div className="vu-dock-body" key={tool ?? panel ?? ''}>
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
  const readOnly = useUi((st) => st.readOnly);
  const announcement = useUi((s) => s.announcement);
  return (
    <div className="vu-toasts" role="status" aria-live="polite">
      <span className="vu-sr-only">{announcement}</span>
      {readOnly ? (
        <div className="vu-toast vu-banner" data-tone="error">
          <Icon name="warning" size={16} />
          <span className="vu-toast-text">{l.readOnlyBanner}</span>
          <button type="button" className="vu-toast-action" onClick={() => void ctl.takeOver()}>
            {l.takeOver}
          </button>
        </div>
      ) : null}
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
          {[...l.shortcutList, ...l.rangeShortcuts].map(([keys, what]) => (
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
