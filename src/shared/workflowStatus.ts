import type { AnalysisResult } from "./contracts.ts";
import { formatDdg, type RemoteStatus } from "./engineStatus.ts";
import { buildEnergeticsEvidence } from "./energeticsEvidence.ts";
import { describeFoldxPhase, type FoldxPhase } from "./foldxPhase.ts";
import { isFallbackLocus, fallbackCause, locusFailureKind, locusRecoveryAction } from "./locusResolution.ts";

export type WorkflowStatusType = "complete" | "progress" | "pending" | "degraded" | "error" | "unavailable" | "on-demand";

/**
 * Views the pipeline never runs by itself: the reader opens them, so they are not part of the
 * automatic run and must not be counted in its progress.
 *
 * Kept as data rather than inferred from a status word, because the status is not stable: literature
 * reads "on-demand" while idle but "running" or "complete" once the reader has asked for it. Counting by
 * status made the denominator change from six to seven mid-run, which is the drift the rail's
 * "N of M settled" line exists to rule out.
 */
export const ON_DEMAND_VIEWS: ReadonlySet<string> = new Set(["literature"]);

export function isOnDemandView(view: string): boolean {
  return ON_DEMAND_VIEWS.has(view);
}

export function summarizeWorkflowStatuses(statuses: WorkflowStatusType[]) {
  const automatic = statuses.filter(status => status !== "on-demand");
  const settled = automatic.filter(status => ["complete", "degraded", "error", "unavailable"].includes(status)).length;
  return {
    settled,
    total: automatic.length,
    percent: automatic.length ? Math.round(settled / automatic.length * 100) : 0,
    hasProblems: automatic.some(status => ["degraded", "error", "unavailable"].includes(status))
  };
}

function remoteStatus(status: string | null | undefined): RemoteStatus {
  if (status === "failed" || status === "timeout") return "error";
  return status === "pending" || status === "done" || status === "error" || status === "unavailable" ? status : null;
}

function energeticsStageStatus(params: WorkflowStageStatusParams): { status: WorkflowStatusType; desc: string } {
  const result = params.result;
  if (result?.metadata?.pipelineStages?.core === "error") {
    return {
      status: "unavailable",
      desc: "Stability engines unavailable · Query failed"
    };
  }
  const energetics = params.foldingEnergetics !== undefined ? params.foldingEnergetics : result?.foldingEnergetics;
  const evidence = buildEnergeticsEvidence({
    foldingEnergetics: { ...energetics, dynamut2: energetics?.dynamut2 ?? result?.dynamut2, ddmut: energetics?.ddmut ?? result?.ddmut },
    foldingDdG: params.foldingDdG,
    foldingStatus: params.foldingStatus === "success" || params.foldingStatus === "failed" || params.foldingStatus === "unavailable" ? params.foldingStatus : null,
    foldingError: params.foldingError ?? energetics?.foldxError,
    dynamut2Status: remoteStatus(params.dynamut2Status),
    ddmutStatus: remoteStatus(params.ddmutStatus),
    thermompnnStatus: remoteStatus(params.thermompnnStatus),
    thermompnnError: params.thermompnnError,
    isFolding: params.isFolding
  });
  // The run's ΔΔG comes from an engine that can count — never from a reference row (ProtVar), which
  // would otherwise be presented as this run's estimate whenever every counted engine failed.
  const computed = evidence.readings.find(reading => reading.ddg !== null && !reading.outcome.engine.referenceOnly);
  const failed = evidence.missing.filter(reading => ["failed", "upstream-error", "upstream-busy"].includes(reading.outcome.state));
  /**
   * An engine interrupted when the session expired is neither a provider failure nor an
   * unknown absence: its cause is known and its fix is a relink, not a re-run of the engine.
   * The rail must say so rather than counting it as "Available" beside the FoldX value that
   * did come back.
   */
  const pausedByName = evidence.missing
    .filter(reading => reading.outcome.state === "paused")
    .map(reading => reading.name);
  if (params.isFolding || evidence.running.length) {
    return { status: "progress", desc: computed ? 
      `ΔΔG = ${computed.ddg! > 0 ? "+" : ""}${formatDdg(computed.ddg)} · Other engines running` : describeFoldxPhase(params.foldingPhase)?.detail ?? "Stability engines running..." };
  }
  if (computed) {
    return {
      status: failed.length || pausedByName.length ? "degraded" : "complete",
      desc: `ΔΔG = ${computed.ddg! > 0 ? "+" : ""}${formatDdg(computed.ddg)} · ${
        failed.length
          ? "Some engines unavailable"
          : pausedByName.length
          ? "Some engines paused — session expired, relink in Services"
          : "Available"
      }`
    };
  }
  if (failed.length) return { status: "error", desc: `${failed.map(reading => reading.name).join(", ")} failed or unavailable · Open Energetics to retry` };
  if (pausedByName.length) {
    return { status: "unavailable", desc: `${pausedByName.join(", ")} paused by an expired session · Relink in Services and retry` };
  }
  if (params.foldingStatus || energetics || result?.metadata?.pipelineStages?.core === "complete") {
    return { status: "unavailable", desc: "Stability engines settled without a numeric result · Open Energetics for details" };
  }
  return { status: params.isLoadingSearch || params.isBiophysicalLoading ? "progress" : "pending", desc: "Awaiting stability engine results..." };
}

