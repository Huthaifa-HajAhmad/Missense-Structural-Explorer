import { isBuildDegradedResult } from "../../shared/contracts";
import { hasReusableCoreEvidence } from "./resultMerge";
import { shouldRunBiophysics } from "./biophysicsRetryPolicy";
import { isFallbackNarrative, type CachedVariantBundle } from "./variantCache";
import type { AnalysisCacheContext, NarrativeMode } from "./analysisContext";
import type { PipelineBiophysicalSink, PipelineStructureSink } from "./types";

/**
 * The rules for putting a saved analysis back on screen. Every route that restores one (a new run, the
 * first paint of a run, a page reload) asks here, so a new rule cannot be added to one route and missed
 * by another.
 */

/**
 * True when a saved result may be shown as the answer: its core finished, it is not an unanswered
 * refusal, and its evidence was built against a canonical reference. A result built against another
 * reference would keep an older coordinate and withheld population evidence on screen.
 */
export function isServableStoredResult(result: unknown): boolean {
  return hasReusableCoreEvidence(result) && !isBuildDegradedResult(result as Parameters<typeof isBuildDegradedResult>[0]);
}

export type ResumableStage = "multimer" | "ppi" | "landscape" | "structural";

/** The enrichment stages a saved result did not finish, in the order a run restarts them. */
export function stagesToResume(result: any): ResumableStage[] {
  const stages = result?.metadata?.pipelineStages;
  const modelStillLoading = ["esm3Eval", "esmcEval", "esm2Eval", "saprotEval"].some(key => result?.[key]?.loading);
  const structuralUnfinished = modelStillLoading
    || ["running", "error", "degraded"].includes(stages?.structural ?? "")
    || (!stages?.structural && !result?.esm2Eval && !result?.saprotEval);
  return [
    ...(!result?.multimerData ? ["multimer" as const] : []),
    ...(!result?.ppiBindingData ? ["ppi" as const] : []),
    ...(!result?.landscapeData || stages?.landscape === "running" || stages?.landscape === "error" ? ["landscape" as const] : []),
    ...(structuralUnfinished ? ["structural" as const] : []),
  ];
}

/** True when a saved result has no model-written narrative, only a fallback or nothing. */
export function narrativeNeedsBackfill(result: any): boolean {
  return isFallbackNarrative(result?.analysis, result?.isFallback, result?.fallbackReason) || !result?.analysis;
}

/** The context fields that live in settings. A reload still knows these, so a change to one is real. */
const SETTINGS_OWNED_CONTEXT = ["uniprotId", "acmgWeighting", "saprotEngine", "simulationConditions", "providerConfiguration"] as const;

/**
 * True when a page reload may show the saved result without starting a run.
 *
 * Only settings are compared. The URL cannot carry the submitted coordinate, the reader's directions or
 * their numbering answer, so a reload has no new value for those to disagree with.
 */
export function reloadMayPaint(
  cached: CachedVariantBundle | null,
  current: AnalysisCacheContext,
  attemptedAt: number | null,
  mode: NarrativeMode
): boolean {
  const result = cached?.analysisResult;
  if (!result || !isServableStoredResult(result)) return false;
  const saved = result.metadata?.pipelineContext;
  return Boolean(saved)
    && SETTINGS_OWNED_CONTEXT.every(field => saved[field] === current[field])
    && stagesToResume(result).length === 0
    && !shouldRunBiophysics(cached, attemptedAt)
    && !(mode === "automatic" && narrativeNeedsBackfill(result));
}

export interface RestoredRemoteState {
  dynamut2Status: string | null;
  dynamut2JobId: string | null;
  ddmutStatus: string | null;
  ddmutJobId: string | null;
  thermompnnStatus: string | null;
  thermompnnJobId: string | null;
}

export const NO_RESTORED_REMOTE_STATE: RestoredRemoteState = {
  dynamut2Status: null, dynamut2JobId: null, ddmutStatus: null, ddmutJobId: null, thermompnnStatus: null, thermompnnJobId: null,
};

