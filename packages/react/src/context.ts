import type { Project } from '@video-ultra/core';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { EditorController } from './controller';
import type { Labels } from './labels';
import type { UiState } from './state';

/** The editor's controller, for components inside `<VideoEditor />`. */
export const ControllerContext = createContext<EditorController | null>(null);

/** The controller of the surrounding `<VideoEditor />`. */
export function useController(): EditorController {
  const ctl = useContext(ControllerContext);
  if (!ctl) throw new Error('useController must be used inside <VideoEditor />');
  return ctl;
}

/** UI state, re-rendering only when the selected slice changes (shallow compare). */
export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(useController().ui, useShallow(selector));
}

/** Part of the project, re-rendering only when it changes (shallow compare). */
export function useProject<T>(selector: (project: Project) => T): T {
  return useStore(
    useController().editor.store,
    useShallow((s) => selector(s.project)),
  );
}

/** Undo/redo availability and labels. */
export function useHistory(): {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
} {
  return useStore(
    useController().editor.store,
    useShallow((s) => ({
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      undoLabel: s.undoLabel,
      redoLabel: s.redoLabel,
    })),
  );
}

/** The editor's labels (i18n). */
export function useLabels(): Labels {
  return useController().labels;
}
