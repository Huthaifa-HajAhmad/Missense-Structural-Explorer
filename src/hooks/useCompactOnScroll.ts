import { useEffect, useState, type RefObject } from "react";

/** Scroll depth that collapses the header, and the depth it must return under to expand again. */
export const COMPACT_ENTER_PX = 64;
export const COMPACT_EXIT_PX = 8;
/**
 * A scroller must have at least this much travel to collapse the header. Collapsing grows the
 * scroller by the height the header gave up, so a page with barely more than the threshold to
 * scroll would clamp back under the exit line and flip-flop between the two states.
 */
export const COMPACT_MIN_TRAVEL_PX = 240;

/** The next compact state for one scroll reading. Hysteresis keeps it from flickering at the edge. */
export function nextCompactState(
  wasCompact: boolean,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): boolean {
  if (wasCompact) return scrollTop > COMPACT_EXIT_PX;
  return scrollTop > COMPACT_ENTER_PX && scrollHeight - clientHeight > COMPACT_MIN_TRAVEL_PX;
}

/**
 * Whether the sticky variant header should collapse to its one-line form.
 *
 * The header sits outside the views, and each view owns its own scroller, so this listens in the
 * capture phase on a shared ancestor (scroll events do not bubble) and reads only vertical
 * scrollers inside the primary pane — the inspector rail scrolling must not resize the page header,
 * and a table scrolling sideways reports `scrollTop = 0`, which would otherwise expand it.
 *
 * `resetKey` puts the header back to full size whenever the page changes.
 */
export function useCompactOnScroll(rootRef: RefObject<HTMLElement | null>, resetKey: string): boolean {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    setIsCompact(false);
  }, [resetKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.closest(".data-screen-primary")) return;
      if (el.scrollHeight <= el.clientHeight + 1) return;
      setIsCompact(prev => nextCompactState(prev, el.scrollTop, el.scrollHeight, el.clientHeight));
    };
    root.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => root.removeEventListener("scroll", onScroll, { capture: true });
  }, [rootRef]);

  return isCompact;
}