export function hasRealAnalysis(result: AnalysisResult | null | undefined): boolean {
  if (typeof result?.analysis !== "string") return false;
  const a = result.analysis.trim().toLowerCase();
  return (
    Boolean(a) &&
    !a.includes("in progress") &&
    !a.includes("unavailable") &&
    !a.includes("generation failed") &&
    !a.includes("error occurred") &&
    !a.includes("rate limit exceeded")
  );
}

export function isAnalysisFailed(result: AnalysisResult | null | undefined): boolean {
  if (typeof result?.analysis !== "string") return false;
  const a = result.analysis.toLowerCase();
  return (
    a.includes("generation failed") ||
    a.includes("error occurred") ||
    a.includes("rate limit exceeded")
  );
}

export function hasRealInsights(insights: any): boolean {
  if (!insights || typeof insights !== "object") return false;
  const shift = typeof insights.biochemicalShift === "string" ? insights.biochemicalShift.toLowerCase() : "";
  const impact = typeof insights.structuralImpact === "string" ? insights.structuralImpact.toLowerCase() : "";
  if (
    shift.includes("unavailable") ||
    shift.includes("failed") ||
    shift.includes("not synthesized") ||
    impact.includes("unavailable") ||
    impact.includes("failed") ||
    impact.includes("not synthesized")
  ) {
    return false;
  }
  return Boolean(
    shift ||
    impact ||
    (Array.isArray(insights.acmgCriteria) && insights.acmgCriteria.length > 0) ||
    insights.acmgVerdict
  );
}

export interface WorkflowStageStatusParams {
  view: string;
  result?: AnalysisResult | null;
  isFolding?: boolean;
  /**
   * The FoldX phase the worker reported, when there is one.
   *
   * Optional, and `null` is meaningful: the rail then uses the legacy wording rather than guessing
   * a stage. See `foldxPhase.ts` for why no surface may invent one.
   */
  foldingPhase?: FoldxPhase | null;
  isBiophysicalLoading?: boolean;
  isClinicalLoading?: boolean;
  isLoadingSearch?: boolean;
  loadingStep?: string;
  isPocketLoading?: boolean;
  dynamut2Status?: string | null;
  ddmutStatus?: string | null;
  isNarrativeLoading?: boolean;
  hasStructureCoordinates?: boolean;
  foldingEnergetics?: Record<string, any> | null;
  foldingDdG?: number | null;
  foldingStatus?: string | null;
  foldingError?: string | null;
  thermompnnStatus?: string | null;
  thermompnnError?: string | null;
  landscapeOverviewStatus?: "loading" | "ready" | "error" | "idle" | null;
  /**
   * Labels of the Evidence tabs still loading their own sources (`evidenceTabProgress.ts`). Core
   * landing makes the workspace USABLE; the row is SETTLED only when no tab is still loading.
   */
  evidenceTabsLoading?: readonly string[];
}

