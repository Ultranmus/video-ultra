import {
  findItem,
  updateItem,
  type BlendMode,
  type ChromaKey,
  type Item,
  type RegionItem,
} from '@video-ultra/core';
import { useRef, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { Button, Chips, EditSlider, EmptyState, Segmented } from './controls';
import { Icon, type IconName } from './icons';

/**
 * Picture tools (v0.2 C): green screen, LUT looks, blend modes and blurred / pixelated areas.
 * Each block works in the desktop inspector (a titled section) and in the phone sheet (a tool).
 */

/** Pictures that take a green screen and a LUT: videos, photos, freeze frames. */
export type PictureItem = Extract<Item, { crop: unknown }>;

export function isPicture(item: Item | null | undefined): item is PictureItem {
  return !!item && (item.kind === 'video' || item.kind === 'image' || item.kind === 'freeze');
}

/** A new green screen: chroma green, a medium range, soft edges, some edge cleaning. */
export const DEFAULT_KEY: Readonly<ChromaKey> = Object.freeze({
  color: '#00b140',
  tolerance: 0.4,
  softness: 0.3,
  spill: 0.5,
});

const KEY_PRESETS = [
  { value: '#00b140', name: 'keyGreen' },
  { value: '#0047bb', name: 'keyBlue' },
] as const;

const percent = (v: number) => `${Math.round(v * 100)}%`;

// ── Green screen (C1) ───────────────────────────────────────────────────────

/** Green screen: on / off, the colour (presets or picked from the video), range, edges. */
export function GreenScreenTool({ item }: { item: Item }): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const picking = useUi((s) => s.picking === item.id);
  if (!isPicture(item)) return <p className="vu-hint">{l.pictureOnly}</p>;
  const key = item.key;
  const set = (patch: Partial<ChromaKey>) =>
    ctl.run(l.greenScreen, (d) =>
      updateItem(d, item.id, { key: { ...(key ?? DEFAULT_KEY), ...patch } }),
    );
  const slider = (
    field: 'tolerance' | 'softness' | 'spill',
    label: string,
    defaultValue: number,
  ) => (
    <EditSlider
      key={field}
      label={label}
      value={key?.[field] ?? defaultValue}
      min={0}
      max={1}
      step={0.01}
      defaultValue={defaultValue}
      format={percent}
      recipe={(d, v) => {
        const found = findItem(d, item.id)?.item;
        const base = found && isPicture(found) && found.key ? found.key : DEFAULT_KEY;
        updateItem(d, item.id, { key: { ...base, [field]: v } });
      }}
      commitLabel={l.greenScreen}
      coalesceKey={`key:${field}:${item.id}`}
    />
  );
  const preset = KEY_PRESETS.find((p) => p.value === key?.color.toLowerCase());
  return (
    <div className="vu-picture-tool">
      <button
        type="button"
        role="switch"
        aria-checked={!!key}
        className="vu-switch-row"
        data-tooltip={l.tipGreenScreen}
        onClick={() =>
          ctl.run(l.greenScreen, (d) => updateItem(d, item.id, { key: key ? null : DEFAULT_KEY }))
        }
      >
        <span>{l.greenScreenSwitch}</span>
        <span className="vu-switch" aria-hidden="true">
          <span className="vu-switch-knob" />
        </span>
      </button>
      {key ? (
        <>
          <div className="vu-field">
            <div className="vu-field-row">
              <span>{l.keyColour}</span>
              <span className="vu-key-current">
                <span
                  className="vu-color-dot"
                  style={{ ['--vu-swatch' as string]: key.color }}
                  aria-hidden="true"
                />
                <span className="vu-color-hex">{key.color.toUpperCase()}</span>
              </span>
            </div>
            <div className="vu-row vu-key-row">
              {KEY_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className="vu-key-preset"
                  aria-pressed={preset?.value === p.value}
                  aria-label={l[p.name]}
                  data-tooltip={l[p.name]}
                  style={{ ['--vu-swatch' as string]: p.value }}
                  onClick={() => set({ color: p.value })}
                />
              ))}
              <Button
                icon="eyedropper"
                label={picking ? l.pickCancel : l.pickFromVideo}
                variant="secondary"
                tip={l.tipPickFromVideo}
                pressed={picking}
                onClick={() => ctl.startPicking(picking ? null : item.id)}
              />
            </div>
            {picking ? (
              <p className="vu-hint" role="status">
                {l.pickingHint}
              </p>
            ) : null}
          </div>
          {slider('tolerance', l.keyTolerance, DEFAULT_KEY.tolerance)}
          {slider('softness', l.keySoftness, DEFAULT_KEY.softness)}
          {slider('spill', l.keySpill, DEFAULT_KEY.spill)}
        </>
      ) : (
        <p className="vu-hint">{l.greenScreenHint}</p>
      )}
    </div>
  );
}

