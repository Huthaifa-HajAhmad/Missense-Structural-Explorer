import React from "react";
import { ExternalLink } from "lucide-react";
import { vhPos, vhMarkerPct, CUT_POINT_ORIGIN_LABELS, type VhMetric } from "./constraintMetrics";

/**
 * One metric as a list row: label, value, reference track, threshold legend, verdict.
 * The reference ranges are drawn on the track as bands and tick marks; the numbers
 * beside it name those ticks in left-to-right order.
 */
export function ConstraintMetric({
  metric,
  id,
  focused = false,
  tooltip = true,
}: {
  metric: VhMetric;
  /** DOM id, so the inspector can move focus to the reading the reader asked for. */
  id?: string;
  /** The reading the reader opened; the row is tinted and takes programmatic focus. */
  focused?: boolean;
  /** The native tooltip; off inside the card, which already shows everything it says. */
  tooltip?: boolean;
}) {
  const { bands, ticks, marker, tone } = metric;
  const markerLeft = marker === null ? null : vhMarkerPct(marker, metric);
  // DOM order follows the drawn order, left to right, whichever way the axis runs.
  const drawnBands = bands
    .map((band) => {
      const a = vhPos(band.from, metric);
      const b = vhPos(band.to, metric);
      return { band, left: Math.min(a, b), width: Math.abs(b - a) };
    })
    .sort((x, y) => x.left - y.left);

  return (
    <li
      id={id}
      className="vh-metric"
      title={tooltip ? metric.tooltip : undefined}
      data-metric={metric.key}
      data-focused={focused || undefined}
      tabIndex={id ? -1 : undefined}
    >
      <span className="vh-metric-label">{metric.label}</span>
      <span className="vh-metric-value" data-tone={tone}>
        {metric.value}
      </span>

      <span className="vh-scale" data-empty={marker === null ? "true" : undefined} aria-hidden="true">
        <span className="vh-scale-bar">
          {drawnBands.map(({ band, left, width }) => (
            <span
              key={`${band.from}-${band.to}`}
              className="vh-band"
              data-tone={band.tone}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          ))}
        </span>
        {ticks.map((tick) => (
          <span key={tick.at} className="vh-tick" data-kind={tick.kind} style={{ left: `${vhPos(tick.at, metric)}%` }} />
        ))}
        {markerLeft !== null && <span className="vh-marker" data-tone={tone} style={{ left: `${markerLeft}%` }} />}
        {ticks.map((tick) => (
          <span key={`label-${tick.at}`} className="vh-axis-label" style={{ left: `${vhPos(tick.at, metric)}%` }}>
            {tick.label}
          </span>
        ))}
      </span>

      <span className="vh-verdict" data-tone={tone}>
        {metric.verdict}
      </span>

      <span className="vh-sr-only">{metric.detail}</span>
    </li>
  );
}

/**
 * The strip's micro-track: the same axis, direction and bands as the full row, at chip size, with
 * the marker only — no ticks or numerals, which cannot be read at 44px. The full row lives in the
 * reading card (keyboard focus or a click) and the inspector.
 */
export function MiniTrack({ metric }: { metric: VhMetric }) {
  const left = metric.marker === null ? null : vhMarkerPct(metric.marker, metric);
  const bands = metric.bands
    .map((band) => {
      const a = vhPos(band.from, metric);
      const b = vhPos(band.to, metric);
      return { band, left: Math.min(a, b), width: Math.abs(b - a) };
    })
    .sort((x, y) => x.left - y.left);
  return (
    <span className="vcs-mini" data-empty={left === null ? "true" : undefined} aria-hidden="true">
      {bands.map(({ band, left: l, width }) => (
        <span key={`${band.from}-${band.to}`} className="vcs-mini-band" data-tone={band.tone} style={{ left: `${l}%`, width: `${width}%` }} />
      ))}
      {left !== null && <span className="vcs-mini-dot" data-tone={metric.tone} style={{ left: `${left}%` }} />}
    </span>
  );
}

/**
 * Where a track's cut-points come from, and the facts about this reading that the row cannot carry:
 * PP2 proxy status, the RMC block and its p-value, why a call is absent. Shared by the strip's card
 * and the inspector so the two cannot word the same reading differently.
 */
export function ConstraintReference({ metric }: { metric: VhMetric }) {
  const { cutPoints, facts } = metric;
  if (!cutPoints && facts.length === 0) return null;
  return (
    <div className="cx-ref" data-metric={metric.key}>
      {cutPoints && (
        <p className="cx-cuts">
          <span className="cx-origin" data-origin={cutPoints.origin}>
            {CUT_POINT_ORIGIN_LABELS[cutPoints.origin]}
          </span>
          <span className="cx-cuts-values">{cutPoints.label}</span>
          <span className="cx-cuts-text">
            {cutPoints.text}
            {cutPoints.href && (
              <>
                {" "}
                <a href={cutPoints.href} target="_blank" rel="noopener noreferrer" className="cx-link">
                  gnomAD guidance
                  <ExternalLink size={11} aria-hidden="true" />
                  <span className="vh-sr-only"> (opens in a new tab)</span>
                </a>
              </>
            )}
          </span>
        </p>
      )}
      {facts.length > 0 && (
        <ul className="cx-facts" role="list" aria-label={`${metric.label}: this reading`}>
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
