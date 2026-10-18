import { useEffect, useRef, useState, type ReactElement } from 'react';

/** Hex ↔ HSV (h 0…360, s/v 0…1). */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0xffffff;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const RECENT_KEY = 'video-ultra:recent-colors';

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function remember(color: string): void {
  try {
    const next = [color, ...readRecent().filter((c) => c !== color)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: no recents */
  }
}

export interface ColorPickerLabels {
  saturation: string;
  hue: string;
  hex: string;
  recent: string;
  /** The "before" half of the comparison (tapping it goes back). */
  before: string;
  eyedropper: string;
}

/** A knob position 0…1 along a track, kept fully inside it. */
const inset = (f: number) =>
  `calc(${f} * (100% - var(--vu-size-cp-knob)) + var(--vu-size-cp-knob) / 2)`;

/** The browser's screen colour picker (Chromium desktop), when there is one. */
type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };
function eyeDropper(): EyeDropperCtor | null {
  return (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper ?? null;
}

/**
 * The full colour picker: a saturation / brightness area, a hue slider, a before | after preview
 * (tap "before" to go back), a compact hex field, the screen eyedropper where the browser has one,
 * and recent colours. `onPreview` fires while dragging (no store writes); `onChange` once on
 * release, Enter or a tap.
 */
export function ColorPicker({
  value,
  onPreview,
  onChange,
  labels,
}: {
  value: string;
  onPreview: (hex: string) => void;
  onChange: (hex: string) => void;
  labels: ColorPickerLabels;
}): ReactElement {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hex, setHex] = useState(value.replace('#', ''));
  const [recent] = useState(readRecent);
  const [before] = useState(value);
  const area = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const latest = useRef(value);
  const Dropper = eyeDropper();

  useEffect(() => {
    if (value.toLowerCase() !== latest.current.toLowerCase()) {
      setHsv(hexToHsv(value));
      setHex(value.replace('#', ''));
      latest.current = value;
    }
  }, [value]);

  const show = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const c = hsvToHex(next.h, next.s, next.v);
    latest.current = c;
    setHex(c.slice(1));
    onPreview(c);
  };
  const commit = () => {
    remember(latest.current);
    onChange(latest.current);
  };
  const pick = (c: string) => {
    latest.current = c.toLowerCase();
    setHsv(hexToHsv(c));
    setHex(c.slice(1).toLowerCase());
    commit();
  };

  const drag = (
    el: HTMLElement | null,
    e: React.PointerEvent,
    apply: (x: number, y: number) => void,
  ) => {
    if (!el) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    el.dataset.dragging = '';
    // Knobs stay fully inside their track: the usable range is inset by half a knob.
    const k = el.querySelector<HTMLElement>('.vu-cp-knob')?.offsetWidth ?? 0;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      apply(
        Math.min(1, Math.max(0, (ev.clientX - r.left - k / 2) / Math.max(1, r.width - k))),
        Math.min(1, Math.max(0, (ev.clientY - r.top - k / 2) / Math.max(1, r.height - k))),
      );
    };
    const up = () => {
      delete el.dataset.dragging;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      commit();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    move(e.nativeEvent);
  };
  const current = hsvToHex(hsv.h, hsv.s, hsv.v);

  return (
    <div className="vu-colorpicker" style={{ ['--vu-cp-hue' as string]: `hsl(${hsv.h} 100% 50%)` }}>
      <div
        ref={area}
        className="vu-cp-area"
        role="slider"
        tabIndex={0}
        aria-label={labels.saturation}
        aria-valuetext={current}
        aria-valuenow={Math.round(hsv.s * 100)}
        onPointerDown={(e) => drag(area.current, e, (x, y) => show({ h: hsv.h, s: x, v: 1 - y }))}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 0.1 : 0.02;
          const next = { ...hsv };
          if (e.key === 'ArrowRight') next.s = Math.min(1, hsv.s + d);
          else if (e.key === 'ArrowLeft') next.s = Math.max(0, hsv.s - d);
          else if (e.key === 'ArrowUp') next.v = Math.min(1, hsv.v + d);
          else if (e.key === 'ArrowDown') next.v = Math.max(0, hsv.v - d);
          else return;
          e.preventDefault();
          show(next);
          commit();
        }}
      >
        <span
          className="vu-cp-knob"
          style={{ left: inset(hsv.s), top: inset(1 - hsv.v), background: current }}
        />
      </div>
      <div
        ref={strip}
        className="vu-cp-hue"
        role="slider"
        tabIndex={0}
        aria-label={labels.hue}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={(e) =>
          drag(strip.current, e, (x) => show({ ...hsv, h: Math.min(359.9, x * 360) }))
        }
        onKeyDown={(e) => {
          const d = e.shiftKey ? 30 : 5;
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          show({ ...hsv, h: (hsv.h + (e.key === 'ArrowRight' ? d : -d) + 360) % 360 });
          commit();
        }}
      >
        <span className="vu-cp-knob vu-cp-knob-hue" style={{ left: inset(hsv.h / 360) }} />
      </div>
      <div className="vu-cp-row">
        <span className="vu-cp-compare">
          <button
            type="button"
            className="vu-cp-before"
            style={{ ['--vu-swatch' as string]: before }}
            aria-label={labels.before}
            data-tooltip={labels.before}
            onClick={() => /^#[0-9a-f]{6}$/i.test(before) && pick(before)}
          />
          <span className="vu-cp-after" style={{ ['--vu-swatch' as string]: current }} />
        </span>
        <label className="vu-cp-hexbox">
          <span aria-hidden="true">#</span>
          <input
            className="vu-cp-hex"
            aria-label={labels.hex}
            value={hex}
            maxLength={7}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(e) => setHex(e.currentTarget.value.replace('#', ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            onBlur={() => {
              const v = `#${hex.trim()}`;
              if (/^#[0-9a-f]{6}$/i.test(v)) pick(v);
              else setHex(latest.current.slice(1));
            }}
          />
        </label>
        {Dropper ? (
          <button
            type="button"
            className="vu-cp-dropper"
            aria-label={labels.eyedropper}
            data-tooltip={labels.eyedropper}
            onClick={() => {
              void new Dropper()
                .open()
                .then((r) => pick(r.sRGBHex.length === 7 ? r.sRGBHex : before))
                .catch(() => {});
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M14.5 5.5l4 4M12.5 7.5l4 4-8 8H4.5v-4z M15 3.5a2.1 2.1 0 013 3l-1.5 1.5-3-3z" />
            </svg>
          </button>
        ) : null}
      </div>
      {recent.length ? (
        <div className="vu-cp-recent" role="group" aria-label={labels.recent}>
          <span className="vu-cp-recent-label">{labels.recent}</span>
          {recent.map((c) => (
            <button
              key={c}
              type="button"
              className="vu-swatch vu-swatch-sm"
              aria-label={c}
              data-tooltip={c}
              style={{ ['--vu-swatch' as string]: c }}
              onClick={() => pick(c)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
