import { FLICKS_PER_SECOND, itemEnd, type Project } from '@video-ultra/core';
import { itemIndexAt } from '@video-ultra/core/internal';
import { useEffect, useRef, type ReactElement } from 'react';
import { useController } from '../context';

/** Above this scrub speed (timeline seconds per wall-clock second) exact frames can't keep up. */
const FAST = 2.5;
/** Hand back to the engine's exact frame this long after the scrub slows or stops. */
const SETTLE_MS = 180;

/**
 * While the playhead is dragged fast, the decoder can't deliver exact frames (4K, long GOPs) and
 * the preview would freeze. This shows the analyzer's fast keyframe thumbnail of the main clip
 * under the playhead over the preview instead, then gets out of the way when the scrub settles.
 * One request in flight, latest wins. Playback never uses it.
 */
export function ScrubPreview({ width, height }: { width: number; height: number }): ReactElement {
  const ctl = useController();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let last = { t: ctl.playhead.time, at: performance.now() };
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let wanted: { assetId: string; seconds: number } | null = null;
    let controller: AbortController | null = null;

    const pxHeight = Math.max(
      90,
      Math.round(Math.min(360, height * Math.min(devicePixelRatio || 1, 2) * 0.5)),
    );

    const pump = () => {
      if (busy || !wanted || !ctl.analyzer) return;
      const want = wanted;
      wanted = null;
      busy = true;
      controller = new AbortController();
      void ctl.analyzer
        .thumbnail(want.assetId, want.seconds, pxHeight, controller.signal)
        .then((bitmap) => {
          if (!bitmap) return;
          if (canvas.hidden && !hideTimer) {
            bitmap.close();
            return;
          }
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          bitmap.close();
          canvas.hidden = false;
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
          pump();
        });
    };

    const target = (project: Project, t: number) => {
      const items = project.tracks[0]!.items;
      const item = items[itemIndexAt(items, t)];
      if (!item || item.kind !== 'video' || t >= itemEnd(item)) return null;
      const seconds = (item.sourceIn + (t - item.start) * item.speed) / FLICKS_PER_SECOND;
      return { assetId: item.assetId, seconds };
    };

    const off = ctl.playhead.subscribe((t) => {
      const now = performance.now();
      const dt = (now - last.at) / 1000;
      const speed = dt > 0 ? Math.abs(t - last.t) / FLICKS_PER_SECOND / dt : 0;
      last = { t, at: now };
      if (ctl.ui.getState().playing) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        canvas.hidden = true;
        controller?.abort();
      }, SETTLE_MS);
      if (speed < FAST) return;
      wanted = target(ctl.project, t);
      pump();
    });
    return () => {
      off();
      clearTimeout(hideTimer);
      controller?.abort();
    };
  }, [ctl, height]);

  return (
    <canvas
      ref={canvasRef}
      className="vu-scrub-preview"
      style={{ width, height }}
      aria-hidden="true"
      hidden
    />
  );
}
