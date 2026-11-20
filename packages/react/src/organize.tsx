import {
  FLICKS_PER_SECOND,
  itemEnd,
  mainTrack,
  type Item,
  type Project,
  type Time,
} from '@video-ultra/core';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';
import { AdjustTool, FadeTool, OpacityTool, SpeedTool, VolumeTool } from './ToolPanel';
import { AllSelected, useSharedReps } from './multiedit';
import { BlendTool } from './picture';
import { ALIGN_COMMANDS, getCommand, menuSections, type Command, type CommandId } from './commands';
import { useNearView } from './browse';
import { useController, useLabels, useUi } from './context';
import { Button, IconButton, Section } from './controls';
import { formatClock } from './format';
import { Icon, type IconName } from './icons';
import { itemTitle, kindLabel } from './items';

/**
 * Layers & organising (v0.2, DECISIONS #116): the History popover, the Layers panel, the context
 * menu, the Arrange controls and the multi-selection inspector. Every action here is a command
 * from the registry (commands.ts) — the same one the shortcuts and menus run.
 */

const KIND_ICON: Record<Item['kind'], IconName> = {
  video: 'media',
  image: 'image',
  freeze: 'freeze',
  audio: 'audio',
  text: 'text',
  sticker: 'sticker',
  region: 'blurArea',
};

/** Re-renders on every project, history or selection change (commands depend on all three). */
function useCommandState(): void {
  const ctl = useController();
  useStore(ctl.editor.store, (s) => s);
  useUi((s) => [s.selectedId, s.selectedIds, s.panel]);
}

/** A registry command as a button: label, icon, tooltip, shortcut and why it's disabled. */
export function CommandButton({
  id,
  layout = 'row',
  variant,
  command,
}: {
  id: CommandId;
  layout?: 'stack' | 'row' | 'icon';
  variant?: 'ghost' | 'secondary' | 'danger';
  /** Pre-computed command (lists compute once). */
  command?: Command;
}): ReactElement {
  const ctl = useController();
  const c = command ?? getCommand(ctl, id);
  return (
    <Button
      icon={c.icon}
      label={c.label}
      layout={layout}
      {...(variant ? { variant } : c.danger ? { variant: 'danger' as const } : {})}
      {...(c.tip ? { tip: c.tip } : {})}
      {...(c.shortcut ? { shortcut: c.shortcut } : {})}
      {...(c.pressed !== undefined ? { pressed: c.pressed } : {})}
      disabledReason={c.disabledReason}
      onClick={() => c.run()}
    />
  );
}

// ── History ─────────────────────────────────────────────────────────────

