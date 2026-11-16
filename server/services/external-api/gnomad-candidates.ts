/**
 * gnomad-candidates.ts — gnomAD read once per candidate allele of a protein-only input.
 *
 * When a protein change can come from several nucleotide alleles, the locus step keeps every
 * candidate (`locusResolution.candidates`) instead of choosing one. This module asks gnomAD r4 about
 * each candidate's GRCh38 id on its own and returns one reading per candidate. Nothing is summed or
 * merged here: the rule that reads these (`src/shared/candidateFrequency.ts`) applies a criterion only
 * when every candidate supports it.
 */
import type { GnomadCandidateReading, PredictorData } from "../../../src/shared/contracts.ts";
import { LOCUS_POLICY_VERSION, type AlleleCandidate } from "../../../src/shared/locusResolution.ts";
import { fetchGnomadVariantFrequency, type FetchGnomadFrequencyOptions } from "./gnomad.ts";

/** The candidates to query, or null when this run is not a current multiple-candidate run. */
export function alleleCandidatesToQuery(pred: PredictorData | null | undefined): AlleleCandidate[] | null {
  const trail = pred?.locusResolution;
  if (trail?.failureKind !== "multiple-candidates" || trail.policyVersion !== LOCUS_POLICY_VERSION) return null;
  return trail.candidates?.length ? trail.candidates : null;
}

/**
 * One gnomAD reading per candidate. A candidate without a verified GRCh38 id is not queried
 * (`not-lifted`); a failed query is recorded on that candidate (`failed`) rather than failing the rest.
 */
export async function fetchCandidateFrequencies(
  candidates: ReadonlyArray<AlleleCandidate>,
  options: Pick<FetchGnomadFrequencyOptions, "deadlineAt" | "cappedByCaller">,
): Promise<GnomadCandidateReading[]> {
  return Promise.all(candidates.map(async ({ id, grch37Id }): Promise<GnomadCandidateReading> => {
    if (!id) {
      return { id: null, grch37Id, outcome: "not-lifted", frequency: null, detail: "no verified GRCh38 position, so gnomAD r4 was not queried for this allele" };
    }
    // A per-candidate failure must stay on that candidate, so the other readings survive.
    return fetchGnomadVariantFrequency(id, { ...options, assembly: "GRCh38" }).then(
      (frequency): GnomadCandidateReading => frequency
        ? { id, grch37Id, outcome: "found", frequency }
        : { id, grch37Id, outcome: "not-found", frequency: null },
      (error: unknown): GnomadCandidateReading => ({
        id, grch37Id, outcome: "failed", frequency: null,
        detail: `the gnomAD query failed (${String((error as Error)?.message ?? error).slice(0, 120)})`,
      }),
    );
  }));
}
