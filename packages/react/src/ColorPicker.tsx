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
}

/**
 * A colour picker: saturation/brightness square, hue strip, hex field and recent colours.
 * `onPreview` fires while dragging (no store writes), `onChange` once on release / Enter.
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
  const [hex, setHex] = useState(value);
  const [recent] = useState(readRecent);
  const square = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const latest = useRef(value);

  useEffect(() => {
    if (value.toLowerCase() !== latest.current.toLowerCase()) {
      setHsv(hexToHsv(value));
      setHex(value);
      latest.current = value;
    }
  }, [value]);

  const show = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const c = hsvToHex(next.h, next.s, next.v);
    latest.current = c;
    setHex(c);
    onPreview(c);
  };
  const commit = () => {
    remember(latest.current);
    onChange(latest.current);
  };

  const drag = (
    el: HTMLElement | null,
    e: React.PointerEvent,
    apply: (x: number, y: number) => void,
  ) => {
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      apply(
        Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
      );
    };
    const up = () => {
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

  return (
    <div className="vu-colorpicker">
      <div
        ref={square}
        className="vu-cp-square"
        role="slider"
        tabIndex={0}
        aria-label={labels.saturation}
        aria-valuenow={Math.round(hsv.s * 100)}
        style={{ ['--vu-cp-hue' as string]: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(e) => drag(square.current, e, (x, y) => show({ h: hsv.h, s: x, v: 1 - y }))}
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
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
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
        onPointerDown={(e) => drag(strip.current, e, (x) => show({ ...hsv, h: x * 360 }))}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 30 : 5;
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          show({ ...hsv, h: (hsv.h + (e.key === 'ArrowRight' ? d : -d) + 360) % 360 });
          commit();
        }}
      >
        <span
          className="vu-cp-knob"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            top: '50%',
            background: `hsl(${hsv.h} 100% 50%)`,
          }}
        />
      </div>
      <div className="vu-cp-row">
        <span className="vu-cp-preview" style={{ background: hex }} />
        <input
          className="vu-cp-hex"
          aria-label={labels.hex}
          value={hex}
          spellCheck={false}
          onChange={(e) => setHex(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={() => {
            const v = hex.startsWith('#') ? hex : `#${hex}`;
            if (/^#[0-9a-f]{6}$/i.test(v)) {
              latest.current = v.toLowerCase();
              setHsv(hexToHsv(v));
              commit();
            } else setHex(latest.current);
          }}
        />
      </div>
      {recent.length ? (
        <div className="vu-cp-recent" role="group" aria-label={labels.recent}>
          {recent.map((c) => (
            <button
              key={c}
              type="button"
              className="vu-swatch vu-swatch-sm"
              aria-label={c}
              data-tooltip={c}
              style={{ ['--vu-swatch' as string]: c }}
              onClick={() => {
                latest.current = c;
                setHsv(hexToHsv(c));
                setHex(c);
                commit();
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
