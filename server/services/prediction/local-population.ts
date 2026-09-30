import { isLocalDbnsfpAvailable, queryLocalDbnsfpVariant } from "./dbnsfp_local.ts";

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
  variant?: string | null
): Promise<{ gnomad: any | null; aou: any | null } | null> {
  if (!isLocalDbnsfpAvailable()) return null;
  const rec = await queryLocalDbnsfpVariant(gene, pos, null, null, variant);
  if (!rec) return null;

  const combinedAF = rec.gnomad_an ? (rec.gnomad_ac || 0) / rec.gnomad_an : null;
  return {
    gnomad: {
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
    },
    aou: {
      aouAC: rec.aou_ac,
      aouAN: rec.aou_an,
      aouHet: rec.aou_het,
      aouHom: rec.aou_hom
    }
  };
}
