import type { AnalysisResult } from "./contracts.ts";
import { toCanonicalDdg, formatDdg, type EnergyEngineId } from "./engineStatus.ts";

export type WorkflowStatusType = "complete" | "progress" | "pending" | "degraded" | "error";

export function hasRealAnalysis(result: AnalysisResult | null | undefined): boolean {
  if (typeof result?.analysis !== "string") return false;
  const a = result.analysis.toLowerCase();
  return (
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

export interface WorkflowStageStatusParams {
  view: string;
  result?: AnalysisResult | null;
  isFolding?: boolean;
  isBiophysicalLoading?: boolean;
  isClinicalLoading?: boolean;
  isLoadingSearch?: boolean;
  loadingStep?: string;
  isPocketLoading?: boolean;
  dynamut2Status?: string | null;
  ddmutStatus?: string | null;
  isNarrativeLoading?: boolean;
  hasStructureCoordinates?: boolean;
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
    isBiophysicalLoading = false,
    isClinicalLoading = false,
    isLoadingSearch = false,
    loadingStep = "",
    isPocketLoading = false,
    isNarrativeLoading = false,
    hasStructureCoordinates = false
  } = p;

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

  // 1. Running state (Active search pipeline execution)
  if (isLoadingSearch && !result) {
    const match = (loadingStep || "").match(/Step (\d+)\/4/);
    const currentStep = match ? parseInt(match[1], 10) : 1;

    switch (view) {
      case "evidence":
        return {
          status: "progress",
          desc: loadingStep || "Running evidence query..."
        };
      case "structure":
      case "structure_alphafold":
      case "structure_esmfold":
        return {
          status: currentStep >= 2 ? "progress" : "pending",
          desc: currentStep >= 2 ? "Resolving AlphaFold, ESMFold & PDB structural models..." : "Awaiting structural template resolution..."
        };
      case "landscape":
        return {
          status: currentStep >= 3 ? "progress" : "pending",
          desc: currentStep >= 3 ? "Mapping spatial mutation density..." : "Awaiting landscape model execution..."
        };
      case "energetics":
        return {
          status: currentStep >= 4 ? "progress" : "pending",
          desc: currentStep >= 4 ? "Modeling FoldX, DynaMut2 & DDMut biophysical energetics..." : "Awaiting free-energy stability calculations..."
        };
      case "insights":
        return {
          status: currentStep >= 3 ? "progress" : "pending",
          desc: currentStep >= 3 ? "Synthesizing pathogenicity & ACMG/AMP criteria..." : "Awaiting clinical insight generation..."
        };
      case "report":
        return {
          status: currentStep >= 4 ? "progress" : "pending",
          desc: currentStep >= 4 ? "Compiling clinical summary & evidence export..." : "Awaiting final clinical report compilation..."
        };
      default:
        return { status: "pending", desc: defaultDescs[view] || "" };
    }
  }

  // 2. Landed state (active background computation tracking)
  if (result != null) {
    const realAnalysis = hasRealAnalysis(result);

    if (view === "evidence") {
      if (isClinicalLoading || isBiophysicalLoading) {
        return {
          status: "progress",
          desc: "Querying ClinVar, gnomAD, and predictors..."
        };
      }
      const clinvarText = result.clinvar?.classification || "Annotated";
      return {
        status: "complete",
        desc: `ClinVar: ${clinvarText} · ACMG rules evaluated`
      };
    }

    if (view === "structure" || view === "structure_alphafold" || view === "structure_esmfold") {
      if (isFolding || !!isPocketLoading) {
        return {
          status: "progress",
          desc: isFolding ? "Repacking mutant side-chains..." : "Running binding pocket solver..."
        };
      }
      // PDB coordinates are available when:
      // 1. Explicitly flagged via hasStructureCoordinates, OR
      // 2. An experimental pdbId is present, OR
      // 3. A UniProt/Gene accession is present in metadata (AlphaFold/ESMFold warmup), OR
      // 4. ESM3 PDB text, folding energetics, or real analysis are populated.
      const hasStructureEvidence = Boolean(
        hasStructureCoordinates ||
        result.metadata?.pdbId ||
        result.metadata?.uniprotId ||
        (result.esm3Eval && "pdbText" in result.esm3Eval && result.esm3Eval.pdbText) ||
        realAnalysis ||
        result.foldingEnergetics
      );
      if (hasStructureEvidence) {
        return {
          status: "complete",
          desc: "AlphaFold, ESMFold & PDB 3D coordinates ready"
        };
      }
      return {
        status: "pending",
        desc: "PDB structure unavailable"
      };
    }

    if (view === "energetics") {
      const hasStructure = hasStructureCoordinates ||
                           Boolean(result.metadata?.uniprotId || result.metadata?.pdbId) ||
                           isBiophysicalLoading ||
                           isFolding ||
                           result.foldingEnergetics != null ||
                           result.dynamut2 != null ||
                           result.ddmut != null ||
                           result.biophysicalEnergetics != null ||
                           realAnalysis;
      if (!hasStructure) {
        return {
          status: "pending",
          desc: "Awaiting PDB structure coordinates..."
        };
      }

      const hasBiophysics = result.foldingEnergetics != null || result.dynamut2 != null || result.ddmut != null || result.biophysicalEnergetics != null;
      const isProgress = (isBiophysicalLoading || (isFolding && !hasBiophysics)) && !hasBiophysics && !realAnalysis;

      if (isProgress) {
        return {
          status: "progress",
          desc: isFolding ? "Modeling FoldX, DynaMut2 & DDMut stability..." : "Computing AI biophysical assessment..."
        };
      }

      if (hasBiophysics || realAnalysis) {
        /**
         * Each fallback now carries the engine it came from, so the value can be canonicalised before
         * it is printed.
         *
         * The previous form picked a raw number across engines whose native sign conventions differ —
         * DynaMut2 and DDMut are negative-destabilizing, FoldX and ThermoMPNN are not
         * (`engineStatus.ts:126`, `:135`) — and formatted it under one "ΔΔG" label. For a DynaMut2
         * value that inverted the meaning: a destabilizing variant printed as negative, i.e. as
         * stabilizing. `engineStatus.ts:212-214` states the rule this violated: every surface must
         * format a ΔΔG through `formatDdg`, so one value can never show two signs in two panels.
         */
        const ddgCandidates: Array<[EnergyEngineId, number | null | undefined]> = [
          ["foldx", result.foldingEnergetics?.foldx],
          ["dynamut2", result.foldingEnergetics?.dynamut2],
          ["ddmut", result.foldingEnergetics?.ddmut],
          ["thermompnn", result.foldingEnergetics?.thermompnn],
          ["dynamut2", result.dynamut2],
        ];
        const picked = ddgCandidates.find(([, raw]) => raw !== null && raw !== undefined);
        const canonicalDdg = picked ? toCanonicalDdg(picked[0], picked[1]) : null;
        const ddgText = canonicalDdg !== null
          ? `ΔΔG = ${canonicalDdg > 0 ? "+" : ""}${formatDdg(canonicalDdg)} · Biophysics ready`
          : "Biophysical stability models active · In-silico chips updating";
        return {
          status: "complete",
          desc: ddgText
        };
      }

      return {
        status: "pending",
        desc: "Energetics calculation unavailable"
      };
    }

    if (view === "landscape") {
      const count = result.landscapeData?.length ?? 0;
      if (count === 0) {
        if (isBiophysicalLoading) {
          return {
            status: "progress",
            desc: "Mapping spatial mutation density..."
          };
        }
        return {
          status: "pending",
          desc: "Landscape data unavailable"
        };
      }
      return {
        status: "complete",
        desc: `${count} residue positions mapped & scored`
      };
    }

    if (view === "insights") {
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

      if (realAnalysis || (result.insights && Object.keys(result.insights).length > 0)) {
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
      if (isClinicalLoading || isBiophysicalLoading) {
        return {
          status: "progress",
          desc: "Mining PubMed & Europe PMC citations..."
        };
      }
      return {
        status: "complete",
        desc: "PubMed & Europe PMC citations indexed"
      };
    }

    if (view === "report") {
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
