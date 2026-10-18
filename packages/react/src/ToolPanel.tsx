import {
  ADJUST_KEYS,
  DEFAULT_TRANSFORM,
  findItem,
  FLICKS_PER_SECOND,
  FONT_PRESETS,
  fromSeconds,
  mainTrack,
  NO_CROP,
  setBackground,
  setCanvasSize,
  setSpeed,
  trimItem,
  updateItem,
  setTransformAt,
  transformAt,
  type Adjust,
  type AudioItem,
  type Item,
  type TextStyle,
  type Transform,
  type VideoItem,
} from '@video-ultra/core';
import { getCommand } from './commands';
import { useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Button, ColorField, EditSlider, IconButton, Section, Segmented } from './controls';
import { Icon } from './icons';
import { DEFAULT_DUCK, isSounding, RATIOS, ratioOf } from './items';
import { AnimatePanel, FilterStrip, TransitionGrid } from './looks';
import type { ToolId } from './state';
import { ArrangeControls, LockedNote } from './organize';
import { BackgroundTool } from './cutout';
import { KeyframesTool, usePlayheadFor } from './keyframes';
import { MaskTool } from './mask';
import { BlendTool, GreenScreenTool, RegionTool } from './picture';

const seconds = (t: number) => t / FLICKS_PER_SECOND;
const fmtSeconds = (s: number) => `${s.toFixed(1)} s`;
const percent = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) =>
  Math.round(v * 100) === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;

/**
 * Tool controls. Each tool is one block of controls; the desktop inspector stacks the blocks of
 * the selected item as sections, a phone shows one block in the dock above the toolbar.
 */

/** The block for one tool (phone dock / tablet sheet). */
export function ToolPanel({ tool }: { tool: ToolId }): ReactElement | null {
  const l = useLabels();
  const selectedId = useUi((s) => s.selectedId);
  const item = useProject((p) => (selectedId ? (findItem(p, selectedId)?.item ?? null) : null));
  const locked = useProject((p) => {
    const found = selectedId ? findItem(p, selectedId) : null;
    return !!found && (!!found.item.locked || found.track.locked);
  });
  if (tool === 'canvas') return <CanvasTool />;
  if (tool === 'filter') return <FilterStrip />;
  if (tool === 'transition') return <TransitionGrid />;
  if (tool === 'animate') return <AnimatePanel />;
  if (tool === 'arrange')
    return (
      <>
        {item ? <LockedNote item={item} /> : null}
        <ArrangeControls compact />
      </>
    );
  if (!item) return <p className="vu-hint">{l.nothingSelected}</p>;
  return (
    <>
      <LockedNote item={item} />
      <div className="vu-tool-body" inert={locked || undefined} data-locked={locked || undefined}>
        <ItemTool tool={tool} item={item} />
      </div>
    </>
  );
}

function ItemTool({ tool, item }: { tool: ToolId; item: Item }): ReactElement | null {
  switch (tool) {
    case 'speed':
      return <SpeedTool item={item} />;
    case 'volume':
      return (
        <>
          <VolumeTool item={item} />
        </>
      );
    case 'fade':
      return <FadeTool item={item} />;
    case 'adjust':
      return <AdjustTool item={item} />;
    case 'crop':
      return <CropTool item={item} />;
    case 'transform':
      return <TransformTool item={item} />;
    case 'text-edit':
      return <TextEditTool item={item} />;
    case 'text-style':
      return <TextStyleTool item={item} />;
    case 'opacity':
      return <OpacityTool item={item} />;
    case 'duration':
      return <DurationTool item={item} />;
    case 'key':
      return <GreenScreenTool item={item} />;
    case 'blend':
      return <BlendTool item={item} />;
    case 'region':
      return <RegionTool item={item} />;
    case 'mask':
      return <MaskTool item={item} />;
    case 'cutout':
      return <BackgroundTool item={item} />;
    case 'keyframes':
      return <KeyframesTool item={item} />;
    default:
      return null;
  }
}

