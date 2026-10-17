/**
 * @video-ultra/core — framework-agnostic video editing engine.
 * Public, semver-covered API. Everything else lives in `@video-ultra/core/internal`.
 */
export { detectCapabilities } from './capabilities';
export type { Capabilities, DeviceTier } from './capabilities';
export type { RenderBackend } from './render/types';

// Project model
export * from './model/time';
export * from './model/schema';
export {
  createProject,
  projectDuration,
  findItem,
  mainTrack,
  itemEnd,
  sourceSpan,
  randomId,
  sequentialIds,
  DEFAULT_TRANSFORM,
  DEFAULT_TEXT_STYLE,
  NO_CROP,
} from './model/project';
export type { CreateProjectOptions, IdFactory } from './model/project';
export { parseProject, repairProject } from './model/migrate';
export type { ParseResult } from './model/migrate';
export { checkInvariants } from './model/invariants';

// Editing
export * from './edit/ops';
export { createEditor, replayLog } from './edit/history';
export type {
  Editor,
  EditorOptions,
  EditorState,
  EditContext,
  ApplyOptions,
  LogEntry,
} from './edit/history';

/** The package version. */
export const VERSION = '0.0.0';
