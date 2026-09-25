import type { NumberingChoice, NumberingRemapRecord } from "../../shared/contracts";
import { PDB_SOURCE_ALPHAFOLD } from "../../shared/contracts";

export interface AnalysisVersionInfo {
  thresholds: string;
  geminiModel: string;
  foldxVersion: string;
  timestamp: string;
}

export interface PipelineStateBaseParams {
  gene: string;
  variant: string;
  uniprotId: string;
  residueIndex?: number | null;
  wildType?: string;
  mutant?: string;
  transcriptMeta?: {
    transcriptId?: string;
    isManeSelect?: boolean;
    isManePlusClinical?: boolean;
    isCanonical?: boolean;
    maneRefSeqId?: string;
    transcriptWarning?: string;
    /** UniProt isoform the analysed residue numbers belong to. */
    uniprotIsoform?: string;
    /** How that numbering basis was established: canonical | remapped | unverified. */
    numberingBasis?: string;
    numberingVerified?: boolean | null;
    numberingUnverifiedReason?: string | null;
    /** Record of a MANE → canonical renumbering, for reports that must state both notations. */
    numberingRemap?: NumberingRemapRecord | null;
  } | null;
}

/**
 * Numbering provenance carried into every analysis result.
 *
 * Copied as a group because each factory below previously copied only the pre-existing
 * transcript fields, silently dropping anything the translation added — which is how the
 * structured remap record never reached a report while the code claimed it did.
 */
function numberingProvenance(
  transcriptMeta: PipelineStateBaseParams["transcriptMeta"],
  resResult?: {
    numberingVerified?: boolean | null;
    numberingUnverifiedReason?: string | null;
  }
) {
  return {
    uniprotIsoform: transcriptMeta?.uniprotIsoform,
    numberingBasis: transcriptMeta?.numberingBasis,
    numberingRemap: transcriptMeta?.numberingRemap,
    // The analysis route reports whether it could verify the numbering across isoforms; the
    // translation meta carries it when the notation itself declared a basis. Either may be the
    // only source, so both are consulted.
    numberingVerified:
      transcriptMeta?.numberingVerified ?? resResult?.numberingVerified ?? undefined,
    numberingUnverifiedReason:
      transcriptMeta?.numberingUnverifiedReason ?? resResult?.numberingUnverifiedReason ?? undefined,
  };
}

/**
 * Standardized analysis version stamper.
 */
export function createAnalysisVersion(): AnalysisVersionInfo {
  return {
    thresholds: "ACMG v1.0.0-concordance",
    geminiModel: "gemini-3.5-flash",
    foldxVersion: "FoldX 5.0",
    timestamp: new Date().toISOString()
  };
}

/**
 * Generates the initial placeholder state when 3D structure warms up before biophysics completes.
 */
export function createPlaceholderAnalysisState(params: PipelineStateBaseParams) {
  const { gene, variant, uniprotId, residueIndex, wildType, mutant, transcriptMeta } = params;

  return {
    isLoading: false,
    error: null,
    result: {
      analysis: "Biophysical analysis in progress...",
      insights: null,
      isDemoData: false,
      ruleBasedInsights: null,
      metadata: {
        gene,
        variant,
        uniprotId,
        residueIndex: residueIndex ?? null,
        wildType: wildType || "",
        mutant: mutant || "",
        analysisVersion: createAnalysisVersion()
      },
      predictorData: null,
      conservationData: null,
      landscapeData: null,
      stringInteractions: null,
      disruptionPredictor: { level: "low" as const, reason: "Default", plddt: 100 },
      uniprotFeatures: null,
      gnomadConstraint: null,
      transcriptId: transcriptMeta?.transcriptId,
      isManeSelect: transcriptMeta?.isManeSelect,
      isManePlusClinical: transcriptMeta?.isManePlusClinical,
      isCanonical: transcriptMeta?.isCanonical,
      maneRefSeqId: transcriptMeta?.maneRefSeqId,
      transcriptWarning: transcriptMeta?.transcriptWarning,
      ...numberingProvenance(transcriptMeta),
      gnomadFrequency: null,
      aouFrequency: null,
      esm2: null,
      esm3Eval: null,
      esmcEval: null,
      esm2Eval: null,
      saprotEval: null
    }
  };
}

