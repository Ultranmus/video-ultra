import type { EditContext, Project } from '@video-ultra/core';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useController } from './context';
import { ColorPicker } from './ColorPicker';
import { Icon, type IconName } from './icons';

/**
 * Shared controls. Every control has a visible label or a tooltip; a control that can't act right
 * now stays visible but disabled, and its tooltip says why (never a button that silently does
 * nothing).
 */

function tooltipFor(
  label: string,
  tip: string | undefined,
  shortcut: string | undefined,
  disabledReason: string | null | undefined,
) {
  if (disabledReason) return disabledReason;
  const text = tip ?? label;
  return shortcut ? `${text}  ·  ${shortcut}` : text;
}

export interface ButtonProps {
  icon?: IconName;
  label: string;
  onClick: () => void;
  /** `ghost` (default) · `primary` (one per screen) · `secondary` · `danger`. */
  variant?: 'ghost' | 'primary' | 'secondary' | 'danger';
  /** Icon above a small label (tool rails and toolbars), icon + label in a row, or icon only. */
  layout?: 'stack' | 'row' | 'icon';
  /** Longer explanation shown in the tooltip (defaults to the label). */
  tip?: string;
  shortcut?: string;
  /** When set, the button is disabled and the tooltip shows this reason. */
  disabledReason?: string | null;
  active?: boolean;
  /** Toggle buttons: exposes the on/off state. */
  pressed?: boolean;
  className?: string;
}