/** The History panel (top bar's clock): "Original" and every step; tap one to go back to it. */
export function HistoryPanel(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  // Any commit, undo or redo changes the project or the undo flags.
  useStore(ctl.editor.store, (s) => s);
  const currentRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  });

  const { labels, position } = ctl.editor.history();
  const rows = [l.historyOriginal, ...labels];
  return (
    <div className="vu-panel-body vu-history">
      {labels.length === 0 ? <p className="vu-hint">{l.historyEmpty}</p> : null}
      <ol className="vu-history-list" aria-label={l.history}>
        {rows.map((label, i) => {
          const current = i === position;
          return (
            <li key={i}>
              <button
                ref={current ? currentRef : undefined}
                type="button"
                className="vu-history-step"
                data-current={current || undefined}
                data-undone={i > position || undefined}
                aria-current={current ? 'step' : undefined}
                data-tooltip={current ? undefined : l.historyStepTip}
                onClick={() => ctl.jumpToHistory(i)}
              >
                <span className="vu-history-dot" aria-hidden="true" />
                <span className="vu-history-label">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── Layers ──────────────────────────────────────────────────────────────

/** Everything drawn at `t`, front first, hidden items included (the panel can show them again). */
export function layerStack(project: Project, t: Time): { item: Item; main: boolean }[] {
  const out: { item: Item; main: boolean }[] = [];
  project.tracks.forEach((track, index) => {
    if (track.kind === 'audio') return;
    for (const item of track.items) {
      if (item.start <= t && t < itemEnd(item)) out.push({ item, main: index === 0 });
    }
  });
  // At the very end of the video, still list the last clip.
  if (!out.some((e) => e.main)) {
    const main = mainTrack(project).items;
    const last = main[main.length - 1];
    if (last && t >= itemEnd(last)) out.unshift({ item: last, main: true });
  }
  return out.reverse();
}

/** The playhead time, re-rendering at most when the stack under it changes. */
function useStackTime(): Time {
  const ctl = useController();
  useStore(ctl.ui, (s) => s.inside);
  const project = ctl.view(useStore(ctl.editor.store, (s) => s.project));
  const [t, setT] = useState(ctl.playhead.time);
  useEffect(() => {
    let key = '';
    const update = (time: Time) => {
      const next = layerStack(project, time)
        .map((e) => e.item.id)
        .join('|');
      if (next !== key) {
        key = next;
        setT(time);
      }
    };
    update(ctl.playhead.time);
    return ctl.playhead.subscribe(update);
  }, [ctl, project]);
  return t;
}

/** Layers panel: what's on screen at the playhead, front to back. */
export function LayersPanel(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  useCommandState();
  const t = useStackTime();
  const selecting = useUi((s) => s.layersSelecting);
  const selectedIds = useUi((s) => s.selectedIds);
  const stack = layerStack(ctl.project, t);
  const listRef = useRef<HTMLUListElement>(null);
  const drag = useRef<{
    id: string;
    pointer: number;
    y: number;
    from: number;
    to: number;
    row: HTMLElement;
  } | null>(null);
  const elements = stack.filter((e) => !e.main);

  // Drag a row by its grip to restack (moves through refs and styles; one edit on release).
  const onGripDown = (e: React.PointerEvent, id: string, index: number) => {
    const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('.vu-layer');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, pointer: e.pointerId, y: e.clientY, from: index, to: index, row };
    row.dataset.dragging = '';
  };
  const onGripMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const list = listRef.current;
    if (!d || d.pointer !== e.pointerId || !list) return;
    const dy = e.clientY - d.y;
    d.row.style.transform = `translateY(${dy}px)`;
    const rows = [...list.querySelectorAll<HTMLElement>('.vu-layer[data-element]')];
    const height = d.row.getBoundingClientRect().height || 1;
    d.to = Math.max(0, Math.min(rows.length - 1, d.from + Math.round(dy / height)));
    rows.forEach((r, i) => {
      if (r === d.row) return;
      const shift =
        d.to > d.from && i > d.from && i <= d.to
          ? -height
          : d.to < d.from && i < d.from && i >= d.to
            ? height
            : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const onGripUp = (e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    for (const r of listRef.current?.querySelectorAll<HTMLElement>('.vu-layer') ?? [])
      r.style.transform = '';
    delete d.row.dataset.dragging;
    if (!cancelled && d.to !== d.from) ctl.moveInStack(d.id, d.to);
  };

  const pick = (item: Item, add: boolean) => {
    ctl.select(item.id, { keepPanel: true, ...(add ? { add: true } : { only: true }) });
  };

  return (
    <div className="vu-panel-body vu-layers">
      <div className="vu-layers-head">
        <p className="vu-hint">{l.layersAt(formatClock(t))}</p>
        <Button
          icon="select"
          label={selecting ? l.done : l.selectSeveral}
          tip={l.tipSelectSeveral}
          variant={selecting ? 'secondary' : 'ghost'}
          pressed={selecting}
          onClick={() => ctl.ui.setState({ layersSelecting: !selecting })}
        />
      </div>
      {stack.length === 0 ? <p className="vu-hint">{l.layersEmpty}</p> : null}
      <ul ref={listRef} className="vu-layer-list" aria-label={l.layers}>
        {stack.map(({ item, main }) => {
          const index = elements.findIndex((e) => e.item.id === item.id);
          return (
            <LayerRow
              key={item.id}
              item={item}
              main={main}
              selected={selectedIds.includes(item.id)}
              selecting={selecting}
              onPick={(add) => pick(item, add || selecting)}
              onMove={(dir) => {
                const to = index + dir;
                if (index >= 0 && to >= 0 && to < elements.length) ctl.moveInStack(item.id, to);
              }}
              grip={
                main
                  ? null
                  : {
                      onPointerDown: (e) => onGripDown(e, item.id, index),
                      onPointerMove: onGripMove,
                      onPointerUp: (e) => onGripUp(e, false),
                      onPointerCancel: (e) => onGripUp(e, true),
                    }
              }
            />
          );
        })}
      </ul>
      {elements.length > 1 ? <p className="vu-hint">{l.layersDragHint}</p> : null}
    </div>
  );
}

function LayerRow({
  item,
  main,
  selected,
  selecting,
  onPick,
  onMove,
  grip,
}: {
  item: Item;
  main: boolean;
  selected: boolean;
  selecting: boolean;
  onPick: (add: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  grip: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  } | null;
}): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const [renaming, setRenaming] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const focusQuietly = useCallback((el: HTMLInputElement | null) => {
    el?.focus({ preventScroll: true });
  }, []);
  const name = main && !item.name ? l.rowVideo : itemTitle(item, ctl.project.assets);
  const shown = item.kind === 'text' ? item.text.split('\n')[0] || name : name;
  const locked = !!item.locked;
  const hidden = !!item.hidden;
  const openMenu = (e: { clientX: number; clientY: number }) => {
    if (!selected) ctl.select(item.id, { keepPanel: true, only: true });
    const r = rowRef.current?.closest('.vu-root')?.getBoundingClientRect();
    ctl.openMenu(e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0));
  };
  return (
    <li
      ref={rowRef}
      className="vu-layer"
      data-element={main ? undefined : ''}
      data-selected={selected || undefined}
      data-hidden={hidden || undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e);
      }}
    >
      {grip ? (
        <span
          className="vu-layer-grip"
          aria-hidden="true"
          data-tooltip={l.layersDragHint}
          {...grip}
        >
          <Icon name="grip" size={16} />
        </span>
      ) : (
        <span className="vu-layer-grip" aria-hidden="true" />
      )}
      {renaming ? (
        <span className="vu-layer-main">
          <LayerThumb item={item} />
          <input
            className="vu-layer-rename"
            aria-label={l.rename}
            defaultValue={item.name ?? ''}
            placeholder={shown}
            // Focused without a scroll: iOS would shift the page to it (the keyboard code
            // places it instead, VideoEditor.tsx).
            ref={focusQuietly}
            onBlur={(e) => {
              ctl.renameItem(item.id, e.currentTarget.value);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        </span>
      ) : (
        <button
          type="button"
          className="vu-layer-main"
          aria-pressed={selected}
          aria-label={`${ctl.isCombined(item) ? l.combinedKind : kindLabel(l, item.kind, true)}: ${shown}${locked ? `, ${l.lockedState}` : ''}${hidden ? `, ${l.hiddenState}` : ''}`}
          data-tooltip={l.renameTipLayer}
          onClick={(e) => onPick(e.shiftKey || e.metaKey || e.ctrlKey)}
          onDoubleClick={() => setRenaming(true)}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault();
              setRenaming(true);
            } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
              e.preventDefault();
              if (!main) onMove(e.key === 'ArrowUp' ? -1 : 1);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const list = rowRef.current?.parentElement;
              const mains = [...(list?.querySelectorAll<HTMLElement>('.vu-layer-main') ?? [])];
              const i = mains.indexOf(e.currentTarget);
              mains[i + (e.key === 'ArrowUp' ? -1 : 1)]?.focus();
            }
          }}
        >
          {selecting ? (
            <span className="vu-layer-check" data-on={selected || undefined} aria-hidden="true">
              {selected ? <Icon name="check" size={14} /> : null}
            </span>
          ) : null}
          <LayerThumb item={item} />
          <span className="vu-layer-name">
            {item.kind === 'sticker' && item.emoji ? `${item.emoji} ` : ''}
            {shown}
          </span>
          {item.groupId ? <span className="vu-layer-badge">{l.groupBadge}</span> : null}
        </button>
      )}
      <IconButton
        icon={locked ? 'lock' : 'unlock'}
        label={locked ? l.unlock : l.lock}
        tip={locked ? l.tipUnlock : l.tipLock}
        pressed={locked}
        className="vu-layer-toggle"
        onClick={() => ctl.setItemLocked(item.id, !locked)}
      />
      <IconButton
        icon={hidden ? 'eyeOff' : 'eye'}
        label={hidden ? l.show : l.hide}
        tip={hidden ? l.tipShow : l.tipHide}
        pressed={hidden}
        className="vu-layer-toggle"
        onClick={() => ctl.setItemHidden(item.id, !hidden)}
      />
      <IconButton
        icon="more"
        label={l.moreActions}
        className="vu-layer-toggle"
        onClick={() => {
          const b = rowRef.current?.getBoundingClientRect();
          openMenu({ clientX: b ? b.right - 200 : 0, clientY: b ? b.bottom : 0 });
        }}
      />
    </li>
  );
}

