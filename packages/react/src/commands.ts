import { mainTrack, projectDuration, type ArrangeTo } from '@video-ultra/core';
import type { EditorController } from './controller';
import type { IconName } from './icons';
import { isSounding } from './items';
import type { AlignEdge } from './stage/arrange';

/**
 * The command registry (DECISIONS #91, #116): every editor action defined once — label, icon,
 * shortcut, whether it can run now (and why not), and what it does. Menus, the Layers panel,
 * toolbars, the inspector, keyboard shortcuts and tests all go through it, so they always agree.
 * Commands are computed on demand from the current state (cheap), never stored.
 */

export type CommandId =
  | 'undo'
  | 'redo'
  | 'history'
  | 'layers'
  | 'split'
  | 'duplicate'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'freeze'
  | 'delete'
  | 'selectAll'
  | 'deselect'
  | 'group'
  | 'ungroup'
  | 'lock'
  | 'hide'
  | 'forward'
  | 'backward'
  | 'front'
  | 'back'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignTop'
  | 'alignMiddle'
  | 'alignBottom'
  | 'distributeH'
  | 'distributeV'
  | 'duck'
  | 'markIn'
  | 'markOut'
  | 'camera';

/** One action, as it stands right now. */
export interface Command {
  id: CommandId;
  /** What it does now (toggles say which way: "Lock" / "Unlock"). */
  label: string;
  icon: IconName;
  /** Longer explanation for tooltips. */
  tip?: string;
  /** Shown in tooltips and menus. */
  shortcut?: string;
  /** Null when it can run; otherwise why it can't (shown instead of doing nothing). */
  disabledReason: string | null;
  /** On/off commands: whether it is on (Lock when locked, Hide when hidden). */
  pressed?: boolean;
  danger?: boolean;
  run(): void;
}

const ARRANGE: Record<'forward' | 'backward' | 'front' | 'back', ArrangeTo> = {
  forward: 'forward',
  backward: 'backward',
  front: 'front',
  back: 'back',
};

const ALIGN: Record<
  'alignLeft' | 'alignCenter' | 'alignRight' | 'alignTop' | 'alignMiddle' | 'alignBottom',
  AlignEdge
> = {
  alignLeft: 'left',
  alignCenter: 'center',
  alignRight: 'right',
  alignTop: 'top',
  alignMiddle: 'middle',
  alignBottom: 'bottom',
};