/** The one button. */
export function Button({
  icon,
  label,
  onClick,
  variant = 'ghost',
  layout = 'row',
  tip,
  shortcut,
  disabledReason,
  active,
  pressed,
  className,
}: ButtonProps): ReactElement {
  const disabled = Boolean(disabledReason);
  const iconOnly = layout === 'icon';
  const showTip = iconOnly || disabled || tip !== undefined || shortcut !== undefined;
  return (
    <button
      type="button"
      className={`vu-btn${className ? ` ${className}` : ''}`}
      data-variant={variant}
      data-layout={layout}
      data-active={active || undefined}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      aria-label={iconOnly ? label : undefined}
      aria-keyshortcuts={shortcut}
      data-tooltip={showTip ? tooltipFor(label, tip, shortcut, disabledReason) : undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {icon ? <Icon name={icon} size={layout === 'stack' ? 20 : 18} /> : null}
      {iconOnly ? null : <span className="vu-btn-label">{label}</span>}
    </button>
  );
}

/** Tool in a rail or toolbar: icon over its label. */
export function ToolButton(
  props: Omit<ButtonProps, 'layout' | 'variant'> & { danger?: boolean },
): ReactElement {
  const { danger, ...rest } = props;
  return <Button {...rest} layout="stack" variant={danger ? 'danger' : 'ghost'} />;
}

/** Icon-only button (the tooltip carries the name). */
export function IconButton(props: Omit<ButtonProps, 'layout'> & { icon: IconName }): ReactElement {
  return <Button {...props} layout="icon" />;
}

/** A tick spacing that gives about 40 ticks over the range (1, 2, 5 × 10ⁿ). */
function niceTick(range: number): number {
  const raw = range / 40;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

const TICK_PX = 8;
const SNAP_PX = 6;

/**
 * The ruler slider: a tick scale that slides under a fixed centre marker, the value above it.
 * Drag it (touch or mouse), use the arrow keys (Shift = ×10), or double-click to reset; it snaps
 * to the default. While dragging it previews live (no store writes, no undo steps) and commits
 * one edit on release; key presses commit, merged into one undo step.
 */
export function EditSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  recipe,
  commitLabel,
  coalesceKey,
  defaultValue,
  origin,
  onLive,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  /** Applies a value to the project draft. */
  recipe: (draft: Project, value: number, ctx: EditContext) => void;
  commitLabel: string;
  coalesceKey: string;
  defaultValue?: number;
  /** Where the fill starts: `min` (default), or the zero point of a two-sided slider. */
  origin?: number;
  onLive?: (value: number) => void;
}): ReactElement {
  const ctl = useController();
  const id = useId();
  const [live, setLive] = useState<number | null>(null);
  const recipeRef = useRef(recipe);
  useEffect(() => {
    recipeRef.current = recipe;
  });
  const drag = useRef<{ id: number; x: number; start: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const shown = live ?? value;
  const changed = defaultValue !== undefined && Math.abs(shown - defaultValue) > step / 2;
  const tick = niceTick(max - min);
  const pxPerUnit = TICK_PX / tick;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));

  const commit = (v: number) => {
    setLive(null);
    ctl.run(commitLabel, (d, ctx) => recipeRef.current(d, v, ctx), { coalesceKey });
  };
  const show = (v: number) => {
    setLive(v);
    onLive?.(v);
    ctl.preview((d, ctx) => recipeRef.current(d, v, ctx));
  };

  // Ticks: one element per tick (≤ ~45), majors every 5; the track moves, the marker stays.
  const ticks: ReactElement[] = [];
  const count = Math.round((max - min) / tick);
  for (let i = 0; i <= count; i++) {
    const v = min + i * tick;
    const major = Math.abs(Math.round(v / tick) % 5) === 0;
    const isDefault = defaultValue !== undefined && Math.abs(v - defaultValue) < tick / 2;
    ticks.push(
      <span
        key={i}
        className="vu-ruler-tick"
        data-major={major || undefined}
        data-default={isDefault || undefined}
        style={{ left: `${i * TICK_PX}px` }}
      />,
    );
  }
  const offset = (shown - min) * pxPerUnit;
  const from = ((origin ?? min) - min) * pxPerUnit;

  return (
    <div className="vu-field">
      <div className="vu-field-row">
        <span id={id}>{label}</span>
        <output className="vu-field-value" data-changed={changed || undefined}>
          {format ? format(shown) : String(shown)}
        </output>
      </div>
      <div
        className="vu-ruler"
        role="slider"
        tabIndex={0}
        aria-labelledby={id}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        aria-valuetext={format ? format(shown) : String(shown)}
        data-dragging={dragging || undefined}
        onPointerDown={(e) => {
          if (e.button > 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, start: shown, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) < 3) return;
          if (!d.moved) setDragging(true);
          d.moved = true;
          // Dragging the scale left brings higher values under the marker.
          let v = clamp(d.start - dx / pxPerUnit);
          if (defaultValue !== undefined && Math.abs(v - defaultValue) * pxPerUnit < SNAP_PX)
            v = defaultValue;
          show(v);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (!d || d.id !== e.pointerId) return;
          if (d.moved && live !== null) commit(live);
          else setLive(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          setLive(null);
          ctl.preview(null);
        }}
        onDoubleClick={() => {
          if (defaultValue !== undefined) commit(defaultValue);
        }}
        onKeyDown={(e) => {
          const big = e.shiftKey ? 10 : 1;
          let next: number | null = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = clamp(shown + tick * big);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = clamp(shown - tick * big);
          else if (e.key === 'Home') next = min;
          else if (e.key === 'End') next = max;
          else if ((e.key === 'Enter' || e.key === 'Delete') && defaultValue !== undefined)
            next = defaultValue;
          if (next === null) return;
          e.preventDefault();
          e.stopPropagation();
          commit(next);
        }}
      >
        <div className="vu-ruler-viewport">
          <div className="vu-ruler-track" style={{ transform: `translateX(${-offset}px)` }}>
            {ticks}
            <span
              className="vu-ruler-fill"
              style={{ left: `${Math.min(from, offset)}px`, width: `${Math.abs(offset - from)}px` }}
            />
          </div>
        </div>
        <span className="vu-ruler-marker" aria-hidden="true" />
      </div>
    </div>
  );
}

type Choice<T extends string> = { value: T; label: string; icon?: IconName; tip?: string };