/**
 * Desktop inspector: the selected item's settings as titled sections, most used first. Filters,
 * transitions and animations are not here: the left menu has them for every element (one place,
 * no duplicates — owner, 2026-10-19); this is the detail view.
 */
export function InspectorSections({ item }: { item: Item }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const index = useProject((p) => mainTrack(p).items.findIndex((i) => i.id === item.id));
  const onMain = index !== -1;
  const picture = (
    <>
      <Section title={l.adjust} collapsible defaultOpen={false}>
        <AdjustTool item={item} />
      </Section>
      <Section title={l.cropRotate} collapsible defaultOpen={false}>
        <TransformTool item={item} />
        <CropTool item={item} />
      </Section>
      <Section
        title={l.keyframes}
        collapsible
        defaultOpen={'keyframes' in item && !!item.keyframes}
      >
        <KeyframesTool item={item} />
      </Section>
      <Section title={l.shape} collapsible defaultOpen={'mask' in item && !!item.mask}>
        <MaskTool item={item} />
      </Section>
      <Section title={l.greenScreen} collapsible defaultOpen={'key' in item && !!item.key}>
        <GreenScreenTool item={item} />
      </Section>
      {onMain ? null : (
        <Section title={l.opacityBlend}>
          <OpacityTool item={item} />
          <BlendTool item={item} />
        </Section>
      )}
    </>
  );

  switch (item.kind) {
    case 'video':
      return (
        <>
          <Section title={l.speed}>
            <SpeedTool item={item} />
          </Section>
          <Section title={l.sound}>
            <VolumeTool item={item} />
            <FadeTool item={item} />
          </Section>
          {picture}
        </>
      );
    case 'image':
    case 'freeze':
      return (
        <>
          <Section title={l.timing}>
            <DurationTool item={item} />
          </Section>
          {item.kind === 'image' && ctl.options.backgroundRemover ? (
            <Section title={l.removeBackground}>
              <BackgroundTool item={item} />
            </Section>
          ) : null}
          {picture}
        </>
      );
    case 'audio':
      return (
        <>
          <Section title={l.sound}>
            <VolumeTool item={item} />
            <FadeTool item={item} />
          </Section>
          <Section title={l.speed}>
            <SpeedTool item={item} />
          </Section>
        </>
      );
    case 'text':
      return (
        <>
          <Section title={l.textContent}>
            <TextEditTool item={item} autoFocus={false} />
          </Section>
          <Section title={l.style}>
            <TextStyleTool item={item} />
          </Section>
          <Section title={l.adjust} collapsible defaultOpen={false}>
            <AdjustTool item={item} />
          </Section>
          <Section title={l.appearance} collapsible defaultOpen={false}>
            <TransformTool item={item} />
            <OpacityTool item={item} />
            <BlendTool item={item} />
          </Section>
          <Section
            title={l.keyframes}
            collapsible
            defaultOpen={'keyframes' in item && !!item.keyframes}
          >
            <KeyframesTool item={item} />
          </Section>
        </>
      );
    case 'sticker':
      return (
        <>
          {item.assetId && ctl.options.backgroundRemover ? (
            <Section title={l.removeBackground}>
              <BackgroundTool item={item} />
            </Section>
          ) : null}
          <Section title={l.adjust} collapsible defaultOpen={false}>
            <AdjustTool item={item} />
          </Section>
          <Section title={l.appearance}>
            <TransformTool item={item} />
            <OpacityTool item={item} />
            <BlendTool item={item} />
          </Section>
          <Section
            title={l.keyframes}
            collapsible
            defaultOpen={'keyframes' in item && !!item.keyframes}
          >
            <KeyframesTool item={item} />
          </Section>
        </>
      );
    case 'region':
      return (
        <>
          <Section title={l.blurArea}>
            <RegionTool item={item} />
          </Section>
          <Section title={l.regionPosition} collapsible defaultOpen={false}>
            <TransformTool item={item} />
            <OpacityTool item={item} />
          </Section>
        </>
      );
  }
}

function SpeedTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (item.kind !== 'video' && item.kind !== 'audio') return null;
  return (
    <>
      <EditSlider
        label={l.speed}
        value={Math.log2(item.speed)}
        min={Math.log2(0.1)}
        max={Math.log2(10)}
        step={0.01}
        defaultValue={0}
        origin={0}
        format={(v) => `${(2 ** v).toFixed(2).replace(/\.?0+$/, '')}×`}
        recipe={(d, v, ctx) => setSpeed(d, item.id, Math.round(2 ** v * 100) / 100, ctx.ids)}
        commitLabel={l.speed}
        coalesceKey={`speed:${item.id}`}
      />
      <Segmented
        label={l.speedPresets}
        hideLabel
        value={String(item.speed)}
        options={['0.5', '1', '1.5', '2', '4'].map((v) => ({ value: v, label: `${v}×` }))}
        onChange={(v) => ctl.run(l.speed, (d, ctx) => setSpeed(d, item.id, Number(v), ctx.ids))}
      />
    </>
  );
}

function VolumeTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (!('volume' in item)) return null;
  const asset = item.kind === 'video' ? ctl.project.assets[item.assetId] : null;
  return (
    <>
      <EditSlider
        label={l.volume}
        value={item.muted ? 0 : item.volume}
        min={0}
        max={2}
        step={0.01}
        defaultValue={1}
        format={percent}
        recipe={(d, v) => updateItem(d, item.id, { volume: v, muted: false })}
        commitLabel={l.volume}
        coalesceKey={`volume:${item.id}`}
      />
      <div className="vu-row">
        <Button
          icon={item.muted ? 'volume' : 'muted'}
          label={item.muted ? l.unmute : l.mute}
          variant="secondary"
          pressed={item.muted}
          onClick={() =>
            ctl.run(item.muted ? l.unmute : l.mute, (d) =>
              updateItem(d, item.id, { muted: !item.muted }),
            )
          }
        />
        {item.kind === 'video' ? (
          <Button
            icon="extract"
            label={l.extractAudio}
            variant="secondary"
            tip={l.tipExtract}
            disabledReason={!asset?.hasAudio ? l.noSound : item.muted ? l.alreadyMuted : null}
            onClick={() => ctl.extractAudio()}
          />
        ) : null}
      </div>
      {isSounding(item) ? <DuckControls item={item} /> : null}
    </>
  );
}

/**
 * "Lower under voice" (ducking, v0.2 B1): a switch, and once on, how much lower. A hint says when
 * there's nothing to listen to yet.
 */
