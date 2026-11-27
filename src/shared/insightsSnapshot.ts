/**
 * insightsSnapshot.ts — the Insights consolidator's input, assembled from a run, in one place.
 *
 * The Insights card builds this input inline from its own props. The Report document needs the same
 * consolidated case from three callers (the screen, the rail and the store's copy-as-text), and the
 * store may not import from `src/components`, so the assembly lives here. `stabilityInputFor` consumes
 * the same `stabilityConsensusFor` helper as Insights (a parity test pins the resulting labels), so the Report cannot show a stability lane the Insights tab would not.
 */
import type { AnalysisResult } from "./contracts.ts";
import { stabilityConsensusFor } from "./stabilityConsensus";
import { buildEnergeticsEvidence, energeticsWithheldText, finalFoldingStatus, type FoldxRunState } from "./energeticsEvidence";
import { buildInsightsEvidence, type InsightsEvidence, type StabilityInput } from "./insightsEvidence.ts";
import { functionEvidenceInputFrom } from "./functionEvidenceInput.ts";
import { isFallbackNarrative } from "./narrativeFallback.ts";

export function stabilityInputFor(
  result: AnalysisResult | null,
  foldingEnergetics?: any,
  foldingDdG?: number | null,
  run: FoldxRunState = {}
): StabilityInput | null {
  const consensus = stabilityConsensusFor({ result, foldingEnergetics, foldingDdG, ...run });
  if (!consensus) return null;
  // The Energetics tab's own evidence, so a running or withheld engine reaches Insights and the Report too.
  const ev = buildEnergeticsEvidence({
    foldingEnergetics: foldingEnergetics ?? null,
    foldingDdG: foldingDdG ?? null,
    isFolding: run.isFolding,
    foldingStatus: finalFoldingStatus(run.foldingStatus),
    plddt: result?.disruptionPredictor?.plddt ?? null,
  });
  return {
    verdict: consensus.consensusVerdict,
    enginesCounted: consensus.enginesCounted,
    enginesDestabilizing: consensus.enginesDestabilizing,
    enginesModerate: consensus.enginesModerate,
    provisional: ev.provisional,
    runningEngines: ev.runningEngines,
    withheldText: energeticsWithheldText(ev),
  };
}

export function insightsEvidenceFor(args: FoldxRunState & {
  result: AnalysisResult | null;
  foldingEnergetics?: any;
  foldingDdG?: number | null;
  isLoading?: boolean;
  /** An expert panel's PM1 specification covers this gene (see `expertPm1Specified`). */
  expertPm1Specified?: boolean;
  expertPm1Status?: "specified" | "not-specified" | "loading" | "unavailable";
}): InsightsEvidence | null {
  const { result } = args;
  if (!result) return null;
  return buildInsightsEvidence({
    result,
    functionInput: functionEvidenceInputFrom(result),
    stability: stabilityInputFor(result, args.foldingEnergetics, args.foldingDdG, { isFolding: args.isFolding, foldingStatus: args.foldingStatus }),
    isLoading: Boolean(args.isLoading),
    narrativeDegraded: isFallbackNarrative(result.analysis ?? "", result.isFallback, result.fallbackReason),
    expertPm1Specified: args.expertPm1Specified,
    expertPm1Status: args.expertPm1Status,
  });
}
