import React from "react";
import type { BiochemicalContrastRow } from "../../../shared/residueContextEvidence";
import { RESIDUE_SCALE_SOURCES, formatNativeResidueValue } from "../../../shared/residueScales";

interface PropertyDumbbellProps {
  row: BiochemicalContrastRow;
  wildType: string;
  mutant: string;
}

/** Gaps on the 0–100 scale, in points. */
const COINCIDENT_BELOW = 0.5;
/** The arrow head needs room between the two markers; a closer pair shows the markers alone. */
const MIN_ARROW_SPAN = 8;

export function PropertyDumbbell({
  row,
  wildType,
  mutant,
}: PropertyDumbbellProps) {
  const source = RESIDUE_SCALE_SOURCES[row.key];
  const unit = source.unit ? ` ${source.unit}` : "";
  const low = formatNativeResidueValue(row.key, source.min);
  const high = formatNativeResidueValue(row.key, source.max);

  const span = Math.abs(row.mutantPosition - row.wildTypePosition);
  // Markers closer than this sit on top of each other, so the ring draws the pair as one.
  const isSameValue = row.direction === "unchanged" || span < COINCIDENT_BELOW;

  const label =
    `${row.label}: ${wildType} ${row.wildTypeNative ?? row.wildTypeValue}, ${mutant} ${row.mutantNative ?? row.mutantValue}` +
    ` on a scale from ${low} to ${high}${unit}.` +
    (row.direction === "unchanged" ? " Both residues share the same value on this scale." : "");

  return (
    // A <span> (phrasing content) rather than a <div>: this track is rendered inside a <button> in the
    // residue-property comparison, and a block element there is invalid nesting. `display: block` in
    // residue.css restores the layout the div had.
    <span className="rsx-track rsx-track--dumbbell" role="img" aria-label={label}>
      <span className="rsx-track__bar">
        {span >= MIN_ARROW_SPAN && <span className="rsx-track__direction" aria-hidden="true"
          data-direction={row.mutantPosition > row.wildTypePosition ? "right" : "left"}
          style={{ left: `${Math.min(row.wildTypePosition, row.mutantPosition)}%`, width: `${span}%` }} />}
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
      </span>

      <span className="rsx-track__axis" aria-hidden="true">
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
      </span>
    </span>
  );
}