/** The command `id` as it stands now. */
export function getCommand(ctl: EditorController, id: CommandId): Command {
  const l = ctl.labels;
  const history = ctl.editor.store.getState();
  const items = ctl.selectedItems();
  const several = items.length > 1;
  const locked = items.some((i) => ctl.isLocked(i.id));
  const selectReason = items.length
    ? null
    : ctl.project.tracks.some((t) => t.items.length)
      ? l.selectFirst
      : l.needClips;
  switch (id) {
    case 'undo':
      return {
        id,
        label: l.undo,
        icon: 'undo',
        tip: history.undoLabel ? l.undoWhat(history.undoLabel) : l.undo,
        shortcut: '⌘Z',
        disabledReason: history.canUndo ? null : l.nothingToUndo,
        run: () => ctl.undo(),
      };
    case 'redo':
      return {
        id,
        label: l.redo,
        icon: 'redo',
        tip: history.redoLabel ? l.redoWhat(history.redoLabel) : l.redo,
        shortcut: '⇧⌘Z',
        disabledReason: history.canRedo ? null : l.nothingToRedo,
        run: () => ctl.redo(),
      };
    case 'history':
      return {
        id,
        label: l.history,
        icon: 'history',
        tip: l.tipHistory,
        disabledReason: null,
        pressed: ctl.ui.getState().historyOpen,
        run: () => ctl.ui.setState((s) => ({ historyOpen: !s.historyOpen, menu: null })),
      };
    case 'layers':
      return {
        id,
        label: l.layers,
        icon: 'layers',
        tip: l.tipLayers,
        disabledReason: null,
        pressed: ctl.ui.getState().panel === 'layers',
        run: () => ctl.toggleLayers(),
      };
    case 'split': {
      const { split } = ctl.targets();
      return {
        id,
        label: l.split,
        icon: 'split',
        tip: l.tipSplit,
        shortcut: 'S',
        disabledReason: split.reason,
        run: () => ctl.split(),
      };
    }
    case 'freeze': {
      const { freeze } = ctl.targets();
      return {
        id,
        label: l.freeze,
        icon: 'freeze',
        tip: l.tipFreeze,
        disabledReason: freeze.reason,
        run: () => ctl.freezeSelected(),
      };
    }
    case 'duplicate':
      return {
        id,
        label: l.duplicate,
        icon: 'duplicate',
        tip: l.tipDuplicate,
        shortcut: '⌘D',
        disabledReason: selectReason,
        run: () => ctl.duplicateSelected(),
      };
    case 'copy':
      return {
        id,
        label: l.copy,
        icon: 'duplicate',
        tip: l.tipCopy,
        shortcut: '⌘C',
        disabledReason: selectReason,
        run: () => ctl.copySelected(),
      };
    case 'cut':
      return {
        id,
        label: l.cutItems,
        icon: 'cut',
        tip: l.tipCut,
        shortcut: '⌘X',
        disabledReason: selectReason ?? (locked ? l.lockedReason : null),
        run: () => ctl.cutSelected(),
      };
    case 'paste':
      return {
        id,
        label: l.paste,
        icon: 'paste',
        tip: l.tipPaste,
        shortcut: '⌘V',
        disabledReason: ctl.hasClipboard() ? null : l.nothingToPaste,
        run: () => ctl.paste(),
      };
    case 'delete':
      return {
        id,
        label: l.delete,
        icon: 'delete',
        tip: l.tipDelete,
        shortcut: 'Del',
        danger: true,
        disabledReason: selectReason ?? (locked ? l.lockedReason : null),
        run: () => ctl.deleteSelected(),
      };
    case 'selectAll':
      return {
        id,
        label: l.selectAll,
        icon: 'select',
        tip: l.tipSelectAll,
        shortcut: '⌘A',
        disabledReason: null,
        run: () => ctl.selectAll(),
      };
    case 'deselect':
      return {
        id,
        label: l.deselect,
        icon: 'close',
        shortcut: 'Esc',
        disabledReason: null,
        run: () => ctl.select(null),
      };
    case 'group':
      return {
        id,
        label: l.group,
        icon: 'group',
        tip: l.tipGroup,
        shortcut: '⌘G',
        disabledReason: ctl.groupReason(),
        run: () => ctl.groupSelected(),
      };
    case 'ungroup':
      return {
        id,
        label: l.ungroup,
        icon: 'ungroup',
        tip: l.tipUngroup,
        shortcut: '⇧⌘G',
        disabledReason: ctl.selectedGroup() ? null : l.groupNeedsTwo,
        run: () => ctl.ungroupSelected(),
      };
    case 'lock': {
      const on = items.length > 0 && items.every((i) => i.locked);
      return {
        id,
        label: several ? (on ? l.unlockAll : l.lockAll) : on ? l.unlock : l.lock,
        icon: on ? 'lock' : 'unlock',
        tip: on ? l.tipUnlock : l.tipLock,
        shortcut: '⇧⌘L',
        pressed: on,
        disabledReason: selectReason,
        run: () => ctl.toggleLockSelected(),
      };
    }
    case 'hide': {
      const visual = items.filter((i) => i.kind !== 'audio');
      const on = visual.length > 0 && visual.every((i) => i.hidden);
      return {
        id,
        label: several ? (on ? l.showAll : l.hideAll) : on ? l.show : l.hide,
        icon: on ? 'eyeOff' : 'eye',
        tip: on ? l.tipShow : l.tipHide,
        shortcut: '⇧⌘H',
        pressed: on,
        disabledReason: selectReason ?? (visual.length ? null : l.arrangeSound),
        run: () => ctl.toggleHideSelected(),
      };
    }
    case 'forward':
    case 'backward':
    case 'front':
    case 'back': {
      const meta = {
        forward: { label: l.bringForward, icon: 'forward', shortcut: ']' },
        backward: { label: l.sendBackward, icon: 'backward', shortcut: '[' },
        front: { label: l.bringToFront, icon: 'toFront', shortcut: '⌘]' },
        back: { label: l.sendToBack, icon: 'toBack', shortcut: '⌘[' },
      }[id] as { label: string; icon: IconName; shortcut: string };
      return {
        id,
        ...meta,
        disabledReason: ctl.arrangeReason(ARRANGE[id]),
        run: () => ctl.arrangeSelected(ARRANGE[id]),
      };
    }
    case 'alignLeft':
    case 'alignCenter':
    case 'alignRight':
    case 'alignTop':
    case 'alignMiddle':
    case 'alignBottom': {
      const edge = ALIGN[id];
      const meta = {
        left: { label: l.alignToLeft, icon: 'alignToLeft' },
        center: { label: l.alignToCenter, icon: 'alignToCenter' },
        right: { label: l.alignToRight, icon: 'alignToRight' },
        top: { label: l.alignToTop, icon: 'alignToTop' },
        middle: { label: l.alignToMiddle, icon: 'alignToMiddle' },
        bottom: { label: l.alignToBottom, icon: 'alignToBottom' },
      }[edge] as { label: string; icon: IconName };
      return {
        id,
        ...meta,
        tip: several ? l.alignToEachOtherTip : l.alignToFrameTip,
        disabledReason: ctl.alignReason(),
        run: () => ctl.align(edge),
      };
    }
    case 'markIn':
    case 'markOut': {
      const empty = projectDuration(ctl.project) === 0;
      return {
        id,
        label: id === 'markIn' ? l.markIn : l.markOut,
        icon: 'range',
        tip: id === 'markIn' ? l.markInTip : l.markOutTip,
        shortcut: id === 'markIn' ? 'I' : 'O',
        disabledReason: empty ? l.needClips : null,
        run: () => (id === 'markIn' ? ctl.setExportIn() : ctl.setExportOut()),
      };
    }
    case 'camera':
      return {
        id,
        label: l.recordCamera,
        icon: 'camera',
        tip: l.recordCameraTip,
        disabledReason: null,
        run: () => ctl.setCameraOpen(true),
      };
    case 'distributeH':
    case 'distributeV':
      return {
        id,
        label: id === 'distributeH' ? l.distributeH : l.distributeV,
        icon: id,
        tip: l.distributeTip,
        disabledReason: ctl.distributeReason(),
        run: () => ctl.distribute(id === 'distributeH' ? 'x' : 'y'),
      };
    case 'duck': {
      const sounding = items.filter(isSounding);
      const on = sounding.length > 0 && sounding.every((i) => !!i.duck);
      return {
        id,
        // Toggles say which way (menus): "Lower under voice" / "Don't lower under voice".
        label: on ? l.duckStop : l.duck,
        icon: 'duck',
        tip: l.tipDuck,
        pressed: on,
        disabledReason: ctl.duckReason(),
        run: () => ctl.toggleDuckSelected(),
      };
    }
  }
}