/**
 * Generates the completed state once multi-model biophysical evaluation resolves.
 */
export function createCompletedAnalysisState(resResult: any, params: PipelineStateBaseParams) {
  const { gene, variant, uniprotId, residueIndex, wildType, mutant, transcriptMeta } = params;

  return {
    isLoading: false,
    error: null,
    result: {
      analysis: resResult.analysis || "Analysis completed.",
      insights: resResult.insights || null,
      isDemoData: false,
      ruleBasedInsights: resResult.ruleBasedInsights || null,
      metadata: {
        gene,
        variant,
        uniprotId,
        residueIndex: residueIndex ?? null,
        wildType: wildType || "",
        mutant: mutant || "",
        analysisVersion: createAnalysisVersion(),
        ...(resResult.metadata || {})
      },
      predictorData: resResult.predictorData || null,
      conservationData: resResult.conservationData || null,
      landscapeData: null,
      stringInteractions: resResult.stringInteractions || null,
      disruptionPredictor: resResult.disruptionPredictor || { level: "low" as const, reason: "Default", plddt: 100 },
      uniprotFeatures: resResult.uniprotFeatures,
      gnomadConstraint: resResult.gnomadConstraint,
      transcriptId: transcriptMeta?.transcriptId ?? resResult.predictorData?.transcriptId,
      isManeSelect: transcriptMeta?.isManeSelect ?? resResult.predictorData?.isManeSelect,
      isManePlusClinical: transcriptMeta?.isManePlusClinical ?? resResult.predictorData?.isManePlusClinical,
      isCanonical: transcriptMeta?.isCanonical ?? resResult.predictorData?.isCanonical,
      maneRefSeqId: transcriptMeta?.maneRefSeqId ?? resResult.predictorData?.maneRefSeqId,
      transcriptWarning: transcriptMeta?.transcriptWarning ?? resResult.transcriptWarning,
      // The server's numbering verification travels with the result, so an unverified numbering is
      // disclosed on screen and cited in the export instead of looking like a clean match.
      ...numberingProvenance(transcriptMeta, resResult),
      gnomadFrequency: resResult.gnomadFrequency || null,
      aouFrequency: resResult.aouFrequency || null,
      esm2: resResult.esm2 || null,
      esm3Eval: { loading: true },
      esmcEval: { loading: true },
      esm2Eval: { loading: true },
      saprotEval: { loading: true }
    }
  };
}

/**
 * Generates a graceful biophysical error state if predictor query fails.
 */
export function createBiophysicalErrorAnalysisState(
  errorMessage: string,
  params: PipelineStateBaseParams,
  /**
   * The readings of a notation that could not be resolved by residue number alone. The biophysical
   * catch is where the analysis refusal actually lands (`fetchBiophysicalAnalysis` rejects and is
   * consumed by a `.catch`, never by an enclosing try), so the choice has to be attached HERE.
   */
  extra?: { numberingChoices?: NumberingChoice[]; numberingNotation?: string }
) {
  const { gene, variant, uniprotId, residueIndex, wildType, mutant, transcriptMeta } = params;

  return {
    isLoading: false,
    error: `Biophysical predictor data query failed: ${errorMessage || "Unknown error"}`,
    result: {
      analysis: "Biophysical analysis data unavailable.",
      insights: null,
      isDemoData: false,
      ruleBasedInsights: null,
      ...(extra?.numberingChoices?.length
        ? {
            numberingChoices: extra.numberingChoices,
            numberingNotation: extra.numberingNotation ?? variant,
          }
        : {}),
      metadata: {
        gene,
        variant,
        uniprotId,
        residueIndex: residueIndex ?? null,
        wildType: wildType || "",
        mutant: mutant || "",
        analysisVersion: createAnalysisVersion()
      },
      predictorData: null,
      conservationData: null,
      landscapeData: null,
      stringInteractions: null,
      disruptionPredictor: { level: "unknown" as const, reason: "Analysis query failed", plddt: null },
      uniprotFeatures: null,
      gnomadConstraint: null,
      transcriptId: transcriptMeta?.transcriptId,
      isManeSelect: transcriptMeta?.isManeSelect,
      isManePlusClinical: transcriptMeta?.isManePlusClinical,
      isCanonical: transcriptMeta?.isCanonical,
      maneRefSeqId: transcriptMeta?.maneRefSeqId,
      transcriptWarning: transcriptMeta?.transcriptWarning,
      ...numberingProvenance(transcriptMeta),
      gnomadFrequency: null,
      aouFrequency: null,
      esm2: null,
      esm3Eval: null,
      esmcEval: null,
      esm2Eval: null,
      saprotEval: null
    }
  };
}

