'use client';

/**
 * The playground's form parts, one look for all: sections, rows, segmented choices, a slider
 * in the editor's style, a select with its own chevron, switches and fields.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

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

const TICK_PX = 8;
const SNAP_PX = 6;

/** A tick spacing that gives about 40 ticks over the range (1, 2, 5 × 10ⁿ). */
function niceTick(range: number): number {
  const raw = range / 40;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * The editor's slider, for the site: a tick scale that slides under a fixed centre marker.
 * Drag it, use the arrow keys (Shift = ×10, Home / End), or double-click to reset; it snaps to
 * the default. A sideways touch drags it; an upward one still scrolls the page.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const labelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; start: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Touch: the page may scroll over the ruler (pan-y), but a gesture that starts sideways is ours.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let x = 0;
    let y = 0;
    let axis: 'x' | 'y' | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      x = t.clientX;
      y = t.clientY;
      axis = null;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      if (!axis) {
        const dx = Math.abs(t.clientX - x);
        const dy = Math.abs(t.clientY - y);
        if (dx < 2 && dy < 2) return;
        axis = dx >= dy ? 'x' : 'y';
      }
      if (axis === 'x' && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
    };
  }, []);

  const tick = niceTick(max - min);
  const pxPerUnit = TICK_PX / tick;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const count = Math.round((max - min) / tick);
  const offset = (value - min) * pxPerUnit;
  const set = (v: number) => {
    if (v !== value) onChange(v);
  };

  return (
    <div className="pg-field">
      <div className="pg-field-top">
        <span className="pg-label" id={labelId}>
          {label}
        </span>
        <span className="pg-value" aria-hidden="true">
          {value}
          {unit}
        </span>
      </div>
      <div
        ref={ref}
        className="pg-ruler"
        role="slider"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value}${unit}`}
        data-dragging={dragging || undefined}
        onPointerDown={(e) => {
          if (e.button > 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, start: value, moved: false };
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
          set(v);
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => {
          if (defaultValue !== undefined) set(defaultValue);
        }}
        onKeyDown={(e) => {
          const big = e.shiftKey ? 10 : 1;
          let next: number | null = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = clamp(value + step * big);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = clamp(value - step * big);
          else if (e.key === 'Home') next = min;
          else if (e.key === 'End') next = max;
          else if ((e.key === 'Enter' || e.key === 'Delete') && defaultValue !== undefined)
            next = defaultValue;
          if (next === null) return;
          e.preventDefault();
          set(next);
        }}
      >
        <div className="pg-ruler-viewport">
          <div className="pg-ruler-track" style={{ transform: `translateX(${-offset}px)` }}>
            {Array.from({ length: count + 1 }, (_, i) => {
              const v = min + i * tick;
              return (
                <span
                  key={i}
                  className="pg-ruler-tick"
                  data-major={Math.abs(Math.round(v / tick) % 5) === 0 || undefined}
                  data-default={
                    (defaultValue !== undefined && Math.abs(v - defaultValue) < tick / 2) ||
                    undefined
                  }
                  style={{ left: `${i * TICK_PX}px` }}
                />
              );
            })}
            <span className="pg-ruler-fill" style={{ left: 0, width: `${offset}px` }} />
          </div>
        </div>
        <span className="pg-ruler-marker" aria-hidden="true" />
      </div>
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
