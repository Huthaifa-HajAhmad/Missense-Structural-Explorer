import { AnalysisResult } from "../types";

export function getWorkflowStageStatus(
  view: string,
  result: AnalysisResult | null | undefined,
  isFolding: boolean,
  isBiophysicalLoading: boolean,
  isClinicalLoading: boolean,
  isLoadingSearch?: boolean,
  loadingStep?: string,
  isPocketLoading?: boolean,
  dynamut2Status?: string | null,
  ddmutStatus?: string | null
): { status: "complete" | "progress" | "pending"; desc: string } {
  // Define default descriptions for stages
  const defaultDescs: Record<string, string> = {
    evidence: "ClinVar, gnomAD & ACMG rules engine",
    structure: "AlphaFold DB, ESMFold & PDB 3D templates",
    energetics: "FoldX, DynaMut2 & DDMut stability engines",
    landscape: "3D spatial mutation mapping & pocket impact",
    insights: "AI-driven variant interpretation narrative",
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
    if (view === "evidence") {
      const clinvarText = result.clinvar?.classification || "Annotated";
      return {
        status: "complete",
        desc: `ClinVar: ${clinvarText} · ACMG rules evaluated`
      };
    }

    if (view === "structure" || view === "structure_alphafold" || view === "structure_esmfold") {
      const isProgress = isFolding || !!isPocketLoading;
      return {
        status: isProgress ? "progress" : "complete",
        desc: isProgress
          ? (isFolding ? "Repacking mutant side-chains..." : "Running binding pocket solver...")
          : "AlphaFold, ESMFold & PDB 3D coordinates ready"
      };
    }

    if (view === "energetics") {
      const isDynamicPredictorActive =
        dynamut2Status === "pending" ||
        dynamut2Status === "running" ||
        ddmutStatus === "pending" ||
        ddmutStatus === "running";
      const hasBiophysics = result?.foldingEnergetics != null || result?.dynamut2 != null || result?.ddmut != null || result?.biophysicalEnergetics != null;

      const isProgress = isFolding || !!isBiophysicalLoading || isDynamicPredictorActive || !hasBiophysics;
      
      let activeDesc = "Calculating FoldX, DynaMut2, DDMut & ThermoMPNN energetics...";
      if (isFolding) {
        activeDesc = "Repacking mutant side-chains via FoldX force field...";
      } else if (dynamut2Status === "pending" || dynamut2Status === "running") {
        activeDesc = "Polling DynaMut2 normal mode analysis...";
      } else if (ddmutStatus === "pending" || ddmutStatus === "running") {
        activeDesc = "Running DDMut neural stability predictor...";
      } else if (isBiophysicalLoading) {
        activeDesc = "Calculating FoldX, DynaMut2, DDMut & ThermoMPNN energetics...";
      }

      const ddgVal = result.foldingEnergetics?.foldx ?? result.foldingEnergetics?.dynamut2 ?? result.foldingEnergetics?.ddmut ?? result.foldingEnergetics?.thermompnn ?? result.dynamut2;
      const ddgText = ddgVal != null ? `ΔΔG = ${ddgVal > 0 ? "+" : ""}${ddgVal.toFixed(2)} kcal/mol · Biophysics ready` : "FoldX, DynaMut2, DDMut & ThermoMPNN stability ready";

      return {
        status: isProgress ? "progress" : "complete",
        desc: isProgress ? activeDesc : ddgText
      };
    }


    if (view === "landscape") {
      const count = result.landscapeData?.length ?? 0;
      return {
        status: "complete",
        desc: `${count} residue positions mapped & scored`
      };
    }

    if (view === "insights" || view === "report") {
      const isProgress = !!isClinicalLoading || !result.analysis;
      return {
        status: isProgress ? "progress" : "complete",
        desc: isProgress
          ? (view === "insights" ? "Synthesizing pathogenicity & ACMG/AMP criteria..." : "Compiling clinical summary & evidence export...")
          : (view === "insights" ? "Variant interpretation consensus ready" : "Clinical summary & report compiled")
      };
    }

    return { status: "complete", desc: defaultDescs[view] || "" };
  }

  return { status: "pending", desc: defaultDescs[view] || "" };
}
