import type { PipelineStateBaseParams } from "./pipelineStateFactory";
import { createPlaceholderAnalysisState } from "./pipelineStateFactory";

export type PipelineStage = "core" | "landscape" | "structural" | "multimer" | "narrative";
export type StageOutcome = "running" | "complete" | "degraded" | "error" | "skipped";
export type PipelineStages = Partial<Record<PipelineStage, StageOutcome>>;

/** Declared running/failed/refused core is never made reusable by optional prose. */
export function hasReusableCoreEvidence(result: any): boolean {
  if (!result || result.numberingChoices?.length || result.buildHint) return false;
  const core = result.metadata?.pipelineStages?.core;
  if (core) return core === "complete";
  // Compatibility for context-stamped legacy snapshots without stage outcomes.
  return typeof result.analysis === "string" && Boolean(result.analysis) && !result.analysis.includes("in progress");
}

/** Stage-owned patches must never replace another stage's evidence or provenance. */
export function mergeResultPatch(prev: any, patch: any, base?: PipelineStateBaseParams, stage?: PipelineStage, outcome?: StageOutcome): any {
  const seed = prev?.result ? prev : base ? createPlaceholderAnalysisState(base) : prev;
  if (!seed?.result) return prev;
  const result = seed.result;
  if (stage === "core" && result.metadata?.ruleBasedInsightsStage === "structural") {
    patch = { ...patch };
    delete patch.ruleBasedInsights;
  }
  const status = {
    ...(result.metadata?.serviceStatus ?? {}), ...(result.serviceStatus ?? {}),
    ...(patch.metadata?.serviceStatus ?? {}), ...(patch.serviceStatus ?? {})
  };
  if (stage === "core" && ["complete", "degraded"].includes(result.metadata?.pipelineStages?.structural)) {
    for (const key of ["esm3", "esmc", "saprot", "esm2Eval"]) {
      const value = result.serviceStatus?.[key] ?? result.metadata?.serviceStatus?.[key];
      if (value !== undefined) status[key] = value;
    }
  }
  const metadata = {
    ...result.metadata, ...patch.metadata,
    serviceStatus: status,
    ...(patch.ruleBasedInsights && (stage === "core" || stage === "structural") ? { ruleBasedInsightsStage: stage } : {}),
    pipelineStages: {
      ...(result.metadata?.pipelineStages ?? {}), ...(patch.metadata?.pipelineStages ?? {}),
      ...(stage && outcome ? { [stage]: outcome } : {})
    }
  };
  return { ...seed, result: { ...result, ...patch, metadata, serviceStatus: status } };
}

/** A final CORE payload is authoritative for core only, not for already-settled enrichment. */
export function mergeCompletedCore(prev: any, completed: any, base: PipelineStateBaseParams): any {
  const patch = { ...completed.result };
  for (const key of ["landscapeData", "landscapeMeta", "multimerData", "esm3Eval", "esmcEval", "esm2Eval", "saprotEval"]) {
    if (prev?.result?.[key] !== undefined && prev.result[key] !== null) delete patch[key];
  }
  const merged = mergeResultPatch(prev, patch, base, "core", "complete");
  return { ...merged, isLoading: false, error: null };
}
