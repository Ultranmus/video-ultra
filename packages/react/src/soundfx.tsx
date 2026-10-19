import {
  AUDIO_FX_PRESETS,
  findItem,
  updateItem,
  type AudioFx,
  type AudioItem,
  type Project,
  type VideoItem,
} from '@video-ultra/core';
import type { ReactElement } from 'react';
import { useController, useLabels } from './context';
import { Chips, EditSlider } from './controls';
import type { Labels } from './labels';

/**
 * Sound effects (v0.4) for a video's sound or a sound clip: ready-made looks (Voice, Podcast,
 * Bass…), then the fine controls — bass / middle / treble, Even out (compressor), Pitch and Keep
 * the voice natural when the speed changes. All non-destructive; preview and export hear the same.
 */

const NEUTRAL_EQ = { low: 0, mid: 0, high: 0 };

/** The item's effects with `change` applied (inside an edit). */
function patchFx(draft: Project, itemId: string, change: (fx: AudioFx) => AudioFx): void {
  const now = findItem(draft, itemId)?.item;
  if (!now || (now.kind !== 'video' && now.kind !== 'audio')) return;
  updateItem(draft, itemId, { audioFx: change({ ...(now.audioFx ?? {}) }) });
}

const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`;
const semitones = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : ''}${v.toFixed(0)}`);

/** Which preset the settings are, if any. */
function presetOf(fx: AudioFx | undefined): string | null {
  const same = (a: AudioFx, b: AudioFx) =>
    (a.eq?.low ?? 0) === (b.eq?.low ?? 0) &&
    (a.eq?.mid ?? 0) === (b.eq?.mid ?? 0) &&
    (a.eq?.high ?? 0) === (b.eq?.high ?? 0) &&
    (a.compress ?? 0) === (b.compress ?? 0) &&
    (a.pitch ?? 0) === (b.pitch ?? 0);
  return AUDIO_FX_PRESETS.find((p) => same(p.fx, fx ?? {}))?.id ?? null;
}

export function presetLabel(l: Labels, id: string): string {
  return l.soundPresets[id as keyof Labels['soundPresets']] ?? id;
}

export function SoundFxTool({ item }: { item: VideoItem | AudioItem }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const fx = item.audioFx;
  const eq = fx?.eq ?? NEUTRAL_EQ;
  const band = (key: 'low' | 'mid' | 'high', label: string) => (
    <EditSlider
      label={label}
      value={eq[key]}
      min={-12}
      max={12}
      step={1}
      origin={0}
      defaultValue={0}
      format={db}
      recipe={(d, v) =>
        patchFx(d, item.id, (f) => ({ ...f, eq: { ...(f.eq ?? NEUTRAL_EQ), [key]: v } }))
      }
      commitLabel={l.soundEffects}
      coalesceKey={`eq-${key}:${item.id}`}
    />
  );
  const keep = !!fx?.keepPitch;
  return (
    <div className="vu-soundfx">
      <Chips
        label={l.soundLook}
        value={presetOf(fx)}
        options={AUDIO_FX_PRESETS.map((p) => ({ value: p.id, label: presetLabel(l, p.id) }))}
        onChange={(id) => {
          const preset = AUDIO_FX_PRESETS.find((p) => p.id === id)!;
          ctl.run(l.soundEffects, (d) =>
            patchFx(d, item.id, (f) => ({
              ...preset.fx,
              ...(f.keepPitch ? { keepPitch: true } : {}),
            })),
          );
        }}
      />
      {band('low', l.bass)}
      {band('mid', l.middle)}
      {band('high', l.treble)}
      <EditSlider
        label={l.evenOut}
        value={fx?.compress ?? 0}
        min={0}
        max={1}
        step={0.05}
        defaultValue={0}
        format={(v) => (v === 0 ? l.off : `${Math.round(v * 100)} %`)}
        recipe={(d, v) => patchFx(d, item.id, (f) => ({ ...f, compress: v }))}
        commitLabel={l.evenOut}
        coalesceKey={`compress:${item.id}`}
      />
      <EditSlider
        label={l.pitch}
        value={fx?.pitch ?? 0}
        min={-12}
        max={12}
        step={1}
        origin={0}
        defaultValue={0}
        format={semitones}
        recipe={(d, v) => patchFx(d, item.id, (f) => ({ ...f, pitch: v }))}
        commitLabel={l.pitch}
        coalesceKey={`pitch:${item.id}`}
      />
      {item.speed !== 1 ? (
        <button
          type="button"
          role="switch"
          aria-checked={keep}
          className="vu-switch-row"
          data-tooltip={l.tipKeepPitch}
          onClick={() =>
            ctl.run(l.keepPitch, (d) => patchFx(d, item.id, (f) => ({ ...f, keepPitch: !keep })))
          }
        >
          <span>{l.keepPitch}</span>
          <span className="vu-switch" aria-hidden="true">
            <span className="vu-switch-knob" />
          </span>
        </button>
      ) : null}
      <p className="vu-hint">{l.soundFxHint}</p>
    </div>
  );
}
