import type { AnalysisResult } from "../../../types";
import type { FunctionEvidenceInput } from "../../../shared/functionEvidence";

/**
 * The one reading of an analysis result into `buildFunctionEvidence`'s input, shared by the tab and
 * the rail so both see the same residue, engine record and numbering basis.
 */
export function functionEvidenceInputFrom(result: AnalysisResult): FunctionEvidenceInput {
  const r = result as any;
  const meta = r?.metadata ?? {};
  return {
    gene: meta.gene ?? null,
    uniprotId: meta.uniprotId ?? null,
    residue: typeof meta.residueIndex === "number" ? meta.residueIndex : NaN,
    wildType: meta.wildType ?? null,
    mutant: meta.mutant ?? null,
    uniprot: r?.uniprotFeatures ?? null,
    serviceStatus: r?.serviceStatus?.uniprotFeatures ?? meta.serviceStatus?.uniprotFeatures ?? null,
    numberingBasis: r?.numberingBasis ?? meta.numberingBasis ?? null,
    uniprotIsoform: r?.uniprotIsoform ?? meta.uniprotIsoform ?? null,
    transcriptId: meta.transcriptId ?? r?.transcriptId ?? null,
    engineCriteria: r?.ruleBasedInsights?.acmgCriteria ?? r?.insights?.acmgCriteria ?? null,
    acmgWeighting: meta.acmgWeighting ?? null,
  };
}
