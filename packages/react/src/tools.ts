import { findItem, type Item, type Project } from '@video-ultra/core';
import { getCommand, type CommandId } from './commands';
import type { EditorController } from './controller';
import type { IconSpec } from './icons';
import { inHostOrder, isHidden } from './embed';
import type { Labels } from './labels';
import type { PanelId, ToolId } from './state';
import { hasCutInto, type Targets } from './targets';

/** One entry of the phone/tablet contextual toolbar. */
export interface ToolEntry {
  key: string;
  icon: IconSpec;
  label: string;
  /** What it does (tooltip). */
  tip?: string;
  /** Opens this tool's controls in the dock … */
  tool?: ToolId;
  /** … or an add-content panel … */
  panel?: PanelId;
  /** … or acts at once. */
  run?: () => void;
  danger?: boolean;
  /** Set when the tool can't act right now (shown disabled, tooltip says why). */
  disabledReason?: string | null;
}

/**
 * Selection drives the tools (UI_VISION §2): nothing selected → add tools (+ Split for the clip
 * under the playhead); a clip selected → that clip's tools, most used first.
 */
export function toolsFor(
  item: Item | null,
  project: Project,
  ctl: EditorController,
  l: Labels,
  targets: Targets,
  /** How many items are selected (several: the selection's tools). */
  count = item ? 1 : 0,
): ToolEntry[] {
  const customize = ctl.options.customize;
  const entries = builtInTools(item, project, ctl, l, targets, count).filter(
    (t) => !isHidden(customize, t.key),
  );
  if (item || count > 0 || !customize?.panels?.length) return entries;
  // Nothing selected: the host's panels join the add tools, in its order.
  const custom: ToolEntry[] = customize.panels.map((p) => ({
    key: p.id,
    icon: { path: p.icon },
    label: p.label,
    ...(p.tip ? { tip: p.tip } : {}),
    panel: `custom:${p.id}`,
  }));
  return inHostOrder(
    [...entries.map((e) => ({ ...e, id: e.key })), ...custom.map((e) => ({ ...e, id: e.key }))],
    customize.railOrder,
  );
}

function builtInTools(
  item: Item | null,
  project: Project,
  ctl: EditorController,
  l: Labels,
  targets: Targets,
  count: number,
): ToolEntry[] {
  const command = (id: CommandId, key = id): ToolEntry => {
    const c = getCommand(ctl, id);
    return {
      key,
      icon: c.icon,
      label: c.label,
      ...(c.tip ? { tip: c.tip } : {}),
      run: c.run,
      ...(c.danger ? { danger: true } : {}),
      disabledReason: c.disabledReason,
    };
  };
  const arrange: ToolEntry = {
    key: 'arrange',
    icon: 'layers',
    label: l.arrange,
    tip: l.tipArrange,
    tool: 'arrange',
  };
  if (count > 1) {
    return [
      command(ctl.selectedGroup() ? 'ungroup' : 'group', 'group'),
      arrange,
      command('lock'),
      command('hide'),
      command('duplicate'),
      command('delete'),
    ];
  }
  const entries = singleTools(item, project, ctl, l, targets, arrange);
  if (!item) return entries;
  // A locked item: only what doesn't change it (arrange holds Unlock; duplicate makes an unlocked copy).
  const found = findItem(project, item.id);
  const locked = !!found && (!!found.item.locked || found.track.locked);
  if (!locked) return entries;
  return entries.map((e) =>
    e.key === 'arrange' || e.key === 'duplicate' ? e : { ...e, disabledReason: l.lockedReason },
  );
}

