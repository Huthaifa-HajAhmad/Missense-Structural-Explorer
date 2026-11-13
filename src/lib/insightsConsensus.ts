import type { AnalysisState } from "../types";
import { stabilityConsensusFor as deriveConsensus } from "../shared/stabilityConsensus";

/** Shared with Insights snapshots and reports; always recomputed from current engine values. */
export { deriveConsensus };

/**
 * The `verdictContext` the export paths pass to the manifest — one function, so the call site has
 * nothing left to get wrong.
 */
export function buildExportVerdictContext(args: {
  result: AnalysisState["result"] | null;
  foldingEnergetics?: any;
  foldingDdG?: number | null;
  plddt?: number | null;
}) {
  const derived = deriveConsensus(args);
  const pendingTools = args.foldingEnergetics?.pendingTools ?? [];
  return {
    derivedVerdict: derived?.consensusVerdict ?? null,
    evidenceComplete: args.foldingEnergetics?.evidenceComplete ?? null,
    pendingTools,
  };
}