/**
 * Whether a saved remote-engine status can still be acted on. A pending engine can only recover if there
 * is a job id to poll, so age is not the question: "can anything still resolve this?" is.
 */
function resolveRestoredStatus(status: string | null | undefined, score: number | null | undefined, jobId: string | null | undefined): string | null {
  if (score != null) return "done";
  if (status === "pending" && !jobId) return "unavailable";
  return status ?? null;
}

type BiophysicalRestoreSink = Pick<PipelineBiophysicalSink, "setMutantPdb" | "setFoldedResidueIndex" | "setFoldingDdG" | "setFoldingEnergetics" | "setFoldingStatus" | "setFoldingError" | "setDynamut2JobId" | "setDynamut2Status" | "setDdmutJobId" | "setDdmutStatus" | "setThermompnnJobId" | "setThermompnnStatus" | "setThermompnnError"> & Partial<Pick<PipelineBiophysicalSink, "setFoldxWtPdb">>;
type StructureRestoreSink = Pick<PipelineStructureSink, "setPdbText" | "setComputedPocket" | "setHomologs" | "setDisruptionPredictor"> & Partial<Pick<PipelineStructureSink, "setPdbTextProvenance" | "setPocketError">>;

/**
 * Replaces everything the viewer shows with this saved variant's values, as one step.
 *
 * A value that was not saved is written as empty on purpose. Skipping it would leave the previous
 * variant's structure or ΔΔG beside this variant's name. FoldX's template travels inside the energetics
 * and is never written to the structure sink, which describes `pdbText` only.
 */
export function restoreStoredArtifacts(cached: CachedVariantBundle, biophysical: BiophysicalRestoreSink, structure: StructureRestoreSink): RestoredRemoteState {
  structure.setPdbText(cached.pdbText ?? null);
  structure.setPdbTextProvenance?.(null);
  structure.setComputedPocket(cached.computedPocket ?? null);
  structure.setPocketError?.(null);
  structure.setHomologs(cached.homologs ?? []);
  structure.setDisruptionPredictor(cached.disruptionPredictor ?? null);

  biophysical.setMutantPdb(cached.mutantPdb ?? null);
  biophysical.setFoldxWtPdb?.(cached.foldxWtPdb ?? null);
  biophysical.setFoldedResidueIndex(cached.foldedResidueIndex ?? null);
  biophysical.setFoldingDdG(cached.foldingDdG ?? null);
  biophysical.setFoldingEnergetics(cached.foldingEnergetics ?? null);
  biophysical.setFoldingStatus(cached.foldingStatus ?? null);
  biophysical.setFoldingError(null);

  const remote: RestoredRemoteState = {
    dynamut2Status: resolveRestoredStatus(cached.dynamut2Status, cached.foldingEnergetics?.dynamut2, cached.dynamut2JobId),
    dynamut2JobId: cached.dynamut2JobId ?? null,
    ddmutStatus: resolveRestoredStatus(cached.ddmutStatus, cached.foldingEnergetics?.ddmut, cached.ddmutJobId),
    ddmutJobId: cached.ddmutJobId ?? null,
    thermompnnStatus: resolveRestoredStatus(cached.thermompnnStatus, cached.foldingEnergetics?.thermompnn, cached.thermompnnJobId),
    thermompnnJobId: cached.thermompnnJobId ?? null,
  };
  biophysical.setDynamut2JobId(remote.dynamut2JobId);
  biophysical.setDynamut2Status(remote.dynamut2Status as any);
  biophysical.setDdmutJobId(remote.ddmutJobId);
  biophysical.setDdmutStatus(remote.ddmutStatus as any);
  biophysical.setThermompnnJobId(remote.thermompnnJobId);
  biophysical.setThermompnnStatus(remote.thermompnnStatus as any);
  biophysical.setThermompnnError(cached.thermompnnError ?? null);
  return remote;
}
