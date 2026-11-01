import React from "react";
import { Box } from "lucide-react";
import type { PocketStrip } from "../../../shared/residueContextEvidence";

interface PocketDistanceStripProps {
  strip: PocketStrip;
  onSelectResidue?: (index: number) => void;
  onViewIn3d?: () => void;
}

export function PocketDistanceStrip({
  strip,
  onSelectResidue,
  onViewIn3d,
}: PocketDistanceStripProps) {
  const { max, marks, origin, centre, residues } = strip;

  return (
    <div className="rsx-pocket-strip" data-testid="pocket-distance-strip">
      <div className="rsx-pocket-strip__header">
        <div className="rsx-pocket-strip__origin-label">
          <span>Distance from {origin}, in Å</span>
        </div>
        {onViewIn3d && (
          <button
            type="button"
            className="rsx-link rsx-pocket-strip__view3d"
            onClick={onViewIn3d}
          >
            <Box className="w-3.5 h-3.5" aria-hidden="true" />
            View in 3D
          </button>
        )}
      </div>

      <div className="rsx-pocket-strip__track" role="img" aria-label={`Pocket distance strip up to ${max} Å`}>
        {/* The horizontal rule */}
        <div className="rsx-pocket-strip__bar">
          {/* Origin: 0 Å (the variant residue) */}
          <span
            className="rsx-pocket-strip__origin-marker"
            style={{ left: "0%" }}
            title={`${origin}, 0 Å (distances run from its centroid)`}
          />

          {/* The app's own cut-points (dashed lines), named in the key below. */}
          {marks.map(m => {
            const pos = Math.max(0, Math.min(100, (m / max) * 100));
            return (
              <span
                key={`mark-${m}`}
                className="rsx-pocket-strip__cut-line"
                style={{ left: `${pos}%` }}
                title={`Cut-point: ${m} Å`}
              />
            );
          })}

          {/* Diamond: the point the tab's distance is measured to. */}
          {centre && (
            <span
              className="rsx-pocket-strip__centre-marker"
              style={{ left: `${centre.position}%` }}
              title={`${centre.distance.toFixed(1)} Å from ${origin} to ${centre.reference}`}
            />
          )}

          {/* Pocket residue ticks along the bar */}
          {residues.map(res => (
            <span
              key={`tick-${res.chain ?? ""}-${res.label}-${res.index}`}
              className="rsx-pocket-strip__res-tick"
              style={{ left: `${res.position}%` }}
              title={`${res.label}${res.chain ? ` (${res.chain})` : ""}: ${res.distance.toFixed(1)} Å`}
            />
          ))}
        </div>

        {/* Axis tick labels */}
        <div className="rsx-pocket-strip__axis" aria-hidden="true">
          <span className="rsx-pocket-strip__axis-tick" style={{ left: "0%", transform: "none" }}>
            0 Å
          </span>
          <span className="rsx-pocket-strip__axis-tick" style={{ left: "50%" }}>{max / 2} Å</span>
          <span className="rsx-pocket-strip__axis-tick" style={{ left: "100%", transform: "translateX(-100%)" }}>
            {max} Å
          </span>
        </div>
      </div>

      {/* One key for every mark on the bar. Each shape is drawn in CSS like its mark, so no glyph
          character is read aloud as "black circle". */}
      <div className="rsx-legend rsx-pocket-strip__key" data-testid="pocket-strip-key">
        <span><i className="rsx-key-origin" aria-hidden="true" />{origin}, 0 Å</span>
        {centre && <span><i className="rsx-key-centre" aria-hidden="true" />{centre.distance.toFixed(1)} Å to {centre.reference}</span>}
        <span><i className="rsx-key-tick" aria-hidden="true" />Pocket residues</span>
        <span><i className="rsx-key-cut" aria-hidden="true" />This app&apos;s {marks.join(", ")} Å cut-points</span>
      </div>
      {/* Pocket residues, nearest first. */}
      {residues.length > 0 && (
        <div className="rsx-pocket-strip__residues-wrap">
          <ul className="rsx-residues rsx-pocket-strip__residues-list" data-testid="pocket-residues">
            {residues.map(res => (
              <li key={`${res.chain ?? ""}-${res.label}-${res.index}`}>
                <button
                  type="button"
                  className="rsx-residue rsx-pocket-strip__residue-btn"
                  onClick={() => onSelectResidue?.(res.index)}
                  aria-label={`Select ${res.label}${res.chain ? ` chain ${res.chain}` : ""}, ${res.distance.toFixed(1)} Å away`}
                >
                  <span>
                    {res.label}
                    {res.chain ? <span className="rsx-dim"> {res.chain}</span> : null}
                  </span>
                  <span>{res.distance.toFixed(1)} Å</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