// ── LUT looks (C2) ──────────────────────────────────────────────────────────

/**
 * LUT looks for a picture: the project's imported `.cube` files as chips (plus "No LUT"), an
 * Import button and the strength. Lives in the Filters panel, above the filter presets.
 */
export function LutControls({ item }: { item: Item }): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const input = useRef<HTMLInputElement>(null);
  const luts = useProject((p) =>
    Object.values(p.assets)
      .filter((a) => a.kind === 'lut')
      .map((a) => `${a.id}\u0000${a.name}`)
      .join('\u0001'),
  );
  if (!isPicture(item)) return null;
  const list = luts
    ? luts.split('\u0001').map((row) => {
        const [id, name] = row.split('\u0000');
        return { id: id!, name: name! };
      })
    : [];
  const current = item.lut?.assetId ?? 'none';
  return (
    <div className="vu-lut">
      <div className="vu-field-row">
        <span className="vu-lut-title">{l.lutLooks}</span>
        <Button
          icon="lut"
          label={l.importLut}
          variant="secondary"
          tip={l.tipImportLut}
          onClick={() => input.current?.click()}
        />
        <input
          ref={input}
          type="file"
          accept=".cube"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void ctl.importLut(file, item.id);
          }}
        />
      </div>
      {list.length ? (
        <Chips
          label={l.lutLooks}
          hideLabel
          value={current}
          options={[
            { value: 'none', label: l.lutNone },
            ...list.map((lut) => ({ value: lut.id, label: lut.name, icon: 'lut' as IconName })),
          ]}
          onChange={(id) =>
            ctl.run(l.lutStep, (d) =>
              updateItem(d, item.id, {
                lut: id === 'none' ? null : { assetId: id, intensity: item.lut?.intensity ?? 1 },
              }),
            )
          }
        />
      ) : (
        <p className="vu-hint">{l.lutHint}</p>
      )}
      {item.lut ? (
        <EditSlider
          label={l.lutIntensity}
          value={item.lut.intensity}
          min={0}
          max={1}
          step={0.01}
          defaultValue={1}
          format={percent}
          recipe={(d, v) =>
            updateItem(d, item.id, { lut: { assetId: item.lut!.assetId, intensity: v } })
          }
          commitLabel={l.lutStep}
          coalesceKey={`lut:${item.id}`}
        />
      ) : null}
    </div>
  );
}

// ── Blend modes (C4) ────────────────────────────────────────────────────────

const BLENDS: readonly BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'add',
  'lighten',
  'darken',
  'difference',
];

