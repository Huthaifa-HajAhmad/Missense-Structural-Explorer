import React from "react";
import type { BiochemicalContrastRow, ScaleTick } from "../../../shared/residueContextEvidence";
import { RESIDUE_SCALE_SOURCES, formatNativeResidueValue } from "../../../shared/residueScales";

interface PropertyDumbbellProps {
  row: BiochemicalContrastRow;
  wildType: string;
  mutant: string;
}

interface PropertyScaleReferenceItem {
  key: BiochemicalContrastRow["key"];
  label: string;
  ticks: ScaleTick[];
}

export function PropertyDumbbell({
  row,
  wildType,
  mutant,
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
    // A <span> (phrasing content) rather than a <div>: this track is rendered inside a <button> in the
    // residue-property comparison, and a block element there is invalid nesting. `display: block` in
    // residue.css restores the layout the div had.
    <span className="rsx-track rsx-track--dumbbell" role="img" aria-label={label}>
      <span className="rsx-track__bar">
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

export function PropertyScaleReference({ items }: { items: PropertyScaleReferenceItem[] }) {
  return (
    <details className="rsx-context rsx-context--card">
      <summary>Reference values for other amino acids</summary>
      <dl className="rsx-context__list">
        {items.map(item => {
          const unit = RESIDUE_SCALE_SOURCES[item.key].unit;
          return (
            <div className="rsx-context__row" key={item.key}>
              <dt>{item.label}</dt>
              <dd>{item.ticks.map(tick => `${tick.codes.join(", ")}: ${tick.native}${unit ? ` ${unit}` : ""}`).join(" · ")}</dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}
