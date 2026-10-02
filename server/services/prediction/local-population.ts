import { isLocalDbnsfpAvailable, queryLocalDbnsfpVariant } from "./dbnsfp_local.ts";
import type { AssemblyTaggedCoordinate } from "../../../src/shared/assembly.ts";

function validCohortCounts(ac: number | null | undefined, an: number | null | undefined,
  hom: number | null | undefined, het: number | null | undefined, diploidAutosome: boolean): boolean {
  const counts = [ac, an, hom, het];
  if (counts.some(v => v != null && (!Number.isSafeInteger(v) || v < 0))) return false;
  if (ac != null && an != null && ac > an) return false;
  // Only autosomes support the complete diploid Het + 2*Hom identity. Sex chromosomes and
  // mitochondria can contain unreported hemizygous copies; reported Hom need not mean two copies.
  // For those contigs each reported alternate carrier only establishes a one-copy lower bound.
  const carrierCopies = (het ?? 0) + (diploidAutosome ? 2 : 1) * (hom ?? 0);
  if (ac != null && carrierCopies > ac) return false;
  if (an != null && carrierCopies > an) return false;
  if (diploidAutosome && hom != null && het != null && ac != null && carrierCopies !== ac) return false;
  // Conservatively withhold an internally contradictory cohort rather than selecting which
  // count field to trust. Independent valid cohorts remain usable.
  return true;
}

/**
 * Population counts for one variant from the local dbNSFP build.
 *
 * The ingest sums gnomAD exome and genome counts into one AC / AN pair, so the only frequency this
 * source can state is the combined one. The consumer (`src/shared/frequencyEvidence.ts`) recognises
 * this source by `dataset === "gnomad_r4_local"` and reads the combined figures from `maxAF`,
 * `genomeAC` and `genomeAN` as ONE "cohorts combined" row. So those carry the combined values, the
 * exome fields are null (they used to be 0 with exomeAF set to the combined AF, which described an
 * exome cohort the data does not have). `groupMaxAF` carries the combined AF, as before; it is not
 * flagged `groupMaxAFIsFallback`, whose ACMG note names low ancestry counts as the cause, which is
 * not why this source has no per-ancestry maximum.
 */
export async function fetchLocalPopulationFrequencies(
  gene: string,
  pos: number,
  variant?: string | null,
  coordinate?: AssemblyTaggedCoordinate | null
): Promise<{ gnomad: any | null; aou: any | null; aouInvalidCounts?: boolean } | null> {
  // Population observations are allele-keyed, not protein-substitution scores. The caller must
  // first establish a canonical identity; an arbitrary matching protein row cannot do that.
  if (!coordinate || coordinate.assembly !== "GRCh38" ||
      !/^(?:chr)?(?:[1-9]|1\d|2[0-2]|X|Y|M|MT)$/i.test(coordinate.chrom) ||
      !Number.isSafeInteger(coordinate.pos) || coordinate.pos <= 0 || coordinate.pos > 400_000_000 ||
      !/^[ACGT]+$/i.test(coordinate.ref) || !/^[ACGT]+$/i.test(coordinate.alt) ||
      coordinate.ref.toUpperCase() === coordinate.alt.toUpperCase() || !isLocalDbnsfpAvailable()) return null;
  const rec = await queryLocalDbnsfpVariant(gene, pos, coordinate.ref, coordinate.alt, variant, coordinate);
  if (!rec) return null;

  // Invalid counts are not observations (and must not prevent a remote gnomAD lookup).
  const diploidAutosome = /^(?:chr)?(?:[1-9]|1\d|2[0-2])$/i.test(coordinate.chrom);
  const validGnomad = validCohortCounts(rec.gnomad_ac, rec.gnomad_an, rec.gnomad_hom, null, diploidAutosome);
  const validAou = validCohortCounts(rec.aou_ac, rec.aou_an, rec.aou_hom, rec.aou_het, diploidAutosome);
  const combinedAF = validGnomad && rec.gnomad_ac != null && rec.gnomad_an != null && rec.gnomad_an > 0
    ? rec.gnomad_ac / rec.gnomad_an : null;
  const hasGnomad = validGnomad && [rec.gnomad_ac, rec.gnomad_an, rec.gnomad_hom].some(v => v != null);
  const hasAou = validAou && [rec.aou_ac, rec.aou_an, rec.aou_het, rec.aou_hom].some(v => v != null);
  return {
    ...(!validAou ? { aouInvalidCounts: true } : {}),
    gnomad: hasGnomad ? {
      maxAF: combinedAF,
      groupMaxAF: combinedAF,
      genomeAF: combinedAF,
      exomeAF: null,
      genomeAC: rec.gnomad_ac,
      exomeAC: null,
      genomeAN: rec.gnomad_an,
      exomeAN: null,
      nHomozygous: rec.gnomad_hom,
      dataset: "gnomad_r4_local"
    } : null,
    aou: hasAou ? {
      aouAC: rec.aou_ac,
      aouAN: rec.aou_an,
      aouHet: rec.aou_het,
      aouHom: rec.aou_hom
    } : null
  };
}
