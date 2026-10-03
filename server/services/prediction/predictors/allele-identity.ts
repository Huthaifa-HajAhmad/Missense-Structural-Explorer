import { parseGenomicCoordinateString, type PredictorData } from "../../../../src/shared/contracts.ts";
import type { AssemblyTaggedCoordinate } from "../../../../src/shared/assembly.ts";
import { LOCUS_POLICY_VERSION } from "../../../../src/shared/locusResolution.ts";

/** Cohort evidence requires a verified canonical identity, not a protein-selected database row. */
export function verifiedPopulationCoordinate(pred: PredictorData | null | undefined): AssemblyTaggedCoordinate | null {
  if (!pred?.gnomadVariantId || pred.gnomadVariantAssembly !== "GRCh38") return null;
  const trail = pred.locusResolution;
  const fallback = trail?.route === "fallback" || /Fallback|MyVariant|dbNSFP/i.test(pred.source ?? "");
  if (fallback && (!trail || trail.policyVersion !== LOCUS_POLICY_VERSION || !trail.canonicalBy)) return null;
  if (trail && (trail.retryable || !trail.canonicalBy || trail.failureKind === "ambiguous-allele" ||
      trail.failureKind === "incomplete-evidence" || trail.failureKind === "invalid-notation")) return null;
  // The shared parser historically uses parseInt; enforce the complete numeric token here.
  const parts = pred.gnomadVariantId.trim().replace(/[:>/_]/g, "-").split("-");
  if (parts.length !== 4 || !/^\d+$/.test(parts[1])) return null;
  const parsed = parseGenomicCoordinateString(pred.gnomadVariantId);
  if (!parsed || !Number.isSafeInteger(parsed.pos) || !/^[ACGT]+$/.test(parsed.ref) ||
      !/^[ACGT]+$/.test(parsed.alt) || parsed.ref === parsed.alt) return null;
  return { ...parsed, assembly: "GRCh38" };
}
