import fc from 'fast-check';
import type { Editor } from '../edit/history';
import {
  EditError,
  addToLane,
  arrangeItem,
  deleteItem,
  duplicateItem,
  freezeFrame,
  groupItems,
  insertMain,
  moveItem,
  reorderMain,
  setItemFlags,
  setSpeed,
  setTransition,
  shiftItems,
  splitItem,
  trimItem,
  ungroupItems,
  updateItem,
} from '../edit/ops';
import type { Project } from '../model/schema';
import { fromSeconds as s } from '../model/time';
import {
  audioItem,
  fixtureProject,
  imageItem,
  regionItem,
  stickerItem,
  textItem,
  videoItem,
} from './fixtures';

/** Random edit sequences for property tests (history, autosave recovery). */

/** The fixture project with a video and a photo on the main track. */
export function startProject(): Project {
  const project = fixtureProject();
  insertMain(project, videoItem('a', 'vidA', 5));
  insertMain(project, imageItem('b', 3));
  return project;
}

export type Op =
  | { op: 'split'; pick: number; at: number }
  | { op: 'trim'; pick: number; edge: 'start' | 'end'; delta: number }
  | { op: 'speed'; pick: number; speed: number }
  | { op: 'delete'; pick: number }
  | { op: 'duplicate'; pick: number }
  | { op: 'reorder'; pick: number; to: number }
  | { op: 'move'; pick: number; start: number }
  | { op: 'freeze'; pick: number; at: number }
  | { op: 'transition'; pick: number; duration: number }
  | { op: 'addMain'; kind: 'video' | 'image'; seconds: number; sourceIn: number }
  | {
      op: 'addLane';
      kind: 'text' | 'audio' | 'sticker' | 'region';
      start: number;
      seconds: number;
    }
  | { op: 'picture'; pick: number; tool: 'key' | 'lut' | 'blend' | 'region' | 'clear' }
  | { op: 'flags'; pick: number; locked: boolean; hidden: boolean }
  | { op: 'group'; pick: number; other: number }
  | { op: 'ungroup'; pick: number }
  | { op: 'shift'; pick: number; other: number; delta: number }
  | { op: 'arrange'; pick: number; to: 'forward' | 'backward' | 'front' | 'back'; at: number }
  | { op: 'duck'; pick: number; amount: number }
  | { op: 'goTo'; position: number }
  | { op: 'undo' }
  | { op: 'redo' };

const fraction = fc.double({ min: 0, max: 1, noNaN: true });
export const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant('split' as const), pick: fc.nat(), at: fraction }),
  fc.record({
    op: fc.constant('trim' as const),
    pick: fc.nat(),
    edge: fc.constantFrom('start' as const, 'end' as const),
    delta: fc.double({ min: -8, max: 8, noNaN: true }),
  }),
  fc.record({
    op: fc.constant('speed' as const),
    pick: fc.nat(),
    speed: fc.constantFrom(0.1, 0.25, 0.5, 1, 1.5, 2, 4, 10),
  }),
  fc.record({ op: fc.constant('delete' as const), pick: fc.nat() }),
  fc.record({ op: fc.constant('duplicate' as const), pick: fc.nat() }),
  fc.record({ op: fc.constant('reorder' as const), pick: fc.nat(), to: fc.nat({ max: 8 }) }),
  fc.record({
    op: fc.constant('move' as const),
    pick: fc.nat(),
    start: fc.double({ min: 0, max: 30, noNaN: true }),
  }),
  fc.record({ op: fc.constant('freeze' as const), pick: fc.nat(), at: fraction }),
  fc.record({
    op: fc.constant('transition' as const),
    pick: fc.nat(),
    duration: fc.double({ min: 0, max: 5, noNaN: true }),
  }),
  fc.record({
    op: fc.constant('addMain' as const),
    kind: fc.constantFrom('video' as const, 'image' as const),
    seconds: fc.double({ min: 0.05, max: 12, noNaN: true }),
    sourceIn: fc.double({ min: 0, max: 9, noNaN: true }),
  }),
  fc.record({
    op: fc.constant('addLane' as const),
    kind: fc.constantFrom('text' as const, 'audio' as const, 'sticker' as const, 'region' as const),
    start: fc.double({ min: 0, max: 20, noNaN: true }),
    seconds: fc.double({ min: 0.05, max: 8, noNaN: true }),
  }),
  fc.record({
    op: fc.constant('flags' as const),
    pick: fc.nat(),
    locked: fc.boolean(),
    hidden: fc.boolean(),
  }),
  fc.record({ op: fc.constant('group' as const), pick: fc.nat(), other: fc.nat() }),
  fc.record({ op: fc.constant('ungroup' as const), pick: fc.nat() }),
  fc.record({
    op: fc.constant('shift' as const),
    pick: fc.nat(),
    other: fc.nat(),
    delta: fc.double({ min: -10, max: 10, noNaN: true }),
  }),
  fc.record({
    op: fc.constant('arrange' as const),
    pick: fc.nat(),
    to: fc.constantFrom('forward' as const, 'backward' as const, 'front' as const, 'back' as const),
    at: fc.double({ min: 0, max: 20, noNaN: true }),
  }),
  fc.record({
    op: fc.constant('duck' as const),
    pick: fc.nat(),
    amount: fc.constantFrom(0, 0.3, 0.75, 1, 1.4),
  }),
  fc.record({
    op: fc.constant('picture' as const),
    pick: fc.nat(),
    tool: fc.constantFrom(
      'key' as const,
      'lut' as const,
      'blend' as const,
      'region' as const,
      'clear' as const,
    ),
  }),
  fc.record({ op: fc.constant('goTo' as const), position: fc.nat({ max: 12 }) }),
  fc.constant({ op: 'undo' as const }),
  fc.constant({ op: 'redo' as const }),
);

