import { z } from "zod";
import { CLINVAR_AA_MAP } from "../../../src/shared/aminoAcids.ts";
import { classifyClinvar } from "../../../src/shared/clinvarClassification.ts";
import { LRUCache } from "lru-cache";
import { clinvarCache, getCachedOrFetch } from "../infra/cache.ts";
import { normalizeGeneSymbol, fetchWithRetry } from "../infra/http-client.ts";
import { buildClinvarKey } from "../infra/cache-keys.ts";
import { parseVcvConditions, type ClinVarCondition } from "./clinvar-conditions.ts";

export interface FetchClinVarOptions {
  originalNotation?: string;
  l1Cache?: LRUCache<string, any>;
  bypassSqlite?: boolean;
}

export interface ClinVarData {
  classification: string;
  lastEvaluated: string;
  reviewStatus: string;
  alleleFrequencies: { source: string; value: any }[];
  trait: string;
  conditions?: ClinVarCondition[];
  /** `full-record`: every condition, from ClinVar's variant record. `summary-only`: only those behind the aggregate. */
  conditionsRead?: "full-record" | "summary-only";
  uid: string | null;
  hasOtherPathogenicVariantSameAA?: boolean;
}

const clinvarSearchResponseSchema = z.object({
  esearchresult: z.object({
    idlist: z.array(z.string()).default([])
  }).optional()
});

const clinvarSummaryResponseSchema = z.object({
  result: z.object({
    uids: z.array(z.string()).optional()
  }).catchall(
    z.object({
      title: z.string().optional(),
      germline_classification: z.object({
        description: z.string().optional(),
        last_evaluated: z.string().optional(),
        review_status: z.string().optional(),
        trait_set: z.array(z.object({
          trait_name: z.string().optional(),
          trait_xrefs: z.array(z.object({ db_source: z.string(), db_id: z.string() })).optional()
        })).optional()
      }).optional(),
      allele_freq_set: z.array(z.object({
        source: z.string().optional(),
        value: z.any().optional()
      })).optional(),
      /** An id ClinVar does not hold: esummary answers 200 with `{"uid", "error": "…"}`. */
      error: z.string().optional()
    }).optional()
  ).optional()
});

