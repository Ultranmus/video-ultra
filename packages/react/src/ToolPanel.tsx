import {
  findItem,
  FLICKS_PER_SECOND,
  fromSeconds,
  NO_CROP,
  DEFAULT_TRANSFORM,
  setBackground,
  setCanvasSize,
  setSpeed,
  setTransition,
  trimItem,
  updateItem,
  type Adjust,
  type Item,
  type TextStyle,
  type Transform,
  ADJUST_KEYS,
  FILTER_PRESETS,
  FONT_PRESETS,
  TRANSITION_PRESETS,
} from '@video-ultra/core';
import type { ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { ColorField, EditSlider, Section, Segmented, ToolButton } from './controls';
import { RATIOS, ratioOf } from './items';
import type { ToolId } from './state';

const seconds = (t: number) => t / FLICKS_PER_SECOND;
const fmtSeconds = (s: number) => `${s.toFixed(1)} s`;
const percent = (v: number) => `${Math.round(v * 100)}%`;
const signedPercent = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;

/** The controls of one tool for the selected item (or the canvas). Shown in the sheet or inspector. */
export function ToolPanel({ tool }: { tool: ToolId }): ReactElement | null {
  const l = useLabels();
  const selectedId = useUi((s) => s.selectedId);
  const item = useProject((p) => (selectedId ? (findItem(p, selectedId)?.item ?? null) : null));
  if (tool === 'canvas') return <CanvasTool />;
  if (!item) return <p className="vu-hint">{l.nothingSelected}</p>;
  switch (tool) {
    case 'speed':
      return <SpeedTool item={item} />;
    case 'volume':
      return <VolumeTool item={item} />;
    case 'fade':
      return <FadeTool item={item} />;
    case 'filter':
      return <FilterTool item={item} />;
    case 'adjust':
      return <AdjustTool item={item} />;
    case 'crop':
      return <CropTool item={item} />;
    case 'transform':
      return <TransformTool item={item} />;
    case 'transition':
      return <TransitionTool item={item} />;
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

function SpeedTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (item.kind !== 'video' && item.kind !== 'audio') return null;
  const apply = (speed: number) =>
    ctl.run(l.speed, (d, ctx) => setSpeed(d, item.id, speed, ctx.ids));
  return (
    <Section>
      <EditSlider
        label={l.speed}
        value={Math.log2(item.speed)}
        min={Math.log2(0.1)}
        max={Math.log2(10)}
        step={0.01}
        format={(v) => `${(2 ** v).toFixed(2).replace(/\.?0+$/, '')}×`}
        recipe={(d, v, ctx) => setSpeed(d, item.id, Math.round(2 ** v * 100) / 100, ctx.ids)}
        commitLabel={l.speed}
        coalesceKey={`speed:${item.id}`}
      />
      <Segmented
        label=""
        value={String(item.speed)}
        options={['0.5', '1', '2', '4'].map((v) => ({ value: v, label: `${v}×` }))}
        onChange={(v) => apply(Number(v))}
      />
    </Section>
  );
}

function VolumeTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (!('volume' in item)) return null;
  return (
    <Section>
      <EditSlider
        label={l.volume}
        value={item.volume}
        min={0}
        max={2}
        step={0.01}
        format={percent}
        recipe={(d, v) => updateItem(d, item.id, { volume: v, muted: false })}
        commitLabel={l.volume}
        coalesceKey={`volume:${item.id}`}
      />
      <div className="vu-row">
        <ToolButton
          icon={item.muted ? 'volume' : 'muted'}
          label={item.muted ? l.unmute : l.mute}
          pressed={item.muted}
          onClick={() =>
            ctl.run(item.muted ? l.unmute : l.mute, (d) =>
              updateItem(d, item.id, { muted: !item.muted }),
            )
          }
        />
      </div>
    </Section>
  );
}

function FadeTool({ item }: { item: Item }) {
  const l = useLabels();
  if (!('fadeIn' in item)) return null;
  const max = Math.min(5, seconds(item.duration) / 2);
  return (
    <Section>
      <EditSlider
        label={l.fadeIn}
        value={seconds(item.fadeIn)}
        min={0}
        max={max}
        step={0.1}
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
        format={fmtSeconds}
        recipe={(d, v) => updateItem(d, item.id, { fadeOut: fromSeconds(v) })}
        commitLabel={l.fadeOut}
        coalesceKey={`fadeout:${item.id}`}
      />
    </Section>
  );
}

function FilterTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (!('filter' in item)) return null;
  const current = item.filter;
  return (
    <Section>
      <div className="vu-grid" role="radiogroup" aria-label={l.filter}>
        <button
          type="button"
          role="radio"
          aria-checked={current === null}
          className="vu-preset"
          onClick={() => ctl.run(l.filter, (d) => updateItem(d, item.id, { filter: null }))}
        >
          {l.none}
        </button>
        {FILTER_PRESETS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={current?.id === f.id}
            className="vu-preset"
            data-filter={f.id}
            onClick={() =>
              ctl.run(l.filter, (d) =>
                updateItem(d, item.id, {
                  filter: { id: f.id, intensity: current?.intensity ?? 1 },
                }),
              )
            }
          >
            {f.label}
          </button>
        ))}
      </div>
      {current ? (
        <EditSlider
          label={l.intensity}
          value={current.intensity}
          min={0}
          max={1}
          step={0.01}
          format={percent}
          recipe={(d, v) => updateItem(d, item.id, { filter: { id: current.id, intensity: v } })}
          commitLabel={l.filter}
          coalesceKey={`filter:${item.id}`}
        />
      ) : null}
    </Section>
  );
}

function AdjustTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (!('adjust' in item)) return null;
  const adjust = item.adjust;
  return (
    <Section>
      {ADJUST_KEYS.map(({ key, label }) => (
        <EditSlider
          key={key}
          label={label}
          value={adjust[key as keyof Adjust] ?? 0}
          min={-1}
          max={1}
          step={0.01}
          format={signedPercent}
          recipe={(d, v) => {
            const found = findItem(d, item.id)?.item;
            const base = found && 'adjust' in found ? found.adjust : adjust;
            updateItem(d, item.id, { adjust: { ...base, [key]: v } });
          }}
          commitLabel={l.adjust}
          coalesceKey={`adjust:${key}:${item.id}`}
        />
      ))}
      <div className="vu-row">
        <ToolButton
          icon="undo"
          label={l.reset}
          onClick={() => ctl.run(l.reset, (d) => updateItem(d, item.id, { adjust: {} }))}
        />
      </div>
    </Section>
  );
}

function CropTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (!('crop' in item)) return null;
  const crop = item.crop;
  const edges = [
    ['left', l.left],
    ['right', l.right],
    ['top', l.top],
    ['bottom', l.bottom],
  ] as const;
  return (
    <Section>
      {edges.map(([edge, label]) => (
        <EditSlider
          key={edge}
          label={label}
          value={crop[edge]}
          min={0}
          max={0.45}
          step={0.005}
          format={percent}
          recipe={(d, v) => {
            const found = findItem(d, item.id)?.item;
            const base = found && 'crop' in found ? found.crop : crop;
            updateItem(d, item.id, { crop: { ...base, [edge]: v } });
          }}
          commitLabel={l.crop}
          coalesceKey={`crop:${edge}:${item.id}`}
        />
      ))}
      <div className="vu-row">
        <ToolButton
          icon="undo"
          label={l.reset}
          onClick={() => ctl.run(l.reset, (d) => updateItem(d, item.id, { crop: { ...NO_CROP } }))}
        />
      </div>
    </Section>
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
  const canFit = 'fit' in item;
  return (
    <Section>
      <div className="vu-row">
        <ToolButton
          icon="rotate"
          label={l.rotate}
          onClick={() =>
            set(l.rotate, {
              rotation: ((Math.round(tf.rotation / 90) * 90 + 90 + 180) % 360) - 180,
            })
          }
        />
        <ToolButton
          icon="flip"
          label={l.flipH}
          pressed={tf.flipX}
          onClick={() => set(l.flipH, { flipX: !tf.flipX })}
        />
        <ToolButton
          icon="flip"
          label={l.flipV}
          pressed={tf.flipY}
          onClick={() => set(l.flipV, { flipY: !tf.flipY })}
        />
        <ToolButton
          icon="undo"
          label={l.reset}
          onClick={() =>
            set(l.reset, { ...DEFAULT_TRANSFORM, scale: item.kind === 'sticker' ? 0.3 : 1 })
          }
        />
      </div>
      {canFit ? (
        <Segmented
          label={l.fitMode}
          value={item.fit}
          options={[
            { value: 'fit', label: l.fit },
            { value: 'fill', label: l.fill },
          ]}
          onChange={(fit) => ctl.run(l.fitMode, (d) => updateItem(d, item.id, { fit }))}
        />
      ) : null}
      <EditSlider
        label={l.rotate}
        value={tf.rotation}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        recipe={(d, v) => updateItem(d, item.id, { transform: { ...tf, rotation: v } })}
        commitLabel={l.rotate}
        coalesceKey={`rotate:${item.id}`}
      />
      <EditSlider
        label={l.scale}
        value={tf.scale}
        min={0.05}
        max={4}
        step={0.01}
        format={percent}
        recipe={(d, v) => updateItem(d, item.id, { transform: { ...tf, scale: v } })}
        commitLabel={l.scale}
        coalesceKey={`scale:${item.id}`}
      />
    </Section>
  );
}

