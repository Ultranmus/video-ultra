import { PhoneTimelineGrip, Splitter, useSavedLayout } from './splitters';
import {
  detectCapabilities,
  type Asset,
  type Capabilities,
  type Project,
  type Transcriber,
  type BackgroundRemover,
  type EditingAssistant,
  type SpeechGenerator,
  type ExportResult,
  type AudioExportResult,
  type FrameImage,
} from '@video-ultra/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { ControllerContext, useController, useLabels, useUi } from './context';
import { EditorController } from './controller';
import type { EditorCustomization, EditorEvent } from './embed';
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
  initialProject?: Project | string | undefined;
  /** Called about a second after each edit with the current project. This is the durable save — store it. */
  onSave?: ((project: Project) => void | Promise<void>) | undefined;
  /** Called when an export finishes, with the video file. */
  onExport?: ((result: ExportResult) => void) | undefined;
  /** Called when a sound-only export finishes, with the sound file. */
  onExportAudio?: ((result: AudioExportResult) => void) | undefined;
  /** Called when a frame is saved as a picture, with the image file. */
  onSaveFrame?: ((image: FrameImage) => void) | undefined;
  /** Shows a close button that calls this. */
  onClose?: (() => void) | undefined;
  /** Called when the device can't run the editor (instead of, or as well as, the built-in message). */
  onUnsupported?: ((capabilities: Capabilities) => void) | undefined;
  /** Gets bytes for media the host stores itself (assets with `url` sources). */
  resolveMedia?: ((asset: Asset) => Promise<Blob | null>) | undefined;
  /** Keep a local autosave and crash-recovery copy in the browser (default true). */
  autosave?: boolean | undefined;
  /**
   * Where the 3D sticker images come from: a base URL (self-host the MIT-licensed set), or `false`
   * to offer only emoji, shapes and uploads. Default: a pinned public CDN. Placed stickers are
   * stored in the project, so exports never depend on it.
   */
  stickerLibrary?: string | false | undefined;
  /**
   * Where animated emoji stickers come from (Noto Emoji Animation, CC BY 4.0): a base URL whose
   * `<code>/512.webp` files are the animations (and `<code>/emoji.svg` stills for the panel's
   * tiles, optional), or `false` to hide the Animated tab. Default:
   * Google's public copy. Placed stickers are stored in the project.
   */
  animatedStickerLibrary?: string | false | undefined;
  /**
   * Lighter copies of heavy videos for smooth editing, kept on this device: `auto` (default)
   * for videos this device would struggle with (4K; 1080p on budget phones), `always` for every
   * video over 540p, `off` never. Previews use the copy; exports always use the original.
   */
  proxies?: 'auto' | 'always' | 'off' | undefined;
  /**
   * A music & sound-effects source for the Audio panel: search, categories, a ▶ preview and the
   * licence line per sound, and Add (at the playhead). The picked file is stored in the project
   * like an import (its licence line on the asset as `credit`), so exports never depend on the
   * source. Without it the Audio panel offers the user's own files and voiceover only — the
   * editor ships no catalogue. `createStarterSounds()` is a small built-in set of synthesised,
   * CC0 sound effects. Read once, like `initialProject`.
   */
  audioLibrary?: AudioLibrary | undefined;
  /**
   * Turns speech into timed words for Auto captions: `createOnDeviceTranscriber()` from the
   * optional `@video-ultra/captions` package (English, on the device, nothing uploaded), or your
   * own service for any language. Without it, captions can still be imported (.srt / .vtt) or
   * typed.
   */
  transcriber?: Transcriber | undefined;
  /**
   * Removes photo backgrounds: `createBackgroundRemover()` from the optional `@video-ultra/ai`
   * package (runs on the device, nothing uploaded), or your own service. Without it the option
   * isn't shown.
   */
  backgroundRemover?: BackgroundRemover | undefined;
  /**
   * AI editing (v0.4): an Assistant panel where people type what they want ("make it warmer",
   * "add a title at the start") and your model's answer is applied as one undo step. Use
   * `createChatAssistant({ endpoint })` from `@video-ultra/ai` with your own server, or implement
   * `EditingAssistant`. A description of the project (no media) is sent to it. Without it the
   * panel isn't shown.
   */
  assistant?: EditingAssistant | undefined;
  /**
   * Text to speech (v0.4): "Text to speech" in the Audio panel and "Read aloud" on texts add a
   * spoken sound clip. Use `createSpeechEndpoint({ endpoint })` from `@video-ultra/ai` with
   * your own server, or implement `SpeechGenerator`. Without it these aren't shown.
   */
  speech?: SpeechGenerator | undefined;
  /**
   * Embedding API: hide or reorder built-in tools, add your own panels, top-bar buttons and
   * media sources (see {@link EditorCustomization}).
   */
  customize?: EditorCustomization | undefined;
  /** Everything that happens in the editor (edits, selection, playback, commands, export…). */
  onEvent?: ((event: EditorEvent) => void) | undefined;
  /** `dark` (default), `light` or `auto` (follow the OS). */
  theme?: ThemeMode | undefined;
  /** Typed overrides for the common theme tokens. */
  themeOverrides?: ThemeOverrides | undefined;
  /**
   * `normal` (default), `high` (stronger text, borders and focus rings — for low vision or bright
   * sunlight), or `auto` (high when the OS asks for more contrast).
   */
  contrast?: 'normal' | 'high' | 'auto' | undefined;
  /**
   * Control sizes: `auto` (default — thumb-sized on touch screens), `touch` (thumb-sized
   * everywhere) or `compact` (mouse sizes, also on touch screens).
   */
  density?: 'auto' | 'touch' | 'compact' | undefined;
  /** Replace any of the editor's text (translation). */
  labels?: Partial<Labels> | undefined;
  /** Text direction of the editor chrome. The timeline always runs left to right. */
  dir?: 'ltr' | 'rtl' | undefined;
  /** Called once the editor is ready, with its controller (programmatic control: play, seek, edits). */
  onReady?: ((controller: EditorController) => void) | undefined;
  /** Force a renderer (testing). Default: WebGPU when available, else WebGL2. */
  backend?: 'auto' | 'webgpu' | 'webgl2' | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

