/**
 * TEMPORARY stand-ins for core APIs being built in parallel (media analyzer, project storage,
 * export, preset catalogues). Same names and shapes as the agreed contracts; replaced by imports
 * from `@video-ultra/core` / `@video-ultra/core/internal` when that work is merged.
 */
import type { Asset, DeviceTier, Project } from '@video-ultra/core';
import type { Editor, ProbeResult } from '@video-ultra/core/internal';

export interface Waveform {
  peaksPerSecond: number;
  peaks: Float32Array;
  duration: number;
}

export interface MediaAnalyzer {
  probe(file: Blob, name: string): Promise<ProbeResult>;
  addMedia(assetId: string, blob: Blob, kind: 'video' | 'audio' | 'image'): void;
  removeMedia(assetId: string): void;
  thumbnail(
    assetId: string,
    seconds: number,
    height: number,
    signal?: AbortSignal,
  ): Promise<ImageBitmap | null>;
  waveform(assetId: string, signal?: AbortSignal): Promise<Waveform | null>;
  destroy(): void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createMediaAnalyzer(_options?: { tier?: DeviceTier }): MediaAnalyzer {
  const images = new Map<string, Blob>();
  return {
    async probe(file, name) {
      const { probeMedia } = await import('@video-ultra/core/internal');
      return probeMedia(file, name);
    },
    addMedia(assetId, blob, kind) {
      if (kind === 'image') images.set(assetId, blob);
    },
    removeMedia(assetId) {
      images.delete(assetId);
    },
    async thumbnail(assetId, _seconds, height) {
      const blob = images.get(assetId);
      if (!blob) return null;
      return createImageBitmap(blob, { resizeHeight: Math.max(8, Math.round(height)) });
    },
    async waveform() {
      return null;
    },
    destroy() {
      images.clear();
    },
  };
}

export class StorageFullError extends Error {
  constructor(message = 'Storage is full') {
    super(message);
    this.name = 'StorageFullError';
  }
}

export interface ProjectStorage {
  readonly kind: 'opfs' | 'memory';
  status(): Promise<{ persistent: boolean; usage: number | null; quota: number | null }>;
  requestPersistence(): Promise<boolean>;
  putMedia(assetId: string, file: Blob, signal?: AbortSignal): Promise<Asset['source']>;
  getMedia(asset: Asset): Promise<Blob | null>;
  deleteMedia(assetId: string): Promise<void>;
  listProjects(): Promise<{ id: string; name: string; updatedAt: string }[]>;
  loadProject(id: string): Promise<{ project: Project; warnings: string[] } | null>;
  deleteProject(id: string): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function createProjectStorage(_options?: {
  namespace?: string;
}): Promise<ProjectStorage> {
  const media = new Map<string, Blob>();
  const projects = new Map<string, Project>();
  return {
    kind: 'memory',
    async status() {
      return { persistent: false, usage: null, quota: null };
    },
    async requestPersistence() {
      return false;
    },
    async putMedia(assetId, file) {
      media.set(assetId, file);
      return { type: 'opfs', key: assetId };
    },
    async getMedia(asset) {
      if (asset.source.type === 'url') return (await fetch(asset.source.url)).blob();
      return media.get(asset.id) ?? null;
    },
    async deleteMedia(assetId) {
      media.delete(assetId);
    },
    async listProjects() {
      return [...projects.values()].map((p) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
      }));
    },
    async loadProject(id) {
      const project = projects.get(id);
      return project ? { project, warnings: [] } : null;
    },
    async deleteProject(id) {
      projects.delete(id);
    },
  };
}

export function attachAutosave(
  editor: Editor,
  _storage: ProjectStorage,
  options: {
    onSave?: (project: Project) => void | Promise<void>;
    onError?: (error: Error) => void;
    debounceMs?: number;
  } = {},
): { flush(): Promise<void>; detach(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = async () => {
    timer = undefined;
    try {
      await options.onSave?.(editor.getProject());
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const off = editor.onCommit(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void save(), options.debounceMs ?? 1000);
  });
  return {
    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        await save();
      }
    },
    detach() {
      clearTimeout(timer);
      off();
    },
  };
}

export interface ExportOptions {
  format: 'mp4' | 'webm';
  height: 480 | 720 | 1080 | 1440 | 2160;
  fps: 24 | 30 | 60;
  quality: 'low' | 'medium' | 'high';
}
export interface ExportProgress {
  fraction: number;
  framesDone: number;
  framesTotal: number;
  etaSeconds: number | null;
}
export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  width: number;
  height: number;
  durationSeconds: number;
  storage: 'opfs' | 'memory';
}

export function maxExportHeight(tier: DeviceTier): number {
  return tier === 'low' ? 1080 : tier === 'mid' ? 1440 : 2160;
}

export const FILTER_PRESETS: readonly { id: string; label: string }[] = [
  { id: 'vivid', label: 'Vivid' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'mono', label: 'Mono' },
  { id: 'fade', label: 'Fade' },
  { id: 'film', label: 'Film' },
  { id: 'noir', label: 'Noir' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dream', label: 'Dream' },
  { id: 'punch', label: 'Punch' },
  { id: 'teal-orange', label: 'Teal & orange' },
  { id: 'vintage', label: 'Vintage' },
];

export const TRANSITION_PRESETS: readonly { id: string; label: string }[] = [
  { id: 'fade', label: 'Fade' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'slide-left', label: 'Slide' },
  { id: 'slide-up', label: 'Slide up' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'wipe', label: 'Wipe' },
  { id: 'blur', label: 'Blur' },
];

export const ADJUST_KEYS: readonly { key: string; label: string }[] = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'warmth', label: 'Warmth' },
  { key: 'tint', label: 'Tint' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'sharpen', label: 'Sharpen' },
  { key: 'vignette', label: 'Vignette' },
];

export const STICKER_EMOJI: readonly string[] = [
  '😀',
  '😂',
  '😍',
  '🥳',
  '😎',
  '🤩',
  '😭',
  '😱',
  '🤔',
  '🙌',
  '👏',
  '👍',
  '❤️',
  '🔥',
  '✨',
  '⭐',
  '💯',
  '🎉',
  '🎂',
  '🎁',
  '🌈',
  '☀️',
  '🌙',
  '⚡',
  '🌸',
  '🍕',
  '☕',
  '🎵',
  '📍',
  '✈️',
  '🏖️',
  '🐶',
  '🐱',
  '🦋',
  '🌊',
  '🏆',
  '💪',
  '👀',
  '💬',
  '✅',
  '❌',
  '➡️',
  '⬆️',
  '💡',
  '📸',
  '🎬',
  '💥',
  '🙏',
];

export const FONT_PRESETS: readonly {
  id: string;
  label: string;
  family: string;
  weight: number;
}[] = [
  { id: 'classic', label: 'Classic', family: 'system-ui, sans-serif', weight: 700 },
  { id: 'light', label: 'Light', family: 'system-ui, sans-serif', weight: 300 },
  { id: 'serif', label: 'Serif', family: 'Georgia, "Times New Roman", serif', weight: 700 },
  { id: 'mono', label: 'Typewriter', family: 'ui-monospace, Menlo, monospace', weight: 500 },
  {
    id: 'rounded',
    label: 'Rounded',
    family: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
    weight: 800,
  },
  {
    id: 'condensed',
    label: 'Condensed',
    family: '"Arial Narrow", "Roboto Condensed", sans-serif-condensed, sans-serif',
    weight: 700,
  },
  {
    id: 'hand',
    label: 'Handwritten',
    family: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive',
    weight: 400,
  },
];
