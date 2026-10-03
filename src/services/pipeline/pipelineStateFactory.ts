import type { BuildHint, CoordinateLiftRecord, NumberingChoice, NumberingRemapRecord } from "../../shared/contracts";
import { PDB_SOURCE_ALPHAFOLD } from "../../shared/contracts";
import type { GenomeAssembly } from "../../shared/variantNotation";

/**
 * The structure step's result before it has run, or when a result carries none.
 *
 * This was `{ level: "low", reason: "Default", plddt: 100 }`: a placeholder that read as a measured
 * low-disruption call at pLDDT 100, which the Energetics inspector and the clinical card display.
 */
export const DISRUPTION_NOT_ASSESSED = { level: "unknown" as const, reason: "Structural disruption has not been assessed.", plddt: null };

/**
 * The build decision a refusal was taken under, carried into the error state.
 *
 * Without it the UI can only say "read as GRCh38", which presents a DEFAULTED build as an established
 * one — the doctrine this whole feature exists to honour (`coordinateLift.buildDeclared` is the field
 * that distinguishes the two). The route already sends the trail with every failure; this is the hop
 * that was dropping it.
 */
export interface RefusalBuildTrail {
  assembly?: GenomeAssembly;
  resolvedAssembly?: GenomeAssembly;
  liftedGenomicCoordinates?: string | null;
  coordinateLift?: CoordinateLiftRecord | null;
  assemblyNote?: string;
}

/**
 * What a REFUSAL carries forward so the reader can answer it, rather than only read it.
 *
 * The members are answers the server composed: readings of an ambiguous notation, the alternative-build
 * spelling of a coordinate whose alleles matched no reference base, and the build decision itself. They
 * travel together because every error state that renders one must be able to render the others.
 */
export interface RefusalAttachments {
  numberingChoices?: NumberingChoice[];
  numberingNotation?: string;
  /** Alternative-build spelling of a refused coordinate — see `AnalysisResult.buildHint`. */
  buildHint?: BuildHint;
  /** The build the refusal was taken under, so the copy never asserts a defaulted build. */
  buildTrail?: RefusalBuildTrail;
}

/** Attachments a refusal asked the UI to render, in the shape every analysis result expects. */
function refusalAttachments(extra?: RefusalAttachments, fallbackVariant = "") {
  return {
    ...(extra?.numberingChoices?.length
      ? {
          numberingChoices: extra.numberingChoices,
          numberingNotation: extra.numberingNotation ?? fallbackVariant,
        }
      : {}),
    ...(extra?.buildHint ? { buildHint: extra.buildHint } : {}),
    ...(extra?.buildTrail ?? {}),
  };
}

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
    /**
     * Genome-build trail from the translation step: the build the SUBMITTED coordinate is in, the
     * build the annotation came from (they differ exactly when a lift was verified), the verified
     * canonical locus, and the decision itself. Carried like the numbering fields above, because a
     * placeholder that omits it makes a surface infer a build while the fine-grained data loads —
     * and a surface that infers a build is how a panel came to certify GRCh38 beside an HG19 chip.
     */
    assembly?: GenomeAssembly;
    resolvedAssembly?: GenomeAssembly;
    liftedGenomicCoordinates?: string | null;
    coordinateLift?: CoordinateLiftRecord | null;
  } | null;
}

/**
 * Numbering AND genome-build provenance, carried into every analysis result.
 *
 * Copied as a group because each factory below previously copied only the pre-existing
 * transcript fields, silently dropping anything the translation added — which is how the
 * structured remap record never reached a report while the code claimed it did. The build trail
 * joined the group for the same reason.
 */