/** A small picture of the layer: its media frame, emoji, or kind icon. */
function LayerThumb({ item }: { item: Item }): ReactElement {
  const ctl = useController();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const assetId = 'assetId' in item ? item.assetId : null;
  const asset = assetId ? ctl.project.assets[assetId] : undefined;
  const at =
    item.kind === 'freeze'
      ? item.sourceTime / FLICKS_PER_SECOND
      : 'sourceIn' in item
        ? item.sourceIn / FLICKS_PER_SECOND
        : 0;
  // A combined clip has no file to take a frame from: it shows the combine icon.
  const combined = asset?.kind === 'compound';
  const picture = !!asset && asset.kind !== 'audio' && !combined;
  // Only rows scrolled near the view decode a frame; on a fresh load, once the file is back.
  const [near, setNear] = useState(false);
  const thumbRef = useNearView<HTMLSpanElement>(() => setNear(true));
  useEffect(() => {
    if (!picture || !assetId || !near) return;
    const controller = new AbortController();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const height = Math.round(32 * Math.min(devicePixelRatio || 1, 2));
    void ctl
      .whenMedia(assetId, controller.signal)
      .then(() =>
        controller.signal.aborted
          ? null
          : ctl.analyzer?.thumbnail(assetId, at, height, controller.signal),
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
  }, [ctl, assetId, at, picture, near]);
  return (
    <span ref={thumbRef} className="vu-layer-thumb" data-kind={item.kind} aria-hidden="true">
      {picture ? (
        <canvas ref={canvasRef} />
      ) : (
        <Icon name={combined ? 'combine' : KIND_ICON[item.kind]} size={16} />
      )}
    </span>
  );
}

// ── Context menu ────────────────────────────────────────────────────────

/**
 * The context menu (right-click / long-press on the stage, timeline or a layer; Shift+F10 for the
 * selection): the selection's commands in groups, Align as a submenu. Arrow keys move, Enter
 * runs, Esc closes; focus returns to where it was.
 */
export function ContextMenu(): ReactElement | null {
  const menu = useUi((s) => s.menu);
  useCommandState();
  if (!menu) return null;
  return <MenuPanel key={`${menu.x},${menu.y}`} x={menu.x} y={menu.y} />;
}

function MenuPanel({ x, y }: { x: number; y: number }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const ref = useRef<HTMLDivElement>(null);
  const phone = useUi((s) => s.layout === 'phone');
  const subId = useId();
  const [submenu, setSubmenu] = useState(false);
  const [pos, setPos] = useState({ x, y });
  // Desktop: the submenu sits beside the list (outside it, so the list's scrolling can't clip
  // it), lined up with its item and flipped to the left when there's no room on the right.
  const [sub, setSub] = useState({ top: 0, flip: false });
  const lastPointer = useRef('');
  const returnFocus = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null,
  );
  const { heading, sections } = menuSections(ctl);
  const close = () => {
    ctl.closeMenu();
    returnFocus.current?.focus?.({ preventScroll: true });
  };

  // Keep it inside the editor — on opening, and when the submenu (inline on phones) makes it
  // taller. Clamps from the point it was opened at, so a later pass never undoes an earlier one.
  const focused = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const root = el?.closest<HTMLElement>('.vu-root');
    if (!el || !root) return;
    const nx = Math.max(8, Math.min(x, root.clientWidth - el.offsetWidth - 8));
    const ny = Math.max(8, Math.min(y, root.clientHeight - el.offsetHeight - 8));
    setPos((p) => (p.x === nx && p.y === ny ? p : { x: nx, y: ny }));
    const panel = el.querySelector<HTMLElement>(':scope > .vu-submenu');
    const trigger = el.querySelector<HTMLElement>('[data-submenu]');
    if (panel && trigger) {
      const top = trigger.getBoundingClientRect().top - el.getBoundingClientRect().top;
      const maxTop = root.clientHeight - ny - panel.offsetHeight - 8;
      const flip = nx + el.offsetWidth + panel.offsetWidth + 8 > root.clientWidth;
      const next = { top: Math.max(-ny + 8, Math.min(top, maxTop)), flip };
      setSub((p) => (p.top === next.top && p.flip === next.flip ? p : next));
    }
    if (!focused.current) {
      focused.current = true;
      el.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    }
  }, [x, y, submenu]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) ctl.closeMenu();
    };
    const onScroll = () => ctl.closeMenu();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [ctl]);

  const onKey = (e: React.KeyboardEvent) => {
    const items = [
      ...(ref.current?.querySelectorAll<HTMLElement>(
        submenu
          ? '.vu-submenu [role="menuitem"]'
          : ':scope > .vu-menu-main > .vu-menu-group > [role="menuitem"], :scope > .vu-menu-main > .vu-menu-group > .vu-menu-sub > [role="menuitem"]',
      ) ?? []),
    ];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (n) items[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (submenu) {
        setSubmenu(false);
        ref.current?.querySelector<HTMLElement>('[data-submenu]')?.focus();
      } else close();
    } else if (e.key === 'ArrowLeft' && submenu) {
      e.preventDefault();
      setSubmenu(false);
      ref.current?.querySelector<HTMLElement>('[data-submenu]')?.focus();
    }
  };

  const item = (c: Command): ReactNode => (
    <div
      key={c.id}
      role="menuitem"
      tabIndex={-1}
      className="vu-menu-item"
      data-danger={c.danger || undefined}
      aria-disabled={c.disabledReason ? true : undefined}
      data-tooltip={c.disabledReason ?? undefined}
      onClick={() => {
        if (c.disabledReason) return;
        ctl.closeMenu();
        c.run();
        returnFocus.current?.focus?.({ preventScroll: true });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      }}
    >
      <Icon name={c.icon} size={16} />
      <span className="vu-menu-label">{c.label}</span>
      {c.shortcut ? <kbd className="vu-menu-key">{c.shortcut}</kbd> : null}
    </div>
  );

  const subPanel = (
    <div
      id={subId}
      className="vu-submenu vu-menu"
      role="menu"
      aria-label={l.align}
      data-flip={!phone && sub.flip ? '' : undefined}
      style={phone ? undefined : { top: sub.top }}
    >
      {ALIGN_COMMANDS.map((a) => item(getCommand(ctl, a)))}
    </div>
  );

  return (
    <div
      ref={ref}
      className="vu-menu-wrap"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="vu-menu vu-menu-main"
        role="menu"
        aria-label={heading ?? l.moreActions}
        onScroll={() => !phone && setSubmenu(false)}
        onPointerOver={(e) => {
          // A mouse moving onto another item closes the desktop submenu.
          const t = e.target as HTMLElement;
          if (!phone && e.pointerType === 'mouse' && !t.closest('.vu-menu-sub')) {
            if (t.closest('[role="menuitem"]')) setSubmenu(false);
          }
        }}
      >
        {heading ? <div className="vu-menu-heading">{heading}</div> : null}
        {sections.map((section, si) => (
          <div key={si} className="vu-menu-group" role="none">
            {section.map((id) =>
              id === 'align' ? (
                <div key="align" className="vu-menu-sub" role="none">
                  <div
                    role="menuitem"
                    tabIndex={-1}
                    aria-haspopup="menu"
                    aria-expanded={submenu}
                    aria-controls={submenu ? subId : undefined}
                    data-submenu=""
                    className="vu-menu-item"
                    onPointerDown={(e) => (lastPointer.current = e.pointerType)}
                    // A mouse opens it on hover, so a click only ever opens it (a toggle would
                    // close what the hover just opened); touch and keys toggle.
                    onClick={() => setSubmenu((v) => lastPointer.current === 'mouse' || !v)}
                    onPointerEnter={(e) => e.pointerType === 'mouse' && setSubmenu(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        setSubmenu(true);
                        requestAnimationFrame(() =>
                          ref.current
                            ?.querySelector<HTMLElement>(
                              '.vu-submenu [role="menuitem"]:not([aria-disabled="true"])',
                            )
                            ?.focus(),
                        );
                      }
                    }}
                  >
                    <Icon name="alignToCenter" size={16} />
                    <span className="vu-menu-label">{l.align}</span>
                    {/* Phones open it inline below (a chevron that turns over), desktop beside. */}
                    {phone ? (
                      <span className="vu-menu-chevron" data-open={submenu || undefined}>
                        <Icon name="chevronDown" size={14} />
                      </span>
                    ) : (
                      <Icon name="arrowRight" size={14} />
                    )}
                  </div>
                  {submenu && phone ? subPanel : null}
                </div>
              ) : (
                item(getCommand(ctl, id))
              ),
            )}
          </div>
        ))}
      </div>
      {submenu && !phone ? subPanel : null}
    </div>
  );
}

