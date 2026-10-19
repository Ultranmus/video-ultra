import { findItem, mainTrack, type Item, type Project } from '@video-ultra/core';
import { useMemo, type ReactElement, type ReactNode } from 'react';
import { ControllerContext, SubjectContext, useController, useProject, useUi } from './context';
import { fanOutController } from './fanout';

/**
 * Editing several at once (DECISIONS #153): for each kind of setting, the selected item whose
 * tool is shown (its values are what the tool displays); a change to it reaches every selected
 * item with that setting (fanout.ts).
 */
export interface SharedReps {
  speed: Item | null;
  sound: Item | null;
  look: Item | null;
  /** Layers (not the main video): opacity, blend, entrance / exit. */
  layer: Item | null;
}

/** Picks the representative per setting from the selected items. Pure. */
export function sharedReps(project: Project, items: readonly Item[]): SharedReps {
  const main = new Set(mainTrack(project).items.map((i) => i.id));
  const editable = items.filter((i) => !i.locked);
  return {
    speed: editable.find((i) => 'speed' in i) ?? null,
    sound: editable.find((i) => 'volume' in i) ?? null,
    look: editable.find((i) => 'adjust' in i) ?? null,
    layer: editable.find((i) => 'transform' in i && i.kind !== 'region' && !main.has(i.id)) ?? null,
  };
}

/** The selected items (fresh from the project) and their representatives, when several. */
export function useSharedReps(): { ids: readonly string[]; reps: SharedReps } | null {
  const ids = useUi((s) => s.selectedIds);
  const items = useProject((p) =>
    ids.map((id) => findItem(p, id)?.item).filter((i): i is Item => !!i),
  );
  const ctl = useController();
  if (ids.length < 2) return null;
  return { ids, reps: sharedReps(ctl.project, items) };
}

/**
 * A left-menu panel (filters, transitions / animation) while several are selected: it shows the
 * representative and acts on all of them. One selected (or none): the panel as it is.
 */
export function SelectionScope({
  kind,
  children,
}: {
  kind: 'look' | 'motion';
  children: ReactNode;
}): ReactElement {
  const shared = useSharedReps();
  const ctl = useController();
  if (!shared) return <>{children}</>;
  const main = new Set(mainTrack(ctl.project).items.map((i) => i.id));
  const subject =
    kind === 'look'
      ? (shared.reps.look?.id ?? null)
      : (shared.reps.layer?.id ?? shared.ids.find((id) => main.has(id)) ?? null);
  return (
    <AllSelected ids={shared.ids} subject={subject}>
      {children}
    </AllSelected>
  );
}

/**
 * Tools inside act on every selected item: a fanning-out controller, and (`subject`) the item the
 * panel-level tools (filters, animation) show.
 */
export function AllSelected({
  ids,
  subject,
  children,
}: {
  ids: readonly string[];
  subject?: string | null;
  children: ReactNode;
}): ReactElement {
  const ctl = useController();
  const key = ids.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids by value
  const fan = useMemo(() => fanOutController(ctl, ids), [ctl, key]);
  const inner =
    subject !== undefined ? (
      <SubjectContext.Provider value={subject}>{children}</SubjectContext.Provider>
    ) : (
      children
    );
  return <ControllerContext.Provider value={fan}>{inner}</ControllerContext.Provider>;
}
