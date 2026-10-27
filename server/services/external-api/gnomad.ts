import type { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";
import { gnomadFreqCache, getCachedOrFetch } from "../infra/cache.ts";
import { buildGnomadFreqKey } from "../infra/cache-keys.ts";
// The ancestry-group AN floor is shared with the surface that DESCRIBES it (the Population
// Frequencies tab's grouped-maximum row), so the filter and the copy cannot drift apart.
import { THRESHOLDS } from "../../../src/shared/thresholds.ts";
import { groupMaximum } from "../../../src/shared/gnomadGroups.ts";

/**
 * An answer gnomAD did not give: a transport failure or a non-OK response.
 *
 * Thrown, not returned as `null`, because the pipeline reads a `null` frequency as `not_found` — a
 * confirmed absence that meets PM2. Before this, a gnomAD outage awarded PM2 (the invariant
 * `server/invariants.test.ts` states for the classifier: a timeout never implies absence). `null`
 * now means only what gnomAD itself says: "Variant not found".
 */
export class GnomadUnavailableError extends Error {}

export interface FetchGnomadFrequencyOptions {
  l1Cache?: LRUCache<string, any>;
  bypassSqlite?: boolean;
  /** Build that the variant id's coordinates belong to, when known. Part of the cache key. */
  assembly?: string | null;
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
  /** Whether groupMaxAF fell back to global maxAF due to low population counts */
  groupMaxAFIsFallback?: boolean;
  /** The genetic-ancestry group that holds `groupMaxAF` (e.g. "afr"), when it is a real group maximum. */
  groupMaxPopulation?: string | null;
  /**
   * gnomAD's filtering allele frequency (FAF95) over the grpmax groups: the lower bound of the 95%
   * confidence interval of the highest group frequency. ClinGen SVI's BA1/BS1 guidance reads this,
   * not the raw AF, so a handful of chance observations in a small group cannot carry a benign call.
   */
  faf95?: number | null;
  /** The group FAF95 was taken from. */
  faf95Population?: string | null;
}

/**
 * Query gnomAD GraphQL API for variant allele frequencies.
 *
 * @param variantId  gnomAD variant ID in the form "CHR-POS-REF-ALT". The endpoint is gnomAD r4,
 *                   which is GRCh38: an id from another build resolves by numeric position and
 *                   returns a DIFFERENT locus.
 * @param options    Optional cache and persistence overrides, plus the build that `variantId`'s
 *                   coordinates belong to. The build participates in the cache key because the id
 *                   alone does not identify a locus — the same numerics exist in both builds.
 */
export async function fetchGnomadVariantFrequency(
  variantId: string | null,
  options?: FetchGnomadFrequencyOptions
): Promise<GnomadVariantFrequency | null> {
  if (!variantId) return null;

  return getCachedOrFetch({
    key: buildGnomadFreqKey(variantId, options?.assembly ?? null),
    source: "gnomAD GraphQL API",
    l1Cache: options?.l1Cache ?? gnomadFreqCache,
    ttlSeconds: 14 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
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
        joint {
          ac
          an
          homozygote_count
          faf95 {
            popmax
            popmax_population
          }
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
      throw new GnomadUnavailableError(`gnomAD responded ${resp.status}`);
    }

    const json = await resp.json();
    const v = json?.data?.variant;
    if (!v) {
      // Only gnomAD's own "Variant not found" is an absence; any other empty answer is a fault.
      const notFound = Array.isArray(json?.errors) && json.errors.some((e: any) => /variant not found/i.test(String(e?.message ?? "")));
      if (!notFound) throw new GnomadUnavailableError("gnomAD returned no variant and no 'not found' answer");
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
      typeof v.joint?.homozygote_count === "number" ? v.joint.homozygote_count :
      (v.genome?.homozygote_count != null || v.exome?.homozygote_count != null)
        ? (v.genome?.homozygote_count ?? 0) + (v.exome?.homozygote_count ?? 0)
        : null;

    const maxAF =
      genomeAF !== null && exomeAF !== null ? Math.max(genomeAF, exomeAF) :
      genomeAF !== null ? genomeAF :
      exomeAF  !== null ? exomeAF  : null;

    /**
     * The grouped maximum, over the groups gnomAD v4.1 itself uses (`GRPMAX_GROUPS`), from the JOINT
     * exome + genome counts when gnomAD returns them. It used to be the maximum over every row of the
     * population list — sex splits, founder groups, `remaining` — and over each cohort separately.
     */
    const minAn = THRESHOLDS.populationFrequency.groupMinAn;
    const jointRows = Array.isArray(v.joint?.populations) ? v.joint.populations : null;
    const perCohortRows = [...(v.genome?.populations ?? []), ...(v.exome?.populations ?? [])];
    const grouped = groupMaximum(jointRows ?? perCohortRows, minAn);
    let groupMaxAF: number | null = null;
    let groupMaxPopulation: string | null = null;
    let groupMaxAFIsFallback = false;
    if (grouped) {
      groupMaxAF = grouped.af;
      groupMaxPopulation = grouped.population;
    } else {
      // No grpmax group reached the AN floor; the global maximum is the coarser stand-in, flagged.
      console.warn(`[gnomAD] No grpmax group with AN >= ${minAn} for variant ${variantId}; groupMaxAF falling back to global maxAF (${maxAF}).`);
      groupMaxAF = maxAF;
      groupMaxAFIsFallback = true;
    }
    const fafRaw = v.joint?.faf95?.popmax;
    const faf95: number | null = typeof fafRaw === "number" && Number.isFinite(fafRaw) ? fafRaw : null;
    const faf95Population: string | null = faf95 !== null ? (v.joint?.faf95?.popmax_population ?? null) : null;

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
      groupMaxPopulation,
      faf95,
      faf95Population,
    };

    return result;
  } catch (err: any) {
    console.error(`[gnomAD Freq] Error fetching ${variantId}:`, err.message);
    // Rethrown: an outage is not an absence (see GnomadUnavailableError).
    throw err instanceof GnomadUnavailableError ? err : new GnomadUnavailableError(err?.message ?? "gnomAD request failed");
  }
    }
  });
}

// Gene constraint is a pinned local product, independent of the live variant frequency API.
export { fetchGnomadGeneConstraint } from "./gnomad-gene-constraint.ts";
export type { GnomadGeneConstraint, FetchGnomadConstraintOptions } from "./gnomad-gene-constraint.ts";
