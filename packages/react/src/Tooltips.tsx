import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

/** Hover this long before a tooltip shows; moving to a neighbour soon after shows it at once. */
const SHOW_DELAY_MS = 450;
const SKIP_DELAY_MS = 300;
const GAP = 8;
const EDGE = 8;

interface Tip {
  text: string;
  /** Anchor rectangle (viewport px). */
  rect: { left: number; top: number; width: number; height: number };
}

/**
 * One tooltip for every `[data-tooltip]` element inside the editor (mouse hover and keyboard
 * focus; never on touch). Disabled controls explain why through `data-tooltip` too. The canvas
 * timeline updates its own `data-tooltip` as the pointer moves over clips and handles; with
 * `data-tooltip-follow` the tip sits at the pointer instead of the element.
 */
export function Tooltips({
  root,
}: {
  root: React.RefObject<HTMLElement | null>;
}): ReactElement | null {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    let shownText: string | null = null;
    let hiddenAt = -Infinity;
    let pointer = { x: 0, y: 0 };

    const anchor = (target: HTMLElement) => {
      if (target.hasAttribute('data-tooltip-follow'))
        return { left: pointer.x, top: pointer.y - 6, width: 0, height: 12 };
      const r = target.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };
    const open = (target: HTMLElement) => {
      const text = target.dataset.tooltip;
      if (!text) return;
      shownText = text;
      setTip({ text, rect: anchor(target) });
    };
    const hide = () => {
      clearTimeout(timer);
      if (shownText) hiddenAt = performance.now();
      shownText = null;
      current = null;
      setTip(null);
    };
    const targetOf = (event: Event) => {
      const t =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-tooltip]')
          : null;
      return t && el.contains(t) ? t : null;
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pointer = { x: e.clientX, y: e.clientY };
      const target = targetOf(e);
      if (!target) {
        if (current) hide();
        return;
      }
      if (target === current) return;
      clearTimeout(timer);
      setTip(null);
      current = target;
      if (performance.now() - hiddenAt < SKIP_DELAY_MS) open(target);
      else timer = setTimeout(() => current === target && open(target), SHOW_DELAY_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      // An element can gain its text while hovered (the canvas timeline): pick it up here.
      if (!current) {
        if (targetOf(e)) onOver(e);
        return;
      }
      pointer = { x: e.clientX, y: e.clientY };
      if (!current.hasAttribute('data-tooltip-follow')) return;
      // The canvas timeline changes its text by region: restart the delay on a new text.
      const text = current.dataset.tooltip ?? null;
      if (!text) {
        if (shownText) {
          shownText = null;
          setTip(null);
        }
        return;
      }
      if (shownText === text) {
        setTip({ text, rect: anchor(current) });
        return;
      }
      if (shownText !== null) {
        shownText = null;
        setTip(null);
      }
      const target = current;
      clearTimeout(timer);
      timer = setTimeout(() => current === target && open(target), SHOW_DELAY_MS);
    };
    const onOut = (e: PointerEvent) => {
      const next = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (current && !(next && current.contains(next))) hide();
    };
    // Focus tooltips are for keyboard users only: after a tap or click (even when the editor then
    // moves focus itself, e.g. back to a toolbar button), no tooltip pops up.
    let keyboard = false;
    const onFocus = (e: FocusEvent) => {
      const target = targetOf(e);
      if (
        keyboard &&
        target?.matches(':focus-visible') &&
        !target.hasAttribute('data-tooltip-follow')
      ) {
        current = target;
        open(target);
      }
    };
    const onDown = (e: Event) => {
      keyboard = e.type === 'keydown';
      hide();
    };
    el.addEventListener('pointerover', onOver);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerout', onOut);
    el.addEventListener('focusin', onFocus);
    el.addEventListener('focusout', hide);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('keydown', onDown);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('pointerover', onOver);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerout', onOut);
      el.removeEventListener('focusin', onFocus);
      el.removeEventListener('focusout', hide);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('keydown', onDown);
    };
  }, [root]);

  // Place below the anchor (above when there's no room), clamped to the window.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || !tip) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const { left, top, width, height } = tip.rect;
    let x = left + width / 2 - w / 2;
    let y = top + height + GAP;
    if (y + h > innerHeight - EDGE) y = top - GAP - h;
    x = Math.max(EDGE, Math.min(innerWidth - EDGE - w, x));
    box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    box.dataset.placed = '';
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} className="vu-tooltip" aria-hidden="true">
      {tip.text}
    </div>
  );
}
