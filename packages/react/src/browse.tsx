import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

/**
 * Scrolls `scroller` so `section` sits just under the sticky chip bar. Done by hand on purpose:
 * `scrollIntoView` also scrolls every ancestor — including the editor itself when part of a
 * sheet is off-screen, which shoved the whole layout (the tab bar ended up mid-screen).
 */
function scrollToSection(
  scroller: HTMLElement,
  section: HTMLElement,
  bar: HTMLElement | null,
  smooth: boolean,
): void {
  const top =
    scroller.scrollTop +
    section.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top -
    (bar?.offsetHeight ?? 0);
  scroller.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}

/** Scrolls the chip row (only it) sideways so `chip` is in view. */
function revealChip(row: HTMLElement, chip: HTMLElement): void {
  const r = row.getBoundingClientRect();
  const c = chip.getBoundingClientRect();
  const pad = 24;
  if (c.left < r.left)
    row.scrollTo({ left: row.scrollLeft + c.left - r.left - pad, behavior: 'smooth' });
  else if (c.right > r.right)
    row.scrollTo({ left: row.scrollLeft + c.right - r.right + pad, behavior: 'smooth' });
}

/** The nearest scrolling ancestor (panel, dock or inspector body). */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * A library you browse by scrolling: every category is a section under a small heading with a
 * divider; the chip row stays on top, follows the scroll (the category in view is highlighted) and
 * jumps to a category when tapped. Used by filters, transitions, animations, text styles and
 * stickers — no tab switching to see everything.
 */
export function CategoryBrowser<C extends { id: string; label: string }>({
  label,
  categories,
  initial,
  children,
}: {
  label: string;
  categories: readonly C[];
  /** Category to scroll to first (e.g. the one holding the current choice). */
  initial?: string | null;
  /** Renders one category's tiles. */
  children: (category: C) => ReactNode;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(initial ?? categories[0]?.id ?? '');
  const jumping = useRef(false);

  // Follow the scroll: the active category is the last section whose top passed under the bar.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scroller = scrollerOf(root);
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (jumping.current) return;
      const barBottom = (barRef.current?.getBoundingClientRect().bottom ?? 0) + 8;
      let current = categories[0]?.id ?? '';
      for (const section of root.querySelectorAll<HTMLElement>('[data-category]')) {
        if (section.getBoundingClientRect().top <= barBottom) current = section.dataset.category!;
        else break;
      }
      // At the very bottom, the last section is the one being looked at.
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2)
        current = categories[categories.length - 1]?.id ?? current;
      setActive((a) => (a === current ? a : current));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [categories]);

  // Keep the active chip visible in the chip row.
  useEffect(() => {
    const row = barRef.current?.querySelector<HTMLElement>('.vu-chips-scroll');
    const chip = row?.querySelector<HTMLElement>(`[data-chip="${CSS.escape(active)}"]`);
    if (row && chip) revealChip(row, chip);
  }, [active]);

  // Start at the category of the current choice.
  useEffect(() => {
    if (!initial || initial === categories[0]?.id) return;
    const root = rootRef.current;
    const section = root?.querySelector<HTMLElement>(`[data-category="${CSS.escape(initial)}"]`);
    const scroller = root ? scrollerOf(root) : null;
    if (section && scroller) scrollToSection(scroller, section, barRef.current, false);
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jump = (id: string) => {
    setActive(id);
    jumping.current = true;
    const root = rootRef.current;
    const section = root?.querySelector<HTMLElement>(`[data-category="${CSS.escape(id)}"]`);
    const scroller = root ? scrollerOf(root) : null;
    if (section && scroller) scrollToSection(scroller, section, barRef.current, true);
    // Let the smooth scroll land before following the scroll again.
    setTimeout(() => (jumping.current = false), 600);
  };

  return (
    <div className="vu-browser" ref={rootRef}>
      <div className="vu-browser-bar" ref={barRef}>
        <div className="vu-chips vu-chips-scroll" role="tablist" aria-label={label}>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === active}
              data-chip={c.id}
              className="vu-chip"
              onClick={() => jump(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {categories.map((c) => (
        <section
          key={c.id}
          className="vu-browser-section"
          data-category={c.id}
          aria-label={c.label}
        >
          <h4 className="vu-browser-heading">{c.label}</h4>
          {children(c)}
        </section>
      ))}
    </div>
  );
}

/** Calls `onVisible` once, when the element first scrolls near the view (lazy previews). */
export function useNearView<T extends HTMLElement>(
  onVisible: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const cb = useRef(onVisible);
  useEffect(() => {
    cb.current = onVisible;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          cb.current();
        }
      },
      { rootMargin: '200px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