function OpacityTool({ item }: { item: Item }) {
  const l = useLabels();
  const tf = transformOf(item);
  if (!tf) return null;
  return (
    <Section>
      <EditSlider
        label={l.opacity}
        value={tf.opacity}
        min={0}
        max={1}
        step={0.01}
        format={percent}
        recipe={(d, v) => updateItem(d, item.id, { transform: { ...tf, opacity: v } })}
        commitLabel={l.opacity}
        coalesceKey={`opacity:${item.id}`}
      />
    </Section>
  );
}

function DurationTool({ item }: { item: Item }) {
  const l = useLabels();
  return (
    <Section>
      <EditSlider
        label={l.duration}
        value={seconds(item.duration)}
        min={0.5}
        max={Math.max(15, seconds(item.duration))}
        step={0.1}
        format={fmtSeconds}
        recipe={(d, v) => {
          const current = findItem(d, item.id)?.item;
          if (current) trimItem(d, item.id, 'end', fromSeconds(v) - current.duration);
        }}
        commitLabel={l.duration}
        coalesceKey={`duration:${item.id}`}
      />
    </Section>
  );
}

function TransitionTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (!('transitionIn' in item)) return null;
  const current = item.transitionIn;
  const duration = current?.duration ?? fromSeconds(0.5);
  return (
    <Section>
      <p className="vu-hint">{l.transitionHint}</p>
      <div className="vu-grid" role="radiogroup" aria-label={l.transition}>
        <button
          type="button"
          role="radio"
          aria-checked={current === null}
          className="vu-preset"
          onClick={() => ctl.run(l.transition, (d) => setTransition(d, item.id, null))}
        >
          {l.none}
        </button>
        {TRANSITION_PRESETS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={current?.type === t.id}
            className="vu-preset"
            onClick={() =>
              ctl.run(l.transition, (d) => setTransition(d, item.id, { type: t.id, duration }))
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {current ? (
        <EditSlider
          label={l.duration}
          value={seconds(current.duration)}
          min={0.1}
          max={2}
          step={0.1}
          format={fmtSeconds}
          recipe={(d, v) =>
            setTransition(d, item.id, { type: current.type, duration: fromSeconds(v) })
          }
          commitLabel={l.transition}
          coalesceKey={`transition:${item.id}`}
        />
      ) : null}
    </Section>
  );
}

function TextEditTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (item.kind !== 'text') return null;
  return (
    <Section>
      <textarea
        className="vu-textarea"
        aria-label={l.text}
        placeholder={l.textPlaceholder}
        value={item.text}
        rows={3}
        autoFocus
        onChange={(e) => {
          const value = e.currentTarget.value;
          // Typing coalesces into one undo step per pause.
          ctl.run(l.edit, (d) => updateItem(d, item.id, { text: value }), {
            coalesceKey: `text:${item.id}`,
          });
        }}
      />
    </Section>
  );
}