export function getWorkflowStageStatus(params: WorkflowStageStatusParams): { status: WorkflowStatusType; desc: string };
export function getWorkflowStageStatus(
  view: string,
  result?: AnalysisResult | null,
  isFolding?: boolean,
  isBiophysicalLoading?: boolean,
  isClinicalLoading?: boolean,
  isLoadingSearch?: boolean,
  loadingStep?: string,
  isPocketLoading?: boolean,
  dynamut2Status?: string | null,
  ddmutStatus?: string | null,
  isNarrativeLoading?: boolean,
  hasStructureCoordinates?: boolean
): { status: WorkflowStatusType; desc: string };
export function getWorkflowStageStatus(
  viewOrParams: string | WorkflowStageStatusParams,
  argResult?: AnalysisResult | null,
  argIsFolding?: boolean,
  argIsBiophysicalLoading?: boolean,
  argIsClinicalLoading?: boolean,
  argIsLoadingSearch?: boolean,
  argLoadingStep?: string,
  argIsPocketLoading?: boolean,
  argDynamut2Status?: string | null,
  argDdmutStatus?: string | null,
  argIsNarrativeLoading?: boolean,
  argHasStructureCoordinates?: boolean
): { status: WorkflowStatusType; desc: string } {
  const p: WorkflowStageStatusParams =
    typeof viewOrParams === "string"
      ? {
          view: viewOrParams,
          result: argResult,
          isFolding: argIsFolding ?? false,
          isBiophysicalLoading: argIsBiophysicalLoading ?? false,
          isClinicalLoading: argIsClinicalLoading ?? false,
          isLoadingSearch: argIsLoadingSearch,
          loadingStep: argLoadingStep,
          isPocketLoading: argIsPocketLoading,
          dynamut2Status: argDynamut2Status,
          ddmutStatus: argDdmutStatus,
          isNarrativeLoading: argIsNarrativeLoading,
          hasStructureCoordinates: argHasStructureCoordinates
        }
      : viewOrParams;

  const {
    view,
    result,
    isFolding = false,
    foldingPhase = null,
    isBiophysicalLoading = false,
    isClinicalLoading = false,
    isLoadingSearch = false,
    loadingStep = "",
    isPocketLoading = false,
    isNarrativeLoading = false,
    dynamut2Status = null,
    ddmutStatus = null,
    hasStructureCoordinates = false,
    landscapeOverviewStatus = null
  } = p;

  /**
   * What the structure stage says while FoldX runs.
   *
   * The reported phase wins when there is one. When there is not — before the submit request has
   * answered, or against a server that does not report phases — the copy is a statement about the
   * RUN, not about a stage: "Repacking mutant side-chains…" named a step the app cannot establish
   * (the job may still be queued), which is the same invented-status defect this module's vocabulary
   * exists to prevent, and it contradicted the Energetics banner's honest "not reported" in the very
   * same frame.
   */
  const foldxActivityDesc =
    describeFoldxPhase(foldingPhase)?.detail ??
    "FoldX force-field run in progress — stage not reported by the compute server yet.";

  // Define default descriptions for stages
  const defaultDescs: Record<string, string> = {
    evidence: "ClinVar, gnomAD & ACMG rules engine",
    structure: "AlphaFold DB, ESMFold & PDB 3D templates",
    energetics: "FoldX, DynaMut2 & DDMut stability engines",
    landscape: "3D spatial mutation mapping & pocket impact",
    insights: "AI-driven variant interpretation narrative",
    literature: "PubMed Central & Europe PMC citation mining",
    report: "Downloadable clinical report & variant summary"
  };

  if (view === "search") {
    return { status: "complete", desc: "Variant search workspace active" };
  }
  if (view === "energetics") return energeticsStageStatus(p);

  // 1. Running state (Active search pipeline execution)
  if (isLoadingSearch && !result) {
    if (view === "evidence") return { status: "progress", desc: loadingStep || "Running evidence query..." };
    if (view === "literature") return { status: "on-demand", desc: "Open Literature to search citations" };
    return { status: "pending", desc: defaultDescs[view] || "Awaiting evidence..." };
  }

  // 2. Landed state (active background computation tracking)
  if (result != null) {
    const realAnalysis = hasRealAnalysis(result);

    if (view === "evidence") {
      if (result.metadata?.pipelineStages?.core === "error") return { status: "error", desc: "Core evidence query failed · Re-run to retry" };
      if (isClinicalLoading || isBiophysicalLoading) {
        return {
          status: "progress",
          // Evidence that ARRIVED: a source that failed or timed out has delivered nothing to be "available".
          desc: Object.values(result.serviceStatus ?? result.metadata?.serviceStatus ?? {}).some(status => status === "ok")
            ? "Partial evidence available · Remaining sources loading"
            : "Querying ClinVar, gnomAD, and predictors..."
        };
      }
      /**
       * A run whose population evidence could not be read is not "complete", and the rail must not
       * show it in the same green as a clean one: a fallback locus (the GRCh38 lookup failed, so
       * gnomAD was never queried) or a gnomAD query that timed out or failed.
       */
      const gnomadStatus = result.serviceStatus?.gnomadFrequency ?? result.metadata?.serviceStatus?.gnomadFrequency;
      if (isFallbackLocus(result)) {
        return {
          status: "degraded",
          desc: `Population evidence not assessed: ${fallbackCause(
             result.predictorData?.gnomadVariantAssembly ?? null,
             locusRecoveryAction(result) === "retry",
             locusFailureKind(result) ?? undefined
           )}`
        };
      }
      if (gnomadStatus === "timeout" || gnomadStatus === "error") {
        return {
          status: "degraded",
          desc: "gnomAD did not answer on this run · population evidence incomplete — re-run to retry"
        };
      }
      /**
       * Usable is not settled. Core evidence and the ACMG rules are in, so every tab can be opened,
       * but a tab still loading its own source (AlphaGenome, Expression, Interfaces…) is named here
       * rather than hidden behind a "complete" the reader would take as final.
       */
      const loadingTabs = p.evidenceTabsLoading ?? [];
      if (loadingTabs.length > 0) {
        const named = loadingTabs.length <= 3
          ? loadingTabs.join(", ")
          : `${loadingTabs.slice(0, 2).join(", ")} and ${loadingTabs.length - 2} more`;
        return { status: "progress", desc: `Usable now · Still loading: ${named}` };
      }
      const clinvarText = result.clinvar?.classification || "Annotated";
      return {
        status: "complete",
        desc: `ClinVar: ${clinvarText} · ACMG rules evaluated`
      };
    }

    if (view === "structure" || view === "structure_alphafold" || view === "structure_esmfold") {
      if (result.metadata?.pipelineStages?.core === "error") {
        return {
          status: "unavailable",
          desc: "Protein coordinates unavailable · Query failed"
        };
      }
      if (!!isPocketLoading) {
        return { status: "progress", desc: "Coordinates available · Assessing binding pockets..." };
      }
      // An accession, template selection, or narrative is not proof that coordinates loaded.
      const hasStructureEvidence = Boolean(
        hasStructureCoordinates ||
        (result.esm3Eval && "pdbText" in result.esm3Eval && result.esm3Eval.pdbText)
      );
      /**
       * Multimer and PPI are started with the structure and are read through the same viewer (the
       * Interfaces & PPI tab). Showing the structure as settled while they still compute would tell the
       * reader the interface view is final when its data is still arriving, so the stage waits for them.
       * A failed or skipped sidecar is settled and does not hold the stage.
       */
      const sidecarRunning =
        result.metadata?.pipelineStages?.multimer === "running" ||
        result.metadata?.pipelineStages?.ppi === "running";
      if (sidecarRunning) {
        return {
          status: "progress",
          desc: hasStructureEvidence
            ? "Protein 3D coordinates ready · Interface and multimer analysis running..."
            : "Loading protein 3D coordinates · Interface and multimer analysis running..."
        };
      }
      if (hasStructureEvidence) {
        return {
          status: "complete",
          desc: "Protein 3D coordinates ready"
        };
      }
      const coordinates = result.metadata?.pipelineStages?.coordinates;
      if (coordinates === "running") return { status: "progress", desc: "Loading protein 3D coordinates..." };
      if (coordinates === "error" || coordinates === "degraded" || coordinates === "skipped") {
        return { status: "unavailable", desc: "Protein coordinates query settled without a structure · Re-run to retry" };
      }
      return {
        status: "pending",
        desc: "PDB structure unavailable"
      };
    }

    if (view === "landscape") {
      if (result.metadata?.pipelineStages?.core === "error") {
        return {
          status: "unavailable",
          desc: "Landscape data unavailable · Query failed"
        };
      }
      const outcome = result.metadata?.pipelineStages?.landscape;
      if (outcome === "running") return { status: "progress", desc: "Loading residue landscape..." };
      if (outcome === "error") return { status: "degraded", desc: "Landscape query failed · Retry from Landscape" };
      const count = result.landscapeData?.length ?? 0;
      if (count === 0) {
        if (outcome === "complete" || outcome === "skipped" || outcome === "degraded") {
          return { status: "unavailable", desc: outcome === "skipped" ? "Landscape source not configured" : "No residue scores returned for this window · Open Landscape for details" };
        }
        if (isBiophysicalLoading) {
          return {
            status: "progress",
            desc: "Loading residue scores..."
          };
        }
        return {
          status: "pending",
          desc: "Landscape data unavailable"
        };
      }
      if (landscapeOverviewStatus === "loading") {
        return {
          status: "progress",
          desc: `${count} residue${count === 1 ? "" : "s"} ready · Loading whole protein...`
        };
      }
      return {
        status: "complete",
        desc: `${count} residue${count === 1 ? "" : "s"} loaded`
      };
    }

    if (view === "insights") {
      if (result.metadata?.pipelineStages?.core === "error") {
        return {
          status: "unavailable",
          desc: "Variant interpretation unavailable · Query failed"
        };
      }

      if (result.ruleBasedInsights && !isBiophysicalLoading && !isClinicalLoading) {
        return { status: "complete", desc: isNarrativeLoading ? "Rule-based interpretation ready · Optional AI running" : "Rule-based interpretation ready" };
      }
      if (isAnalysisFailed(result)) {
        return {
          status: "degraded",
          desc: "Variant narrative generation failed"
        };
      }

      const isPrereqLoading = isBiophysicalLoading || isClinicalLoading;
      if (isPrereqLoading) {
        return {
          status: "pending",
          desc: "Awaiting prerequisite biophysical & clinical data..."
        };
      }

      if (isNarrativeLoading) {
        return {
          status: "progress",
          desc: "Synthesizing pathogenicity & ACMG/AMP criteria..."
        };
      }

      if (realAnalysis || hasRealInsights(result.insights)) {
        return {
          status: "complete",
          desc: "Variant interpretation consensus ready"
        };
      }

      return {
        status: "pending",
        desc: "Variant insights unavailable"
      };
    }

    if (view === "literature") {
      const outcome = result.metadata?.pipelineStages?.literature;
      if (outcome === "running") return { status: "progress", desc: "Searching Europe PMC citations..." };
      if (outcome === "complete") return { status: "complete", desc: "Literature query complete" };
      if (outcome === "degraded" || outcome === "error") return { status: "degraded", desc: "Literature query unavailable · Open Literature to retry" };
      return { status: "on-demand", desc: "Open Literature to search citations" };
    }

    if (view === "report") {
      if (result.metadata?.pipelineStages?.core === "error") {
        return {
          status: "unavailable",
          desc: "Clinical report unavailable · Query failed"
        };
      }

      const hasEvidence = Boolean(result.ruleBasedInsights || result.clinvar || result.predictorData || result.conservationData || result.metadata?.pipelineStages?.core === "complete");
      if (hasEvidence) {
        return { status: isBiophysicalLoading || isClinicalLoading ? "progress" : "complete",
          desc: isBiophysicalLoading || isClinicalLoading ? "Evidence snapshot available · Sources still loading" : isNarrativeLoading ? "Evidence report ready · Optional AI running" : "Evidence report ready" };
      }
      if (isAnalysisFailed(result)) {
        return {
          status: "error",
          desc: "Clinical summary generation failed"
        };
      }

      if (isNarrativeLoading) {
        return {
          status: "progress",
          desc: "Compiling clinical summary & evidence export..."
        };
      }

      if (!realAnalysis && (isBiophysicalLoading || isClinicalLoading)) {
        return {
          status: "pending",
          desc: "Awaiting variant insights & clinical evidence..."
        };
      }

      if (realAnalysis) {
        return {
          status: "complete",
          desc: "Clinical summary & report compiled"
        };
      }

      return {
        status: "pending",
        desc: "Report generation unavailable"
      };
    }

    return { status: "complete", desc: defaultDescs[view] || "" };
  }

  return { status: "pending", desc: defaultDescs[view] || "" };
}