/** A small set of exclusive choices in one pill (2–5 short options). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string;
  value: T | null;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
  hideLabel?: boolean;
}): ReactElement {
  return (
    <div className="vu-field">
      {hideLabel ? null : <span className="vu-field-row">{label}</span>}
      <div className="vu-segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className="vu-segment"
            data-tooltip={o.tip}
            onClick={() => onChange(o.value)}
          >
            {o.icon ? <Icon name={o.icon} size={16} /> : null}
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A wrapping row of outlined choice chips (more options than a segmented pill holds). */
export function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string;
  value: T | null;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
  hideLabel?: boolean;
}): ReactElement {
  return (
    <div className="vu-field">
      {hideLabel ? null : <span className="vu-field-row">{label}</span>}
      <div className="vu-chips" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className="vu-chip"
            data-tooltip={o.tip}
            onClick={() => onChange(o.value)}
          >
            {o.icon ? <Icon name={o.icon} size={16} /> : null}
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const SWATCHES = [
  ['#ffffff', 'White'],
  ['#000000', 'Black'],
  ['#f5d547', 'Yellow'],
  ['#ff7a45', 'Orange'],
  ['#ff4d6d', 'Red'],
  ['#c86bfa', 'Purple'],
  ['#5b8cff', 'Blue'],
  ['#33c3a0', 'Teal'],
  ['#8fd16a', 'Green'],
] as const;

/** Colour swatches plus a full colour picker. Previews while dragging; one edit per change. */
export function ColorField({
  label,
  value,
  recipe,
  commitLabel,
  coalesceKey,
}: {
  label: string;
  value: string;
  /** Applies a colour to the project draft. */
  recipe: (draft: Project, color: string) => void;
  commitLabel: string;
  coalesceKey: string;
}): ReactElement {
  const ctl = useController();
  const l = ctl.labels;
  const [open, setOpen] = useState(false);
  const custom = !SWATCHES.some(([c]) => c === value.toLowerCase());
  const commit = (color: string) => ctl.run(commitLabel, (d) => recipe(d, color), { coalesceKey });
  return (
    <div className="vu-field">
      <span className="vu-field-row">{label}</span>
      <div className="vu-swatches" role="radiogroup" aria-label={label}>
        {SWATCHES.map(([color, name]) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === color}
            aria-label={name}
            data-tooltip={name}
            className="vu-swatch"
            style={{ ['--vu-swatch' as string]: color }}
            onClick={() => commit(color)}
          />
        ))}
        <button
          type="button"
          className="vu-swatch vu-swatch-custom"
          aria-label={l.customColor}
          aria-expanded={open}
          data-tooltip={l.customColor}
          data-checked={custom || undefined}
          onClick={() => setOpen(!open)}
        />
      </div>
      {open ? (
        <ColorPicker
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
          onPreview={(c) => ctl.preview((d) => recipe(d, c))}
          onChange={commit}
          labels={{ saturation: l.cpSaturation, hue: l.cpHue, hex: l.cpHex, recent: l.cpRecent }}
        />
      ) : null}
    </div>
  );
}

/** A titled group in a panel; collapsible when `collapsible`. */
export function Section({
  title,
  children,
  collapsible,
  defaultOpen = true,
  aside,
}: {
  title?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Small control on the heading's right (e.g. Reset). */
  aside?: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const shown = open || !collapsible;
  return (
    <section className="vu-section" data-open={shown || undefined}>
      {title ? (
        <div className="vu-section-head">
          {collapsible ? (
            <button
              type="button"
              className="vu-section-toggle"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen(!open)}
            >
              <Icon name="chevronDown" size={16} />
              <h3 className="vu-section-title">{title}</h3>
            </button>
          ) : (
            <h3 className="vu-section-title">{title}</h3>
          )}
          {aside}
        </div>
      ) : null}
      {shown ? (
        <div className="vu-section-body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** An empty state: what this place is for, and the one thing to do next. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="vu-empty">
      <span className="vu-empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <p className="vu-empty-title">{title}</p>
      {body ? <p className="vu-empty-body">{body}</p> : null}
      {action}
    </div>
  );
}
