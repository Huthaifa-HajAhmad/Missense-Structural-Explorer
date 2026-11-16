/**
 * allele-candidates.ts — the candidate alleles of a protein-only input.
 *
 * Some protein changes can come from more than one single-base change at the same codon (FGFR3
 * p.Gly380Arg: codon GGG, so G>A and G>C both give Arg). The person carries one of them and the input
 * does not say which, so no allele is selected: every candidate is lifted to GRCh38 on its own and
 * later queried on its own (`server/services/external-api/gnomad-candidates.ts`).
 */
import type { AlleleCandidate, LocusResolutionStep } from "../../../../src/shared/locusResolution.ts";
import { recoverCanonicalLocus, type DbnsfpGrch38 } from "./locus-resolver.ts";

/**
 * True when every id ("chrom-pos-ref-alt") sits on one chromosome within three bases: the alleles of
 * one codon. Matches further apart are other loci whose isoform numbering coincides, not candidates.
 */
export function withinOneCodon(ids: string[]): boolean {
  const parsed = ids.map(id => id.split("-"));
  const positions = parsed.map(p => Number(p[1]));
  return new Set(parsed.map(p => p[0])).size === 1 && Math.max(...positions) - Math.min(...positions) <= 2;
}

/**
 * Lift each GRCh37 candidate to GRCh38 with the same verified routes a single allele uses.
 * A candidate that cannot be lifted keeps `id: null`, and a step names it in the trail.
 */
export async function liftAlleleCandidates(
  loci: ReadonlyArray<[string, DbnsfpGrch38 | null]>,
  steps: LocusResolutionStep[],
): Promise<AlleleCandidate[]> {
  return Promise.all(loci.map(async ([grch37Id, own]) => {
    const recovered = await recoverCanonicalLocus(grch37Id, own);
    const lifted = recovered.assembly === "GRCh38" && recovered.canonicalBy !== null;
    if (!lifted) {
      steps.push({ step: "ensembl-lift", outcome: "failed", detail: `candidate GRCh37 ${grch37Id}: no verified GRCh38 position${recovered.retryable ? " (temporary failure)" : ""}` });
    }
    return {
      grch37Id,
      id: lifted ? recovered.id : null,
      canonicalBy: lifted ? recovered.canonicalBy as AlleleCandidate["canonicalBy"] : null,
      retryable: !lifted && recovered.retryable,
    };
  }));
}
