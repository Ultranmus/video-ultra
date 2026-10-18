import {
  detectCapabilities,
  type Asset,
  type Capabilities,
  type Project,
  type ExportResult,
  type AudioExportResult,
  type FrameImage,
} from '@video-ultra/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { ControllerContext, useController, useLabels, useUi } from './context';
import { EditorController } from './controller';
import { CameraRecorder } from './Camera';
import { ExportDialog } from './ExportDialog';
import { Icon } from './icons';
import { DEFAULT_LABELS, type Labels } from './labels';
import type { AudioLibrary } from './library/audio-library';
import {
  Dock,
  HelpSheet,
  Inspector,
  Panel,
  PhoneTransport,
  PreviewBar,
  Rail,
  Timeline,
  TimelineBar,
  Toasts,
  Toolbar,
  TopBar,
} from './shell';
import { Tooltips } from './Tooltips';
import { commandForKey, runCommand } from './commands';
import { ContextMenu } from './organize';
import { Stage } from './Stage';
import type { LayoutMode } from './state';
import { themeOverridesToStyle, type ThemeMode, type ThemeOverrides } from './theme';

/** Props of {@link VideoEditor}. */
export interface VideoEditorProps {
  /** Project to open (object or JSON string). Without it the last autosaved project reopens, or a new one starts. */
  initialProject?: Project | string;
  /** Called about a second after each edit with the current project. This is the durable save — store it. */
  onSave?: (project: Project) => void | Promise<void>;
  /** Called when an export finishes, with the video file. */
  onExport?: (result: ExportResult) => void;
  /** Called when a sound-only export finishes, with the sound file. */
  onExportAudio?: (result: AudioExportResult) => void;
  /** Called when a frame is saved as a picture, with the image file. */
  onSaveFrame?: (image: FrameImage) => void;
  /** Shows a close button that calls this. */
  onClose?: () => void;
  /** Called when the device can't run the editor (instead of, or as well as, the built-in message). */
  onUnsupported?: (capabilities: Capabilities) => void;
  /** Gets bytes for media the host stores itself (assets with `url` sources). */
  resolveMedia?: (asset: Asset) => Promise<Blob | null>;
  /** Keep a local autosave and crash-recovery copy in the browser (default true). */
  autosave?: boolean;
  /**
   * Where the 3D sticker images come from: a base URL (self-host the MIT-licensed set), or `false`
   * to offer only emoji, shapes and uploads. Default: a pinned public CDN. Placed stickers are
   * stored in the project, so exports never depend on it.
   */
  stickerLibrary?: string | false;
  /**
   * A music & sound-effects source for the Audio panel: search, categories, a ▶ preview and the
   * licence line per sound, and Add (at the playhead). The picked file is stored in the project
   * like an import (its licence line on the asset as `credit`), so exports never depend on the
   * source. Without it the Audio panel offers the user's own files and voiceover only — the
   * editor ships no catalogue. `createStarterSounds()` is a small built-in set of synthesised,
   * CC0 sound effects. Read once, like `initialProject`.
   */
  audioLibrary?: AudioLibrary;
  /** `dark` (default), `light` or `auto` (follow the OS). */
  theme?: ThemeMode;
  /** Typed overrides for the common theme tokens. */
  themeOverrides?: ThemeOverrides;
  /** Replace any of the editor's text (translation). */
  labels?: Partial<Labels>;
  /** Text direction of the editor chrome. The timeline always runs left to right. */
  dir?: 'ltr' | 'rtl';
  /** Called once the editor is ready, with its controller (programmatic control: play, seek, edits). */
  onReady?: (controller: EditorController) => void;
  /** Force a renderer (testing). Default: WebGPU when available, else WebGL2. */
  backend?: 'auto' | 'webgpu' | 'webgl2';
  className?: string;
  style?: CSSProperties;
}

const ACCEPT = 'video/*,audio/*,image/*,.mov,.mkv,.heic,.heif,.m4a,.mp3,.wav';

/**
 * The video editor. Drop it anywhere — it fills its container and picks the phone, tablet or
 * desktop layout from its own width (container queries), not the window's.
 *
 * ```tsx
 * import { VideoEditor } from '@video-ultra/react';
 * import '@video-ultra/react/styles.css';
 *
 * <VideoEditor onSave={(project) => save(project)} onExport={({ blob }) => upload(blob)} />
 * ```
 */
