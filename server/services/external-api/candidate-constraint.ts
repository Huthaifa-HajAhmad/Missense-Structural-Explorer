/**
 * candidate-constraint.ts — the gene-constraint record read for the locus a run resolved to.
 *
 * A protein-only input can come from several single-base alleles, and the locus step keeps them all
 * rather than choosing one. A regional interval belongs to a POSITION, not to the base that changes
 * there, so each candidate is looked up on its own and the interval is reported only when every
 * candidate lands in the same one (alleles of one codon almost always do). If they split, nothing is
 * reported: no allele is picked to break the tie.
 */
import type { GnomadConstraintData, PredictorData } from "../../../src/shared/contracts.ts";
import { verifiedCandidateCoordinates, verifiedPopulationCoordinate } from "../prediction/predictors/allele-identity.ts";
import { alleleCandidatesToQuery } from "./candidate-frequencies.ts";
import { fetchGnomadGeneConstraint } from "./gnomad.ts";
import type { ConstraintIndex } from "./constraint-snapshot.ts";

/** One reading for all candidates: the shared one, or the same record with the regional reading withheld. */
function sharedReading(readings: ReadonlyArray<GnomadConstraintData | null>): GnomadConstraintData | null {
  const [first, ...rest] = readings;
  if (!first) return null;
  const sameInterval = rest.every(r => r !== null && r.regionalStatus === first.regionalStatus && r.regionalConstraint?.regionText === first.regionalConstraint?.regionText);
  return sameInterval ? first : { ...first, regionalStatus: "candidates-differ", regionalConstraint: null, pp2Code: null, isPP2Constrained: false };
}

export async function fetchRefinedGeneConstraint(
  gene: string,
  aaPos: number | null | undefined,
  pred: PredictorData | null | undefined,
  index?: ConstraintIndex,
): Promise<GnomadConstraintData | null> {
  const transcriptId = pred?.transcriptId;
  const candidates = alleleCandidatesToQuery(pred);
  const coordinates = candidates ? verifiedCandidateCoordinates(candidates) : null;
  if (!coordinates) return fetchGnomadGeneConstraint(gene, aaPos, { transcriptId, coordinate: verifiedPopulationCoordinate(pred), index });
  return sharedReading(await Promise.all(coordinates.map(coordinate => fetchGnomadGeneConstraint(gene, aaPos, { transcriptId, coordinate, index }))));
}
