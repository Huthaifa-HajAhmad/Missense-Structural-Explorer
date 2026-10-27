import React from "react";
import { PanelRightOpen } from "lucide-react";
import { ConstraintMetric, ConstraintReference } from "./ConstraintTrack";
import type { VhMetric } from "./constraintMetrics";

/**
 * One constraint reading, explained in place: the card a strip chip opens on keyboard focus or a
 * click.
 *
 * It holds what the chip cannot — the full track with its cut-points, who set them, and the facts
 * about this reading — and hands off to the inspector for the full view (all three readings and
 * their source). A disclosure, not a dialog: it never takes focus on its own, Escape or a click
 * outside closes it, and it sits in the DOM right after its chip so Tab reaches "Open in inspector"
 * next.
 *
 * `tabIndex={-1}` is what lets the reader press on the card's text. Chromium moves focus on a press
 * to the nearest focusable ancestor, else `<body>`; the chip is a sibling of the card, so without a
 * focusable card the chip would blur to `relatedTarget === null` and the strip would close the card
 * under the pointer. With it, focus lands on the card, inside the same `<li>`, and the card stays.
 * It is not in the Tab order, and a pointer-focused element draws no focus ring.
 */
export function ConstraintCard({
  metric,
  id,
  left,
  onInspect,
}: {
  metric: VhMetric;
  id: string;
  /** Offset from the strip's left edge, clamped by the strip so the card stays on screen. */
  left: number;
  onInspect: () => void;
}) {
  return (
    <div
      id={id}
      className="vcs-card"
      role="region"
      aria-label={`${metric.label} reading`}
      data-testid="constraint-card"
      data-metric={metric.key}
      tabIndex={-1}
      style={{ left }}
    >
      <div className="vcs-card-head">
        <span className="vcs-card-name">{metric.name}</span>
        <span className="vcs-card-release">{metric.release}</span>
      </div>
      <div className="vcs-card-body">
        <div className="vh-rail">
          <ul className="vh-metrics" role="list" aria-label={`${metric.label} reference track`}>
            <ConstraintMetric metric={metric} tooltip={false} />
          </ul>
        </div>
        <ConstraintReference metric={metric} />
      </div>
      <div className="vcs-card-foot">
        <span>Gene-level context. It does not classify the variant.</span>
        <button type="button" className="vcs-card-inspect" onClick={onInspect}>
          <PanelRightOpen size={13} aria-hidden="true" />
          Open in inspector
        </button>
      </div>
    </div>
  );
}
