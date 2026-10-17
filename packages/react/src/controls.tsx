import type { EditContext, Project } from '@video-ultra/core';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useController } from './context';
import { Icon, type IconName } from './icons';

/** A tool button: icon over a label (every tool has both — UI_VISION §1). */
export function ToolButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  danger,
  pressed,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Toggle buttons expose their state to screen readers. */
  pressed?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      className="vu-tool"
      data-active={active || undefined}
      data-danger={danger || undefined}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="vu-tool-label">{label}</span>
    </button>
  );
}

/** Small icon button with a visible text label next to the icon (top bar, transport). */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  showLabel = false,
  title,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  showLabel?: boolean;
  title?: string;
}): ReactElement {
  return (
    <button
      type="button"
      className="vu-icon-button"
      data-labelled={showLabel || undefined}
      aria-label={showLabel ? undefined : label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}

/**
 * A slider that previews live while dragged (no store writes, no undo steps) and commits one edit
 * on release. Keyboard steps commit each step, merged into one undo step.
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
  /** Called with the live value while dragging (e.g. to move the playhead). */
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

  return (
    <div className="vu-field">
      <label className="vu-field-row" htmlFor={id}>
        <span>{label}</span>
        <output className="vu-field-value">{format ? format(shown) : String(shown)}</output>
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
        style={{ ['--vu-fill' as string]: `${((shown - min) / (max - min)) * 100}%` }}
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

/** A single-choice row of chips (radio group). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <div className="vu-field">
      <span className="vu-field-row">{label}</span>
      <div className="vu-segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className="vu-chip"
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
  '#ffffff',
  '#000000',
  '#f5d547',
  '#ff7a45',
  '#ff4d6d',
  '#c86bfa',
  '#5b8cff',
  '#33c3a0',
  '#8fd16a',
];

/** Colour swatches plus a custom colour input. */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="vu-field">
      <span className="vu-field-row">{label}</span>
      <div className="vu-swatches" role="radiogroup" aria-label={label}>
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === color}
            aria-label={color}
            className="vu-swatch"
            style={{ ['--vu-swatch' as string]: color }}
            onClick={() => onChange(color)}
          />
        ))}
        <input
          className="vu-swatch vu-swatch-custom"
          type="color"
          aria-label={label}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      </div>
    </div>
  );
}

/** A labelled group inside a tool panel. */
export function Section({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="vu-section">
      {title ? <h3 className="vu-section-title">{title}</h3> : null}
      {children}
    </section>
  );
}
