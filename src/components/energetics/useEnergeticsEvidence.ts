import { useMemo } from "react";
import type { AnalysisResult, EnergeticsData } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import type { EnergyUnit } from "../../shared/engineStatus";
import { buildEnergeticsEvidence, type EnergeticsEvidence, type EnergeticsInputs } from "../../shared/energeticsEvidence";

/**
 * What the stability engines have reported for the current variant so far. The Energetics column and
 * its inspector rail take the same fields, so the two panes are built from the same run. The fields
 * come from `EnergeticsInputs`; the four that this hook fills in itself are left out. Spelled as a
 * `Pick`, not an `Omit`: every `EnergeticsInputs` field is optional, so an `Omit` would let a new
 * input become a silently-never-supplied prop of both panes.
 */
export type EnergeticsRun = Pick<
  EnergeticsInputs,
  "foldingDdG" | "foldingStatus" | "foldingError" | "dynamut2Status" | "ddmutStatus" | "thermompnnStatus" | "thermompnnError" | "isFolding"
> & {
  foldingEnergetics?: EnergeticsData | null;
  disruptionPredictor?: { plddt?: number | null } | null;
};

/** The parts of the analysis the evidence needs: the accession and the residue's pLDDT. */
export type EnergeticsContext = Pick<AnalysisResult, "metadata" | "disruptionPredictor">;

/**
 * The one evidence object both panes read, and the energy unit the user chose. `hidePending` renames
 * the rows of engines that are still running; it does not change which engines count as running.
 */
export function useEnergeticsEvidence(
  run: EnergeticsRun,
  context: EnergeticsContext | null | undefined,
  hidePending = false
): { evidence: EnergeticsEvidence; unit: EnergyUnit } {
  const { settings } = useSettings();
  const unit: EnergyUnit = settings.energyUnit === "kJ/mol" ? "kJ/mol" : "kcal/mol";
  const plddt = run.disruptionPredictor?.plddt ?? context?.disruptionPredictor?.plddt ?? null;
  const uniprotId = context?.metadata?.uniprotId ?? null;
  const { foldingDdG, foldingStatus, foldingEnergetics, foldingError, dynamut2Status, ddmutStatus, thermompnnStatus, thermompnnError, isFolding } = run;
  const evidence = useMemo(
    () =>
      buildEnergeticsEvidence({
        foldingDdG,
        foldingStatus,
        foldingEnergetics,
        dynamut2Status,
        ddmutStatus,
        thermompnnStatus,
        thermompnnError,
        foldingError,
        isFolding,
        plddt,
        hidePending,
        uniprotId,
      }),
    [foldingDdG, foldingStatus, foldingEnergetics, dynamut2Status, ddmutStatus, thermompnnStatus, thermompnnError, foldingError, isFolding, plddt, hidePending, uniprotId]
  );
  return { evidence, unit };
}
