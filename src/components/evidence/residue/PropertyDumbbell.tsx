import React from "react";
import type { BiochemicalContrastRow, ScaleTick } from "../../../shared/residueContextEvidence";
import { RESIDUE_SCALE_SOURCES, formatNativeResidueValue } from "../../../shared/residueScales";

interface PropertyDumbbellProps {
  row: BiochemicalContrastRow;
  wildType: string;
  mutant: string;
  contextTicks?: ScaleTick[];
}

export function PropertyDumbbell({
  row,
  wildType,
  mutant,
  contextTicks = [],
}: PropertyDumbbellProps) {
  const source = RESIDUE_SCALE_SOURCES[row.key];
  const unit = source.unit ? ` ${source.unit}` : "";
  const low = formatNativeResidueValue(row.key, source.min);
  const high = formatNativeResidueValue(row.key, source.max);

  const isSameValue = row.direction === "unchanged" || Math.abs(row.mutantPosition - row.wildTypePosition) < 0.5;

  const label =
    `${row.label}: ${wildType} ${row.wildTypeNative ?? row.wildTypeValue}, ${mutant} ${row.mutantNative ?? row.mutantValue}` +
    ` on a scale from ${low} to ${high}${unit}.` +
    (isSameValue ? " Both residues share the same value on this scale." : "");

  return (
    <div className="rsx-property-plot">
      <div className="rsx-track rsx-track--dumbbell" role="img" aria-label={label}>
        <div className="rsx-track__bar">
        {/* The two residue markers are the reading. A filled connecting span made the scale
            look like a second quantitative bar, so position and the Shift column carry the move. */}
        <span
          className="rsx-track__wt"
          data-coincident={isSameValue || undefined}
          style={{ left: `${row.wildTypePosition}%` }}
          title={`${wildType}: ${row.wildTypeNative ?? row.wildTypeValue}${unit}`}
        />
        <span
          className="rsx-track__mut"
          style={{ left: `${row.mutantPosition}%` }}
          title={`${mutant}: ${row.mutantNative ?? row.mutantValue}${unit}`}
        />
        </div>

        <div className="rsx-track__axis" aria-hidden="true">
          <span className="rsx-track__tick" data-edge="start" style={{ left: 0 }}>
            {low} {row.lowAnchor !== low ? row.lowAnchor.toLowerCase() : ""}
          </span>
          {row.midpointLabel && (
            <span className="rsx-track__tick" style={{ left: "50%" }}>
              {row.midpointLabel}
            </span>
          )}
          <span className="rsx-track__tick" data-edge="end" style={{ left: "100%" }}>
            {high}{unit} {row.highAnchor !== high ? row.highAnchor.toLowerCase() : ""}
          </span>
        </div>
      </div>

      {contextTicks.length > 0 && (
        <details className="rsx-context">
          <summary>Reference values for other amino acids</summary>
          <p>
            {contextTicks.map(tick => `${tick.codes.join(", ")}: ${tick.native}${unit}`).join(" · ")}
          </p>
        </details>
      )}
    </div>
  );
}