export function VideoEditor(props: VideoEditorProps): ReactElement {
  const [ctl] = useState(() => {
    const labels = { ...DEFAULT_LABELS, ...props.labels } as Labels;
    const parsed = props.initialProject ? EditorController.parse(props.initialProject) : null;
    const controller = new EditorController(
      {
        labels,
        ...(props.backend ? { backend: props.backend } : {}),
        ...(props.onSave ? { onSave: props.onSave } : {}),
        ...(props.onExport ? { onExport: props.onExport } : {}),
        ...(props.onExportAudio ? { onExportAudio: props.onExportAudio } : {}),
        ...(props.onSaveFrame ? { onSaveFrame: props.onSaveFrame } : {}),
        ...(props.resolveMedia ? { resolveMedia: props.resolveMedia } : {}),
        ...(props.autosave !== undefined ? { autosave: props.autosave } : {}),
        ...(props.stickerLibrary !== undefined ? { stickerLibrary: props.stickerLibrary } : {}),
        ...(props.audioLibrary ? { audioLibrary: props.audioLibrary } : {}),
      },
      parsed?.project ?? undefined,
    );
    if (parsed?.error) controller.toast(parsed.error, 'error');
    return { controller, initial: parsed?.project ?? null };
  });
  const controller = ctl.controller;
  const rootRef = useRef<HTMLDivElement>(null);

  // Start: capabilities, storage, media. Strict mode mounts twice — `cancelled` guards async work.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const caps = await detectCapabilities();
      if (cancelled) return;
      if (!caps.supported) {
        controller.ui.setState({ status: 'unsupported' });
        props.onUnsupported?.(caps);
        return;
      }
      await controller.start(caps, ctl.initial);
      if (cancelled) return;
      controller.ui.setState({ status: 'ready' });
      props.onReady?.(controller);
    })().catch((error: unknown) => {
      if (!cancelled)
        controller.ui.setState({
          status: 'error',
          statusMessage: error instanceof Error ? error.message : String(error),
        });
    });
    return () => {
      cancelled = true;
      controller.stop();
      controller.ui.setState({ status: 'loading' });
    };
    // Mount-only: props are read once (like `defaultValue`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);

  useEffect(() => {
    controller.setRoot(rootRef.current);
    return () => controller.setRoot(null);
  }, [controller]);

  // On-screen keyboard (phones): the visible area shrinks and iOS scrolls the page. Keep the
  // editor one box: --vu-keyboard is how much of the editor the keyboard covers, and the bottom
  // area moves up by it while a text field is focused.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const root = rootRef.current;
    if (!vv || !root) return;
    const update = () => {
      const rect = root.getBoundingClientRect();
      const visibleBottom = vv.offsetTop + vv.height;
      const covered = Math.max(0, Math.round(rect.bottom - visibleBottom));
      root.style.setProperty('--vu-keyboard', `${covered}px`);
      root.toggleAttribute('data-keyboard', covered > 80);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // Layout from the editor's own width.
  useEffect(() => {
    const root = rootRef.current!;
    const ro = new ResizeObserver(() => {
      const w = root.clientWidth;
      const layout: LayoutMode = w < 768 ? 'phone' : w < 1024 ? 'tablet' : 'desktop';
      controller.setLayout(layout);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [controller]);

  const theme = props.theme ?? 'dark';
  return (
    <ControllerContext.Provider value={controller}>
      <div
        ref={rootRef}
        className={`vu-root${props.className ? ` ${props.className}` : ''}`}
        data-vu-theme={theme === 'auto' ? undefined : theme}
        dir={props.dir ?? 'ltr'}
        tabIndex={-1}
        onPointerDown={(e) => {
          // Clicking the canvas or empty chrome keeps keyboard shortcuts working.
          const target = e.target as HTMLElement;
          if (!target.closest('input, textarea, select, button, a, [tabindex]:not(.vu-root)'))
            rootRef.current?.focus({ preventScroll: true });
        }}
        style={{ ...themeOverridesToStyle(props.themeOverrides), ...props.style }}
      >
        <Shell rootRef={rootRef} onClose={props.onClose} />
      </div>
    </ControllerContext.Provider>
  );
}

function Shell({
  rootRef,
  onClose,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  onClose?: (() => void) | undefined;
}) {
  const ctl = useController();
  const l = useLabels();
  const status = useUi((s) => s.status);
  const message = useUi((s) => s.statusMessage);
  const layout = useUi((s) => s.layout);
  const previewMode = useUi((s) => s.previewMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);

  useEffect(() => ctl.setFilePicker(() => inputRef.current?.click()), [ctl]);

  useKeyboard(rootRef);

  if (status === 'unsupported') {
    return (
      <div className="vu-screen" role="alert">
        <Icon name="warning" size={32} />
        <h2>{l.unsupportedTitle}</h2>
        <p>{l.unsupportedBody}</p>
      </div>
    );
  }
  if (status === 'stopped') {
    return (
      <div className="vu-screen" role="alert">
        <Icon name="warning" size={32} />
        <h2>{l.stoppedTitle}</h2>
        <p>{l.stoppedBody}</p>
        {message ? <p className="vu-screen-detail">{message}</p> : null}
        <button
          type="button"
          className="vu-btn"
          data-variant="primary"
          data-layout="row"
          onClick={() => location.reload()}
        >
          <span>{l.reload}</span>
        </button>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="vu-screen" role="alert">
        <Icon name="warning" size={32} />
        <p>{l.engineError(message ?? '')}</p>
      </div>
    );
  }

  const desktop = layout === 'desktop';
  const phone = layout === 'phone';
  return (
    <div
      className="vu-shell"
      data-layout={layout}
      data-preview={previewMode || undefined}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node))
          setDropping(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer.files.length) void ctl.importFiles([...e.dataTransfer.files]);
      }}
    >
      {previewMode ? null : <TopBar onClose={onClose} />}
      {!phone && !previewMode ? <Rail /> : null}
      {!phone && !previewMode ? <Panel /> : null}
      <div className="vu-stage-area">
        {status === 'loading' ? <div className="vu-loading">{l.loading}</div> : <Stage />}
      </div>
      {desktop && !previewMode ? <Inspector /> : null}
      {previewMode ? (
        <PreviewBar />
      ) : (
        <div className="vu-bottom">
          {phone ? <PhoneTransport /> : <TimelineBar />}
          <div className="vu-timeline-area">
            {status === 'ready' ? <Timeline rootRef={rootRef} /> : <div className="vu-timeline" />}
            {!desktop ? <Dock /> : null}
          </div>
          {!desktop ? <Toolbar /> : null}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          void ctl.importFiles(files);
        }}
      />
      {dropping ? (
        <div className="vu-drop" aria-hidden="true">
          <Icon name="plus" size={28} />
          <span>{l.dropHere}</span>
        </div>
      ) : null}
      <Toasts />
      <ContextMenu />
      <ExportDialog />
      <CameraRecorder />
      <HelpSheet />
      <Tooltips root={rootRef} />
    </div>
  );
}

