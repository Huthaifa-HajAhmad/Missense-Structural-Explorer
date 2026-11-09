import type { PipelineStateBaseParams } from "./pipelineStateFactory";
import { createPlaceholderAnalysisState } from "./pipelineStateFactory";
import type { AnalysisPipelineStage, AnalysisStageOutcome, AnalysisPipelineStages } from "../../shared/contracts";

export type PipelineStage = AnalysisPipelineStage;
export type StageOutcome = AnalysisStageOutcome;
export type PipelineStages = AnalysisPipelineStages;

const enrichmentOwners: Record<string, PipelineStage> = {
  landscapeData: "landscape",
  landscapeMeta: "landscape",
  multimerData: "multimer",
  ppiBindingData: "ppi",
  esm3Eval: "structural",
  esmcEval: "structural",
  esm2Eval: "structural",
  saprotEval: "structural"
};

/**
 * Evidence the core stage writes first and the structural stage can refine, with the metadata field that
 * records who wrote it last. The two responses race, so once structural has written, core may not replace it.
 */
const structuralRefinements = { ruleBasedInsights: "ruleBasedInsightsStage", disruptionPredictor: "disruptionPredictorStage" } as const;

/**
 * The stages a finished run left at "running", settled. A stage whose evidence arrived is `complete`; one
 * whose evidence never arrived did not report, so it is `error` (the screen offers a retry, and a cached
 * result re-runs it) rather than a `complete` with nothing behind it. A stage with no evidence field of its
 * own (narrative, literature) is `complete`, because its own writer settles it. `coordinates` is left alone.
 * Returns null when nothing was running.
 */
export function settleUnreportedStages(result: any): PipelineStages | null {
  const stages: Record<string, StageOutcome> = { ...(result?.metadata?.pipelineStages ?? {}) };
  let changed = false;
  for (const [stage, outcome] of Object.entries(stages)) {
    if (outcome !== "running" || stage === "coordinates") continue;
    const fields = Object.keys(enrichmentOwners).filter(field => enrichmentOwners[field] === stage);
    stages[stage] = fields.length === 0 || fields.some(field => result?.[field] != null) ? "complete" : "error";
    changed = true;
  }
  return changed ? stages : null;
}

/** True when the core analysis text is a real answer, not the placeholder a run starts with. */
export function hasCoreAnalysisText(result: any): boolean {
  return typeof result?.analysis === "string" && Boolean(result.analysis) && !result.analysis.includes("in progress");
}

/**
 * The stages of a result that is being stored or restored, with none left at "running". A stage that is
 * still running cannot be running in the reader's next session, so it is settled by its evidence
 * (see `settleUnreportedStages`). Core has no evidence field of its own: it is `complete` only when the
 * analysis text is a real answer. Otherwise it is `error`, so the next run redoes it instead of
 * serving the placeholder as a finished analysis. A narrative or literature search still running records no
 * outcome: its writer has not finished, so nothing can be said about it. Returns null when nothing was running.
 */
export function settleStagesForStorage(result: any): PipelineStages | null {
  const stages: Record<string, StageOutcome> | null = settleUnreportedStages(result);
  const settled: Record<string, StageOutcome> = { ...(stages ?? result?.metadata?.pipelineStages ?? {}) };
  let changed = stages !== null;
  if (result?.metadata?.pipelineStages?.core === "running" && !hasCoreAnalysisText(result)) {
    settled.core = "error";
    changed = true;
  }
  for (const stage of ["narrative", "literature"]) {
    if (result?.metadata?.pipelineStages?.[stage] !== "running") continue;
    delete settled[stage];
    changed = true;
  }
  if (settled.coordinates === "running") {
    settled.coordinates = "complete";
    changed = true;
  }
  return changed ? settled : null;
}

/** Declared running/failed/refused core is never made reusable by optional prose. */
export function hasReusableCoreEvidence(result: any): boolean {
  if (!result || result.numberingChoices?.length || result.buildHint) return false;
  const core = result.metadata?.pipelineStages?.core;
  if (core) return core === "complete";
  // Compatibility for context-stamped legacy snapshots without stage outcomes.
  return hasCoreAnalysisText(result);
}

/** Stage-owned patches must never replace another stage's evidence or provenance. */
export function mergeResultPatch(prev: any, patch: any, base?: PipelineStateBaseParams, stage?: PipelineStage, outcome?: StageOutcome): any {
  const seed = prev?.result ? prev : base ? createPlaceholderAnalysisState(base) : prev;
  if (!seed?.result) return prev;
  const result = seed.result;
  patch = { ...patch };
  if (stage) {
    for (const [field, owner] of Object.entries(enrichmentOwners)) {
      if (stage !== owner) delete patch[field];
    }
  }
  const refinements = Object.entries(structuralRefinements);
  if (stage === "core") {
    for (const [field, marker] of refinements) if (result.metadata?.[marker] === "structural") delete patch[field];
  }
  const refinedBy = stage === "core" || stage === "structural"
    ? Object.fromEntries(refinements.filter(([field]) => patch[field]).map(([, marker]) => [marker, stage]))
    : {};
  const status = {
    ...(result.metadata?.serviceStatus ?? {}), ...(result.serviceStatus ?? {}),
    ...(patch.metadata?.serviceStatus ?? {}), ...(patch.serviceStatus ?? {})
  };
  const metadata = {
    ...result.metadata, ...patch.metadata,
    serviceStatus: status,
    ...refinedBy,
    pipelineStages: {
      ...(result.metadata?.pipelineStages ?? {}), ...(patch.metadata?.pipelineStages ?? {}),
      ...(stage && outcome ? { [stage]: outcome } : {})
    }
  };
  return { ...seed, result: { ...result, ...patch, metadata, serviceStatus: status } };
}

/** A final CORE payload is authoritative for core only, not for already-settled enrichment. */
export function mergeCompletedCore(prev: any, completed: any, base: PipelineStateBaseParams): any {
  const merged = mergeResultPatch(prev, completed.result, base, "core", "complete");
  return { ...merged, isLoading: false, error: null };
}
