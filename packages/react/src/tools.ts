import type { Item, Project } from '@video-ultra/core';
import type { EditorController } from './controller';
import type { IconName } from './icons';
import type { Labels } from './labels';
import type { PanelId, ToolId } from './state';

/** One entry of the contextual toolbar. */
export interface ToolEntry {
  key: string;
  icon: IconName;
  label: string;
  /** Opens this tool's controls (sheet / inspector) … */
  tool?: ToolId;
  /** … or opens an add-content panel … */
  panel?: PanelId;
  /** … or acts at once. */
  run?: () => void;
  danger?: boolean;
  pressed?: boolean;
}

/**
 * Selection drives the tools (UI_VISION §2): nothing selected → add tools; a clip selected →
 * that clip's tools, most used first.
 */
export function toolsFor(
  item: Item | null,
  project: Project,
  ctl: EditorController,
  l: Labels,
): ToolEntry[] {
  if (!item) {
    return [
      { key: 'media', icon: 'media', label: l.media, panel: 'media' },
      { key: 'text', icon: 'text', label: l.text, panel: 'text' },
      { key: 'audio', icon: 'audio', label: l.audio, panel: 'audio' },
      { key: 'stickers', icon: 'sticker', label: l.stickers, panel: 'stickers' },
      { key: 'canvas', icon: 'canvas', label: l.canvas, tool: 'canvas' },
      { key: 'split', icon: 'split', label: l.split, run: () => ctl.split() },
    ];
  }
  const split: ToolEntry = { key: 'split', icon: 'split', label: l.split, run: () => ctl.split() };
  const duplicate: ToolEntry = {
    key: 'duplicate',
    icon: 'duplicate',
    label: l.duplicate,
    run: () => ctl.duplicateSelected(),
  };
  const remove: ToolEntry = {
    key: 'delete',
    icon: 'delete',
    label: l.delete,
    run: () => ctl.deleteSelected(),
    danger: true,
  };
  const onMain = project.tracks[0]!.items.some((i) => i.id === item.id);
  const index = project.tracks[0]!.items.findIndex((i) => i.id === item.id);
  const look: ToolEntry[] = [
    { key: 'filter', icon: 'filter', label: l.filter, tool: 'filter' },
    { key: 'adjust', icon: 'adjust', label: l.adjust, tool: 'adjust' },
    { key: 'crop', icon: 'crop', label: l.crop, tool: 'crop' },
    { key: 'transform', icon: 'rotate', label: l.rotate, tool: 'transform' },
  ];
  const transition: ToolEntry[] =
    onMain && index > 0
      ? [{ key: 'transition', icon: 'transition', label: l.transition, tool: 'transition' }]
      : [];
  switch (item.kind) {
    case 'video': {
      const asset = project.assets[item.assetId];
      return [
        split,
        { key: 'speed', icon: 'speed', label: l.speed, tool: 'speed' },
        { key: 'volume', icon: item.muted ? 'muted' : 'volume', label: l.volume, tool: 'volume' },
        ...look,
        ...transition,
        { key: 'fade', icon: 'fade', label: l.fade, tool: 'fade' },
        ...(onMain
          ? [
              {
                key: 'freeze',
                icon: 'freeze',
                label: l.freeze,
                run: () => ctl.freezeSelected(),
              } as ToolEntry,
            ]
          : []),
        ...(asset?.hasAudio && !item.muted
          ? [
              {
                key: 'extract',
                icon: 'extract',
                label: l.extractAudio,
                run: () => ctl.extractAudio(),
              } as ToolEntry,
            ]
          : []),
        ...(onMain
          ? []
          : [{ key: 'opacity', icon: 'opacity', label: l.opacity, tool: 'opacity' } as ToolEntry]),
        duplicate,
        remove,
      ];
    }
    case 'image':
    case 'freeze':
      return [
        split,
        { key: 'duration', icon: 'speed', label: l.duration, tool: 'duration' },
        ...look,
        ...transition,
        ...(onMain
          ? []
          : [{ key: 'opacity', icon: 'opacity', label: l.opacity, tool: 'opacity' } as ToolEntry]),
        duplicate,
        remove,
      ];
    case 'audio':
      return [
        split,
        { key: 'volume', icon: item.muted ? 'muted' : 'volume', label: l.volume, tool: 'volume' },
        { key: 'fade', icon: 'fade', label: l.fade, tool: 'fade' },
        { key: 'speed', icon: 'speed', label: l.speed, tool: 'speed' },
        duplicate,
        remove,
      ];
    case 'text':
      return [
        { key: 'text-edit', icon: 'edit', label: l.edit, tool: 'text-edit' },
        { key: 'text-style', icon: 'style', label: l.style, tool: 'text-style' },
        { key: 'transform', icon: 'rotate', label: l.rotate, tool: 'transform' },
        { key: 'opacity', icon: 'opacity', label: l.opacity, tool: 'opacity' },
        split,
        duplicate,
        remove,
      ];
    case 'sticker':
      return [
        { key: 'transform', icon: 'rotate', label: l.rotate, tool: 'transform' },
        { key: 'opacity', icon: 'opacity', label: l.opacity, tool: 'opacity' },
        split,
        duplicate,
        remove,
      ];
  }
}