/** Keyboard shortcuts while focus is inside the editor (not in text fields). */
function useKeyboard(rootRef: React.RefObject<HTMLDivElement | null>) {
  const ctl = useController();
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      // Menus and the Layers list handle their own keys.
      if (target.closest('.vu-menu, .vu-layer-list')) return;
      // The camera and the export dialog cover the editor: its shortcuts wait until they close.
      const { cameraOpen, exportOpen } = ctl.ui.getState();
      if (cameraOpen || exportOpen) return;
      if (
        target.closest('[role="option"]') &&
        ['ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(e.key)
      )
        return;
      const state = ctl.ui.getState();
      // Shift+F10 / the Menu key: the selection's menu, next to it.
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        e.preventDefault();
        const frame = root.querySelector('.vu-stage-frame')?.getBoundingClientRect();
        const r = root.getBoundingClientRect();
        ctl.openMenu(
          frame ? frame.left + frame.width / 2 - r.left : r.width / 2,
          frame ? frame.top + frame.height / 2 - r.top : r.height / 2,
        );
        return;
      }
      const command = commandForKey(e);
      // Delete with nothing selected does nothing (no toast for a stray Backspace).
      if (command === 'delete' && state.selectedIds.length === 0) return;
      if (command) {
        // Plain keys over a focused button belong to it (Space / Enter click it).
        e.preventDefault();
        runCommand(ctl, command);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod) return;
      if (e.key === ' ' || e.key === 'k') {
        if (target.closest('button') && e.key === ' ') return; // let buttons click
        e.preventDefault();
        ctl.togglePlay();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        ctl.step((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      } else if (e.key === 'Home') {
        ctl.seek(0);
      } else if (e.key === 'End') {
        ctl.seek(Number.MAX_SAFE_INTEGER);
      } else if (e.key === 'Escape') {
        if (state.menu) ctl.closeMenu();
        else if (state.picking) ctl.startPicking(null);
        else if (state.historyOpen) ctl.ui.setState({ historyOpen: false });
        else if (state.previewMode) ctl.setPreviewMode(false);
        else ctl.select(null);
      } else if (e.key === '?') {
        ctl.ui.setState({ helpOpen: true });
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [ctl, rootRef]);
}