function singleTools(
  item: Item | null,
  project: Project,
  ctl: EditorController,
  l: Labels,
  targets: Targets,
  arrange: ToolEntry,
): ToolEntry[] {
  const split: ToolEntry = {
    key: 'split',
    icon: 'split',
    label: l.split,
    tip: l.tipSplit,
    run: () => ctl.split(),
    disabledReason: targets.split.reason,
  };
  if (!item) {
    return [
      { key: 'media', icon: 'media', label: l.media, tip: l.tipAddMedia, panel: 'media' },
      {
        key: 'templates',
        icon: 'template',
        label: l.templates,
        tip: l.tipTemplates,
        panel: 'templates',
      },
      { key: 'text', icon: 'text', label: l.text, tip: l.tipText, panel: 'text' },
      {
        key: 'captions',
        icon: 'captions',
        label: l.captions,
        tip: l.tipCaptions,
        panel: 'captions',
      },
      { key: 'audio', icon: 'audio', label: l.audio, tip: l.tipAudio, panel: 'audio' },
      {
        key: 'stickers',
        icon: 'sticker',
        label: l.stickers,
        tip: l.tipStickers,
        panel: 'stickers',
      },
      { key: 'filters', icon: 'filter', label: l.filters, tip: l.tipFilter, tool: 'filter' },
      {
        key: 'transitions',
        icon: 'transition',
        label: l.transitions,
        tip: l.tipTransitions,
        tool: 'transition',
      },
      { key: 'blur', icon: 'blurArea', label: l.blurAreas, tip: l.tipBlurAreas, panel: 'blur' },
      { key: 'canvas', icon: 'canvas', label: l.canvas, tip: l.tipCanvas, tool: 'canvas' },
      split,
      ...(ctl.options.assistant
        ? [
            {
              key: 'assistant',
              icon: 'sparkle',
              label: l.assistant,
              tip: l.tipAssistant,
              panel: 'assistant',
            } as ToolEntry,
          ]
        : []),
    ];
  }
  const duplicate: ToolEntry = {
    key: 'duplicate',
    icon: 'duplicate',
    label: l.duplicate,
    tip: l.tipDuplicate,
    run: () => ctl.duplicateSelected(),
  };
  const remove: ToolEntry = {
    key: 'delete',
    icon: 'delete',
    label: l.delete,
    tip: l.tipDelete,
    run: () => ctl.deleteSelected(),
    danger: true,
  };
  const index = project.tracks[0]!.items.findIndex((i) => i.id === item.id);
  const onMain = index !== -1;
  const look: ToolEntry[] = [
    { key: 'filter', icon: 'filter', label: l.filter, tip: l.tipFilter, tool: 'filter' },
    { key: 'adjust', icon: 'adjust', label: l.adjust, tip: l.tipAdjust, tool: 'adjust' },
    { key: 'crop', icon: 'crop', label: l.crop, tip: l.tipCrop, tool: 'crop' },
    { key: 'transform', icon: 'rotate', label: l.rotate, tip: l.tipRotate, tool: 'transform' },
  ];
  const transition: ToolEntry[] = hasCutInto(project, item.id)
    ? [
        {
          key: 'transition',
          icon: 'transition',
          label: l.transition,
          tip: l.tipTransition,
          tool: 'transition',
        },
      ]
    : [];
  const animate: ToolEntry[] = onMain
    ? []
    : [{ key: 'animate', icon: 'sparkle', label: l.animate, tip: l.tipAnimate, tool: 'animate' }];
  const opacity: ToolEntry[] = onMain
    ? []
    : [{ key: 'opacity', icon: 'opacity', label: l.opacity, tip: l.tipOpacity, tool: 'opacity' }];
  // v0.2 C. Picture tools
  const greenScreen: ToolEntry = {
    key: 'key',
    icon: 'greenScreen',
    label: l.greenScreen,
    tip: l.tipGreenScreen,
    tool: 'key',
  };
  const mask: ToolEntry = {
    key: 'mask',
    icon: 'shape',
    label: l.shape,
    tip: l.tipShape,
    tool: 'mask',
  };
  // v0.4 Fine trims: clips of the main video, and video / sound anywhere.
  const protrim: ToolEntry[] =
    onMain || item.kind === 'video' || item.kind === 'audio'
      ? [{ key: 'protrim', icon: 'split', label: l.fineTrim, tip: l.tipFineTrim, tool: 'protrim' }]
      : [];
  // v0.4 Sound effects: video and sound clips.
  const soundfx: ToolEntry = {
    key: 'soundfx',
    icon: 'equalizer',
    label: l.soundEffects,
    tip: l.tipSoundEffects,
    tool: 'soundfx',
  };
  // v0.4 Keyframes: anything with a place on the video.
  const keyframes: ToolEntry[] =
    'transform' in item
      ? [
          {
            key: 'keyframes',
            icon: 'keyframe',
            label: l.keyframes,
            tip: l.tipKeyframes,
            tool: 'keyframes',
          },
        ]
      : [];
  // v0.3 Background removal (photos, image stickers; when the host gave a remover).
  const cutout: ToolEntry[] =
    ctl.options.backgroundRemover &&
    (item.kind === 'image' || (item.kind === 'sticker' && item.assetId))
      ? [
          {
            key: 'cutout',
            icon: 'cutout',
            label: l.removeBackground,
            tip: l.tipRemoveBackground,
            tool: 'cutout',
          },
        ]
      : [];
  const blend: ToolEntry[] = onMain
    ? []
    : [{ key: 'blend', icon: 'blend', label: l.blend, tip: l.tipBlend, tool: 'blend' }];
  switch (item.kind) {
    case 'video':
      return [
        split,
        { key: 'speed', icon: 'speed', label: l.speed, tip: l.tipSpeed, tool: 'speed' },
        {
          key: 'volume',
          icon: item.muted ? 'muted' : 'volume',
          label: l.volume,
          tip: l.tipVolume,
          tool: 'volume',
        },
        soundfx,
        ...look,
        mask,
        greenScreen,
        ...transition,
        { key: 'fade', icon: 'fade', label: l.fade, tip: l.tipFade, tool: 'fade' },
        ...protrim,
        {
          key: 'scenes',
          icon: 'scenes',
          label: l.splitAtScenes,
          tip: l.tipSplitAtScenes,
          tool: 'scenes',
        },
        ...(onMain
          ? [
              {
                key: 'freeze',
                icon: 'freeze',
                label: l.freeze,
                tip: l.tipFreeze,
                run: () => ctl.freezeSelected(),
                disabledReason: targets.freeze.reason,
              } as ToolEntry,
            ]
          : []),
        ...animate,
        ...keyframes,
        ...opacity,
        ...blend,
        arrange,
        duplicate,
        remove,
      ];
    case 'image':
    case 'freeze':
      return [
        split,
        { key: 'duration', icon: 'speed', label: l.duration, tip: l.duration, tool: 'duration' },
        ...cutout,
        ...look,
        mask,
        greenScreen,
        ...transition,
        ...protrim,
        ...animate,
        ...keyframes,
        ...opacity,
        ...blend,
        arrange,
        duplicate,
        remove,
      ];
    case 'audio':
      return [
        split,
        {
          key: 'volume',
          icon: item.muted ? 'muted' : 'volume',
          label: l.volume,
          tip: l.tipVolume,
          tool: 'volume',
        },
        soundfx,
        { key: 'fade', icon: 'fade', label: l.fade, tip: l.tipFade, tool: 'fade' },
        { key: 'speed', icon: 'speed', label: l.speed, tip: l.tipSpeed, tool: 'speed' },
        ...protrim,
        arrange,
        duplicate,
        remove,
      ];
    case 'text':
      // A caption: its words, the shared captions look, and cutting / joining.
      if (project.tracks.some((t) => t.kind === 'caption' && t.items.includes(item)))
        return [
          { key: 'text-edit', icon: 'edit', label: l.edit, tool: 'text-edit' },
          {
            key: 'captions',
            icon: 'captions',
            label: l.captionStyles,
            tip: l.tipCaptions,
            panel: 'captions',
          },
          split,
          {
            key: 'merge',
            icon: 'merge',
            label: l.mergeCaptions,
            tip: l.mergeCaptionsTip,
            run: () => ctl.mergeCaption(item.id),
          },
          remove,
        ];
      return [
        { key: 'text-edit', icon: 'edit', label: l.edit, tool: 'text-edit' },
        { key: 'text-style', icon: 'style', label: l.style, tool: 'text-style' },
        ...animate,
        look[0]!,
        look[1]!,
        { key: 'transform', icon: 'rotate', label: l.rotate, tip: l.tipRotate, tool: 'transform' },
        ...keyframes,
        { key: 'opacity', icon: 'opacity', label: l.opacity, tip: l.tipOpacity, tool: 'opacity' },
        ...blend,
        arrange,
        split,
        duplicate,
        remove,
      ];
    case 'sticker':
      return [
        ...cutout,
        ...animate,
        look[0]!,
        look[1]!,
        { key: 'transform', icon: 'rotate', label: l.rotate, tip: l.tipRotate, tool: 'transform' },
        ...keyframes,
        { key: 'opacity', icon: 'opacity', label: l.opacity, tip: l.tipOpacity, tool: 'opacity' },
        ...blend,
        arrange,
        split,
        duplicate,
        remove,
      ];
    case 'region':
      return [
        {
          key: 'region',
          icon: item.effect === 'pixelate' ? 'pixelate' : 'blurArea',
          label: l.blurArea,
          tip: l.tipBlurAreas,
          tool: 'region',
        },
        { key: 'transform', icon: 'rotate', label: l.rotate, tip: l.tipRotate, tool: 'transform' },
        ...keyframes,
        { key: 'opacity', icon: 'opacity', label: l.opacity, tip: l.tipOpacity, tool: 'opacity' },
        arrange,
        split,
        duplicate,
        remove,
      ];
  }
}
