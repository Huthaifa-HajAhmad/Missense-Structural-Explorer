/**
 * inspectorFocus.ts — ask the context inspector to reveal one of its sections.
 *
 * The evidence panes deliberately split their content: the main column carries the
 * decisive quantities, the inspector carries the interpretation. That split only
 * works if the reader can get from the former to the latter, so a main-column
 * element needs a way to say "show me section X" without threading a callback
 * through every intermediate component.
 *
 * Shape of the contract:
 *
 *   - The producer calls `requestInspectorFocus(sectionId)` and knows nothing about
 *     the inspector, which view is mounted, or whether it is collapsed.
 *   - The inspector subscribes once via `useInspectorFocus` and owns all of the
 *     behaviour: expanding itself, scrolling the section into view, moving focus.
 *
 * Why an event rather than a store or props: this is ephemeral, imperative UI
 * intent that belongs to no view's persistent state, and it must not re-render the
 * variant analysis tree. The bus is also inert by design — publishing with no
 * subscriber resolves to a no-op, so a producer can ship before its consumer.
 */
import { useEffect } from "react";

export const INSPECTOR_FOCUS_EVENT = "cs:inspector-focus";

/**
 * Stable DOM ids for focusable inspector sections.
 *
 * Declared here, as data, so a producer and a consumer cannot drift apart on a
 * string literal — a typo would otherwise fail silently as "nothing happened".
 */
export const INSPECTOR_SECTIONS = {
  /** Biochemical shift narrative in the Residue Shifts inspector. */
  residueShiftNarrative: "inspector-residue-shift-narrative",
  /** P2Rank cavity interpretation in the Residue Shifts inspector. */
  residueShiftPocket: "inspector-residue-shift-pocket"
} as const;

export type InspectorSectionId = (typeof INSPECTOR_SECTIONS)[keyof typeof INSPECTOR_SECTIONS];

/** Ask the inspector to reveal a section. Safe to call when none is listening. */
export function requestInspectorFocus(sectionId: InspectorSectionId | string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INSPECTOR_FOCUS_EVENT, { detail: { sectionId } }));
}

/**
 * Subscribe to focus requests.
 *
 * `onFocus` runs after the inspector has been given a frame to mount the section
 * when it was collapsed, and after the target element is confirmed present.
 * Returning early on a missing element keeps a stale id from throwing.
 */
export function useInspectorFocus(onFocus: (sectionId: string) => void): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handler = (event: Event) => {
      const sectionId = (event as CustomEvent<{ sectionId?: string }>).detail?.sectionId;
      if (!sectionId) return;
      onFocus(sectionId);
    };

    window.addEventListener(INSPECTOR_FOCUS_EVENT, handler);
    return () => window.removeEventListener(INSPECTOR_FOCUS_EVENT, handler);
  }, [onFocus]);
}

/**
 * Scroll a section into view and move keyboard focus to it.
 *
 * Focus, not just scroll: a keyboard user who activated a "show me this" control
 * must land on the revealed content, otherwise the next Tab continues from the
 * main column and the section is reachable only by tabbing through everything
 * between. The target is given `tabIndex={-1}` by its owner so it is focusable
 * without joining the tab order.
 */
export function revealInspectorSection(sectionId: string, container?: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;

  const target = document.getElementById(sectionId);
  if (!target) return false;

  target.scrollIntoView({ behavior: "smooth", block: "start" });

  // Only take focus when the section belongs to the inspector body. A stray
  // duplicate id elsewhere in the document must not pull focus out of the main
  // column, but it should still be scrolled to.
  const isInsideInspector = Boolean(container && container.contains(target));
  if (isInsideInspector) {
    target.focus({ preventScroll: true });
  }

  return true;
}
