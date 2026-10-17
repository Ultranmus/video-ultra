import {
  ADJUST_KEYS,
  DEFAULT_TRANSFORM,
  FILTER_PRESETS,
  findItem,
  FLICKS_PER_SECOND,
  FONT_PRESETS,
  fromSeconds,
  mainTrack,
  NO_CROP,
  setBackground,
  setCanvasSize,
  setSpeed,
  setTransition,
  TRANSITION_PRESETS,
  trimItem,
  updateItem,
  type Adjust,
  type Item,
  type TextStyle,
  type Transform,
} from '@video-ultra/core';
import { useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Button, Chips, ColorField, EditSlider, IconButton, Section, Segmented } from './controls';
import { RATIOS, ratioOf } from './items';
import { FilterStrip, TransitionGrid } from './looks';
import type { ToolId } from './state';

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
  if (tool === 'canvas') return <CanvasTool />;
  if (tool === 'filter') return <FilterStrip />;
  if (tool === 'transition') return <TransitionGrid />;
  if (!item) return <p className="vu-hint">{l.nothingSelected}</p>;
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
    default:
      return null;
  }
}

/** Desktop inspector: the selected item's settings as titled sections, most used first. */
export function InspectorSections({ item }: { item: Item }): ReactElement {
  const l = useLabels();
  const ctl = useController();
  const index = useProject((p) => mainTrack(p).items.findIndex((i) => i.id === item.id));
  const onMain = index !== -1;
  const filterName =
    'filter' in item && item.filter
      ? (FILTER_PRESETS.find((f) => f.id === item.filter!.id)?.label ?? item.filter.id)
      : l.none;
  const transitionName =
    'transitionIn' in item && item.transitionIn
      ? (TRANSITION_PRESETS.find((t) => t.id === item.transitionIn!.type)?.label ??
        item.transitionIn.type)
      : l.none;
  const change = (panel: 'filters' | 'transitions', tip: string) => (
    <Button label={l.change} variant="secondary" tip={tip} onClick={() => ctl.openPanel(panel)} />
  );

  const look =
    'filter' in item ? (
      <Section title={l.look}>
        <div className="vu-current">
          <span className="vu-current-label">{l.filter}</span>
          <span className="vu-current-value">{filterName}</span>
          {change('filters', l.changeFilterTip)}
        </div>
        {item.filter ? (
          <EditSlider
            label={l.intensity}
            value={item.filter.intensity}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            defaultValue={1}
            recipe={(d, v) =>
              updateItem(d, item.id, { filter: { id: item.filter!.id, intensity: v } })
            }
            commitLabel={l.filter}
            coalesceKey={`filter:${item.id}`}
          />
        ) : null}
      </Section>
    ) : null;
  const transition =
    index > 0 && 'transitionIn' in item ? (
      <Section title={l.transition}>
        <div className="vu-current">
          <span className="vu-current-label">{l.transitionShort}</span>
          <span className="vu-current-value">{transitionName}</span>
          {change('transitions', l.changeTransitionTip)}
        </div>
        <TransitionDuration item={item} />
      </Section>
    ) : null;
  const picture = (
    <>
      {look}
      <Section title={l.adjust} collapsible defaultOpen={false}>
        <AdjustTool item={item} />
      </Section>
      <Section title={l.cropRotate} collapsible defaultOpen={false}>
        <TransformTool item={item} />
        <CropTool item={item} />
      </Section>
      {transition}
      {onMain ? null : (
        <Section title={l.opacity}>
          <OpacityTool item={item} />
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
          <Section title={l.appearance} collapsible defaultOpen={false}>
            <TransformTool item={item} />
            <OpacityTool item={item} />
          </Section>
        </>
      );
    case 'sticker':
      return (
        <Section title={l.appearance}>
          <TransformTool item={item} />
          <OpacityTool item={item} />
        </Section>
      );
  }
}

function TransitionDuration({ item }: { item: Item }) {
  const l = useLabels();
  if (!('transitionIn' in item) || !item.transitionIn) return null;
  const current = item.transitionIn;
  return (
    <EditSlider
      label={l.duration}
      value={seconds(current.duration)}
      min={0.1}
      max={2}
      step={0.1}
      format={fmtSeconds}
      defaultValue={0.5}
      recipe={(d, v) => setTransition(d, item.id, { type: current.type, duration: fromSeconds(v) })}
      commitLabel={l.transition}
      coalesceKey={`transition:${item.id}`}
    />
  );
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
    </>
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
        options={edges.map(([value, label]) => ({ value, label }))}
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

function transformOf(item: Item): Transform | null {
  return 'transform' in item ? item.transform : null;
}

function TransformTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  const tf = transformOf(item);
  if (!tf) return null;
  const set = (label: string, patch: Partial<Transform>) =>
    ctl.run(label, (d) => updateItem(d, item.id, { transform: { ...tf, ...patch } }));
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
        recipe={(d, v) => updateItem(d, item.id, { transform: { ...tf, scale: v } })}
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
        recipe={(d, v) => updateItem(d, item.id, { transform: { ...tf, rotation: v } })}
        commitLabel={l.rotate}
        coalesceKey={`rotate:${item.id}`}
      />
    </>
  );
}