// HEIC / HEIF by type too: some Android pickers grey a photo out unless its type is listed.
const ACCEPT =
  'video/*,audio/*,image/*,image/heic,image/heif,.mov,.mkv,.heic,.heif,.m4a,.mp3,.wav,.svg';

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
        ...(props.animatedStickerLibrary !== undefined
          ? { animatedStickerLibrary: props.animatedStickerLibrary }
          : {}),
        ...(props.proxies ? { proxies: props.proxies } : {}),
        ...(props.audioLibrary ? { audioLibrary: props.audioLibrary } : {}),
        ...(props.transcriber ? { transcriber: props.transcriber } : {}),
        ...(props.backgroundRemover ? { backgroundRemover: props.backgroundRemover } : {}),
        ...(props.assistant ? { assistant: props.assistant } : {}),
        ...(props.speech ? { speech: props.speech } : {}),
        ...(props.customize ? { customize: props.customize } : {}),
      },
      parsed?.project ?? undefined,
    );
    if (parsed?.error) controller.toast(parsed.error, 'error');
    return { controller, initial: parsed?.project ?? null };
  });
  const controller = ctl.controller;
  const rootRef = useRef<HTMLDivElement>(null);

  // The host's event listener (latest one; it may change between renders).
  const onEvent = useRef(props.onEvent);
  useEffect(() => {
    onEvent.current = props.onEvent;
  });
  useEffect(() => controller.on((event) => onEvent.current?.(event)), [controller]);

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

  // On-screen keyboard (phones). The visible area shrinks, and iOS also scrolls the page to show
  // the field (it ignores `interactive-widget`). Keep the editor one box, where it is:
  // - while a field in the editor has focus, a page scroll the browser makes is undone (only
  //   when the editor fills the window — a host page that scrolls keeps its scrolling);
  // - a field in a sheet: the bottom area rises by --vu-keyboard-lift so the sheet sits on the
  //   keyboard, no taller than the room left (--vu-keyboard-room), the field scrolled into view;
  // - the text field on the video: the editor takes the visible height and the bottom area
  //   steps aside (data-keyboard="stage"), so the video stays as big as it can above the keyboard.
  // Also marks a zoomed-in page (data-page-zoomed), so a pinch can always zoom it back out.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const root = rootRef.current;
    if (!vv || !root) return;
    let natural = 0; // the root's own height while it is shrunk (0: not shrunk)
    let frame = 0;
    let keepScroll: number | null = null; // the page's scroll before a field took focus
    const typingField = (): HTMLElement | null => {
      const el = document.activeElement;
      return el instanceof HTMLElement &&
        root.contains(el) &&
        el.matches('input:not([type="range"]), textarea, [contenteditable="true"]')
        ? el
        : null;
    };
    const update = () => {
      frame = 0;
      const zoomed = vv.scale > 1.01;
      root.toggleAttribute('data-page-zoomed', zoomed);
      const field = zoomed ? null : typingField();
      const rect = root.getBoundingClientRect();
      const height = natural || rect.height;
      const visBottom = vv.offsetTop + vv.height;
      const covered = Math.max(0, Math.round(rect.top + height - visBottom));
      const open = !!field && covered > 80;
      const onStage = open && field.classList.contains('vu-stage-text');
      if (onStage) {
        natural = height;
        root.style.height = `${Math.max(0, height - covered)}px`;
      } else if (natural) {
        natural = 0;
        root.style.height = '';
      }
      const bar = root.querySelector<HTMLElement>('.vu-toolbar');
      const lift = onStage ? 0 : Math.max(0, covered - (bar?.offsetHeight ?? 0));
      root.style.setProperty('--vu-keyboard', `${onStage ? 0 : covered}px`);
      root.style.setProperty('--vu-keyboard-lift', `${lift}px`);
      root.style.setProperty('--vu-keyboard-room', `${Math.max(0, height - covered)}px`);
      if (onStage) root.setAttribute('data-keyboard', 'stage');
      else root.toggleAttribute('data-keyboard', open);
      // The field being typed in stays in view inside its sheet.
      if (open && !onStage) {
        // The box that really scrolls it (a sheet, or a list inside one, like Layers).
        let scroller = field.parentElement;
        while (scroller && scroller !== root) {
          const oy = getComputedStyle(scroller).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && scroller.scrollHeight > scroller.clientHeight)
            break;
          scroller = scroller.parentElement;
        }
        if (scroller && scroller !== root) {
          const f = field.getBoundingClientRect();
          const sr = scroller.getBoundingClientRect();
          const bottom = Math.min(sr.bottom, visBottom);
          const pad = 16;
          if (f.bottom > bottom - pad) scroller.scrollTop += f.bottom - (bottom - pad);
          else if (f.top < sr.top + pad) scroller.scrollTop -= sr.top + pad - f.top;
        }
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // The editor fills the window: the page itself has nothing to scroll to.
    const fillsWindow = () => root.offsetHeight >= window.innerHeight * 0.9;
    const onFocusIn = () => {
      if (keepScroll === null && typingField() && fillsWindow()) keepScroll = window.scrollY;
      schedule();
    };
    const onFocusOut = () => {
      // Focus may be moving to another field: decide once it has landed.
      requestAnimationFrame(() => {
        if (!typingField()) keepScroll = null;
        schedule();
      });
    };
    const onScroll = () => {
      if (keepScroll !== null && typingField() && Math.abs(window.scrollY - keepScroll) > 1)
        window.scrollTo(window.scrollX, keepScroll);
    };
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    update();
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', onScroll);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      root.style.height = '';
    };
  }, []);

  // Desktop panel sizes the person dragged, kept in this browser.
  useSavedLayout(rootRef);

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
        data-vu-contrast={
          props.contrast && props.contrast !== 'normal' ? props.contrast : undefined
        }
        data-vu-density={props.density && props.density !== 'auto' ? props.density : undefined}
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
  useNoPageZoom(rootRef);
  const panelOpen = useUi((s) => s.panel !== null);

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
      {/* Desktop: drag an inner edge to resize the side panel, the settings, the timeline. */}
      {desktop && !previewMode && panelOpen ? <Splitter edge="panel" /> : null}
      {desktop && !previewMode ? <Splitter edge="inspector" /> : null}
      {desktop && !previewMode ? <Splitter edge="timeline" /> : null}
      {previewMode ? (
        <PreviewBar />
      ) : (
        <div className="vu-bottom">
          {phone ? <PhoneTimelineGrip /> : null}
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
          void ctl.importFiles(files, { atStart: ctl.takePickPlace() === 'start' });
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

/**
 * A pinch (trackpad: ⌘ / Ctrl + wheel; Safari: gesture events) inside the editor never zooms the
 * whole page: on the video and the timeline it zooms them (their own handlers run first),
 * elsewhere it does nothing. ⌘ + / ⌘ − still zoom the page.
 */
function useNoPageZoom(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    // Once the page is zoomed in (by the browser, not us), a pinch must get through to undo it.
    const onGesture = (e: Event) => {
      if ((window.visualViewport?.scale ?? 1) <= 1.01) e.preventDefault();
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('gesturestart', onGesture);
    root.addEventListener('gesturechange', onGesture);
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('gesturestart', onGesture);
      root.removeEventListener('gesturechange', onGesture);
    };
  }, [rootRef]);
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
        else if (state.previewMode) ctl.setPreviewMode(false);
        // Nothing selected inside a combined clip: Esc goes back out of it.
        else if (!state.selectedId && state.inside.length) ctl.closeCombined();
        else ctl.select(null);
      } else if (e.key === '?') {
        ctl.ui.setState({ helpOpen: true });
      }
    };
    root.addEventListener('keydown', onKey);
    // Shortcuts work straight away: the editor takes focus on opening — only when nothing else
    // on the page has it (a host's own field keeps it), and without scrolling the page.
    const active = document.activeElement;
    if (!active || active === document.body) root.focus({ preventScroll: true });
    return () => root.removeEventListener('keydown', onKey);
  }, [ctl, rootRef]);
}
