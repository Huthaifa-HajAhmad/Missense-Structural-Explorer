import React from "react";
import { THRESHOLDS } from "../../../shared/thresholds";
import { DDMUT_PPI_RMSE, IPTM_BAND_LABEL, type IptmBand } from "../../../shared/interfacesEvidence";

/**
 * IptmRuler — interface confidence on its 0–1 axis. The three regions are AlphaFold-Multimer's
 * published reading guide (THRESHOLDS.complexConfidence), in neutral ink that deepens with
 * confidence; the edges are dashed because they are the authors' guide, not a calibration.
 */
export function IptmRuler({ value, band }: { value: number; band: IptmBand | null }) {
  const C = THRESHOLDS.complexConfidence;
  const clamp = (v: number) => Math.max(0, Math.min(100, v * 100));
  const regions: Array<{ key: IptmBand; from: number; to: number }> = [
    { key: "low", from: 0, to: C.iptmLow },
    { key: "grey", from: C.iptmLow, to: C.iptmConfident },
    { key: "confident", from: C.iptmConfident, to: 1 },
  ];
  return (
    <div
      className="ifc-ruler"
      role="img"
      aria-label={`ipTM ${value.toFixed(2)} on a 0 to 1 axis${band ? `, ${IPTM_BAND_LABEL[band].toLowerCase()} by AlphaFold-Multimer guidance` : ""}`}
    >
      <div className="ifc-ruler__track">
        <span className="ifc-ruler__bands">
          {regions.map(r => (
            <span
              key={r.key}
              className="ifc-ruler__band"
              data-band={r.key}
              data-active={band === r.key || undefined}
              style={{ left: `${clamp(r.from)}%`, width: `${clamp(r.to) - clamp(r.from)}%` }}
            />
          ))}
        </span>
        <span className="ifc-ruler__tick" style={{ left: `${clamp(C.iptmLow)}%` }} />
        <span className="ifc-ruler__tick" style={{ left: `${clamp(C.iptmConfident)}%` }} />
        <span className="ifc-ruler__marker" style={{ left: `${clamp(value)}%` }} />
      </div>
      <div className="ifc-ruler__axis" aria-hidden="true">
        <span data-edge="start" style={{ left: "0%" }}>0</span>
        <span style={{ left: `${clamp(C.iptmLow)}%` }}>{C.iptmLow}</span>
        <span style={{ left: `${clamp(C.iptmConfident)}%` }}>{C.iptmConfident}</span>
        <span data-edge="end" style={{ left: "100%" }}>1</span>
      </div>
    </div>
  );
}

/** Half-width of the drawn ΔΔG axis, kcal/mol. A value beyond it is pinned at the edge as a hollow marker. */
const SPAN = 4;

/**
 * BindingRuler — ΔΔG_bind on a signed axis centred on 0, DDMut-PPI's convention: left is weaker
 * binding. No cut-points (the authors publish none); the shaded band is ± the method's RMSE
 * (1.33 kcal/mol), so a value inside it visibly sits within the error.
 */
export function BindingRuler({ value }: { value: number }) {
  const off = Math.abs(value) > SPAN;
  const clamped = Math.max(-SPAN, Math.min(SPAN, value));
  const at = (v: number) => ((v + SPAN) / (2 * SPAN)) * 100;
  const signed = `${value > 0 ? "+" : value < 0 ? "minus " : ""}${Math.abs(value).toFixed(2)}`;
  return (
    <div
      className="ifc-ruler"
      role="img"
      aria-label={`ΔΔG_bind ${signed} kcal/mol on a minus ${SPAN} to plus ${SPAN} axis; negative is weaker binding; ${Math.abs(value) < DDMUT_PPI_RMSE ? "inside" : "outside"} the method's error of ${DDMUT_PPI_RMSE}${off ? "; beyond the drawn axis" : ""}`}
    >
      <div className="ifc-ruler__track">
        <span className="ifc-ruler__error" style={{ left: `${at(-DDMUT_PPI_RMSE)}%`, width: `${at(DDMUT_PPI_RMSE) - at(-DDMUT_PPI_RMSE)}%` }} />
        <span className="ifc-ruler__zero" style={{ left: "50%" }} />
        <span className="ifc-ruler__marker" data-tone="variant" data-off={off || undefined} style={{ left: `${at(clamped)}%` }} />
      </div>
      <div className="ifc-ruler__axis" aria-hidden="true">
        <span data-edge="start" style={{ left: "0%" }}>−{SPAN} weaker binding</span>
        <span style={{ left: "50%" }}>0</span>
        <span data-edge="end" style={{ left: "100%" }}>stronger binding +{SPAN}</span>
      </div>
    </div>
  );
}