/** Runs a command if it can run; otherwise says why (never silently nothing). */
export function runCommand(ctl: EditorController, id: CommandId): void {
  const command = getCommand(ctl, id);
  if (command.disabledReason) ctl.toast(command.disabledReason, 'info');
  else command.run();
}

/** A keyboard shortcut. `mod` = ⌘ on Apple devices, Ctrl elsewhere. */
interface KeyBinding {
  key: string;
  mod?: boolean;
  shift?: boolean;
  id: CommandId;
}

/** Shortcuts that run commands (the rest — play, arrows, Home/End — are playback, not commands). */
export const KEYMAP: readonly KeyBinding[] = [
  { key: 'z', mod: true, id: 'undo' },
  { key: 'z', mod: true, shift: true, id: 'redo' },
  { key: 'y', mod: true, id: 'redo' },
  { key: 'd', mod: true, id: 'duplicate' },
  { key: 'c', mod: true, id: 'copy' },
  { key: 'x', mod: true, id: 'cut' },
  { key: 'v', mod: true, id: 'paste' },
  { key: 'a', mod: true, id: 'selectAll' },
  { key: 'g', mod: true, id: 'group' },
  { key: 'g', mod: true, shift: true, id: 'ungroup' },
  { key: 'l', mod: true, shift: true, id: 'lock' },
  { key: 'h', mod: true, shift: true, id: 'hide' },
  { key: ']', id: 'forward' },
  { key: '[', id: 'backward' },
  { key: ']', mod: true, id: 'front' },
  { key: '[', mod: true, id: 'back' },
  { key: 's', id: 'split' },
  { key: 'i', id: 'markIn' },
  { key: 'o', id: 'markOut' },
  { key: 'delete', id: 'delete' },
  { key: 'backspace', id: 'delete' },
];

