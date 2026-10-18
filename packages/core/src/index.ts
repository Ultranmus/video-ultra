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
  groupOf,
  mainTrack,
  itemEnd,
  projectFrame,
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
  HistoryView,
} from './edit/history';

// Effects catalogues (filters, transitions, animations, adjustments, stickers, text styles)
export {
  FILTER_PRESETS,
  FILTER_CATEGORIES,
  TRANSITION_PRESETS,
  TRANSITION_CATEGORIES,
  findTransitionPreset,
  ANIMATION_PRESETS,
  ANIMATION_CATEGORIES,
  findAnimationPreset,
  ADJUST_KEYS,
  STICKER_EMOJI,
  FONT_PRESETS,
} from './effects/presets';
export type {
  FilterPreset,
  FilterCategory,
  TransitionPreset,
  TransitionCategory,
  AnimationPreset,
  AnimationSlot,
  AdjustKey,
  FontPreset,
} from './effects/presets';

// Export settings
export {
  maxExportHeight,
  exportLimits,
  exportSize,
  exportBitrate,
  exportAudioBitrate,
  EXPORT_HEIGHTS,
  EXPORT_PRESETS,
  presetFits,
  resolveExportRange,
} from './engine/export-plan';
export type {
  ExportOptions,
  ExportProgress,
  ExportResult,
  ExportHeight,
  ExportLimits,
  ExportRange,
  ExportPreset,
  AudioExportFormat,
  AudioExportOptions,
  AudioExportResult,
  FrameImageFormat,
  FrameImageOptions,
  FrameImage,
} from './engine/export-plan';

/** The package version. */
// Captions: subtitle files, words → captions, speech timing, style presets
export { parseSubtitles, formatSrt, formatVtt } from './captions/subtitles';
export type { SubtitleCue } from './captions/subtitles';
export { groupCaptions } from './captions/group';
export type { GroupOptions, GroupedCaption } from './captions/group';
export { captionWords, captionWordTimes, speechAt } from './captions/timing';
export type { SpeechPosition } from './captions/timing';
export { CAPTION_PRESETS, DEFAULT_CAPTION_PRESET, lookFromPreset } from './captions/presets';
export type { CaptionPreset } from './captions/presets';
// Captions: the transcriber interface (audio in, timed words out)
export { TRANSCRIBE_SAMPLE_RATE } from './captions/transcriber';
export type {
  Transcriber,
  TranscribeRequest,
  TranscribeResult,
  TranscribeProgress,
  TranscriptWord,
} from './captions/transcriber';

export const VERSION = '0.0.0';
