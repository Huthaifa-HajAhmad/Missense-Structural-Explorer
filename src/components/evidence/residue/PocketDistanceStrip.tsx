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
          <span>Axis: distance from {origin} (centroid, Å)</span>
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
            title={`Origin: ${origin} (0 Å)`}
          />

          {/* App's cut-point marks: 4 Å, 8 Å, 12 Å */}
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

          {/* Cavity centre diamond ◆ */}
          {centre && (
            <span
              className="rsx-pocket-strip__centre-marker"
              style={{ left: `${centre.position}%` }}
              title={`Cavity centre: ${centre.distance.toFixed(1)} Å from ${origin}`}
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
          <span className="rsx-pocket-strip__axis-tick" style={{ left: "0%" }}>
            0 Å
          </span>
          {marks.map(m => {
            const pos = Math.max(0, Math.min(100, (m / max) * 100));
            return (
              <span
                key={`axis-${m}`}
                className="rsx-pocket-strip__axis-tick rsx-pocket-strip__axis-tick--dashed"
                style={{ left: `${pos}%` }}
              >
                {m}
              </span>
            );
          })}
          {centre && (
            <span
              className="rsx-pocket-strip__axis-tick rsx-pocket-strip__axis-tick--centre"
              style={{ left: `${centre.position}%` }}
            >
              ◆ {centre.distance.toFixed(1)} Å ({centre.reference})
            </span>
          )}
          <span className="rsx-pocket-strip__axis-tick" style={{ left: "100%", transform: "translateX(-100%)" }}>
            {max} Å
          </span>
        </div>
      </div>

      {/* Pocket residues interactive pills in staggered lanes */}
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
