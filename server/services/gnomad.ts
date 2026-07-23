import { normalizeGeneSymbol, fetchWithRetry } from "./http-client.ts";
import { stringCache, gnomadFreqCache, gnomadConstraintCache } from "./cache.ts";

export interface StringInteraction {
  partner: string;
  score: number;
}

export async function fetchStringInteractions(gene: string): Promise<StringInteraction[]> {
  const normGene = normalizeGeneSymbol(gene);
  const cacheKey = normGene;
  const cached = stringCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://string-db.org/api/json/network?identifiers=${encodeURIComponent(normGene)}&species=9606`;
  
  try {
    const res = await fetchWithRetry(url, { timeout: 15000 });
    if (res.ok) {
      const data = await res.json() as any;
      if (Array.isArray(data)) {
        const partnersMap = new Map<string, number>();
        const targetUpper = gene.toUpperCase();
        for (const item of data) {
          const nameA = (item.preferredName_A || "").toUpperCase();
          const nameB = (item.preferredName_B || "").toUpperCase();
          const score = item.score !== undefined ? parseFloat(item.score) : 0.4;
          
          if (nameA === targetUpper && nameB !== targetUpper) {
            partnersMap.set(nameB, Math.max(partnersMap.get(nameB) || 0, score));
          } else if (nameB === targetUpper && nameA !== targetUpper) {
            partnersMap.set(nameA, Math.max(partnersMap.get(nameA) || 0, score));
          }
        }
        const parsed = Array.from(partnersMap.entries()).map(([partner, score]) => ({ partner, score }));
        parsed.sort((a, b) => b.score - a.score);
        const sliced = parsed.slice(0, 5);
        stringCache.set(cacheKey, sliced);
        return sliced;
      }
    }
  } catch (err: any) {
    console.warn(`[STRING Network Fetch Error] Failed to fetch STRING network: ${err.message}`);
  }

  stringCache.set(cacheKey, [], { ttl: 5 * 60 * 1000 });
  return [];
}

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
    if (validPops.length > 0) {
      let maxVal = 0;
      for (const p of validPops) {
        if (p.af > maxVal) {
          maxVal = p.af;
        }
      }
      groupMaxAF = maxVal;
    } else {
      // Fallback to global maxAF if no sub-population matches criteria
      groupMaxAF = maxAF;
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
            regions: rmc?.regions || []
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
