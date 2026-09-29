import React from "react";
import { THRESHOLDS } from "../../../shared/thresholds";
import { IPTM_BAND_LABEL, type IptmBand } from "../../../shared/multimerEvidence";

/**
 * IptmRuler — interface confidence on its 0–1 axis.
 *
 * The three regions are AlphaFold-Multimer's published guidance (THRESHOLDS.complexConfidence),
 * shaded in neutral ink that deepens with confidence, and the two edges are dashed because they are
 * the authors' reading guide, not a calibration. Red/green is reserved for ACMG bands: a confident
 * interface says nothing about pathogenicity.
 */
export function IptmRuler({ value, band, size = "row" }: { value: number; band: IptmBand | null; size?: "row" | "hero" }) {
  const C = THRESHOLDS.complexConfidence;
  const clamp = (v: number) => Math.max(0, Math.min(100, v * 100));
  const regions: Array<{ key: IptmBand; from: number; to: number }> = [
    { key: "low", from: 0, to: C.iptmLow },
    { key: "grey", from: C.iptmLow, to: C.iptmConfident },
    { key: "confident", from: C.iptmConfident, to: 1 },
  ];
  return (
    <div
      className="mlt-ruler"
      data-size={size}
      role="img"
      aria-label={`ipTM ${value.toFixed(2)} on a 0 to 1 axis${band ? `, ${IPTM_BAND_LABEL[band].toLowerCase()} by AlphaFold-Multimer guidance` : ""}`}
    >
      <div className="mlt-ruler__track">
        <span className="mlt-ruler__bands">
          {regions.map(r => (
            <span
              key={r.key}
              className="mlt-ruler__band"
              data-band={r.key}
              data-active={band === r.key || undefined}
              style={{ left: `${clamp(r.from)}%`, width: `${clamp(r.to) - clamp(r.from)}%` }}
            />
          ))}
        </span>
        <span className="mlt-ruler__tick" style={{ left: `${clamp(C.iptmLow)}%` }} />
        <span className="mlt-ruler__tick" style={{ left: `${clamp(C.iptmConfident)}%` }} />
        <span className="mlt-ruler__marker" style={{ left: `${clamp(value)}%` }} />
      </div>
      <div className="mlt-ruler__axis" aria-hidden="true">
        <span data-edge="start" style={{ left: "0%" }}>0</span>
        <span style={{ left: `${clamp(C.iptmLow)}%` }}>{C.iptmLow}</span>
        <span style={{ left: `${clamp(C.iptmConfident)}%` }}>{C.iptmConfident}</span>
        <span data-edge="end" style={{ left: "100%" }}>1</span>
      </div>
    </div>
  );
}
