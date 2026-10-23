import { isConservationModelPending } from "./conservationProgress.ts";

/**
 * Which Evidence tabs are still waiting on their backing data — one answer for the sidebar's
 * per-tab indicators, the Evidence row and the search rail, so the three cannot disagree.
 *
 * Every tab reads its OWN sources. The parent row used to summarise core only: it said "complete"
 * while AlphaGenome, Expression or Interfaces were still loading, and said "running" while every
 * tab the reader could open was already usable. The row now states both (see `workflowStatus.ts`).
 */

/** Gene-context loads (disease, expression, model organisms), which run outside the core stream. */
export interface GeneContextLoading {
  disease: boolean;
  expression: boolean;
  models: boolean;
}

export const NO_GENE_CONTEXT_LOADING: GeneContextLoading = { disease: false, expression: false, models: false };

export function isEvidenceTabLoading(
  tabId: string,
  isBiophysicalLoading: boolean,
  result: any,
  context: GeneContextLoading = NO_GENE_CONTEXT_LOADING
): boolean {
  const statuses = result?.serviceStatus ?? result?.metadata?.serviceStatus;
  const pending = (key: string) => {
    const status = (statuses as Record<string, string> | undefined)?.[key];
    return status ? status === "pending" : isBiophysicalLoading;
  };
  const stages = result?.metadata?.pipelineStages;
  switch (tabId) {
    case "clinical": return pending("clinvar") || pending("gnomadFrequency") || pending("gnomadConstraint");
    case "gene-disease": return context.disease;
    case "expression-models": return context.expression;
    case "species-models": return context.models;
    case "function": return pending("uniprotFeatures");
    // Per model: a streamed SpliceAI or AlphaGenome answer stops its own tab's indicator.
    case "alphagenome": return !result?.conservationData?.alphagenome && isConservationModelPending(result, "alphagenome", isBiophysicalLoading);
    case "splicing": return !result?.conservationData?.spliceai && isConservationModelPending(result, "spliceai", isBiophysicalLoading);
    // The predictor table also carries PopEVE, GPN-Star and the AVI row, each a model of its own.
    case "predictors": return pending("predictorData") ||
      (["base", "popeve", "gpnStar", "alphagenome"] as const).some(model => isConservationModelPending(result, model, isBiophysicalLoading));
    case "structure":
    case "perturbation": return stages?.structural === "running";
    case "interfaces": return stages?.multimer === "running" || stages?.ppi === "running";
    default: return false;
  }
}

/** Labels of the tabs still loading, in tab order. */
export function evidenceTabsLoading(
  tabs: ReadonlyArray<{ id: string; label: string }>,
  isBiophysicalLoading: boolean,
  result: any,
  context: GeneContextLoading = NO_GENE_CONTEXT_LOADING
): string[] {
  return tabs.filter(tab => isEvidenceTabLoading(tab.id, isBiophysicalLoading, result, context)).map(tab => tab.label);
}
