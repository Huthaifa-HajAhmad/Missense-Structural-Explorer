import { parseGenomicCoordinateString, type PredictorData } from "../../../../src/shared/contracts.ts";
import type { AssemblyTaggedCoordinate } from "../../../../src/shared/assembly.ts";
import { LOCUS_POLICY_VERSION, type AlleleCandidate } from "../../../../src/shared/locusResolution.ts";

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

/**
 * The GRCh38 coordinate of every candidate allele of a protein-only input, or null when any candidate has
 * no verified GRCh38 id. Each allele keeps its own base: none is chosen.
 */
export function verifiedCandidateCoordinates(candidates: ReadonlyArray<AlleleCandidate>): AssemblyTaggedCoordinate[] | null {
  if (candidates.length === 0) return null;
  const coordinates: AssemblyTaggedCoordinate[] = [];
  for (const { id } of candidates) {
    // Same id normalization as `verifiedPopulationCoordinate`, so an id spelled with ":" or ">" reads the same on both paths.
    const parts = id?.trim().replace(/[:>/_]/g, "-").split("-") ?? [];
    const parsed = parts.length === 4 && /^\d+$/.test(parts[1]) ? parseGenomicCoordinateString(id!) : null;
    // A candidate is a single-base change (one base in, one base out), so the check is stricter than the single-allele path's.
    if (!parsed || !Number.isSafeInteger(parsed.pos) || !/^[ACGT]$/.test(parsed.ref) || !/^[ACGT]$/.test(parsed.alt) || parsed.ref === parsed.alt) return null;
    coordinates.push({ ...parsed, assembly: "GRCh38" });
  }
  return coordinates;
}
