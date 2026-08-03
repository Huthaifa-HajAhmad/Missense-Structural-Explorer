import { normalizeGeneSymbol, fetchWithRetry } from "./http-client.ts";
import { gnomadFreqCache, gnomadConstraintCache } from "./cache.ts";


export interface GnomadVariantFrequency {
  /** Max allele frequency across gnomAD v4 sub-populations */
  maxAF: number | null;
  /** Ancestry-specific max allele frequency for reliable groups (AN >= 2000) */
  groupMaxAF: number | null;
  /** gnomAD v4 genome AF (global) */
  genomeAF: number | null;
  /** gnomAD v4 exome AF (global) */
  exomeAF: number | null;
  /** gnomAD v4 genome Allele Count (raw count) */
  genomeAC: number | null;
  /** gnomAD v4 exome Allele Count (raw count) */
  exomeAC: number | null;
  /** gnomAD v4 genome Allele Number (total alleles observed) */
  genomeAN: number | null;
  /** gnomAD v4 exome Allele Number (total alleles observed) */
  exomeAN: number | null;
  /** Number of homozygous individuals in gnomAD (relevant for recessive disorders) */
  nHomozygous: number | null;
  /** Dataset used */
  dataset: string;
  /** Whether groupMaxAF fell back to global maxAF due to low population counts */
  groupMaxAFIsFallback?: boolean;
}

/**
 * Query gnomAD GraphQL API for variant allele frequencies.
 *
 * @param variantId  gnomAD variant ID in the form "CHR-POS-REF-ALT" (GRCh38).
 *                   If not known, pass null and the function returns null.
 */
export async function fetchGnomadVariantFrequency(
  variantId: string | null
): Promise<GnomadVariantFrequency | null> {
  if (!variantId) return null;

  const cached = gnomadFreqCache.get(variantId);
  if (cached !== undefined) return cached;

  const query = `
    query VariantFrequency($variantId: String!) {
      variant(variantId: $variantId, dataset: gnomad_r4) {
        variant_id
        genome {
          ac
          an
          af
          homozygote_count
          populations {
            id
            ac
            an
          }
        }
        exome {
          ac
          an
          af
          homozygote_count
          populations {
            id
            ac
            an
          }
        }
      }
    }
  `;

  try {
    const resp = await fetchWithRetry(
      "https://gnomad.broadinstitute.org/api",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables: { variantId } }),
        timeout: 15000,
      },
      2,
      1500
    );

    if (!resp.ok) {
      console.warn(`[gnomAD Freq] API responded ${resp.status} for variant ${variantId}`);
      return null;
    }

    const json = await resp.json();
    const v = json?.data?.variant;
    if (!v) {
      console.warn(`[gnomAD Freq] No variant data returned for ${variantId}`);
      return null;
    }

    const genomeAF: number | null = v.genome?.af ?? null;
    const exomeAF:  number | null = v.exome?.af  ?? null;
    const genomeAC: number | null = v.genome?.ac ?? null;
    const exomeAC:  number | null = v.exome?.ac  ?? null;
    const genomeAN: number | null = v.genome?.an ?? null;
    const exomeAN:  number | null = v.exome?.an  ?? null;
    // NOTE (High #gnomAD-homozygotes): gnomAD v4 uses disjoint cohorts — whole-genome and
    // whole-exome individuals are not shared between datasets.  Summing homozygote_count
    // across genome and exome is therefore the correct approach and does NOT double-count.
    // Ref: gnomAD v4 release notes, Nov 2023 (https://gnomad.broadinstitute.org/news/2023-11-gnomad-v4-0).
    const nHomozygous: number | null =
      (v.genome?.homozygote_count != null || v.exome?.homozygote_count != null)
        ? (v.genome?.homozygote_count ?? 0) + (v.exome?.homozygote_count ?? 0)
        : null;

    const maxAF =
      genomeAF !== null && exomeAF !== null ? Math.max(genomeAF, exomeAF) :
      genomeAF !== null ? genomeAF :
      exomeAF  !== null ? exomeAF  : null;

    // Compute ancestry-specific groupMaxAF (AN >= 2000)
    const populations: { id: string; ac: number; an: number; af: number }[] = [];
    if (v.genome?.populations) {
      for (const p of v.genome.populations) {
        populations.push({
          id: p.id,
          ac: p.ac,
          an: p.an,
          af: p.an > 0 ? p.ac / p.an : 0
        });
      }
    }
    if (v.exome?.populations) {
      for (const p of v.exome.populations) {
        populations.push({
          id: p.id,
          ac: p.ac,
          an: p.an,
          af: p.an > 0 ? p.ac / p.an : 0
        });
      }
    }

    const validPops = populations.filter(p => p.an >= 2000 && p.af !== null && p.af !== undefined);
    let groupMaxAF: number | null = null;
    let groupMaxAFIsFallback = false;
    if (validPops.length > 0) {
      let maxVal = 0;
      for (const p of validPops) {
        if (p.af > maxVal) {
          maxVal = p.af;
        }
      }
      groupMaxAF = maxVal;
    } else {
      // NOTE (High #gnomAD-groupMaxAF-fallback): No population had AN >= 2000 (all too small to
      // trust AF estimates for ACMG PS4/PM2/BS1/BA1 evaluation).  Falling back to global maxAF.
      // Callers should be aware this is a coarser estimate; the fallback is logged to surface it.
      console.warn(`[gnomAD] No populations with AN >= 2000 for variant ${variantId}; groupMaxAF falling back to global maxAF (${maxAF}).`);
      groupMaxAF = maxAF;
      groupMaxAFIsFallback = true;
    }

    const result: GnomadVariantFrequency = {
      maxAF,
      groupMaxAF,
      genomeAF,
      exomeAF,
      genomeAC,
      exomeAC,
      genomeAN,
      exomeAN,
      nHomozygous,
      dataset: "gnomad_r4",
      groupMaxAFIsFallback,
    };

    gnomadFreqCache.set(variantId, result);
    return result;
  } catch (err: any) {
    console.error(`[gnomAD Freq] Error fetching ${variantId}:`, err.message);
    return null;
  }
}

