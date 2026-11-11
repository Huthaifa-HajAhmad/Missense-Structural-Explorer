import React from "react";

/**
 * A score split at its decimal point, so a column mixing 0.231, 26.3, -4.00 and 7 lines up on the
 * point rather than on the last digit (right-aligning alone left the points staggered). The split
 * halves are hidden from assistive technology and the whole number is read once from the sr-only copy.
 */
export function DecimalScore({ text }: { text: string }) {
  const dot = text.indexOf(".");
  const int = dot < 0 ? text : text.slice(0, dot);
  const frac = dot < 0 ? "" : text.slice(dot);
  return (
    <span className="prd-dec">
      <span className="sr-only">{text}</span>
      <span className="prd-dec__int" aria-hidden="true">{int}</span>
      <span className="prd-dec__frac" aria-hidden="true">{frac}</span>
    </span>
  );
}

/** True for a reading that is a number (it may lead with a sign), as opposed to a state such as "No result". */
export const isNumericText = (text: string) => /^[−+-]?\d/.test(text);
