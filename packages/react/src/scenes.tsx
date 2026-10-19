import type { VideoItem } from '@video-ultra/core';
import type { SceneSensitivity } from '@video-ultra/core/internal';
import { useState, type ReactElement } from 'react';
import { useController, useLabels, useUi } from './context';
import { Button, Segmented } from './controls';

/**
 * Scene detection (v0.4): finds where the shot changes in a video clip and splits it there, with
 * progress and Cancel. The decoding and the maths run in the media analyzer's worker.
 */
export function ScenesTool({ item }: { item: VideoItem }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const job = useUi((s) => s.sceneJob);
  const [sensitivity, setSensitivity] = useState<SceneSensitivity>('normal');
  if (job && job.itemId === item.id)
    return (
      <div className="vu-caption-job" role="status" aria-live="polite">
        <div className="vu-caption-job-head">
          <span className="vu-spinner" aria-hidden="true" />
          <span>{l.findingScenes}</span>
          <Button label={l.cancel} variant="secondary" onClick={() => ctl.cancelSceneDetection()} />
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
      <Segmented
        label={l.sceneSensitivity}
        value={sensitivity}
        options={[
          { value: 'low', label: l.sceneFewer },
          { value: 'normal', label: l.sceneNormal },
          { value: 'high', label: l.sceneMore },
        ]}
        onChange={setSensitivity}
      />
      <Button
        icon="scenes"
        label={l.splitAtScenes}
        variant="primary"
        tip={l.tipSplitAtScenes}
        disabledReason={job ? l.findingScenes : null}
        onClick={() => void ctl.splitAtScenes(item.id, sensitivity)}
      />
      <p className="vu-hint">{l.scenesHint}</p>
    </div>
  );
}
