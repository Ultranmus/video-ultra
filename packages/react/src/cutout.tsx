import type { BackgroundRemoverCheck, Item } from '@video-ultra/core';
import { useEffect, useState, type ReactElement } from 'react';
import { useController, useLabels, useUi } from './context';
import { Button } from './controls';
import type { EditorController } from './controller';

/**
 * Background removal (v0.3) for a photo or an image sticker: Remove (with progress and Cancel)
 * or Restore. Only shown when the host gave the editor a background remover.
 */

/** Photos, and image stickers that have a background (still, not see-through), can lose it. */
export function canCutOut(item: Item | null | undefined, ctl: EditorController): boolean {
  if (!item) return false;
  if (item.kind === 'image') return true;
  if (item.kind !== 'sticker' || !item.assetId) return false;
  // A cut-out sticker keeps Restore; otherwise only one with a background to remove.
  return !!item.cutout || ctl.stickerHasBackground(item.assetId) === true;
}

export function BackgroundTool({ item }: { item: Item }): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const job = useUi((s) => s.cutoutJob);
  const [check, setCheck] = useState<BackgroundRemoverCheck | null>(null);
  useEffect(() => {
    let live = true;
    void ctl.checkBackgroundRemoval().then((c) => {
      if (live) setCheck(c);
    });
    return () => {
      live = false;
    };
  }, [ctl]);
  if (!ctl.options.backgroundRemover) return null;
  if (!canCutOut(item, ctl)) return <p className="vu-hint">{l.photoOnly}</p>;
  const cut = 'cutout' in item && !!item.cutout;
  if (job && job.itemId === item.id)
    return (
      <div className="vu-caption-job" role="status" aria-live="polite">
        <div className="vu-caption-job-head">
          <span className="vu-spinner" aria-hidden="true" />
          <span>{l.removingBackground}</span>
          <Button
            label={l.cancel}
            variant="secondary"
            onClick={() => ctl.cancelBackgroundRemoval()}
          />
        </div>
        <div className="vu-progress" aria-hidden="true">
          <div
            className="vu-progress-fill"
            style={{ width: `${Math.round(Math.max(0.02, job.fraction) * 100)}%` }}
          />
        </div>
      </div>
    );
  return (
    <div className="vu-picture-tool">
      {cut ? (
        <Button
          icon="undo"
          label={l.restoreBackground}
          variant="secondary"
          onClick={() => ctl.restoreBackground(item.id)}
        />
      ) : (
        <Button
          icon="cutout"
          label={l.removeBackground}
          variant="primary"
          tip={l.tipRemoveBackground}
          disabledReason={
            check && !check.available
              ? (check.reason ?? l.backgroundUnavailable)
              : job
                ? l.removingBackground
                : null
          }
          onClick={() => void ctl.removeBackground(item.id)}
        />
      )}
      {check?.available && check.onDevice && check.downloadMB && !cut ? (
        <p className="vu-hint">{l.backgroundOnDevice(check.downloadMB)}</p>
      ) : null}
    </div>
  );
}
