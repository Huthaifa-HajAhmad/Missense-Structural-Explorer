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
    <div className="rsx-track rsx-track--dumbbell" role="img" aria-label={label}>
      <div className="rsx-track__bar">
        {/* Alphabet background context ticks */}
        {contextTicks.map((tick, i) => (
          <span
            key={`tick-${tick.position}-${i}`}
            className="rsx-track__context-tick"
            style={{ left: `${tick.position}%` }}
            title={`${tick.codes.join(", ")}: ${tick.native}${unit}`}
          />
        ))}

        {/* Delta span */}
        {!isSameValue && (
          <span
            className="rsx-track__span"
            style={{ left: `${row.spanStart}%`, width: `${row.spanWidth}%` }}
          />
        )}

        {/* Markers */}
        {isSameValue ? (
          /* Combined concentric/split glyph for identical values (Fix F2) */
          <span
            className="rsx-track__same"
            style={{ left: `${row.wildTypePosition}%` }}
            title={`${wildType} and ${mutant} identical at ${row.wildTypeNative ?? row.wildTypeValue}${unit}`}
          >
            <span className="rsx-track__same-core" />
          </span>
        ) : (
          <>
            <span
              className="rsx-track__wt"
              style={{ left: `${row.wildTypePosition}%` }}
              title={`${wildType}: ${row.wildTypeNative ?? row.wildTypeValue}${unit}`}
            />
            <span
              className="rsx-track__mut"
              style={{ left: `${row.mutantPosition}%` }}
              title={`${mutant}: ${row.mutantNative ?? row.mutantValue}${unit}`}
            />
          </>
        )}
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
  );
}