function OpacityTool({ item }: { item: Item }) {
  const l = useLabels();
  const tf = transformOf(item);
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
      recipe={(d, v) => updateItem(d, item.id, { transform: { ...tf, opacity: v } })}
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
      <EditSlider
        label={l.textSize}
        value={style.size}
        min={0.02}
        max={0.2}
        step={0.002}
        defaultValue={0.06}
        format={(v) => `${Math.round(v * 1000) / 10}`}
        recipe={(d, v) => updateItem(d, item.id, { style: { ...style, size: v } })}
        commitLabel={l.style}
        coalesceKey={`textsize:${item.id}`}
      />
      <Segmented
        label={l.alignment}
        value={style.align}
        options={[
          { value: 'left', label: l.left, icon: 'alignLeft', tip: l.alignLeft },
          { value: 'center', label: l.centre, icon: 'alignCenter', tip: l.alignCenter },
          { value: 'right', label: l.right, icon: 'alignRight', tip: l.alignRight },
        ]}
        onChange={(align) => set({ align })}
      />
      <div className="vu-field">
        <span className="vu-field-row">{l.textEffects}</span>
        <div className="vu-row">
          <Button
            label={l.bold}
            variant="secondary"
            pressed={style.fontWeight >= 600}
            onClick={() => set({ fontWeight: style.fontWeight >= 600 ? 400 : 700 })}
          />
          <Button
            label={l.italic}
            variant="secondary"
            pressed={style.italic}
            onClick={() => set({ italic: !style.italic })}
          />
          <Button
            label={l.outline}
            variant="secondary"
            pressed={style.outline !== null}
            onClick={() =>
              set({ outline: style.outline ? null : { color: '#000000', width: 0.08 } })
            }
          />
          <Button
            label={l.shadow}
            variant="secondary"
            pressed={style.shadow !== null}
            onClick={() =>
              set({
                shadow: style.shadow ? null : { color: 'rgba(0,0,0,0.5)', blur: 4, x: 0, y: 2 },
              })
            }
          />
          <Button
            label={l.background}
            variant="secondary"
            pressed={style.background !== null}
            onClick={() =>
              set({
                background: style.background
                  ? null
                  : { color: '#000000', padding: 0.3, radius: 0.2 },
              })
            }
          />
        </div>
      </div>
      {style.outline ? (
        <ColorField
          label={l.outlineColor}
          value={style.outline.color}
          recipe={(d, color) => restyle(d, { outline: { ...style.outline!, color } })}
          commitLabel={l.outlineColor}
          coalesceKey={`outlinecolor:${item.id}`}
        />
      ) : null}
      {style.background ? (
        <ColorField
          label={l.backgroundColorText}
          value={style.background.color}
          recipe={(d, color) => restyle(d, { background: { ...style.background!, color } })}
          commitLabel={l.backgroundColorText}
          coalesceKey={`boxcolor:${item.id}`}
        />
      ) : null}
    </>
  );
}

/** Video settings: shape of the canvas and what shows behind the clips. */
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
      <Chips
        label={l.ratio}
        value={ratioOf(width, height)}
        options={RATIOS.map((r) => ({ value: r.id, label: r.id, tip: l.ratioTip(r.id) }))}
        onChange={(id) => {
          const r = RATIOS.find((x) => x.id === id)!;
          ctl.run(l.aspectRatio, (d) => setCanvasSize(d, r.width, r.height));
        }}
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
