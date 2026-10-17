import { detectCapabilities, type Asset, type Capabilities, type Project } from '@video-ultra/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { ControllerContext, useController, useLabels, useUi } from './context';
import { EditorController } from './controller';
import { ExportDialog } from './ExportDialog';
import { Icon } from './icons';
import { DEFAULT_LABELS, type Labels } from './labels';
import type { ExportResult } from './pending';
import {
  Inspector,
  Panel,
  Rail,
  Sheet,
  Timeline,
  Toasts,
  Toolbar,
  TopBar,
  Transport,
} from './shell';
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
  /** Shows a close button that calls this. */
  onClose?: () => void;
  /** Called when the device can't run the editor (instead of, or as well as, the built-in message). */
  onUnsupported?: (capabilities: Capabilities) => void;
  /** Gets bytes for media the host stores itself (assets with `url` sources). */
  resolveMedia?: (asset: Asset) => Promise<Blob | null>;
  /** Keep a local autosave and crash-recovery copy in the browser (default true). */
  autosave?: boolean;
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
        ...(props.resolveMedia ? { resolveMedia: props.resolveMedia } : {}),
        ...(props.autosave !== undefined ? { autosave: props.autosave } : {}),
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
  const inputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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
  if (status === 'error') {
    return (
      <div className="vu-screen" role="alert">
        <Icon name="warning" size={32} />
        <p>{l.engineError(message ?? '')}</p>
      </div>
    );
  }

  const desktop = layout === 'desktop';
  return (
    <div
      className="vu-shell"
      data-layout={layout}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDropping(false);
        void ctl.importFiles([...e.dataTransfer.files]);
      }}
    >
      <TopBar onClose={onClose} />
      {layout !== 'phone' ? <Rail /> : null}
      {layout !== 'phone' ? <Panel /> : null}
      <div className="vu-stage-area" ref={stageRef}>
        {status === 'loading' ? <div className="vu-loading">{l.loading}</div> : <Stage />}
      </div>
      {desktop ? <Inspector /> : null}
      <div className="vu-bottom">
        <div className="vu-timeline-head">
          <Transport stageRef={stageRef} />
          {desktop ? <Toolbar /> : null}
        </div>
        {status === 'ready' ? <Timeline rootRef={rootRef} /> : <div className="vu-timeline" />}
        {!desktop ? <Sheet /> : null}
        {!desktop ? <Toolbar /> : null}
      </div>
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
      <ExportDialog />
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
      if (
        target.closest('[role="option"]') &&
        ['ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(e.key)
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) ctl.redo();
        else ctl.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        ctl.redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        ctl.duplicateSelected();
      } else if (mod) {
        return;
      } else if (e.key === ' ' || e.key === 'k') {
        if (target.closest('button') && e.key === ' ') return; // let buttons click
        e.preventDefault();
        ctl.togglePlay();
      } else if (e.key === 's') {
        ctl.split();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        ctl.deleteSelected();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        ctl.step((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      } else if (e.key === 'Home') {
        ctl.seek(0);
      } else if (e.key === 'End') {
        ctl.seek(Number.MAX_SAFE_INTEGER);
      } else if (e.key === 'Escape') {
        ctl.select(null);
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [ctl, rootRef]);
}
