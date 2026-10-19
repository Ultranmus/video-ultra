import { useEffect, useRef, type ReactElement } from 'react';
import { useController, useLabels } from './context';

/** Shown range: −48 dB … 0 dB. */
const FLOOR_DB = -48;
/** How fast a bar falls back (dB per update ≈ per frame): smooth, readable. */
const FALL_DB = 1.2;

const toDb = (peak: number) => (peak > 1e-5 ? 20 * Math.log10(peak) : -120);

/**
 * Level meter (v0.4): how loud the sound being heard is, left and right. Updated per frame
 * through refs (React never renders for it); bars turn amber near the top and red when the mix
 * reaches full scale. Decorative for screen readers (the sound itself is what they hear).
 */
export function LevelMeter(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const leftRef = useRef<HTMLSpanElement>(null);
  const rightRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bars = [leftRef.current!, rightRef.current!];
    const shown = [FLOOR_DB, FLOOR_DB];
    const states = ['', ''];
    const draw = (index: number, peak: number) => {
      const db = Math.max(toDb(peak), shown[index]! - FALL_DB, FLOOR_DB);
      if (db === shown[index]) return;
      shown[index] = db;
      const bar = bars[index]!;
      bar.style.transform = `scaleX(${((db - FLOOR_DB) / -FLOOR_DB).toFixed(3)})`;
      const state = peak >= 0.99 ? 'clip' : db > -6 ? 'hot' : '';
      if (state !== states[index]) {
        states[index] = state;
        if (state) bar.dataset.level = state;
        else delete bar.dataset.level;
      }
    };
    return ctl.levels.subscribe((left, right) => {
      draw(0, left);
      draw(1, right);
    });
  }, [ctl]);
  return (
    <span className="vu-meter" aria-hidden="true" data-tooltip={l.soundLevel}>
      <span className="vu-meter-bar">
        <span ref={leftRef} className="vu-meter-fill" />
      </span>
      <span className="vu-meter-bar">
        <span ref={rightRef} className="vu-meter-fill" />
      </span>
    </span>
  );
}