function resultProvenance(
  transcriptMeta: PipelineStateBaseParams["transcriptMeta"],
  resResult?: {
    numberingVerified?: boolean | null;
    numberingUnverifiedReason?: string | null;
    assembly?: GenomeAssembly | null;
    resolvedAssembly?: GenomeAssembly | null;
    liftedGenomicCoordinates?: string | null;
    coordinateLift?: CoordinateLiftRecord | null;
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
    /**
     * Same two-source rule for the build trail: the translation step knows what the user submitted
     * and what the lift did; the analysis response echoes it. Absent everywhere stays absent — the
     * surfaces must render exactly what they rendered before, never a default build.
     *
     * Copied as a GROUP from ONE source. Falling back per field could pair `assembly` from the
     * translation meta with `resolvedAssembly` from the response, or a canonical locus with no
     * build at all — a trail that never existed, rendered as a verified lift.
     */
    ...((transcriptMeta?.assembly ?? transcriptMeta?.resolvedAssembly)
      ? {
          assembly: transcriptMeta?.assembly ?? undefined,
          resolvedAssembly: transcriptMeta?.resolvedAssembly ?? undefined,
          liftedGenomicCoordinates: transcriptMeta?.liftedGenomicCoordinates ?? undefined,
          coordinateLift: transcriptMeta?.coordinateLift ?? undefined,
        }
      : {
          assembly: resResult?.assembly ?? undefined,
          resolvedAssembly: resResult?.resolvedAssembly ?? undefined,
          liftedGenomicCoordinates: resResult?.liftedGenomicCoordinates ?? undefined,
          coordinateLift: resResult?.coordinateLift ?? undefined,
        }),
  };
}

/**
 * Standardized analysis version stamper.
 */
export function createAnalysisVersion(): AnalysisVersionInfo {
  return {
    thresholds: "Not recorded",
    geminiModel: "Not recorded",
    foldxVersion: "Not recorded",
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
      analysis: "",
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
      disruptionPredictor: { ...DISRUPTION_NOT_ASSESSED },
      uniprotFeatures: null,
      gnomadConstraint: null,
      transcriptId: transcriptMeta?.transcriptId,
      isManeSelect: transcriptMeta?.isManeSelect,
      isManePlusClinical: transcriptMeta?.isManePlusClinical,
      isCanonical: transcriptMeta?.isCanonical,
      maneRefSeqId: transcriptMeta?.maneRefSeqId,
      transcriptWarning: transcriptMeta?.transcriptWarning,
      ...resultProvenance(transcriptMeta),
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
      // Core evidence is not AI-authored prose. Optional synthesis owns this field.
      analysis: resResult.analysis || "",
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
      disruptionPredictor: resResult.disruptionPredictor || { ...DISRUPTION_NOT_ASSESSED },
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
      ...resultProvenance(transcriptMeta, resResult),
      gnomadFrequency: resResult.gnomadFrequency || null,
      aouFrequency: resResult.aouFrequency || null,
      // Carried so an empty All of Us row can name which absence it is (`aouAbsenceReason`).
      aouLookup: resResult.aouLookup ?? null,
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
  extra?: RefusalAttachments
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
      ...resultProvenance(transcriptMeta),
      /**
       * The refusal attachments go LAST, deliberately.
       *
       * `resultProvenance` always RETURNS the build-trail keys — with `undefined` values when neither
       * source has a trail — so spreading these BEFORE it let `undefined` overwrite a trail the refusal
       * had actually carried. That is exactly what the first version did; a test pins the order, because
       * the two spreads look interchangeable and are not.
       */
      ...refusalAttachments(extra, variant),
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
  extra?: RefusalAttachments
) {
  const { gene, variant, uniprotId, residueIndex, wildType, mutant } = params;

  return {
    isLoading: false,
    error: `Analysis query error: ${errorMessage || "Unknown error."}`,
    result: {
      isDemoData: false,
      ...refusalAttachments(extra, variant),
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
      disruptionPredictor: { ...DISRUPTION_NOT_ASSESSED },
      uniprotFeatures: null,
      gnomadConstraint: null,
      transcriptId: transcriptMeta?.transcriptId,
      isManeSelect: transcriptMeta?.isManeSelect,
      isManePlusClinical: transcriptMeta?.isManePlusClinical,
      isCanonical: transcriptMeta?.isCanonical,
      maneRefSeqId: transcriptMeta?.maneRefSeqId,
      transcriptWarning: transcriptMeta?.transcriptWarning,
      ...resultProvenance(transcriptMeta),
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
