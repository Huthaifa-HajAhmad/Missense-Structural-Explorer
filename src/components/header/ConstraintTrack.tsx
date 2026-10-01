import React from "react";
import { vhPos, vhMarkerPct, type VhMetric } from "./constraintMetrics";

/**
 * One metric as a list row: label, value, reference track, threshold legend, verdict.
 * The reference ranges are drawn on the track as bands and tick marks; the numbers
 * beside it name those ticks in left-to-right order.
 */
export function ConstraintMetric({ metric }: { metric: VhMetric }) {
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
    <li className="vh-metric" title={metric.tooltip}>
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
          <span key={tick.at} className="vh-tick" style={{ left: `${vhPos(tick.at, metric)}%` }} />
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
 * Details panel one click away.
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
