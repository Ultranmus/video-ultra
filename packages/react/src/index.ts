/**
 * @video-ultra/react — the video editor component for React and Next.js, plus hooks to build your
 * own UI on the same controller.
 */
export { VideoEditor } from './VideoEditor';
export type { VideoEditorProps } from './VideoEditor';
export { EditorController } from './controller';
export type { ControllerOptions } from './controller';
export { useController, useUi, useProject, useHistory, useLabels } from './context';
export { DEFAULT_LABELS } from './labels';
export type { Labels } from './labels';
export type { UiState, LayoutMode, PanelId, ToolId } from './state';
export { createStarterSounds } from './library/starter-sounds';
export type { StarterSoundLabels } from './library/starter-sounds';
export type {
  AudioLibrary,
  AudioLibraryCategory,
  AudioLibraryPage,
  AudioLibraryQuery,
  AudioLibraryTrack,
} from './library/audio-library';
export type {
  EditorCustomization,
  EditorEvent,
  CustomPanel,
  CustomButton,
  CustomIconPath,
  MediaSource,
  MediaSourceItem,
} from './embed';
export { themeOverridesToStyle } from './theme';
export type { ThemeMode, ThemeOverrides } from './theme';
export { VERSION, detectCapabilities } from '@video-ultra/core';
export type {
  Capabilities,
  DeviceTier,
  Project,
  ExportOptions,
  ExportProgress,
  ExportResult,
} from '@video-ultra/core';