function getCodingNotation(title: string): string | null {
  const match = title.match(/(c\.[^\s(]+)/i);
  return match ? match[1].toLowerCase() : null;
}

export async function fetchClinVarData(
  gene: string,
  variant: string,
  optionsOrNotation?: string | FetchClinVarOptions
): Promise<ClinVarData> {
  const options: FetchClinVarOptions = typeof optionsOrNotation === "string"
    ? { originalNotation: optionsOrNotation }
    : (optionsOrNotation || {});

  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = variant.replace(/^p\./i, "").trim();
  const cacheKey = buildClinvarKey(gene, variant, options.originalNotation);

  return getCachedOrFetch({
    key: cacheKey,
    source: "NCBI ClinVar API",
    l1Cache: options.l1Cache ?? clinvarCache,
    ttlSeconds: 7 * 24 * 60 * 60,
    bypassSqlite: options.bypassSqlite,
    // A record whose full variant record could not be read is shown honestly but not kept for a week:
    // the next request, after the short in-memory hold, tries again.
    shouldCache: (result: ClinVarData) => result.uid !== null && result.classification !== "Not found in ClinVar" && result.conditionsRead === "full-record",
    fetcher: async () => {
      const defaultRes: ClinVarData = {
        classification: "Not found in ClinVar",
        lastEvaluated: "",
        reviewStatus: "",
        alleleFrequencies: [],
        trait: "",
        uid: null,
        hasOtherPathogenicVariantSameAA: false
      };
  
  /**
   * A bare ClinVar Variation ID needs no search: esearch's only job for `2582078[Variation ID]`
   * is to confirm the number the caller already typed, and esearch is the E-utilities endpoint
   * whose index degrades under load (measured 2026-11-05: it 500'd two requests in three while
   * esummary for the SAME id answered — so an ID lookup died before esummary was ever asked).
   * esummary by id returns the identical record, so the direct branch asks it first, and the
   * payload the tabs read is unchanged.
   */
  const isDirectIdSearch = /^(?:VCV)?\d+$/i.test(cleanVar);
  let term = "";
  let idList: string[];
  if (isDirectIdSearch) {
    // VCV000123456 or 123456 → its numeric id. Leading zeros are not part of the id E-utilities
    // summaries key on, so they are stripped here, not at the summary step.
    const varId = cleanVar.replace(/^VCV/i, "").replace(/^0+/, "");
    if (!varId) return defaultRes;
    idList = [varId];
  } else {
    term = `${normGene}[gene] AND (${variant}[variant name] OR ${cleanVar}[variant name])`;

    const apiKey0 = process.env.NCBI_API_KEY;
    const apiKeyParam0 = apiKey0 ? `&api_key=${encodeURIComponent(apiKey0)}` : "";
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=${encodeURIComponent(term)}&retmode=json${apiKeyParam0}`;

    const searchRes = await fetchWithRetry(searchUrl, {
      headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
      timeout: 15000,
      // NCBI's error page is its own "try the query again" — fast because the fault is in its routing,
      // not because it is refusing this client (see FetchWithRetryOptions.fastFailureIsTransient).
      fastFailureIsTransient: true
    });
    if (!searchRes.ok) {
      throw new Error(`ClinVar search failed (status: ${searchRes.status})`);
    }

    const searchJson = await searchRes.json();
    const searchData = clinvarSearchResponseSchema.parse(searchJson);
    idList = searchData.esearchresult?.idlist || [];
    if (idList.length === 0) {
      (options.l1Cache ?? clinvarCache).set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
      return defaultRes;
    }
  }

  const apiKey = process.env.NCBI_API_KEY;
  const apiKeyParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${idList.join(",")}&retmode=json${apiKeyParam}`;
  const summaryRes = await fetchWithRetry(summaryUrl, {
    headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
    timeout: 15000,
    fastFailureIsTransient: true
  });
  if (!summaryRes.ok) {
    throw new Error(`ClinVar summary failed (status: ${summaryRes.status})`);
  }

  const summaryJson = await summaryRes.json();
  const summaryData = clinvarSummaryResponseSchema.parse(summaryJson);
  const resultObj = summaryData.result || {};
  const queryNorm = (() => {
    const clean = variant.replace(/^p\./i, "").trim().toLowerCase();
    const match3 = clean.match(/^([a-z]{3})(\d+)([a-z]{3})$/);
    if (match3) {
      const wt1 = CLINVAR_AA_MAP[match3[1]];
      const pos = match3[2];
      const mut1 = CLINVAR_AA_MAP[match3[3]];
      if (wt1 && mut1) {
        return `${wt1.toUpperCase()}${pos}${mut1.toUpperCase()}`;
      }
    }
    const match1 = clean.match(/^([a-z])(\d+)([a-z])$/);
    if (match1) {
      return `${match1[1].toUpperCase()}${match1[2]}${match1[3].toUpperCase()}`;
    }
    return null;
  })();

  // Match entries to queryNorm first
  const matchingEntries: { id: string; entry: any; cleanTitle: string }[] = [];
  for (const id of idList) {
    const entry = resultObj[id];
    if (!entry) continue;
    /**
     * A summary carries its refusals as a 200 with an `error` body: *"cannot get document summary"*
     * for an id ClinVar does not hold. That is the direct-ID branch's "no such variation", and the
     * empty `matchingEntries` below turns it into the same "Not found" a failed esearch would —
     * never a record with a `uid` but no classification, which a screen could read as evidence.
     */
    if (entry.error) continue;
    
    const title = (entry.title || "").toLowerCase();
    let isMatch = isDirectIdSearch;
    if (!isMatch && queryNorm) {
      const pChangeMatches = title.match(/p\.[a-z]{1,3}\d+[a-z]{1,3}(?![a-z0-9*]|fs)/gi);
      if (pChangeMatches) {
        for (const pMatch of pChangeMatches) {
          const cleanMatch = pMatch.replace(/^p\./i, "").trim().toLowerCase();
          const m3 = cleanMatch.match(/^([a-z]{3})(\d+)([a-z]{3})$/);
          let matchNorm: string | null = null;
          if (m3) {
            const wt1 = CLINVAR_AA_MAP[m3[1]];
            const pos = m3[2];
            const mut1 = CLINVAR_AA_MAP[m3[3]];
            if (wt1 && mut1) {
              matchNorm = `${wt1.toUpperCase()}${pos}${mut1.toUpperCase()}`;
            }
          } else {
            const m1 = cleanMatch.match(/^([a-z])(\d+)([a-z])$/);
            if (m1) {
              matchNorm = `${m1[1].toUpperCase()}${m1[2]}${m1[3].toUpperCase()}`;
            }
          }
          if (matchNorm === queryNorm) {
            isMatch = true;
            break;
          }
        }
      }
      if (!isMatch) {
        const cleanVariant = variant.replace(/^p\./i, "").toLowerCase();
        const escaped = cleanVariant.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9*]|fs)`, 'i');
        if (regex.test(title)) {
          isMatch = true;
        }
      }
    }
    if (isMatch) {
      matchingEntries.push({ id, entry, cleanTitle: title });
    }
  }

  if (matchingEntries.length === 0) {
    (options.l1Cache ?? clinvarCache).set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
    return defaultRes;
  }

  // Find user's specific matched entry
  let matchedIdx = 0;
  if (options.originalNotation) {
    const cleanNotation = options.originalNotation.trim().toLowerCase();
    const escapedNotation = cleanNotation.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const exactRegex = new RegExp(`(?:^|[^a-z0-9])${escapedNotation}(?![a-z0-9*]|fs)`, 'i');
    let idx = matchingEntries.findIndex(m => exactRegex.test(m.cleanTitle));
    if (idx === -1) {
      idx = matchingEntries.findIndex(m => m.cleanTitle.includes(cleanNotation));
    }
    if (idx !== -1) {
      matchedIdx = idx;
    }
  }

  const { id: matchedId, entry: matchedEntry } = matchingEntries[matchedIdx];
  const matchedTitle = matchingEntries[matchedIdx].cleanTitle;
  const matchedC = getCodingNotation(matchedTitle);

  // Check if there is another entry that is pathogenic/likely pathogenic
  let hasOtherPathogenicVariantSameAA = false;
  for (let i = 0; i < matchingEntries.length; i++) {
    if (i === matchedIdx) continue;
    // PS1 needs an established P/LP record; "Conflicting … pathogenicity" is not one.
    if (classifyClinvar(matchingEntries[i].entry.germline_classification?.description) === "plp") {
      const otherC = getCodingNotation(matchingEntries[i].cleanTitle);
      if (!matchedC || !otherC || matchedC !== otherC) {
        hasOtherPathogenicVariantSameAA = true;
        break;
      }
    }
  }

  const classification = matchedEntry.germline_classification?.description || "Unknown";
  const lastEvaluated = matchedEntry.germline_classification?.last_evaluated || "";
  const reviewStatus = matchedEntry.germline_classification?.review_status || "";
  const traits = (matchedEntry.germline_classification?.trait_set || []).map((t: any) => t.trait_name || "").filter(Boolean).join(", ");
  const summaryConditions: ClinVarCondition[] = (matchedEntry.germline_classification?.trait_set || []).map((t: any) => ({
    label: t.trait_name || '',
    xrefs: (t.trait_xrefs || []).map((xref: { db_source: string; db_id: string }) => ({ source: xref.db_source, id: xref.db_id }))
  }));
  // The summary lists only conditions behind the aggregate classification; the variant record lists all of
  // them, each with its own record. It is best effort and must stay cheap: one attempt, a short timeout
  // that is our cap (not evidence about NCBI, so it never counts toward the shared host breaker). If it
  // fails, the summary conditions stand and the payload says so (`conditionsRead`), so no screen reads a
  // missing condition as an absent one. Whether the record was read comes from the parse, not its size.
  const vcvUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=clinvar&rettype=vcv&is_variationid=true&from_esearch=true&id=${encodeURIComponent(matchedId)}${apiKeyParam}`;
  const vcvConditions = await fetchWithRetry(vcvUrl, { headers: { "User-Agent": "Missense-Structural-Explorer/1.0" }, timeout: 6000, cappedByCaller: true }, 1)
    .then(res => (res.ok ? res.text() : null))
    .then(xml => (xml ? parseVcvConditions(xml) : null))
    .catch(() => null);
  const conditions = vcvConditions ?? summaryConditions;
  const conditionsRead = vcvConditions ? "full-record" as const : "summary-only" as const;
  
  const alleleFrequencies = (matchedEntry.allele_freq_set || []).map((freq: any) => ({
    source: freq.source || "Unknown",
    value: freq.value !== undefined ? freq.value : null
  }));
  
      const resVal: ClinVarData = {
        classification,
        lastEvaluated,
        reviewStatus,
        alleleFrequencies,
        trait: traits,
        conditions,
        conditionsRead,
        uid: matchedId,
        hasOtherPathogenicVariantSameAA
      };
      // Not kept for a week (see `shouldCache`), but kept for a few minutes so a burst of requests for this
      // variant does not repeat the failing request each time.
      if (conditionsRead === "summary-only") (options.l1Cache ?? clinvarCache).set(cacheKey, resVal, { ttl: 5 * 60 * 1000 });
      return resVal;
    }
  });
}
