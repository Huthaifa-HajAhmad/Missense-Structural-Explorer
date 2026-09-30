/**
 * insightsSnapshot.ts — the Insights consolidator's input, assembled from a run, in one place.
 *
 * The Insights card builds this input inline from its own props. The Report document needs the same
 * consolidated case from three callers (the screen, the rail and the store's copy-as-text), and the
 * store may not import from `src/components`, so the assembly lives here. `stabilityInputFor` maps
 * the engines exactly as `deriveConsensus` in `ClinicalInsightsCard.tsx` does (a parity test pins
 * the two together), so the Report cannot show a stability lane the Insights tab would not.
 */
import type { AnalysisResult } from "./contracts.ts";
import { computeStabilityConsensus } from "./thresholds.ts";
import { buildInsightsEvidence, type InsightsEvidence, type StabilityInput } from "./insightsEvidence.ts";
import { functionEvidenceInputFrom } from "./functionEvidenceInput.ts";
import { isFallbackNarrative } from "./narrativeFallback.ts";

export function stabilityInputFor(
  result: AnalysisResult | null,
  foldingEnergetics?: any,
  foldingDdG?: number | null
): StabilityInput | null {
  if (!result) return null;
  const fe = foldingEnergetics;
  const consensus = computeStabilityConsensus({
    foldx: fe?.foldx ?? foldingDdG ?? null,
    foldxMean: fe?.foldxMean ?? foldingDdG ?? null,
    dynamut2: fe?.dynamut2 ?? null,
    ddmut: fe?.ddmut ?? null,
    rasp: fe?.rasp ?? null,
    thermompnn: fe?.thermompnn ?? null,
    stabilityoracle: fe?.stabilityoracle ?? null,
    foldxRepairFailed: fe?.foldxRepairFailed ?? false,
    foldxBinaryMissing: fe?.foldxBinaryMissing ?? false,
  } as any);
  return consensus
    ? {
        verdict: consensus.consensusVerdict,
        enginesCounted: consensus.enginesCounted,
        enginesDestabilizing: consensus.enginesDestabilizing,
      }
    : null;
}

export function insightsEvidenceFor(args: {
  result: AnalysisResult | null;
  foldingEnergetics?: any;
  foldingDdG?: number | null;
  isLoading?: boolean;
}): InsightsEvidence | null {
  const { result } = args;
  if (!result) return null;
  return buildInsightsEvidence({
    result,
    functionInput: functionEvidenceInputFrom(result),
    stability: stabilityInputFor(result, args.foldingEnergetics, args.foldingDdG),
    isLoading: Boolean(args.isLoading),
    narrativeDegraded: isFallbackNarrative(result.analysis ?? "", result.isFallback, result.fallbackReason),
  });
}
