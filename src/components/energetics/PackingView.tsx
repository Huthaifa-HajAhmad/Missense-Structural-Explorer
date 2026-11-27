import { useMemo } from "react";
import { buildPackingEvidence, type PackingEvidenceInput } from "../../shared/packingEvidence";
import { PackingFigures } from "./PackingFigures";
import { PackingTable } from "./PackingTable";

/**
 * Packing & geometry — the Energetics tab's view of what FoldX's mutant model changed physically:
 * energy components of ΔΔG, side-chain movement, clashes, contacts and surface area. It sits beside
 * the stability estimate because it comes from the same FoldX run, and like it, it is not an ACMG input.
 */
export function PackingView({ position, unit = "kcal/mol", ...input }: PackingEvidenceInput & { position: number | null }) {
  const { foldingEnergetics, structuralDiff, metrics, isFolding, foldingStatus, foldingError, site } = input;
  const packing = useMemo(
    () => buildPackingEvidence({ foldingEnergetics, structuralDiff, metrics, isFolding, foldingStatus, foldingError, site, unit }),
    [foldingEnergetics, structuralDiff, metrics, isFolding, foldingStatus, foldingError, site, unit]
  );
  return (
    <div className="pkg-view" data-testid="energetics-packing">
      <PackingFigures packing={packing} position={position} />
      <PackingTable packing={packing} />
    </div>
  );
}
