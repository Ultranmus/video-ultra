import {
  FLICKS_PER_SECOND,
  findItem,
  projectFrame,
  rollEdit,
  slideItem,
  slipItem,
  type Item,
} from '@video-ultra/core';
import type { ReactElement } from 'react';
import { useController, useLabels, useProject } from './context';
import { EditSlider, IconButton } from './controls';

/**
 * Fine trims (v0.4) for every device — the desktop timeline also has them as Alt-drags. Slip
 * (which part of a video or sound shows, the clip staying put), move the cut after the clip
 * (roll), and slide a main-video clip between its neighbours, a frame at a time.
 */
export function ProTrimTool({ item }: { item: Item }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const frame = useProject((p) => projectFrame(p));
  const neighbours = useProject((p) => {
    const found = findItem(p, item.id);
    if (!found) return { next: false, slide: false };
    const items = found.track.items;
    const i = items.findIndex((x) => x.id === item.id);
    const after = items[i + 1];
    return {
      next: !!after && after.start === item.start + item.duration,
      slide: found.track.kind === 'main' && i > 0 && i < items.length - 1,
    };
  });
  const asset = 'assetId' in item && item.assetId ? ctl.project.assets[item.assetId] : undefined;
  const media = (item.kind === 'video' || item.kind === 'audio') && asset;
  const step = (label: string, run: (delta: number) => void) => (
    <div className="vu-protrim-row">
      <span>{label}</span>
      <span className="vu-protrim-steps">
        <IconButton icon="back" label={l.earlier(label)} onClick={() => run(-frame)} />
        <IconButton icon="next" label={l.later(label)} onClick={() => run(frame)} />
      </span>
    </div>
  );
  return (
    <div className="vu-protrim">
      {media ? (
        <EditSlider
          label={l.slipClip}
          value={item.sourceIn / FLICKS_PER_SECOND}
          min={0}
          max={Math.max(0, (asset.duration - item.duration * item.speed) / FLICKS_PER_SECOND)}
          step={0.01}
          format={(v) => `${v.toFixed(2)} s`}
          recipe={(d, v) => {
            const now = findItem(d, item.id)?.item;
            if (now && (now.kind === 'video' || now.kind === 'audio'))
              slipItem(d, item.id, (v * FLICKS_PER_SECOND - now.sourceIn) / now.speed);
          }}
          commitLabel={l.slipClip}
          coalesceKey={`slip:${item.id}`}
        />
      ) : null}
      {neighbours.next
        ? step(l.rollCut, (delta) => ctl.run(l.rollCut, (d) => rollEdit(d, item.id, delta)))
        : null}
      {neighbours.slide
        ? step(l.slideClip, (delta) => ctl.run(l.slideClip, (d) => slideItem(d, item.id, delta)))
        : null}
      <p className="vu-hint">{l.proTrimHint}</p>
    </div>
  );
}
