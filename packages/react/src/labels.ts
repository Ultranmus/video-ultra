/**
 * Every piece of text the editor shows. Pass a partial `labels` object to `<VideoEditor />` to
 * translate or reword; missing keys fall back to English. Functions receive values to place.
 */
export const DEFAULT_LABELS = {
  // Top bar
  close: 'Close',
  undo: 'Undo',
  redo: 'Redo',
  undoWhat: (what: string) => `Undo ${what.toLowerCase()}`,
  redoWhat: (what: string) => `Redo ${what.toLowerCase()}`,
  projectName: 'Project name',
  aspectRatio: 'Canvas size',
  export: 'Export',
  // Rail / panels
  media: 'Media',
  text: 'Text',
  audio: 'Audio',
  stickers: 'Stickers',
  canvas: 'Canvas',
  filters: 'Filters',
  transitions: 'Transitions',
  addMedia: 'Add media',
  addMediaHint: 'Videos, photos and music. Drop files here or pick them.',
  importing: (name: string) => `Adding ${name}…`,
  dropHere: 'Drop to add',
  addText: 'Add text',
  addMusic: 'Add music or sound',
  recordVoiceover: 'Record voiceover',
  stopRecording: 'Stop recording',
  recording: 'Recording…',
  microphoneBlocked:
    "The microphone is blocked. Allow it in the browser's site settings, then try again.",
  noMediaYet: 'Nothing added yet.',
  addToTimeline: 'Add to timeline',
  // Transport
  play: 'Play',
  pause: 'Pause',
  fullscreen: 'Full screen',
  exitFullscreen: 'Exit full screen',
  timecode: (now: string, total: string) => `${now} of ${total}`,
  // Timeline
  timeline: 'Timeline',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  mainTrack: 'Main track',
  lane: (kind: string, n: number) => `${kind} lane ${n}`,
  clipLabel: (n: number, kind: string, from: string, to: string) =>
    `Clip ${n}, ${kind}, ${from} to ${to}`,
  timelineHelp:
    'Arrow keys move the selected clip, Shift with arrows trims its end, Delete removes it.',
  emptyTimeline: 'Add videos or photos to start your story.',
  kind: {
    video: 'video',
    image: 'photo',
    freeze: 'freeze frame',
    audio: 'audio',
    text: 'text',
    sticker: 'sticker',
  } as Record<string, string>,
  // Tools
  split: 'Split',
  delete: 'Delete',
  duplicate: 'Duplicate',
  speed: 'Speed',
  volume: 'Volume',
  mute: 'Mute',
  unmute: 'Unmute',
  fade: 'Fade',
  fadeIn: 'Fade in',
  fadeOut: 'Fade out',
  extractAudio: 'Extract audio',
  freeze: 'Freeze',
  crop: 'Crop',
  rotate: 'Rotate',
  flipH: 'Flip horizontal',
  flipV: 'Flip vertical',
  fit: 'Fit',
  fill: 'Fill',
  fitMode: 'Fit or fill',
  adjust: 'Adjust',
  filter: 'Filter',
  none: 'None',
  intensity: 'Intensity',
  transition: 'Transition',
  transitionHint: 'Plays between this clip and the one before it.',
  duration: 'Duration',
  opacity: 'Opacity',
  position: 'Position',
  scale: 'Size',
  edit: 'Edit',
  style: 'Style',
  font: 'Font',
  color: 'Colour',
  outline: 'Outline',
  shadow: 'Shadow',
  background: 'Background',
  bold: 'Bold',
  italic: 'Italic',
  alignLeft: 'Align left',
  alignCenter: 'Align centre',
  alignRight: 'Align right',
  textPlaceholder: 'Your text',
  reset: 'Reset',
  done: 'Done',
  more: 'More',
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
  // Canvas
  ratio: 'Ratio',
  backgroundColor: 'Colour',
  backgroundBlur: 'Blur',
  blurAmount: 'Blur amount',
  // Export
  exportTitle: 'Export video',
  format: 'Format',
  resolution: 'Resolution',
  frameRate: 'Frame rate',
  quality: 'Quality',
  qualityLow: 'Smaller file',
  qualityMedium: 'Balanced',
  qualityHigh: 'Best quality',
  startExport: 'Export video',
  cancel: 'Cancel',
  exporting: 'Exporting…',
  exportProgress: (percent: number, eta: string | null) =>
    eta ? `${percent}% · about ${eta} left` : `${percent}%`,
  exportDone: 'Your video is ready.',
  download: 'Download',
  exportFailed: (reason: string) => `Export failed: ${reason}`,
  exportUnavailable: "Export isn't available in this build yet.",
  exportKeepOpen: 'Keep this tab open until the export finishes.',
  deviceLimit: 'Higher resolutions need a more powerful device.',
  // Status / errors
  loading: 'Loading the editor…',
  unsupportedTitle: "This browser can't edit video",
  unsupportedBody:
    'The editor needs WebCodecs and WebGL2. Use a current version of Chrome, Edge, Safari or Firefox.',
  engineError: (message: string) => `Preview problem: ${message}`,
  importFailed: (name: string, reason: string) => `${name}: ${reason}`,
  storageFull:
    "There's no space left to store this file. Free up space on this device or remove media you don't use.",
  notPersistent:
    'This browser may clear unsaved work after a few days. Save or export to keep it safe.',
  saved: 'Saved',
  saving: 'Saving…',
  dismiss: 'Dismiss',
  splitOutside: 'Move the playhead inside the clip to split it.',
  nothingSelected: 'Select a clip to edit it.',
} as const;

/** All labels. Override any subset through the `labels` prop. */
export type Labels = {
  -readonly [K in keyof typeof DEFAULT_LABELS]: (typeof DEFAULT_LABELS)[K] extends (
    ...args: infer A
  ) => string
    ? (...args: A) => string
    : (typeof DEFAULT_LABELS)[K] extends string
      ? string
      : (typeof DEFAULT_LABELS)[K];
};