function DuckControls({ item }: { item: VideoItem | AudioItem }) {
  const ctl = useController();
  const l = useLabels();
  // Re-read on every project change: the voice can come from any other clip.
  const hasVoice = useProject((p) => ctl.hasVoiceFor(item.id, p));
  const command = getCommand(ctl, 'duck');
  const on = !!item.duck;
  const reason = command.disabledReason;
  return (
    <div className="vu-duck">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-disabled={reason ? true : undefined}
        className="vu-switch-row vu-duck-switch"
        data-tooltip={reason ?? l.tipDuck}
        onClick={() => {
          if (!reason) command.run();
        }}
      >
        <span className="vu-duck-label">
          <Icon name="duck" size={18} />
          <span>{l.duck}</span>
        </span>
        <span className="vu-switch" aria-hidden="true">
          <span className="vu-switch-knob" />
        </span>
      </button>
      {on ? (
        <>
          <EditSlider
            label={l.duckAmount}
            value={item.duck ?? DEFAULT_DUCK}
            min={0.1}
            max={1}
            step={0.05}
            defaultValue={DEFAULT_DUCK}
            format={percent}
            recipe={(d, v) => updateItem(d, item.id, { duck: v })}
            commitLabel={l.duckAmount}
            coalesceKey={`duck:${item.id}`}
          />
          {hasVoice ? null : (
            <p className="vu-hint vu-duck-hint" role="status">
              {l.duckNothingToHear}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

function FadeTool({ item }: { item: Item }) {
  const l = useLabels();
  if (!('fadeIn' in item)) return null;
  const max = Math.max(0.1, Math.min(5, seconds(item.duration) / 2));
  return (
    <>
      <EditSlider
        label={l.fadeIn}
        value={seconds(item.fadeIn)}
        min={0}
        max={max}
        step={0.1}
        defaultValue={0}
        format={fmtSeconds}
        recipe={(d, v) => updateItem(d, item.id, { fadeIn: fromSeconds(v) })}
        commitLabel={l.fadeIn}
        coalesceKey={`fadein:${item.id}`}
      />
      <EditSlider
        label={l.fadeOut}
        value={seconds(item.fadeOut)}
        min={0}
        max={max}
        step={0.1}
        defaultValue={0}
        format={fmtSeconds}
        recipe={(d, v) => updateItem(d, item.id, { fadeOut: fromSeconds(v) })}
        commitLabel={l.fadeOut}
        coalesceKey={`fadeout:${item.id}`}
      />
    </>
  );
}

function AdjustTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  const [key, setKey] = useState<keyof Adjust>('brightness');
  if (!('adjust' in item)) return null;
  const adjust = item.adjust;
  const any = Object.values(adjust).some((v) => v);
  const current = ADJUST_KEYS.find((k) => k.key === key) ?? ADJUST_KEYS[0]!;
  return (
    <>
      <div className="vu-chips" role="radiogroup" aria-label={l.adjust}>
        {ADJUST_KEYS.map(({ key: k, label }) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={k === key}
            className="vu-chip"
            data-dot={adjust[k as keyof Adjust] ? '' : undefined}
            onClick={() => setKey(k as keyof Adjust)}
          >
            {label}
          </button>
        ))}
      </div>
      <EditSlider
        key={key}
        label={current.label}
        value={adjust[key] ?? 0}
        min={-1}
        max={1}
        step={0.01}
        defaultValue={0}
        origin={0}
        format={signed}
        recipe={(d, v) => {
          const found = findItem(d, item.id)?.item;
          const base = found && 'adjust' in found ? found.adjust : adjust;
          updateItem(d, item.id, { adjust: { ...base, [key]: v } });
        }}
        commitLabel={l.adjust}
        coalesceKey={`adjust:${key}:${item.id}`}
      />
      <div className="vu-row">
        <Button
          icon="undo"
          label={l.resetAdjust}
          variant="secondary"
          disabledReason={any ? null : l.nothingToReset}
          onClick={() => ctl.run(l.reset, (d) => updateItem(d, item.id, { adjust: {} }))}
        />
      </div>
    </>
  );
}

function CropTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  const [edge, setEdge] = useState<'left' | 'right' | 'top' | 'bottom'>('left');
  if (!('crop' in item)) return null;
  const crop = item.crop;
  const any = crop.left || crop.right || crop.top || crop.bottom;
  const edges = [
    ['left', l.cropLeft],
    ['right', l.cropRight],
    ['top', l.cropTop],
    ['bottom', l.cropBottom],
  ] as const;
  return (
    <>
      <Segmented
        label={l.crop}
        hideLabel
        value={edge}
        options={edges.map(([value]) => ({ value, label: l[value] }))}
        onChange={setEdge}
      />
      <EditSlider
        key={edge}
        label={edges.find(([e]) => e === edge)![1]}
        value={crop[edge]}
        min={0}
        max={0.45}
        step={0.005}
        defaultValue={0}
        format={percent}
        recipe={(d, v) => {
          const found = findItem(d, item.id)?.item;
          const base = found && 'crop' in found ? found.crop : crop;
          updateItem(d, item.id, { crop: { ...base, [edge]: v } });
        }}
        commitLabel={l.crop}
        coalesceKey={`crop:${edge}:${item.id}`}
      />
      <div className="vu-row">
        <Button
          icon="undo"
          label={l.resetCrop}
          variant="secondary"
          disabledReason={any ? null : l.nothingToReset}
          onClick={() => ctl.run(l.reset, (d) => updateItem(d, item.id, { crop: { ...NO_CROP } }))}
        />
      </div>
    </>
  );
}

function TransformTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  // Keyframed elements: the values at the playhead; edits key them there (setTransformAt).
  const time = usePlayheadFor(item);
  const tf = transformAt(item, time);
  if (!tf) return null;
  const set = (label: string, patch: Partial<Transform>) =>
    ctl.run(label, (d) => setTransformAt(d, item.id, { ...tf, ...patch }, time));
  const baseScale = item.kind === 'sticker' ? 0.3 : 1;
  const moved =
    tf.x !== 0.5 ||
    tf.y !== 0.5 ||
    tf.rotation !== 0 ||
    tf.scale !== baseScale ||
    tf.flipX ||
    tf.flipY;
  return (
    <>
      <div className="vu-icon-row" role="group" aria-label={l.rotate}>
        <IconButton
          icon="rotate"
          label={l.rotate90}
          onClick={() =>
            set(l.rotate, {
              rotation: ((Math.round(tf.rotation / 90) * 90 + 90 + 180) % 360) - 180,
            })
          }
        />
        <IconButton
          icon="flip"
          label={l.flipH}
          pressed={tf.flipX}
          onClick={() => set(l.flipH, { flipX: !tf.flipX })}
        />
        <IconButton
          icon="flipV"
          label={l.flipV}
          pressed={tf.flipY}
          onClick={() => set(l.flipV, { flipY: !tf.flipY })}
        />
        <IconButton
          icon="undo"
          label={l.resetPosition}
          disabledReason={moved ? null : l.nothingToReset}
          onClick={() =>
            set(l.reset, { ...DEFAULT_TRANSFORM, scale: baseScale, opacity: tf.opacity })
          }
        />
      </div>
      {'fit' in item ? (
        <Segmented
          label={l.fitMode}
          value={item.fit}
          options={[
            { value: 'fit', label: l.fit, tip: l.fitTip },
            { value: 'fill', label: l.fill, tip: l.fillTip },
          ]}
          onChange={(fit) => ctl.run(l.fitMode, (d) => updateItem(d, item.id, { fit }))}
        />
      ) : null}
      <EditSlider
        label={l.scale}
        value={tf.scale}
        min={0.05}
        max={4}
        step={0.01}
        defaultValue={baseScale}
        format={percent}
        recipe={(d, v) => setTransformAt(d, item.id, { ...tf, scale: v }, time)}
        commitLabel={l.scale}
        coalesceKey={`scale:${item.id}`}
      />
      <EditSlider
        label={l.rotation}
        value={tf.rotation}
        min={-180}
        max={180}
        step={1}
        defaultValue={0}
        origin={0}
        format={(v) => `${Math.round(v)}°`}
        recipe={(d, v) => setTransformAt(d, item.id, { ...tf, rotation: v }, time)}
        commitLabel={l.rotate}
        coalesceKey={`rotate:${item.id}`}
      />
    </>
  );
}

function OpacityTool({ item }: { item: Item }) {
  const l = useLabels();
  const time = usePlayheadFor(item);
  const tf = transformAt(item, time);
  if (!tf) return null;
  return (
    <EditSlider
      label={l.opacity}
      value={tf.opacity}
      min={0}
      max={1}
      step={0.01}
      defaultValue={1}
      format={percent}
      recipe={(d, v) => setTransformAt(d, item.id, { ...tf, opacity: v }, time)}
      commitLabel={l.opacity}
      coalesceKey={`opacity:${item.id}`}
    />
  );
}

function DurationTool({ item }: { item: Item }) {
  const l = useLabels();
  return (
    <EditSlider
      label={l.duration}
      value={seconds(item.duration)}
      min={0.5}
      max={Math.max(15, seconds(item.duration))}
      step={0.1}
      defaultValue={3}
      format={fmtSeconds}
      recipe={(d, v) => {
        const current = findItem(d, item.id)?.item;
        if (current) trimItem(d, item.id, 'end', fromSeconds(v) - current.duration);
      }}
      commitLabel={l.duration}
      coalesceKey={`duration:${item.id}`}
    />
  );
}

function TextEditTool({ item, autoFocus = true }: { item: Item; autoFocus?: boolean }) {
  const ctl = useController();
  const l = useLabels();
  if (item.kind !== 'text') return null;
  return (
    <textarea
      className="vu-textarea"
      aria-label={l.text}
      placeholder={l.textPlaceholder}
      value={item.text}
      rows={2}
      autoFocus={autoFocus}
      onChange={(e) => {
        const value = e.currentTarget.value;
        // Typing coalesces into one undo step per pause.
        ctl.run(l.edit, (d) => updateItem(d, item.id, { text: value }), {
          coalesceKey: `text:${item.id}`,
        });
      }}
    />
  );
}

function TextStyleTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (item.kind !== 'text') return null;
  const style = item.style;
  const set = (patch: Partial<TextStyle>) =>
    ctl.run(l.style, (d) => updateItem(d, item.id, { style: { ...style, ...patch } }));
  const restyle = (d: Parameters<typeof updateItem>[0], patch: Partial<TextStyle>) =>
    updateItem(d, item.id, { style: { ...style, ...patch } });
  const font =
    FONT_PRESETS.find((f) => f.family === style.fontFamily && f.weight === style.fontWeight)?.id ??
    FONT_PRESETS.find((f) => f.family === style.fontFamily)?.id ??
    null;
  return (
    <>
      <div className="vu-font-grid" role="radiogroup" aria-label={l.font}>
        {FONT_PRESETS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={font === f.id}
            className="vu-font-tile"
            style={{ fontFamily: f.family, fontWeight: f.weight }}
            onClick={() => set({ fontFamily: f.family, fontWeight: f.weight })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ColorField
        label={l.color}
        value={style.color}
        recipe={(d, color) => restyle(d, { color })}
        commitLabel={l.color}
        coalesceKey={`textcolor:${item.id}`}
      />
      <div className="vu-field">
        <span className="vu-field-row">{l.format}</span>
        <div className="vu-format-bar" role="group" aria-label={l.format}>
          <button
            type="button"
            className="vu-format"
            aria-pressed={style.fontWeight >= 600}
            data-tooltip={l.bold}
            aria-label={l.bold}
            onClick={() => set({ fontWeight: style.fontWeight >= 600 ? 400 : 700 })}
          >
            <span className="vu-format-glyph" data-glyph="bold">
              B
            </span>
          </button>
          <button
            type="button"
            className="vu-format"
            aria-pressed={style.italic}
            data-tooltip={l.italic}
            aria-label={l.italic}
            onClick={() => set({ italic: !style.italic })}
          >
            <span className="vu-format-glyph" data-glyph="italic">
              I
            </span>
          </button>
          <span className="vu-format-divider" aria-hidden="true" />
          {(
            [
              ['left', 'alignLeft', l.alignLeft],
              ['center', 'alignCenter', l.alignCenter],
              ['right', 'alignRight', l.alignRight],
            ] as const
          ).map(([align, icon, tip]) => (
            <button
              key={align}
              type="button"
              className="vu-format"
              aria-pressed={style.align === align}
              data-tooltip={tip}
              aria-label={tip}
              onClick={() => set({ align })}
            >
              <Icon name={icon} size={18} />
            </button>
          ))}
        </div>
      </div>
      <EditSlider
        label={l.textSize}
        value={style.size}
        min={0.02}
        max={0.2}
        step={0.002}
        defaultValue={0.06}
        format={(v) => `${Math.round(v * 1000)}`}
        recipe={(d, v) => restyle(d, { size: v })}
        commitLabel={l.style}
        coalesceKey={`textsize:${item.id}`}
      />
      <EditSlider
        label={l.letterSpacing}
        value={style.letterSpacing}
        min={-0.05}
        max={0.5}
        step={0.005}
        defaultValue={0}
        origin={0}
        format={(v) => `${Math.round(v * 100)}`}
        recipe={(d, v) => restyle(d, { letterSpacing: v })}
        commitLabel={l.style}
        coalesceKey={`textspacing:${item.id}`}
      />
      <EditSlider
        label={l.lineHeight}
        value={style.lineHeight}
        min={0.8}
        max={2}
        step={0.05}
        defaultValue={1.2}
        format={(v) => v.toFixed(2)}
        recipe={(d, v) => restyle(d, { lineHeight: v })}
        commitLabel={l.style}
        coalesceKey={`textline:${item.id}`}
      />
      <div className="vu-field">
        <span className="vu-field-row">{l.textEffects}</span>
        <div className="vu-effects">
          <EffectCard
            label={l.outline}
            on={style.outline !== null}
            sample={{
              color: style.color,
              WebkitTextStroke: `2px ${style.outline?.color ?? '#000000'}`,
              paintOrder: 'stroke fill',
            }}
            onToggle={() =>
              set({ outline: style.outline ? null : { color: '#000000', width: 0.08 } })
            }
          >
            {style.outline ? (
              <>
                <ColorField
                  label={l.color}
                  value={style.outline.color}
                  recipe={(d, color) => restyle(d, { outline: { ...style.outline!, color } })}
                  commitLabel={l.outlineColor}
                  coalesceKey={`outlinecolor:${item.id}`}
                />
                <EditSlider
                  label={l.thickness}
                  value={style.outline.width}
                  min={0.01}
                  max={0.3}
                  step={0.005}
                  defaultValue={0.08}
                  format={(v) => `${Math.round(v * 100)}`}
                  recipe={(d, v) => restyle(d, { outline: { ...style.outline!, width: v } })}
                  commitLabel={l.outline}
                  coalesceKey={`outlinewidth:${item.id}`}
                />
              </>
            ) : null}
          </EffectCard>
          <EffectCard
            label={l.shadow}
            on={style.shadow !== null}
            sample={{
              color: style.color,
              textShadow: `2px 3px 4px ${style.shadow?.color ?? 'rgba(0,0,0,0.6)'}`,
            }}
            onToggle={() =>
              set({
                shadow: style.shadow ? null : { color: 'rgba(0,0,0,0.5)', blur: 4, x: 0, y: 2 },
              })
            }
          >
            {style.shadow ? (
              <>
                <ColorField
                  label={l.color}
                  value={style.shadow.color}
                  recipe={(d, color) => restyle(d, { shadow: { ...style.shadow!, color } })}
                  commitLabel={l.shadow}
                  coalesceKey={`shadowcolor:${item.id}`}
                />
                <EditSlider
                  label={l.softness}
                  value={style.shadow.blur}
                  min={0}
                  max={30}
                  step={0.5}
                  defaultValue={4}
                  format={(v) => `${Math.round(v)}`}
                  recipe={(d, v) => restyle(d, { shadow: { ...style.shadow!, blur: v } })}
                  commitLabel={l.shadow}
                  coalesceKey={`shadowblur:${item.id}`}
                />
                <EditSlider
                  label={l.distance}
                  value={Math.hypot(style.shadow.x, style.shadow.y)}
                  min={0}
                  max={12}
                  step={0.25}
                  defaultValue={2}
                  format={(v) => `${Math.round(v * 10) / 10}`}
                  recipe={(d, v) => {
                    const sh = style.shadow!;
                    const len = Math.hypot(sh.x, sh.y);
                    // Keep the direction (straight down when there was none).
                    const [ux, uy] = len > 0 ? [sh.x / len, sh.y / len] : [0, 1];
                    restyle(d, { shadow: { ...sh, x: ux * v, y: uy * v } });
                  }}
                  commitLabel={l.shadow}
                  coalesceKey={`shadowdist:${item.id}`}
                />
              </>
            ) : null}
          </EffectCard>
          <EffectCard
            label={l.labelBox}
            on={style.background !== null}
            sample={{
              color: style.color,
              background: style.background?.color ?? '#000000',
              borderRadius: '0.25em',
              padding: '0 0.3em',
            }}
            onToggle={() =>
              set({
                background: style.background
                  ? null
                  : { color: '#000000', padding: 0.3, radius: 0.2 },
              })
            }
          >
            {style.background ? (
              <>
                <ColorField
                  label={l.color}
                  value={style.background.color}
                  recipe={(d, color) => restyle(d, { background: { ...style.background!, color } })}
                  commitLabel={l.backgroundColorText}
                  coalesceKey={`boxcolor:${item.id}`}
                />
                <EditSlider
                  label={l.roundness}
                  value={style.background.radius}
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={0.2}
                  format={(v) => `${Math.round(v * 100)}%`}
                  recipe={(d, v) => restyle(d, { background: { ...style.background!, radius: v } })}
                  commitLabel={l.labelBox}
                  coalesceKey={`boxradius:${item.id}`}
                />
                <EditSlider
                  label={l.boxPadding}
                  value={style.background.padding}
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={0.3}
                  format={(v) => `${Math.round(v * 100)}`}
                  recipe={(d, v) =>
                    restyle(d, { background: { ...style.background!, padding: v } })
                  }
                  commitLabel={l.labelBox}
                  coalesceKey={`boxpad:${item.id}`}
                />
              </>
            ) : null}
          </EffectCard>
        </div>
      </div>
    </>
  );
}

/** A text effect: a sample of how it looks, its name and an on/off switch; settings when on. */
function EffectCard({
  label,
  on,
  sample,
  onToggle,
  children,
}: {
  label: string;
  on: boolean;
  sample: React.CSSProperties;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="vu-effect" data-on={on || undefined}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="vu-effect-head"
        onClick={onToggle}
      >
        <span className="vu-effect-sample" style={sample} aria-hidden="true">
          Aa
        </span>
        <span className="vu-effect-name">{label}</span>
        <span className="vu-switch" aria-hidden="true">
          <span className="vu-switch-knob" />
        </span>
      </button>
      {on ? <div className="vu-effect-body">{children}</div> : null}
    </div>
  );
}

/** Video settings: shape of the canvas and what shows behind the clips. */
/** Frame shapes as tiles: the shape itself, its ratio and what it's for. */
function RatioPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (ratio: (typeof RATIOS)[number]) => void;
}) {
  const l = useLabels();
  return (
    <div className="vu-field">
      <span className="vu-field-row" id="vu-ratio-label">
        {l.ratio}
      </span>
      <div className="vu-ratio-grid" role="radiogroup" aria-labelledby="vu-ratio-label">
        {RATIOS.map((r) => {
          const long = Math.max(r.width, r.height);
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={r.id === value}
              className="vu-ratio"
              data-tooltip={l.ratioTip(r.id)}
              onClick={() => onChange(r)}
            >
              <span className="vu-ratio-frame" aria-hidden="true">
                <span
                  style={{
                    width: `${(r.width / long) * 100}%`,
                    height: `${(r.height / long) * 100}%`,
                  }}
                />
              </span>
              <span className="vu-ratio-id">{r.id}</span>
              <span className="vu-ratio-use">{l.ratioName(r.id)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CanvasTool(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const { width, height, background } = useProject((p) => ({
    width: p.settings.width,
    height: p.settings.height,
    background: p.settings.background,
  }));
  return (
    <>
      <RatioPicker
        value={ratioOf(width, height)}
        onChange={(r) => ctl.run(l.aspectRatio, (d) => setCanvasSize(d, r.width, r.height))}
      />
      <Segmented
        label={l.background}
        value={background.type}
        options={[
          { value: 'color', label: l.backgroundColor, tip: l.bgColorTip },
          { value: 'blur', label: l.backgroundBlur, tip: l.bgBlurTip },
        ]}
        onChange={(type) =>
          ctl.run(l.background, (d) =>
            setBackground(
              d,
              type === 'blur' ? { type: 'blur', amount: 0.5 } : { type: 'color', color: '#000000' },
            ),
          )
        }
      />
      {background.type === 'color' ? (
        <ColorField
          label={l.backgroundColor}
          value={background.color}
          recipe={(d, color) => setBackground(d, { type: 'color', color })}
          commitLabel={l.background}
          coalesceKey="background-color"
        />
      ) : (
        <EditSlider
          label={l.blurAmount}
          value={background.amount}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0.5}
          format={percent}
          recipe={(d, v) => setBackground(d, { type: 'blur', amount: v })}
          commitLabel={l.background}
          coalesceKey="background-blur"
        />
      )}
    </>
  );
}
