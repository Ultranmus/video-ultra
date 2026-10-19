import type { StoredProjectInfo } from '@video-ultra/core/internal';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Button, IconButton } from './controls';

/**
 * "Your videos" (DECISIONS #154): the videos saved on this device — open another, make a copy of
 * this one (same media, nothing copied but the project), start a new one, delete one that isn't
 * open (it asks first). A popover under its top-bar button; only when the editor saves locally.
 */
export function VideosPopover(): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const open = useUi((s) => s.videosOpen);
  const currentId = useProject((p) => p.id);
  const readOnly = useUi((s) => s.readOnly);
  const [videos, setVideos] = useState<StoredProjectInfo[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => ctl.ui.setState({ videosOpen: false });

  useEffect(() => {
    if (!open) return;
    let live = true;
    void ctl.listVideos().then((list) => live && setVideos(list));
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest('[data-videos-toggle]')) return;
      ctl.ui.setState({ videosOpen: false });
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      live = false;
      document.removeEventListener('pointerdown', onDown, true);
      setConfirm(null);
    };
  }, [ctl, open, currentId]);

  if (!open) return null;
  const act = (job: () => Promise<void>) => {
    setBusy(true);
    void job().finally(() => {
      setBusy(false);
      close();
    });
  };
  const others = (videos ?? []).filter((v) => v.id !== currentId);
  const when = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };
  return (
    <div
      ref={ref}
      className="vu-popover vu-videos"
      role="dialog"
      aria-label={l.yourVideos}
      aria-busy={busy || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="vu-popover-head">
        <h2 className="vu-popover-title">{l.yourVideos}</h2>
        <IconButton icon="close" label={l.close} onClick={close} />
      </div>
      <div className="vu-row">
        <Button
          icon="duplicate"
          label={l.makeCopy}
          variant="secondary"
          disabledReason={readOnly ? l.notSavedHere : busy ? l.saving : null}
          onClick={() => act(() => ctl.duplicateVideo())}
        />
        <Button
          icon="plus"
          label={l.newVideo}
          variant="secondary"
          disabledReason={busy ? l.saving : null}
          onClick={() => act(() => ctl.newVideo())}
        />
      </div>
      {videos && others.length === 0 ? <p className="vu-hint">{l.noOtherVideos}</p> : null}
      <ul className="vu-videos-list">
        {others.map((v) => (
          <li key={v.id} className="vu-videos-row">
            {confirm === v.id ? (
              <div className="vu-videos-confirm" role="alert">
                <span>{l.deleteVideoConfirm}</span>
                <div className="vu-row">
                  <Button label={l.cancel} variant="secondary" onClick={() => setConfirm(null)} />
                  <Button
                    icon="delete"
                    label={l.delete}
                    variant="danger"
                    onClick={() => {
                      setConfirm(null);
                      void ctl
                        .deleteVideo(v.id)
                        .then(() => ctl.listVideos())
                        .then(setVideos);
                    }}
                  />
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="vu-videos-open"
                  aria-label={l.openVideo(v.name)}
                  disabled={busy}
                  onClick={() => act(() => ctl.openVideo(v.id))}
                >
                  <span className="vu-videos-name">{v.name}</span>
                  <span className="vu-videos-when">{l.editedAt(when(v.updatedAt))}</span>
                </button>
                <IconButton
                  icon="delete"
                  label={l.deleteVideo(v.name)}
                  onClick={() => setConfirm(v.id)}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