export interface GnomadGeneConstraint {
  missense_z: number | null;
  oe_mis: number | null;
  pli: number | null;
  loeuf: number | null;
  isPP2Constrained: boolean;
  regions?: any[];
  hasRegionalData?: boolean;
  regionalConstraint?: {
    isConstrained: boolean;
    oeRatio: number | null;
    pValue: number | null;
    regionText: string | null;
  } | null;
}

export async function fetchGnomadGeneConstraint(
  geneSymbol: string,
  aaPos?: number | null
): Promise<GnomadGeneConstraint | null> {
  const key = geneSymbol.toUpperCase();
  let cached = gnomadConstraintCache.get(key);

  if (cached === undefined) {
    const query = `
      query GeneConstraintAndRMC($gene: String!) {
        gene(gene_symbol: $gene, reference_genome: GRCh37) {
          gnomad_constraint {
            mis_z
            oe_mis
            pLI
            oe_lof_upper
          }
          gnomad_v2_regional_missense_constraint {
            passed_qc
            regions {
              chrom
              start
              stop
              aa_start
              aa_stop
              obs_mis
              exp_mis
              obs_exp
              p_value
            }
          }
        }
      }
    `;

    try {
      const resp = await fetchWithRetry(
        "https://gnomad.broadinstitute.org/api",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ query, variables: { gene: key } }),
          timeout: 15000,
        },
        2,
        1500
      );

      if (resp.ok) {
        const json = await resp.json();
        const geneData = json?.data?.gene;
        const constraint = geneData?.gnomad_constraint;
        const rmc = geneData?.gnomad_v2_regional_missense_constraint;

        if (constraint) {
          const missense_z = constraint.mis_z != null ? parseFloat(constraint.mis_z.toFixed(2)) : null;
          const oe_mis = constraint.oe_mis != null ? parseFloat(constraint.oe_mis.toFixed(2)) : null;
          const pli = constraint.pLI != null ? parseFloat(constraint.pLI.toFixed(2)) : null;
          const loeuf = constraint.oe_lof_upper != null ? parseFloat(constraint.oe_lof_upper.toFixed(2)) : null;

          const isPP2Constrained =
            (missense_z !== null && missense_z >= 3.09) ||
            (oe_mis !== null && oe_mis < 0.8);

          cached = {
            missense_z,
            oe_mis,
            pli,
            loeuf,
            isPP2Constrained,
            regions: rmc?.regions || [],
            hasRegionalData: !!(rmc && rmc.regions && rmc.regions.length > 0)
          };
          gnomadConstraintCache.set(key, cached);
        }
      }
    } catch (err: any) {
      console.error(`[gnomAD Constraint] Error fetching ${key}:`, err.message);
    }
  }

  if (!cached) return null;

  // Perform regional check for the specific aaPos on-the-fly from the cached object
  let regionalConstraint: GnomadGeneConstraint["regionalConstraint"] = null;
  if (aaPos && cached.regions && cached.regions.length > 0) {
    let matchedRegion = null;
    for (const r of cached.regions) {
      const startNum = parseInt(r.aa_start.replace(/\D/g, ""), 10);
      const stopNum = parseInt(r.aa_stop.replace(/\D/g, ""), 10);
      if (!isNaN(startNum) && !isNaN(stopNum)) {
        const minPos = Math.min(startNum, stopNum);
        const maxPos = Math.max(startNum, stopNum);
        if (aaPos >= minPos && aaPos <= maxPos) {
          matchedRegion = r;
          break;
        }
      }
    }
    if (matchedRegion) {
      regionalConstraint = {
        isConstrained: true,
        oeRatio: matchedRegion.obs_exp != null ? parseFloat(matchedRegion.obs_exp.toFixed(2)) : null,
        pValue: matchedRegion.p_value,
        regionText: `${matchedRegion.aa_start} to ${matchedRegion.aa_stop}`
      };
    } else {
      regionalConstraint = {
        isConstrained: false,
        oeRatio: null,
        pValue: null,
        regionText: null
      };
    }
  }

  return {
    ...cached,
    regionalConstraint
  };
}
