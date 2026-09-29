import { isLocalDbnsfpAvailable, queryLocalDbnsfpVariant } from "./dbnsfp_local.ts";

/**
 * Population counts for one variant from the local dbNSFP build.
 *
 * The ingest sums gnomAD exome and genome counts into one AC / AN pair, so the only frequency this
 * source can state is the combined one. It used to be reported four times (maxAF, groupMaxAF,
 * genomeAF, exomeAF) with exome counts set to 0, which described an exome/genome split and a
 * per-ancestry maximum the data does not contain. Now: the combined AF is `maxAF`; `groupMaxAF`
 * carries the same value flagged as a fallback (the ACMG engine already words that case); the
 * per-cohort fields are null.
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
      groupMaxAFIsFallback: combinedAF !== null,
      genomeAF: null,
      exomeAF: null,
      genomeAC: null,
      exomeAC: null,
      genomeAN: null,
      exomeAN: null,
      combinedAC: rec.gnomad_ac,
      combinedAN: rec.gnomad_an,
      nHomozygous: rec.gnomad_hom,
      dataset: "gnomad_r4_local_combined"
    },
    aou: {
      aouAC: rec.aou_ac,
      aouAN: rec.aou_an,
      aouHet: rec.aou_het,
      aouHom: rec.aou_hom
    }
  };
}