/** How a layer (picture, text, sticker) mixes with what's under it. */
export function BlendTool({ item }: { item: Item }): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const onMain = useProject((p) => findItem(p, item.id)?.track.kind === 'main');
  if (item.kind === 'audio' || item.kind === 'region') return null;
  if (onMain) return <p className="vu-hint">{l.blendMainVideo}</p>;
  const value = ('blend' in item ? item.blend : undefined) ?? 'normal';
  // Tiles that show what each mode does: a coloured square under a dot mixed with that mode
  // (the browser's own blending, so it costs nothing to draw).
  return (
    <div className="vu-field">
      <span className="vu-field-row">{l.blend}</span>
      <div className="vu-filter-grid vu-blend-grid" role="radiogroup" aria-label={l.blend}>
        {BLENDS.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={mode === value}
            className="vu-filter-tile"
            data-tooltip={l.blendTip(mode)}
            onClick={() => {
              if (mode !== value) ctl.run(l.blend, (d) => updateItem(d, item.id, { blend: mode }));
            }}
          >
            <span className="vu-filter-thumb vu-blend-thumb" data-ready="" aria-hidden="true">
              <span
                className="vu-blend-dot"
                style={{ mixBlendMode: mode === 'add' ? 'plus-lighter' : mode }}
              />
            </span>
            <span className="vu-filter-name">{l.blendName(mode)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Blurred / pixelated areas (C3) ──────────────────────────────────────────

/** A blurred area's settings: blur or pixelate, shape, strength and size. */
export function RegionTool({ item }: { item: Item }): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  if (item.kind !== 'region') return null;
  const set = (label: string, patch: Partial<Pick<RegionItem, 'effect' | 'shape'>>) =>
    ctl.run(label, (d) => updateItem(d, item.id, patch));
  const size = (field: 'width' | 'height', label: string) => (
    <EditSlider
      key={field}
      label={label}
      value={item[field]}
      min={0.02}
      max={1.5}
      step={0.005}
      format={percent}
      recipe={(d, v) => updateItem(d, item.id, { [field]: v })}
      commitLabel={l.resize}
      coalesceKey={`region:${field}:${item.id}`}
    />
  );
  return (
    <>
      <Segmented
        label={l.regionEffect}
        value={item.effect}
        options={[
          { value: 'blur', label: l.regionBlur, icon: 'blurArea' },
          { value: 'pixelate', label: l.regionPixelate, icon: 'pixelate' },
        ]}
        onChange={(effect) => set(l.regionEffect, { effect })}
      />
      <Segmented
        label={l.regionShape}
        value={item.shape}
        options={[
          { value: 'rectangle', label: l.regionRectangle, icon: 'rectangle' },
          { value: 'ellipse', label: l.regionEllipse, icon: 'oval' },
        ]}
        onChange={(shape) => set(l.regionShape, { shape })}
      />
      <EditSlider
        label={l.regionAmount}
        value={item.amount}
        min={0}
        max={1}
        step={0.01}
        defaultValue={0.5}
        format={percent}
        recipe={(d, v) => updateItem(d, item.id, { amount: v })}
        commitLabel={l.regionAmount}
        coalesceKey={`region:amount:${item.id}`}
      />
      {size('width', l.regionWidth)}
      {size('height', l.regionHeight)}
    </>
  );
}

const REGION_TILES: {
  effect: RegionItem['effect'];
  shape: RegionItem['shape'];
  label: 'blurBox' | 'blurOval' | 'pixelateBox' | 'pixelateOval';
  icon: IconName;
}[] = [
  { effect: 'blur', shape: 'rectangle', label: 'blurBox', icon: 'blurArea' },
  { effect: 'blur', shape: 'ellipse', label: 'blurOval', icon: 'blurArea' },
  { effect: 'pixelate', shape: 'rectangle', label: 'pixelateBox', icon: 'pixelate' },
  { effect: 'pixelate', shape: 'ellipse', label: 'pixelateOval', icon: 'pixelate' },
];

/** The Blur panel: add a blurred or pixelated box / oval at the playhead. */
export function BlurPanel(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const hasClips = useProject((p) => p.tracks.some((t) => t.items.length > 0));
  if (!hasClips) {
    return (
      <EmptyState
        icon="blurArea"
        title={l.needClips}
        body={l.tipBlurAreas}
        action={
          <Button
            icon="plus"
            label={l.addMedia}
            variant="primary"
            onClick={() => ctl.pickFiles()}
          />
        }
      />
    );
  }
  return (
    <div className="vu-blur-panel">
      <p className="vu-hint">{l.blurPanelHint}</p>
      <div className="vu-region-tiles">
        {REGION_TILES.map((tile) => (
          <button
            key={tile.label}
            type="button"
            className="vu-region-tile"
            data-tooltip={l.addBlurArea}
            onClick={() => ctl.addRegion(tile.effect, tile.shape)}
          >
            <span className="vu-region-swatch" data-effect={tile.effect} data-shape={tile.shape}>
              <Icon name={tile.icon} size={22} />
            </span>
            <span className="vu-region-name">{l[tile.label]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