// ── Arrange (inspector section / phone tool) ────────────────────────────

/** Order, align, lock and hide for the selection. */
export function ArrangeControls({ compact = false }: { compact?: boolean }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  useCommandState();
  const items = ctl.selectedItems();
  const several = items.length > 1;
  const main = mainTrack(ctl.project);
  const onMain = items.length === 1 && main.items.includes(items[0]!);
  const visual = items.some((i) => i.kind !== 'audio');
  const layout = compact ? 'stack' : 'icon';
  return (
    <div className="vu-arrange" data-compact={compact || undefined}>
      {visual && !onMain ? (
        <div className="vu-arrange-row" role="group" aria-label={l.order}>
          <span className="vu-arrange-label">{l.order}</span>
          <div className="vu-arrange-buttons">
            {(['forward', 'backward', 'front', 'back'] as const).map((id) => (
              <CommandButton key={id} id={id} layout={layout} />
            ))}
          </div>
        </div>
      ) : null}
      {visual ? (
        <div className="vu-arrange-row" role="group" aria-label={l.align}>
          <span className="vu-arrange-label">{l.align}</span>
          <div className="vu-arrange-buttons">
            {(
              [
                'alignLeft',
                'alignCenter',
                'alignRight',
                'alignTop',
                'alignMiddle',
                'alignBottom',
                ...(several ? (['distributeH', 'distributeV'] as const) : []),
              ] as const
            ).map((id) => (
              <CommandButton key={id} id={id} layout={layout} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="vu-arrange-row vu-arrange-toggles">
        <CommandButton id="lock" variant="secondary" />
        {visual ? <CommandButton id="hide" variant="secondary" /> : null}
      </div>
    </div>
  );
}

/** Desktop inspector for several selected elements (or a group). */
export function SelectionInspector(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  useCommandState();
  const items = ctl.selectedItems();
  const group = ctl.selectedGroup();
  return (
    <aside className="vu-inspector" aria-label={l.selectedCount(items.length)}>
      <div className="vu-panel-head">
        <span className="vu-kind-badge" data-kind="group">
          <Icon name={group ? 'group' : 'select'} size={16} />
        </span>
        <div className="vu-inspector-title">
          <h2 className="vu-panel-title">{group ? l.groupBadge : l.selectionTitle}</h2>
          <span className="vu-inspector-meta">{l.selectedCount(items.length)}</span>
        </div>
        <IconButton
          icon="close"
          label={l.deselect}
          shortcut="Esc"
          onClick={() => ctl.select(null)}
        />
      </div>
      <div className="vu-panel-scroll">
        <Section>
          <div className="vu-arrange-row vu-arrange-toggles">
            <CommandButton id={group ? 'ungroup' : 'group'} variant="secondary" />
          </div>
        </Section>
        <Section title={l.arrange}>
          <ArrangeControls />
        </Section>
        <SharedSections />
        <Section>
          <div className="vu-arrange-row vu-arrange-toggles">
            <CommandButton id="duplicate" variant="secondary" />
            <CommandButton id="delete" />
          </div>
        </Section>
      </div>
    </aside>
  );
}

/**
 * Several selected: the settings they share, each change made to all of them (DECISIONS #153).
 * Filters and entrance / exit are in the left menu, which also acts on all of them.
 */
function SharedSections(): ReactElement | null {
  const l = useLabels();
  const shared = useSharedReps();
  if (!shared) return null;
  const { ids, reps } = shared;
  if (!reps.speed && !reps.sound && !reps.look && !reps.layer) return null;
  return (
    <AllSelected ids={ids}>
      <p className="vu-hint vu-shared-note">{l.appliesToAll(ids.length)}</p>
      {reps.speed ? (
        <Section title={l.speed}>
          <SpeedTool item={reps.speed} />
        </Section>
      ) : null}
      {reps.sound ? (
        <Section title={l.sound}>
          <VolumeTool item={reps.sound} />
          <FadeTool item={reps.sound} />
        </Section>
      ) : null}
      {reps.look ? (
        <Section title={l.adjust} collapsible defaultOpen={false}>
          <AdjustTool item={reps.look} />
        </Section>
      ) : null}
      {reps.layer ? (
        <Section title={l.opacityBlend}>
          <OpacityTool item={reps.layer} />
          <BlendTool item={reps.layer} />
        </Section>
      ) : null}
    </AllSelected>
  );
}

/** Shown above a locked item's settings: why nothing changes, and the way out. */
export function LockedNote({ item }: { item: Item }): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const trackLocked = ctl.project.tracks.some(
    (t) => t.locked && t.items.some((i) => i.id === item.id),
  );
  if (!item.locked && !trackLocked) return null;
  return (
    <div className="vu-locked-note" role="note">
      <Icon name="lock" size={16} />
      <span>{trackLocked && !item.locked ? l.laneLocked : l.lockedNote}</span>
      <Button
        label={l.unlock}
        variant="secondary"
        onClick={() => {
          if (item.locked) ctl.setItemLocked(item.id, false);
          else {
            const track = ctl.project.tracks.find((t) => t.items.some((i) => i.id === item.id));
            if (track) ctl.toggleTrackLock(track.id);
          }
        }}
      />
    </div>
  );
}