function TextStyleTool({ item }: { item: Item }) {
  const ctl = useController();
  const l = useLabels();
  if (item.kind !== 'text') return null;
  const style = item.style;
  const set = (patch: Partial<TextStyle>) =>
    ctl.run(l.style, (d) => updateItem(d, item.id, { style: { ...style, ...patch } }));
  const font = FONT_PRESETS.find((f) => f.family === style.fontFamily)?.id ?? null;
  return (
    <Section>
      <Segmented
        label={l.font}
        value={font}
        options={FONT_PRESETS.map((f) => ({ value: f.id, label: f.label }))}
        onChange={(id) => {
          const f = FONT_PRESETS.find((x) => x.id === id)!;
          set({ fontFamily: f.family, fontWeight: f.weight });
        }}
      />
      <ColorField label={l.color} value={style.color} onChange={(color) => set({ color })} />
      <EditSlider
        label={l.scale}
        value={style.size}
        min={0.02}
        max={0.2}
        step={0.002}
        format={(v) => `${Math.round(v * 1000) / 10}`}
        recipe={(d, v) => updateItem(d, item.id, { style: { ...style, size: v } })}
        commitLabel={l.style}
        coalesceKey={`textsize:${item.id}`}
      />
      <div className="vu-row">
        <ToolButton
          icon="style"
          label={l.bold}
          pressed={style.fontWeight >= 600}
          onClick={() => set({ fontWeight: style.fontWeight >= 600 ? 400 : 700 })}
        />
        <ToolButton
          icon="edit"
          label={l.italic}
          pressed={style.italic}
          onClick={() => set({ italic: !style.italic })}
        />
        <ToolButton
          icon="alignLeft"
          label={l.alignLeft}
          pressed={style.align === 'left'}
          onClick={() => set({ align: 'left' })}
        />
        <ToolButton
          icon="alignCenter"
          label={l.alignCenter}
          pressed={style.align === 'center'}
          onClick={() => set({ align: 'center' })}
        />
        <ToolButton
          icon="alignRight"
          label={l.alignRight}
          pressed={style.align === 'right'}
          onClick={() => set({ align: 'right' })}
        />
      </div>
      <div className="vu-row">
        <ToolButton
          icon="edit"
          label={l.outline}
          pressed={style.outline !== null}
          onClick={() => set({ outline: style.outline ? null : { color: '#000000', width: 0.08 } })}
        />
        <ToolButton
          icon="opacity"
          label={l.shadow}
          pressed={style.shadow !== null}
          onClick={() =>
            set({ shadow: style.shadow ? null : { color: 'rgba(0,0,0,0.5)', blur: 4, x: 0, y: 2 } })
          }
        />
        <ToolButton
          icon="canvas"
          label={l.background}
          pressed={style.background !== null}
          onClick={() =>
            set({
              background: style.background ? null : { color: '#000000', padding: 0.3, radius: 0.2 },
            })
          }
        />
      </div>
      {style.outline ? (
        <ColorField
          label={l.outline}
          value={style.outline.color}
          onChange={(color) => set({ outline: { ...style.outline!, color } })}
        />
      ) : null}
      {style.background ? (
        <ColorField
          label={l.background}
          value={style.background.color}
          onChange={(color) => set({ background: { ...style.background!, color } })}
        />
      ) : null}
    </Section>
  );
}

function CanvasTool() {
  const ctl = useController();
  const l = useLabels();
  const { width, height, background } = useProject((p) => ({
    width: p.settings.width,
    height: p.settings.height,
    background: p.settings.background,
  }));
  return (
    <Section>
      <Segmented
        label={l.ratio}
        value={ratioOf(width, height)}
        options={RATIOS.map((r) => ({ value: r.id, label: r.id }))}
        onChange={(id) => {
          const r = RATIOS.find((x) => x.id === id)!;
          ctl.run(l.aspectRatio, (d) => setCanvasSize(d, r.width, r.height));
        }}
      />
      <Segmented
        label={l.background}
        value={background.type}
        options={[
          { value: 'color', label: l.backgroundColor },
          { value: 'blur', label: l.backgroundBlur },
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
          onChange={(color) =>
            ctl.run(l.background, (d) => setBackground(d, { type: 'color', color }))
          }
        />
      ) : (
        <EditSlider
          label={l.blurAmount}
          value={background.amount}
          min={0}
          max={1}
          step={0.01}
          format={percent}
          recipe={(d, v) => setBackground(d, { type: 'blur', amount: v })}
          commitLabel={l.background}
          coalesceKey="background-blur"
        />
      )}
    </Section>
  );
}
