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
export {
  KEYFRAME_PROPS,
  sampleKeyframes,
  keyedTransform,
  keyedValue,
  keyTime,
  hasKeyframes,
  retimeKeyframes,
  curveAt,
  bezierAt,
  type KeyframeProp,
  type Keyframe,
  type Keyframes,
  type Bezier,
} from './model/keyframes';
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
  ExportVideoCodec,
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
export { groupCaptions, UNSURE_BELOW } from './captions/group';
export { hasDevanagari, romanizeHindi } from './captions/romanize';
export type { GroupOptions, GroupedCaption } from './captions/group';
export { captionWords, captionWordTimes, speechAt } from './captions/timing';
export type { SpeechPosition } from './captions/timing';
export { CAPTION_PRESETS, DEFAULT_CAPTION_PRESET, lookFromPreset } from './captions/presets';
export {
  TEMPLATE_PRESETS,
  TEMPLATE_CATEGORIES,
  TEMPLATE_THEMES,
  templatePreset,
  fillTemplateText,
  applyTemplate,
  type TemplatePreset,
  type TemplateElement,
  type TemplateVariable,
  type TemplateCategory,
  type Theme as TemplateTheme,
} from './templates/templates';
export {
  SHAPE_PRESETS,
  SHAPE_CATEGORIES,
  ShapeFamily,
  shapePreset,
  shapeDistance,
  shapeCoverage,
  type ShapePreset,
} from './effects/shapes';
// AI editing (v0.4, optional): the action language a host's model answers in.
export {
  applyEditActions,
  correctionRequest,
  describeProject,
  EditActionSchema,
  EDIT_ACTIONS_GUIDE,
  type EditAction,
  type EditingAssistant,
  type EditingRequest,
  type EditingResponse,
  type ProjectDescription,
} from './ai/assistant';
// Text to speech (v0.4, optional): the voice service interface.
export type { SpeechGenerator, SpeechRequest, SpeechVoice } from './ai/speech';
// Sound effects (v0.4): ready-made looks and the equaliser's band frequencies.
export { AUDIO_FX_PRESETS, EQ_BANDS, pitchRatio } from './audio/fx';
export type { CaptionPreset } from './captions/presets';
// Background removal: the remover interface (a picture in, the same with no background out)
export type {
  BackgroundRemover,
  BackgroundRemovalRequest,
  BackgroundRemoverCheck,
} from './ai/background';
// Captions: the transcriber interface (audio in, timed words out)
export { TRANSCRIBE_SAMPLE_RATE } from './captions/transcriber';
export type {
  Transcriber,
  TranscribeRequest,
  TranscribeResult,
  TranscribeProgress,
  TranscriptWord,
  TranscriberCheck,
} from './captions/transcriber';

export const VERSION = '0.0.0';