/**
 * Generates a top-level error state with diagnostics and ACMG placeholders.
 */
export function createTopLevelErrorAnalysisState(
  errorMessage: string,
  params: PipelineStateBaseParams,
  /**
   * The readings of a notation that could not be resolved by residue number alone. Passed through to
   * the result so the UI can offer a choice: the refusal is a question, and a question with no way to
   * answer it is just a dead end.
   */
  extra?: { numberingChoices?: NumberingChoice[]; numberingNotation?: string }
) {
  const { gene, variant, uniprotId, residueIndex, wildType, mutant } = params;

  return {
    isLoading: false,
    error: `Analysis query error: ${errorMessage || "Unknown error."}`,
    result: {
      isDemoData: false,
      ...(extra?.numberingChoices?.length
        ? {
            numberingChoices: extra.numberingChoices,
            numberingNotation: extra.numberingNotation ?? variant,
          }
        : {}),
      metadata: {
        gene,
        variant,
        uniprotId,
        residueIndex: residueIndex ?? null,
        wildType: wildType || "",
        mutant: mutant || "",
        pdbId: null,
        pdbSource: PDB_SOURCE_ALPHAFOLD,
        analysisVersion: createAnalysisVersion()
      },
      insights: {
        biochemicalShift: `⚠️ **Biochemical Shift Unavailable** (${errorMessage || "Failed"})`,
        structuralImpact: `⚠️ **Structural Impact Unavailable** (${errorMessage || "Failed"})`,
        acmgCriteria: [],
        plausibility: ""
      }
    }
  };
}

/**
 * Generates a precomputed demo fallback state.
 */
export function createDemoFallbackAnalysisState(
  analysisText: string,
  insights: any,
  params: PipelineStateBaseParams
) {
  const { gene, variant, uniprotId, residueIndex, wildType, mutant, transcriptMeta } = params;

  return {
    isLoading: false,
    error: null,
    result: {
      analysis: analysisText,
      insights: insights || null,
      isDemoData: true,
      ruleBasedInsights: null,
      metadata: {
        gene,
        variant,
        uniprotId,
        residueIndex: residueIndex ?? null,
        wildType: wildType || "",
        mutant: mutant || "",
        analysisVersion: createAnalysisVersion()
      },
      predictorData: null,
      conservationData: null,
      landscapeData: null,
      stringInteractions: null,
      disruptionPredictor: { level: "low" as const, reason: "Default", plddt: 100 },
      uniprotFeatures: null,
      gnomadConstraint: null,
      transcriptId: transcriptMeta?.transcriptId,
      isManeSelect: transcriptMeta?.isManeSelect,
      isManePlusClinical: transcriptMeta?.isManePlusClinical,
      isCanonical: transcriptMeta?.isCanonical,
      maneRefSeqId: transcriptMeta?.maneRefSeqId,
      transcriptWarning: transcriptMeta?.transcriptWarning,
      ...numberingProvenance(transcriptMeta),
      gnomadFrequency: null,
      aouFrequency: null,
      esm2: null,
      esm3Eval: null,
      esmcEval: null,
      esm2Eval: null,
      saprotEval: null
    }
  };
}
