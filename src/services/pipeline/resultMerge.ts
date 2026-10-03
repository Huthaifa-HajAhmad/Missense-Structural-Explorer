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
  esm3Eval: "structural",
  esmcEval: "structural",
  esm2Eval: "structural",
  saprotEval: "structural"
};

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
  patch = { ...patch };
  if (stage) {
    for (const [field, owner] of Object.entries(enrichmentOwners)) {
      if (stage !== owner) delete patch[field];
    }
  }
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
  const merged = mergeResultPatch(prev, completed.result, base, "core", "complete");
  return { ...merged, isLoading: false, error: null };
}
