/**
 * Internal API for @video-ultra/react and the playground. Not covered by semver.
 */
export * from './index';
export { ALLOWED_KINDS, laneKindFor } from './model/project';
export { createLabSession } from './lab/client';
export type { LabSession } from './lab/client';
export type * from './lab/protocol';
export type {
  Backdrop,
  FramePlacement,
  LayerDraw,
  LayerSource,
  Renderer,
  RendererOptions,
  RegionDraw,
} from './render/types';
export { layerGeometry, displaySize, applyGeometry, GEOMETRY_FLOATS } from './render/layout';
export type { LayerLook, LayerMedia } from './render/layout';
export {
  activeLayers,
  itemIndexAt,
  sourceTimeAt,
  upcomingVideoItems,
  upcomingVideo,
  visibleSpan,
  transitionLength,
} from './engine/timeline';
export type { ActiveLayer, VisualItem, LayerTransition, UpcomingItem } from './engine/timeline';
export { measureTextBox, textFont, textFontPx } from './engine/text';
export type { MeasureText } from './engine/text';
export {
  colourParams,
  identityColour,
  FILTER_PARAMS,
  writeEffects,
  noFx,
  EFFECT_FLOATS,
  BlurMode,
  MaskShape,
  WarpKind,
  BLEND_IDS,
  chromaOf,
  keyParams,
  noPictureFx,
} from './effects/colour';
export type { ColourParams, LayerFx, PictureFx } from './effects/colour';
export { parseCubeLut, sampleLut, LutError, LUT_MIN_SIZE, LUT_MAX_SIZE } from './effects/lut';
export type { CubeLut } from './effects/lut';
export { layerBounds, regionTexel } from './render/grab';
export {
  transitionLook,
  transitionOverlay,
  fadeOverlay,
  easeAt,
  EASES,
  plainLook,
  noOverlay,
} from './effects/transitions';
export type { TransitionLook, TransitionOverlay, TransitionOptions } from './effects/transitions';
export { animationState, animationSpans, restingState } from './effects/animations';
export type { AnimationState } from './effects/animations';
export {
  placedGeometry,
  shiftGeometry,
  fullCanvasGeometry,
  moveOnCanvas,
  moveInBox,
} from './render/layout';
export type { GeometryMove } from './render/layout';
export { probeMedia, assetFromProbe, sniffImage, unsupportedVideoMessage } from './media/probe';
export type {
  ProbeResult,
  ProbedMedia,
  ProbeWarning,
  ProbeErrorCode,
  ProbeWarningCode,
} from './media/probe';
export { createWebGL2Renderer } from './render/webgl2';
export { createWebGPURenderer } from './render/webgpu';
export { browserEngine, hdrCalibrationFor, needsHdrCorrection } from './render/hdr';
export type { BrowserEngine } from './render/hdr';
export { createEngine } from './engine/client';
export type { Engine, EngineInternal, EngineOptions } from './engine/client';
export type { EngineStats, ExportRunInfo } from './engine/protocol';
export { Mixer } from './audio/mixer';
export type { AudioTrackSource } from './audio/mixer';
export { applyDuck, DUCK_TUNING, DuckFollower, hasDucking, presenceFor } from './audio/duck';
export type { DuckTuning } from './audio/duck';

// Media analysis (import probing, thumbnails, waveforms) — runs in its own worker.
export { createMediaAnalyzer } from './media/analyzer';
export type {
  MediaAnalyzer,
  MediaAnalyzerOptions,
  WaveformCache,
  AnalyzerStats,
  ThumbnailMode,
} from './media/analyzer';
export type { Waveform } from './media/peaks';
export {
  SceneDetector,
  sceneCutTimes,
  SCENE_FRAME_WIDTH,
  SCENE_FRAME_HEIGHT,
} from './media/scenes';
export type { SceneSensitivity, SceneOptions } from './media/scenes';
export { accumulatePeaks, peaksPerSecondFor, MAX_PEAKS } from './media/peaks';

// Persistence: media storage, autosave via the op log, crash recovery.
export { createProjectStorage, createProjectStorageOn } from './storage/project-storage';
export type {
  ProjectStorage,
  ProjectStorageOptions,
  ProjectWriter,
  MediaRecordingWriter,
  StoredProjectInfo,
  StoredLogEntry,
  StorageStatus,
  LoadedProject,
} from './storage/project-storage';
export { StorageFullError, MemoryFileStore } from './storage/files';
export type { FileStore } from './storage/files';
export type { HandleStore } from './storage/handles';
export { attachAutosave } from './storage/autosave';
export { lockProject } from './storage/lock';
export type { ProjectLock } from './storage/lock';
export type { Autosave, AutosaveOptions } from './storage/autosave';
