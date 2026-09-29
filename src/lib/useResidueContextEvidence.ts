import { useMemo } from "react";
import type { AnalysisResult, PocketResult } from "../types";
import { AMINO_ACID_NAMES_MAP } from "../useVariantAnalysis";
import { resolveResidueShiftModel, type ResidueShiftModel } from "./residueShiftModel";
import { useResidueScalesLoading } from "./residueScalesLoading";
import { derivePocketNarrative } from "../shared/residueShiftEvidence";
import { buildResidueContextEvidence, type ResidueContextEvidence } from "../shared/residueContextEvidence";

/**
 * The Residue Shifts tab and its inspector rail call this one hook, so both build the model from
 * the same inputs. They used to differ (the tab passed the variant's chain to the pocket model and
 * the inspector did not), which is how two panes can describe one pocket differently.
 */
export function useResidueContextEvidence(params: {
  result: AnalysisResult | null | undefined;
  computedPocket?: PocketResult | null;
  isPocketLoading?: boolean;
  pocketError?: string | null;
  isBiophysicalLoading?: boolean;
}): { model: ResidueContextEvidence; shift: ResidueShiftModel } {
  const { result, computedPocket, isPocketLoading, pocketError, isBiophysicalLoading } = params;
  const metadata = result?.metadata as (NonNullable<AnalysisResult["metadata"]> & { chain?: string }) | undefined;
  const position = metadata?.residueIndex ?? null;
  const chain = metadata?.chain ?? null;

  const shift = useMemo(
    () => resolveResidueShiftModel({ wildType: metadata?.wildType, mutant: metadata?.mutant, variant: metadata?.variant }),
    [metadata?.wildType, metadata?.mutant, metadata?.variant]
  );
  const scalesLoading = useResidueScalesLoading(isBiophysicalLoading);

  const pocket = useMemo(
    () => derivePocketNarrative(computedPocket, { isLoading: isPocketLoading, error: pocketError, variantResidueIndex: position, variantResidueChain: chain }),
    [computedPocket, isPocketLoading, pocketError, position, chain]
  );

  const model = useMemo(
    () =>
      buildResidueContextEvidence({
        wildTypeCode: shift.wildTypeCode,
        mutantCode: shift.mutantCode,
        wildTypeLabel: shift.wildTypeLabel,
        mutantLabel: shift.mutantLabel,
        wildTypeName: residueName(shift.wildTypeCode),
        mutantName: residueName(shift.mutantCode),
        position,
        contrast: shift.contrast,
        scalesLoading,
        disruption: result?.disruptionPredictor ?? null,
        pdbId: metadata?.pdbId,
        pdbSource: metadata?.pdbSource,
        chain,
        pocket
      }),
    [shift, position, scalesLoading, result?.disruptionPredictor, metadata?.pdbId, metadata?.pdbSource, chain, pocket]
  );

  return { model, shift };
}

/** "Aspartate [Asp]" → "Aspartate". */
function residueName(code: string): string | null {
  const name = AMINO_ACID_NAMES_MAP[code];
  if (!name) return null;
  return name.replace(/\s*\[.*\]\s*$/, "").trim() || null;
}
