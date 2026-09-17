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

const INSPECTOR_SECTION_IDS: readonly string[] = Object.values(INSPECTOR_SECTIONS);

/**
 * Runtime check that a value is a declared section id.
 *
 * The type alone is not enough, because the id arrives through a DOM event and
 * can be anything at runtime. Validating here means a stale or misspelled id is
 * dropped at the boundary instead of being retried for six frames and then
 * silently doing nothing.
 */
export function isInspectorSectionId(value: unknown): value is InspectorSectionId {
  return typeof value === "string" && INSPECTOR_SECTION_IDS.includes(value);
}

/**
 * Ask the inspector to reveal a section. Safe to call when none is listening.
 *
 * The parameter is deliberately the narrowed union, not `| string`: widening it
 * would let `requestInspectorFocus("inspector-residue-shift-narrativ")` compile
 * and then fail silently at runtime, which is the exact failure the section-id
 * registry exists to prevent. Tests that need to exercise an unknown id should
 * dispatch the event directly.
 */
export function requestInspectorFocus(sectionId: InspectorSectionId): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INSPECTOR_FOCUS_EVENT, { detail: { sectionId } }));
}

/**
 * Subscribe to focus requests.
 *
 * `onFocus` runs after the inspector has been given a chance to mount the section
 * when it was collapsed, and only for a declared section id. Returning early on a
 * missing element keeps a stale id from throwing.
 */
export function useInspectorFocus(onFocus: (sectionId: InspectorSectionId) => void): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handler = (event: Event) => {
      const sectionId = (event as CustomEvent<{ sectionId?: unknown }>).detail?.sectionId;
      if (!isInspectorSectionId(sectionId)) return;
      onFocus(sectionId);
    };

    window.addEventListener(INSPECTOR_FOCUS_EVENT, handler);
    return () => window.removeEventListener(INSPECTOR_FOCUS_EVENT, handler);
  }, [onFocus]);
}

/** Honour a user's motion preference rather than always animating the scroll. */
function preferredScrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "smooth";
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  } catch {
    return "smooth";
  }
}

/**
 * Scroll a section into view and move keyboard focus to it.
 *
 * Focus, not just scroll: a keyboard user who activated a "show me this" control
 * must land on the revealed content, otherwise the next Tab continues from the
 * main column and the section is reachable only by tabbing through everything
 * between. The target is given `tabIndex={-1}` by its owner so it is focusable
 * without joining the tab order, and a `focus-visible` ring so the move is
 * visible rather than only announced.
 */
export function revealInspectorSection(sectionId: string, container?: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;

  const target = document.getElementById(sectionId);
  if (!target) return false;

  // Guarded: `scrollIntoView` is not implemented in every DOM environment
  // (jsdom, for one), and this function is documented as safe to call. An
  // unguarded call threw before the focus move ran, so the section was never
  // focused at all.
  if (typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  }

  // Only take focus when the section belongs to the inspector body. A stray
  // duplicate id elsewhere in the document must not pull focus out of the main
  // column, but it should still be scrolled to.
  const isInsideInspector = Boolean(container && container.contains(target));
  if (isInsideInspector && typeof target.focus === "function") {
    target.focus({ preventScroll: true });
  }

  return true;
}
