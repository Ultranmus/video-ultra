'use client';

/**
 * The playground's form parts, one look for all: sections, rows, segmented choices, a slider
 * in the editor's style, a select with its own chevron, switches and fields.
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** A titled group of options (a fieldset, so screen readers hear its title). */
export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset className="pg-section">
      <div className="pg-section-head">
        <legend>{title}</legend>
        {action}
      </div>
      {hint ? <p className="pg-hint">{hint}</p> : null}
      <div className="pg-section-body">{children}</div>
    </fieldset>
  );
}

/** Tabs with arrow-key movement (WAI-ARIA tabs pattern). */
export function Tabs<T extends string>({
  tabs,
  tab,
  onTab,
  label,
  idPrefix,
}: {
  tabs: readonly { id: T; label: string }[];
  tab: T;
  onTab: (t: T) => void;
  label: string;
  idPrefix: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let to = -1;
    if (e.key === 'ArrowRight') to = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') to = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = tabs.length - 1;
    if (to < 0) return;
    e.preventDefault();
    onTab(tabs[to]!.id);
    refs.current[to]?.focus();
  };
  return (
    <div className="pg-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => onTab(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A segmented choice that fills its row (equal parts, never wraps). */
export function Choice<T extends string>({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
}: {
  label: string;
  hideLabel?: boolean;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="pg-field">
      {hideLabel ? null : <span className="pg-label">{label}</span>}
      <div
        className="pg-choice"
        role="group"
        aria-label={label}
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A slider drawn like the editor's: a rounded track, an accent fill, a round handle. */
export function Slider({
  label,
  value,
  min,
  max,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="pg-field">
      <div className="pg-field-top">
        <label className="pg-label" htmlFor={id}>
          {label}
        </label>
        <output className="pg-value" htmlFor={id}>
          {value}
          {unit}
        </output>
      </div>
      <input
        id={id}
        className="pg-slider"
        type="range"
        min={min}
        max={max}
        value={value}
        style={{ '--pg-fill': `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** A select with the site's chevron. */
export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="pg-field">
      <label className="pg-label" htmlFor={id}>
        {label}
      </label>
      <div className="pg-select">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.label} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

/** An on / off switch (a checkbox underneath: native keyboard and screen reader behaviour). */
export function Switch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="pg-switch">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** A labelled text field. */
export function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="pg-field">
      <label className="pg-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="pg-input"
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** A number field that commits on Enter or leaving it (kept in range). */
export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  // The parent keys this field by its value, so a new value starts a fresh draft.
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Math.round(Number(text));
    if (Number.isFinite(n) && text.trim() !== '') onChange(Math.min(max, Math.max(min, n)));
    else setText(String(value));
  };
  return (
    <label className="pg-number">
      <span className="site-sr">{label}</span>
      <input
        className="pg-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
  );
}
