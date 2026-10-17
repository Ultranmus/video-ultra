import {
  findItem,
  itemEnd,
  mainTrack,
  projectFrame,
  type Item,
  type Project,
  type Time,
} from '@video-ultra/core';
import { itemIndexAt } from '@video-ultra/core/internal';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useController } from './context';
import type { Labels } from './labels';

/**
 * What each action would act on right now, and why it can't when it can't. One place, so the
 * desktop timeline bar, the phone toolbar and the shortcuts agree — and no button ever silently
 * does nothing.
 */

/** Visual items that have a look (filter, adjustments, crop). */
export type LookItem = Extract<Item, { filter: unknown }>;

export interface Targets {
  /** The selected item, or the main clip under the playhead. */
  subject: Item | null;
  /** Split / freeze act on this item at the playhead. */
  split: { item: Item | null; reason: string | null };
  freeze: { item: Item | null; reason: string | null };
  /** Delete / duplicate act on the selection only. */
  selection: { item: Item | null; reason: string | null };
  /** Filters and adjustments: the selected visual clip, else the main clip under the playhead. */
  look: LookItem | null;
  /** Transitions: the clip after the cut — selected main clip, else the cut nearest the playhead. */
  transition: Item | null;
  hasClips: boolean;
}

/** The main clip under the playhead (the last one when the playhead is at the very end). */
function mainAt(project: Project, t: Time): Item | null {
  const items = mainTrack(project).items;
  const index = itemIndexAt(items, t);
  if (index !== -1) return items[index]!;
  const last = items[items.length - 1];
  return last && t >= itemEnd(last) ? last : null;
}

/** Computes {@link Targets} for a project, selection and playhead. Pure. */
export function computeTargets(
  project: Project,
  selectedId: string | null,
  t: Time,
  l: Labels,
): Targets {
  const selected = selectedId ? (findItem(project, selectedId)?.item ?? null) : null;
  const items = mainTrack(project).items;
  const hasClips = project.tracks.some((tr) => tr.items.length > 0);
  const under = mainAt(project, t);
  const frame = projectFrame(project);

  // Split: the selection if the playhead is inside it, else the main clip under the playhead.
  const splitItem =
    selected && t >= selected.start && t < itemEnd(selected) ? selected : selected ? null : under;
  let splitReason: string | null = null;
  if (!hasClips) splitReason = l.needClips;
  else if (!splitItem) splitReason = selected ? l.playheadOutsideSelection : l.playheadOutsideClips;
  else if (t < splitItem.start + frame || t > itemEnd(splitItem) - frame)
    splitReason = l.playheadAtEdge;

  const freezeBase = selected ?? under;
  const freezeItem =
    freezeBase &&
    freezeBase.kind === 'video' &&
    items.includes(freezeBase) &&
    t >= freezeBase.start &&
    t < itemEnd(freezeBase)
      ? freezeBase
      : null;
  const freezeReason = !hasClips
    ? l.needClips
    : freezeItem
      ? null
      : freezeBase && freezeBase.kind !== 'video'
        ? l.freezeVideoOnly
        : l.playheadOutsideClips;

  const look: LookItem | null =
    selected && 'filter' in selected ? selected : under && 'filter' in under ? under : null;

  let transition: Item | null = null;
  const selIndex = selected ? items.indexOf(selected) : -1;
  if (selIndex > 0) transition = selected;
  else if (items.length > 1) {
    // The cut nearest the playhead.
    let best = 1;
    for (let i = 1; i < items.length; i++)
      if (Math.abs(items[i]!.start - t) < Math.abs(items[best]!.start - t)) best = i;
    transition = items[best]!;
  }

  return {
    subject: selected ?? under,
    split: { item: splitReason ? null : splitItem, reason: splitReason },
    freeze: { item: freezeItem, reason: freezeReason },
    selection: { item: selected, reason: selected ? null : hasClips ? l.selectFirst : l.needClips },
    look,
    transition,
    hasClips,
  };
}

function key(t: Targets): string {
  return [
    t.subject?.id,
    t.split.item?.id,
    t.split.reason,
    t.freeze.item?.id,
    t.freeze.reason,
    t.selection.item?.id,
    t.look?.id,
    t.transition?.id,
    t.hasClips,
  ].join('|');
}

/**
 * {@link Targets} for the editor, re-rendering only when the answer changes — not on every
 * playhead frame (the playhead is a subscription, CLAUDE.md "React never renders per frame").
 */
export function useTargets(): Targets {
  const ctl = useController();
  const project = useStore(ctl.editor.store, (s) => s.project);
  const selectedId = useStore(ctl.ui, (s) => s.selectedId);
  const [targets, setTargets] = useState(() =>
    computeTargets(project, selectedId, ctl.playhead.time, ctl.labels),
  );
  useEffect(() => {
    let last = '';
    const update = (t: number) => {
      const next = computeTargets(project, selectedId, t, ctl.labels);
      const k = key(next);
      if (k !== last) {
        last = k;
        setTargets(next);
      }
    };
    update(ctl.playhead.time);
    return ctl.playhead.subscribe(update);
  }, [ctl, project, selectedId]);
  return targets;
}
