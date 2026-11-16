/**
 * candidate-frequencies.ts — population frequencies read once per candidate allele of a protein-only
 * input: gnomAD r4 (remote) and All of Us (the local dbNSFP store, when installed).
 *
 * When a protein change can come from several nucleotide alleles, the locus step keeps every
 * candidate (`locusResolution.candidates`) instead of choosing one. This module reads each candidate's
 * GRCh38 allele on its own and returns one reading per candidate. Nothing is summed or merged here:
 * the rule that reads these (`src/shared/candidateFrequency.ts`) applies a criterion only when every
 * candidate supports it. All of Us is shown per allele and feeds no criterion.
 */
import type { CandidateAllOfUs, GnomadCandidateReading, PredictorData } from "../../../src/shared/contracts.ts";
import { LOCUS_POLICY_VERSION, type AlleleCandidate } from "../../../src/shared/locusResolution.ts";
import { fetchLocalPopulationFrequencies } from "../prediction/landscape.ts";
import { fetchGnomadVariantFrequency, type FetchGnomadFrequencyOptions } from "./gnomad.ts";

/** The candidates to query, or null when this run is not a current multiple-candidate run. */
export function alleleCandidatesToQuery(pred: PredictorData | null | undefined): AlleleCandidate[] | null {
  const trail = pred?.locusResolution;
  if (trail?.failureKind !== "multiple-candidates" || trail.policyVersion !== LOCUS_POLICY_VERSION) return null;
  return trail.candidates?.length ? trail.candidates : null;
}

/** What the local store lookup needs besides the allele; null when no local store is installed. */
export interface LocalStoreQuery { gene: string; pos: number; variant: string }

/** One candidate's All of Us counts from the local store, or why there are none. */
async function readAllOfUs(id: string, local: LocalStoreQuery | null): Promise<CandidateAllOfUs> {
  if (!local) return { localTable: "not-installed", frequency: null };
  const [chrom, pos, ref, alt] = id.split("-");
  const coordinate = { chrom, pos: Number(pos), ref, alt, assembly: "GRCh38" as const };
  return fetchLocalPopulationFrequencies(local.gene, local.pos, local.variant, coordinate).then(
    (rows): CandidateAllOfUs => rows?.aou ? { localTable: "found", frequency: rows.aou } : { localTable: "absent", frequency: null },
    (): CandidateAllOfUs => ({ localTable: "failed", frequency: null }),
  );
}

/** One gnomAD reading for one lifted candidate. A failed query stays on that candidate. */
async function readGnomad(
  id: string,
  grch37Id: string | null,
  options: Pick<FetchGnomadFrequencyOptions, "deadlineAt" | "cappedByCaller">,
): Promise<GnomadCandidateReading> {
  return fetchGnomadVariantFrequency(id, { ...options, assembly: "GRCh38" }).then(
    (frequency): GnomadCandidateReading => frequency
      ? { id, grch37Id, outcome: "found", frequency }
      : { id, grch37Id, outcome: "not-found", frequency: null },
    (error: unknown): GnomadCandidateReading => ({
      id, grch37Id, outcome: "failed", frequency: null,
      detail: `the gnomAD query failed (${String((error as Error)?.message ?? error).slice(0, 120)})`,
    }),
  );
}

/**
 * One reading per candidate. A candidate without a verified GRCh38 id is not queried (`not-lifted`);
 * a failed query is recorded on that candidate rather than failing the rest.
 */
export async function fetchCandidateFrequencies(
  candidates: ReadonlyArray<AlleleCandidate>,
  options: Pick<FetchGnomadFrequencyOptions, "deadlineAt" | "cappedByCaller">,
  local: LocalStoreQuery | null = null,
): Promise<GnomadCandidateReading[]> {
  return Promise.all(candidates.map(async ({ id, grch37Id }): Promise<GnomadCandidateReading> => {
    if (!id) {
      return { id: null, grch37Id, outcome: "not-lifted", frequency: null, detail: "no verified GRCh38 position, so gnomAD r4 was not queried for this allele" };
    }
    const [gnomad, allOfUs] = await Promise.all([readGnomad(id, grch37Id, options), readAllOfUs(id, local)]);
    return { ...gnomad, allOfUs };
  }));
}
