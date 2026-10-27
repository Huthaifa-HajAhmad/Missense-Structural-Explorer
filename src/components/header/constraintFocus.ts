/**
 * constraintFocus.ts — the DOM contract between the context strip's constraint chips and the
 * inspector's Gene constraint view.
 *
 * Declared once, as data, so the strip, the inspector, tests and agents address the same elements:
 * a chip is `[data-constraint-chip="<key>"]`, an inspector row is `#constraint-metric-<key>`.
 */
import type { ConstraintMetricKey } from "./constraintMetrics";

export const constraintChipSelector = (key: ConstraintMetricKey) => `[data-constraint-chip="${key}"]`;

export const constraintMetricDomId = (key: ConstraintMetricKey) => `constraint-metric-${key}`;

/**
 * Return focus to a strip chip without opening its card.
 *
 * A chip opens its card on keyboard focus. Coming back from the inspector is a focus move the
 * reader did not ask to be a "look at this reading" gesture, so the chip is told to stay quiet for
 * this one focus event (it fires synchronously inside `focus()`).
 */
export function focusConstraintChip(key: ConstraintMetricKey): void {
  if (typeof document === "undefined") return;
  const chip = document.querySelector<HTMLElement>(constraintChipSelector(key));
  if (!chip) return;
  chip.dataset.quietFocus = "true";
  chip.focus();
  delete chip.dataset.quietFocus;
}