/** The command a key press runs, if any. */
export function commandForKey(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): CommandId | null {
  if (e.altKey) return null;
  const key = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  // Shift + [ / ] types { / } on most layouts: treat the bracket keys by their own name.
  const binding = KEYMAP.find(
    (b) =>
      b.key === key &&
      !!b.mod === mod &&
      (b.key === '[' || b.key === ']' || b.key === 'delete' || b.key === 'backspace'
        ? true
        : !!b.shift === e.shiftKey),
  );
  return binding?.id ?? null;
}

/**
 * The context menu's sections for the current selection (a heading, then groups of commands;
 * `align` opens a submenu).
 */
export function menuSections(ctl: EditorController): {
  heading: string | null;
  sections: (CommandId | 'align')[][];
} {
  const l = ctl.labels;
  const items = ctl.selectedItems();
  if (items.length === 0)
    return {
      heading: null,
      sections: [
        ['paste', 'selectAll'],
        ['undo', 'redo'],
      ],
    };
  const main = mainTrack(ctl.project);
  const onMain = items.length === 1 && main.items.includes(items[0]!);
  if (items.length > 1) {
    return {
      heading: l.selectedCount(items.length),
      sections: [
        [ctl.selectedGroup() ? 'ungroup' : 'group'],
        ['copy', 'cut', 'paste'],
        ['duplicate', 'delete'],
        ['align', 'front', 'back'],
        ['lock', 'hide'],
      ],
    };
  }
  if (onMain)
    return {
      heading: null,
      sections: [
        ['split', 'freeze'],
        ['copy', 'cut', 'paste'],
        ['duplicate', 'delete'],
        ['lock', 'hide'],
      ],
    };
  if (items[0]!.kind === 'audio')
    return {
      heading: null,
      sections: [['split'], ['duck'], ['copy', 'cut', 'paste'], ['duplicate', 'delete'], ['lock']],
    };
  return {
    heading: null,
    sections: [
      ['split'],
      ['copy', 'cut', 'paste'],
      ['duplicate', 'delete'],
      ['forward', 'backward', 'front', 'back'],
      ['align'],
      ['lock', 'hide'],
    ],
  };
}

/** The Align submenu. */
export const ALIGN_COMMANDS: readonly CommandId[] = [
  'alignLeft',
  'alignCenter',
  'alignRight',
  'alignTop',
  'alignMiddle',
  'alignBottom',
  'distributeH',
  'distributeV',
];
