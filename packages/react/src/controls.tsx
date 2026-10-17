import type { EditContext, Project } from '@video-ultra/core';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useController } from './context';
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

/**
 * A slider that previews live while dragged (no store writes, no undo steps) and commits one edit
 * on release. Keyboard steps commit each step, merged into one undo step. Double-click resets to
 * `defaultValue`.
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
  const ref = useRef<HTMLInputElement>(null);
  const recipeRef = useRef(recipe);
  useEffect(() => {
    recipeRef.current = recipe;
  });
  const shown = live ?? value;
  const changed = defaultValue !== undefined && Math.abs(shown - defaultValue) > step / 2;

  useEffect(() => {
    const input = ref.current!;
    // Native `change` fires on release (pointer) or per key step; React's onChange fires on input.
    const commit = () => {
      const v = Number(input.value);
      setLive(null);
      ctl.run(commitLabel, (d, ctx) => recipeRef.current(d, v, ctx), { coalesceKey });
    };
    input.addEventListener('change', commit);
    return () => input.removeEventListener('change', commit);
  }, [ctl, commitLabel, coalesceKey]);

  const fill = ((shown - min) / (max - min)) * 100;
  // Two-sided sliders (adjustments) fill from their zero point, not from the left end.
  const from = origin !== undefined ? ((origin - min) / (max - min)) * 100 : 0;
  return (
    <div className="vu-field">
      <label className="vu-field-row" htmlFor={id}>
        <span>{label}</span>
        <output className="vu-field-value" data-changed={changed || undefined}>
          {format ? format(shown) : String(shown)}
        </output>
      </label>
      <input
        ref={ref}
        id={id}
        className="vu-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        style={{
          ['--vu-fill-from' as string]: `${Math.min(fill, from)}%`,
          ['--vu-fill-to' as string]: `${Math.max(fill, from)}%`,
        }}
        onDoubleClick={() => {
          if (defaultValue === undefined) return;
          setLive(null);
          ctl.run(commitLabel, (d, ctx) => recipeRef.current(d, defaultValue, ctx));
        }}
        onChange={(e) => {
          const v = Number(e.currentTarget.value);
          setLive(v);
          onLive?.(v);
          ctl.preview((d, ctx) => recipeRef.current(d, v, ctx));
        }}
      />
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

/** Colour swatches plus a custom colour. */
export function ColorField({
  label,
  value,
  onChange,
  customLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  customLabel: string;
}): ReactElement {
  const custom = !SWATCHES.some(([c]) => c === value.toLowerCase());
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
            onClick={() => onChange(color)}
          />
        ))}
        <label
          className="vu-swatch vu-swatch-custom"
          data-tooltip={customLabel}
          data-checked={custom || undefined}
        >
          <input
            type="color"
            className="vu-sr-only"
            aria-label={customLabel}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        </label>
      </div>
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
