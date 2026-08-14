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
  ddmutStatus?: string | null,
  isNarrativeLoading?: boolean
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
      // PDB text is held in the viewer/pipeline state rather than AnalysisResult.
      // AnalysisResult only carries structure evidence (for example ESM3 output),
      // so do not read a non-existent result.pdbText field here.
      const hasStructureEvidence = Boolean(
        result.metadata?.pdbId ||
        (result.esm3Eval && "pdbText" in result.esm3Eval && result.esm3Eval.pdbText) ||
        result.analysis ||
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
      const hasStructure = isBiophysicalLoading ||
                           result.foldingEnergetics != null ||
                           result.dynamut2 != null ||
                           result.ddmut != null ||
                           result.biophysicalEnergetics != null ||
                           result.analysis != null;
      if (!hasStructure) {
        return {
          status: "pending",
          desc: "Awaiting PDB structure coordinates..."
        };
      }

      const hasBiophysics = result.foldingEnergetics != null || result.dynamut2 != null || result.ddmut != null || result.biophysicalEnergetics != null;
      const isProgress = !!isBiophysicalLoading && !hasBiophysics && !result.analysis;

      if (isProgress) {
        return {
          status: "progress",
          desc: "Computing AI biophysical assessment..."
        };
      }

      if (hasBiophysics || result.analysis) {
        const ddgVal = result.foldingEnergetics?.foldx ?? result.foldingEnergetics?.dynamut2 ?? result.foldingEnergetics?.ddmut ?? result.foldingEnergetics?.thermompnn ?? result.dynamut2;
        const ddgText = ddgVal != null ? `ΔΔG = ${ddgVal > 0 ? "+" : ""}${ddgVal.toFixed(2)} kcal/mol · Biophysics ready` : "Gemini biophysical assessment ready · FoldX/DynaMut2/DDMut chips updating independently";
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
      const hasPrereq = result.clinvar != null || result.landscapeData != null || result.foldingEnergetics != null || result.biophysicalEnergetics != null;
      const isPrereqLoading = isBiophysicalLoading || isClinicalLoading;
      if (isPrereqLoading && !hasPrereq) {
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

      if (result.analysis) {
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

    if (view === "report") {
      if (!result.analysis && (isNarrativeLoading || isBiophysicalLoading || isClinicalLoading)) {
        return {
          status: "pending",
          desc: "Awaiting variant insights..."
        };
      }

      if (isNarrativeLoading) {
        return {
          status: "progress",
          desc: "Compiling clinical summary & evidence export..."
        };
      }

      if (result.analysis) {
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
