import React from "react";
import { DDG_AXIS, markText, signedDdg, type EnergeticsReading } from "../../shared/energeticsEvidence";
import type { EnergyUnit } from "../../shared/engineStatus";

/**
 * DdgRuler — one engine's canonical ΔΔG on a shared kcal/mol axis.
 *
 * Every tick is dashed because every ΔΔG mark in this app is local: no engine publishes a clinical
 * cut-point. The faint zone right of the engine's own destabilizing mark shows where that engine's
 * "Destabilizing" begins; it is not a calibrated band and is never graded by strength. A value
 * outside the window sits on the edge as a hollow mark; an excluded value is a dashed ring.
 *
 * The axis is the same for all six rows so the engines can be compared by eye, which the old table
 * (a centred number and a chip) never allowed.
 */

function pct(value: number) {
  const span = DDG_AXIS.max - DDG_AXIS.min;
  return Math.max(0, Math.min(100, ((value - DDG_AXIS.min) / span) * 100));
}

export function DdgRuler({ reading, unit = "kcal/mol" }: { reading: EnergeticsReading; unit?: EnergyUnit }) {
  const v = reading.ddg;
  const offScale = v !== null && (v < DDG_AXIS.min || v > DDG_AXIS.max);
  const describe = [
    `${reading.name} ${signedDdg(v, unit)} on a ${markText(DDG_AXIS.min, unit)} to ${markText(DDG_AXIS.max, unit)} ${unit} axis`,
    `local destabilizing mark ${markText(reading.strongMark, unit)}`,
    reading.callLabel ? reading.callLabel.toLowerCase() : null,
    offScale ? "beyond the drawn window" : null,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <div className="nrg-ruler" role="img" aria-label={describe}>
      <div className="nrg-ruler__track">
        <span
          className="nrg-ruler__zone"
          style={{ left: `${pct(reading.strongMark)}%`, right: 0 }}
          aria-hidden="true"
        />
        <span className="nrg-ruler__zero" style={{ left: `${pct(0)}%` }} aria-hidden="true" />
        {reading.marks.map(m => (
          <span
            key={`${m.side}-${m.value}`}
            className="nrg-ruler__tick"
            data-side={m.side}
            data-weak={m.value !== reading.strongMark && m.side === "destabilizing" ? true : undefined}
            style={{ left: `${pct(m.value)}%` }}
            title={`${markText(m.value, unit)} ${m.side === "stabilizing" ? "stabilizing" : m.value === reading.strongMark ? "destabilizing" : "moderately destabilizing"} (local)`}
          />
        ))}
        {v !== null && (
          <span
            className="nrg-ruler__marker"
            data-off-scale={offScale || undefined}
            data-excluded={!reading.counted || undefined}
            style={{ left: `${pct(v)}%` }}
          />
        )}
      </div>
      <div className="nrg-ruler__axis" aria-hidden="true">
        <span style={{ left: 0 }}>{markText(DDG_AXIS.min, unit)}</span>
        <span style={{ left: `${pct(0)}%`, transform: "translateX(-50%)" }}>0</span>
        <span style={{ right: 0 }}>{markText(DDG_AXIS.max, unit)}</span>
      </div>
    </div>
  );
}

export default DdgRuler;
