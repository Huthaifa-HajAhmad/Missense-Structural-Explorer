import type { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";
import { gnomadFreqCache, getCachedOrFetch } from "../infra/cache.ts";
import { buildGnomadFreqKey } from "../infra/cache-keys.ts";
// The ancestry-group AN floor is shared with the surface that DESCRIBES it (the Population
// Frequencies tab's grouped-maximum row), so the filter and the copy cannot drift apart.
import { THRESHOLDS } from "../../../src/shared/thresholds.ts";

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

    const validPops = populations.filter(p => p.an >= THRESHOLDS.populationFrequency.groupMinAn && p.af !== null && p.af !== undefined);
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

    return result;
  } catch (err: any) {
    console.error(`[gnomAD Freq] Error fetching ${variantId}:`, err.message);
    return null;
  }
    }
  });
}

// Gene constraint is a pinned local product, independent of the live variant frequency API.
export { fetchGnomadGeneConstraint } from "./gnomad-gene-constraint.ts";
export type { GnomadGeneConstraint, FetchGnomadConstraintOptions } from "./gnomad-gene-constraint.ts";
