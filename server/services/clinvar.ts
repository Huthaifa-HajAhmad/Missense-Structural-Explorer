import { z } from "zod";
import { CLINVAR_AA_MAP } from "../../src/aminoAcids.ts";
import { clinvarCache } from "./cache.ts";
import { normalizeGeneSymbol, fetchWithRetry } from "./http-client.ts";

export interface ClinVarData {
  classification: string;
  lastEvaluated: string;
  reviewStatus: string;
  alleleFrequencies: { source: string; value: any }[];
  trait: string;
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
          trait_name: z.string().optional()
        })).optional()
      }).optional(),
      allele_freq_set: z.array(z.object({
        source: z.string().optional(),
        value: z.any().optional()
      })).optional()
    }).optional()
  ).optional()
});

function getCodingNotation(title: string): string | null {
  const match = title.match(/(c\.[^\s(]+)/i);
  return match ? match[1].toLowerCase() : null;
}

export async function fetchClinVarData(gene: string, variant: string, originalNotation?: string): Promise<ClinVarData> {
  const cacheKey = `${gene}_${variant}_${originalNotation || ""}`;
  const cached = clinvarCache.get(cacheKey);
  if (cached) return cached;

  const defaultRes: ClinVarData = {
    classification: "Not found in ClinVar",
    lastEvaluated: "",
    reviewStatus: "",
    alleleFrequencies: [],
    trait: "",
    uid: null,
    hasOtherPathogenicVariantSameAA: false
  };
  
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = variant.replace(/^p\./i, "").trim();
  
  let term = "";
  if (/^(?:VCV)?\d+$/i.test(cleanVar)) {
    // If it's a ClinVar Variation ID (e.g. VCV000123456 or 123456), search directly by Variation ID
    const varId = cleanVar.replace(/^VCV/i, "").replace(/^0+/, "");
    term = `${varId}[Variation ID]`;
  } else {
    term = `${normGene}[gene] AND (${variant}[variant name] OR ${cleanVar}[variant name])`;
  }
  
  const apiKey = process.env.NCBI_API_KEY;
  const apiKeyParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=${encodeURIComponent(term)}&retmode=json${apiKeyParam}`;
  
  const searchRes = await fetchWithRetry(searchUrl, {
    headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
    timeout: 15000
  });
  if (!searchRes.ok) {
    throw new Error(`ClinVar search failed (status: ${searchRes.status})`);
  }
  
  const searchJson = await searchRes.json();
  const searchData = clinvarSearchResponseSchema.parse(searchJson);
  const idList = searchData.esearchresult?.idlist || [];
  if (idList.length === 0) {
    clinvarCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
    return defaultRes;
  }
  
  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${idList.join(",")}&retmode=json${apiKeyParam}`;
  const summaryRes = await fetchWithRetry(summaryUrl, {
    headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
    timeout: 15000
  });
  if (!summaryRes.ok) {
    throw new Error(`ClinVar summary failed (status: ${summaryRes.status})`);
  }
  
  const summaryJson = await summaryRes.json();
  const summaryData = clinvarSummaryResponseSchema.parse(summaryJson);
  const isDirectIdSearch = /^(?:VCV)?\d+$/i.test(cleanVar);
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
    
    const title = (entry.title || "").toLowerCase();
    let isMatch = isDirectIdSearch;
    if (!isMatch && queryNorm) {
      const pChangeMatches = title.match(/p\.[a-z]{1,3}\d+[a-z]{1,3}/g);
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
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
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
    clinvarCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
    return defaultRes;
  }

  // Find user's specific matched entry
  let matchedIdx = 0;
  if (originalNotation) {
    const cleanNotation = originalNotation.trim().toLowerCase();
    const idx = matchingEntries.findIndex(m => m.cleanTitle.includes(cleanNotation));
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
    const otherClass = (matchingEntries[i].entry.germline_classification?.description || "").toLowerCase();
    if (otherClass.includes("pathogenic") || otherClass.includes("likely pathogenic")) {
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
    uid: matchedId,
    hasOtherPathogenicVariantSameAA
  };
  clinvarCache.set(cacheKey, resVal);
  return resVal;
}
