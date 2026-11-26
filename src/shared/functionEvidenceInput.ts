import type { AnalysisResult } from "./contracts.ts";
import type { FunctionEvidenceInput } from "./functionEvidence.ts";
import { nativeInterfaceSupport } from "./interfacesEvidence.ts";
import { variantNumberingView } from "./numbering.ts";

/**
 * The one reading of an analysis result into `buildFunctionEvidence`'s input, shared by the tab, the
 * rail, the Insights consolidator and the Report document, so all of them see the same residue,
 * engine record and numbering basis.
 *
 * It lives in `src/shared` (the tab's own module re-exports it) because the Report's copy-as-text
 * path runs from the store, which may not import from `src/components`.
 */
/** A remap that kept the residue number is an isoform switch: the residue is numbered on canonical. */
function numberingBasisOf(r: any, meta: any): FunctionEvidenceInput["numberingBasis"] {
  const basis = r?.numberingBasis ?? meta.numberingBasis ?? null;
  if (basis !== "remapped") return basis;
  const view = variantNumberingView({ variant: meta.variant ?? "", uniprotId: meta.uniprotId, numberingRemap: r?.numberingRemap });
  return view.isoformSwitched ? "canonical" : basis;
}

export function functionEvidenceInputFrom(result: AnalysisResult): FunctionEvidenceInput {
  const r = result as any;
  const meta = r?.metadata ?? {};
  const residue = typeof meta.residueIndex === "number" ? meta.residueIndex : NaN;
  const interfaces = r?.multimerData
    ? nativeInterfaceSupport(r.multimerData, meta.gene ?? "This protein")
    : null;
  const interfaceAtResidue = interfaces?.status === "ok" && Number.isFinite(residue)
    ? (interfaces.byResidue.get(residue) ?? null)
    : null;
  return {
    gene: meta.gene ?? null,
    uniprotId: meta.uniprotId ?? null,
    residue,
    wildType: meta.wildType ?? null,
    mutant: meta.mutant ?? null,
    uniprot: r?.uniprotFeatures ?? null,
    serviceStatus: r?.serviceStatus?.uniprotFeatures ?? meta.serviceStatus?.uniprotFeatures ?? null,
    numberingBasis: numberingBasisOf(r, meta),
    uniprotIsoform: r?.uniprotIsoform ?? meta.uniprotIsoform ?? null,
    transcriptId: meta.transcriptId ?? r?.transcriptId ?? null,
    engineCriteria: r?.ruleBasedInsights?.acmgCriteria ?? r?.insights?.acmgCriteria ?? null,
    acmgWeighting: meta.acmgWeighting ?? null,
    regionalConstraint: r?.gnomadConstraint?.regionalConstraint ?? null,
    interfaceAtResidue,
  };
}