function allItems(project: Project) {
  return project.tracks.flatMap((t) => t.items);
}

export function run(editor: Editor, step: Op, newId: () => string): void {
  const items = allItems(editor.getProject());
  const pickItem = (n: number) => (items.length ? items[n % items.length]! : null);
  try {
    switch (step.op) {
      case 'undo':
        editor.undo();
        return;
      case 'redo':
        editor.redo();
        return;
      case 'goTo':
        editor.goTo(Math.min(step.position, editor.history().labels.length));
        return;
      case 'addMain': {
        const item =
          step.kind === 'video'
            ? videoItem(newId(), 'vidA', step.seconds, step.sourceIn)
            : imageItem(newId(), step.seconds);
        editor.apply('Add', (d) => insertMain(d, item));
        return;
      }
      case 'addLane': {
        const id = newId();
        const item =
          step.kind === 'text'
            ? textItem(id, step.start, step.seconds)
            : step.kind === 'audio'
              ? audioItem(id, step.start, step.seconds)
              : step.kind === 'region'
                ? regionItem(id, step.start, step.seconds)
                : stickerItem(id, step.start, step.seconds);
        editor.apply('Add', (d, ctx) => addToLane(d, item, ctx.ids));
        return;
      }
    }
    const item = pickItem(step.pick);
    if (!item) return;
    switch (step.op) {
      case 'split':
        editor.apply('Split', (d, ctx) =>
          splitItem(d, item.id, item.start + Math.round(item.duration * step.at), ctx.ids),
        );
        break;
      case 'trim':
        editor.apply('Trim', (d) => trimItem(d, item.id, step.edge, s(step.delta)));
        break;
      case 'speed':
        editor.apply('Speed', (d, ctx) => setSpeed(d, item.id, step.speed, ctx.ids));
        break;
      case 'delete':
        editor.apply('Delete', (d) => deleteItem(d, item.id));
        break;
      case 'duplicate':
        editor.apply('Duplicate', (d, ctx) => duplicateItem(d, item.id, ctx.ids));
        break;
      case 'reorder':
        editor.apply('Reorder', (d) => reorderMain(d, item.id, step.to));
        break;
      case 'move':
        editor.apply('Move', (d, ctx) => moveItem(d, item.id, s(step.start), ctx.ids));
        break;
      case 'freeze':
        editor.apply('Freeze', (d, ctx) =>
          freezeFrame(d, item.id, item.start + Math.round(item.duration * step.at), ctx.ids, s(1)),
        );
        break;
      case 'flags':
        editor.apply('Lock', (d) =>
          setItemFlags(d, item.id, { locked: step.locked, hidden: step.hidden }),
        );
        break;
      case 'group': {
        const other = pickItem(step.other)!;
        editor.apply('Group', (d, ctx) => groupItems(d, [item.id, other.id], ctx.ids));
        break;
      }
      case 'ungroup':
        if (item.groupId) editor.apply('Ungroup', (d) => ungroupItems(d, item.groupId!));
        break;
      case 'shift': {
        const other = pickItem(step.other)!;
        editor.apply('Move', (d, ctx) =>
          shiftItems(d, [item.id, other.id], s(step.delta), ctx.ids),
        );
        break;
      }
      case 'arrange':
        editor.apply('Arrange', (d, ctx) => arrangeItem(d, item.id, step.to, s(step.at), ctx.ids));
        break;
      case 'duck':
        editor.apply('Lower under voice', (d) => updateItem(d, item.id, { duck: step.amount }));
        break;
      case 'picture':
        editor.apply('Picture', (d) =>
          updateItem(
            d,
            item.id,
            step.tool === 'key'
              ? { key: { color: '#00b140', tolerance: 0.4, softness: 0.3, spill: 0.5 } }
              : step.tool === 'lut'
                ? { lut: { assetId: 'look', intensity: 0.7 } }
                : step.tool === 'blend'
                  ? { blend: 'screen' }
                  : step.tool === 'region'
                    ? { effect: 'pixelate', shape: 'ellipse', amount: 0.8, width: 0.5 }
                    : { key: null, lut: null, blend: null },
          ),
        );
        break;
      case 'transition':
        editor.apply('Transition', (d) =>
          setTransition(d, item.id, { type: 'fade', duration: Math.max(1, s(step.duration)) }),
        );
        break;
    }
  } catch (error) {
    // Refused edits are fine (and leave the project unchanged); anything else is a bug.
    if (!(error instanceof EditError)) throw error;
  }
}
