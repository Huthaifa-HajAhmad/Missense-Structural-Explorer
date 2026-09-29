import React from "react";

/** Half-width of the drawn axis, kcal/mol. A value beyond it is pinned at the edge as a hollow marker. */
const SPAN = 4;

/**
 * BindingRuler — ΔΔG_bind on a signed axis centred on 0, in DDMut-PPI's convention: left of zero is
 * weaker binding, right is stronger. No bands and no cut-points: DDMut-PPI's authors publish none,
 * so the only mark is zero itself.
 */
export function BindingRuler({ value }: { value: number }) {
  const off = Math.abs(value) > SPAN;
  const clamped = Math.max(-SPAN, Math.min(SPAN, value));
  const left = ((clamped + SPAN) / (2 * SPAN)) * 100;
  const signed = `${value > 0 ? "+" : value < 0 ? "minus " : ""}${Math.abs(value).toFixed(2)}`;
  return (
    <div
      className="itx-ruler"
      role="img"
      aria-label={`ΔΔG_bind ${signed} kcal/mol on a minus ${SPAN} to plus ${SPAN} axis; negative is weaker binding${off ? "; beyond the drawn axis" : ""}`}
    >
      <div className="itx-ruler__track">
        <span className="itx-ruler__zero" style={{ left: "50%" }} />
        <span className="itx-ruler__marker" data-off={off || undefined} style={{ left: `${left}%` }} />
      </div>
      <div className="itx-ruler__axis" aria-hidden="true">
        <span data-edge="start" style={{ left: "0%" }}>−{SPAN} weaker binding</span>
        <span style={{ left: "50%" }}>0</span>
        <span data-edge="end" style={{ left: "100%" }}>stronger binding +{SPAN}</span>
      </div>
    </div>
  );
}
