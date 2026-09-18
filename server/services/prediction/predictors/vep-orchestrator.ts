import { z } from "zod";
import { predictorCache, getCachedOrFetch } from "../../infra/cache.ts";
import { normalizeGeneSymbol, normalizeVariantTo3Letter, fetchWithRetry } from "../../infra/http-client.ts";
import { buildPredictorsKey } from "../../infra/cache-keys.ts";
import { queryLocalDbnsfpVariant } from "../dbnsfp_local.ts";
import { safeParseFloat, toSingleAa } from "./normalizer.ts";
import { getTranscriptsForProtein } from "./transcript-resolver.ts";
import type { PredictorData } from "../../../../src/shared/contracts.ts";

export const vepResponseSchema = z.array(z.object({
  seq_region_name: z.string().optional(),
  start: z.number().optional(),
  allele_string: z.string().optional(),
  transcript_consequences: z.array(z.object({
    transcript_id: z.string().optional(),
    canonical: z.union([z.number(), z.boolean()]).optional(),
    mane_select: z.any().optional(),
    mane_plus_clinical: z.any().optional(),
    alphamissense: z.object({
      am_pathogenicity: z.any().optional(),
      am_class: z.string().optional()
    }).optional(),
    cadd_phred: z.any().optional(),
    eve_score: z.any().optional(),
    eve_class: z.any().optional()
  })).optional()
})).min(1);

export async function fetchPredictorsFallback(gene: string, variant: string, uniprotId?: string): Promise<PredictorData> {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  
  let transcriptId: string | undefined = undefined;
  let maneRefSeqId: string | undefined = undefined;
  let isManeSelect = false;
  if (uniprotId) {
    try {
      const transcripts = await getTranscriptsForProtein(uniprotId);
      if (transcripts.ensemblId) transcriptId = transcripts.ensemblId;
      if (transcripts.refseqId) maneRefSeqId = transcripts.refseqId;
      if (transcripts.isManeSelect) isManeSelect = true;
    } catch (_) {}
  }

  const posMatch = variant.match(/\d+/);
  const pos = posMatch ? parseInt(posMatch[0], 10) : null;

  let amPathogenicity: number | null = null;
  let amClass: string | null = null;
  let caddPhred: number | null = null;
  let gnomadVariantId: string | null = null;

  // 1. Check local dbNSFP first if available
  if (pos !== null) {
    try {
      const localData = await queryLocalDbnsfpVariant(normGene, pos, null, null, cleanVar);
      if (localData) {
        if (localData.alphamissense !== undefined && localData.alphamissense !== null) {
          amPathogenicity = safeParseFloat(localData.alphamissense);
          amClass = amPathogenicity !== null ? (amPathogenicity >= 0.564 ? "likely_pathogenic" : amPathogenicity <= 0.34 ? "likely_benign" : "ambiguous") : null;
        }
        if (localData.cadd !== undefined && localData.cadd !== null) {
          caddPhred = safeParseFloat(localData.cadd);
        }
      }
    } catch (_) {}
  }

  // 2. Query MyVariant.info for AlphaMissense & CADD
  if (amPathogenicity === null || caddPhred === null) {
    try {
      const cleanVarLower = cleanVar.toLowerCase();
      const mutMatch = variant.match(/([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})/i);
      const term1 = mutMatch ? `p.${toSingleAa(mutMatch[1])}${mutMatch[2]}${toSingleAa(mutMatch[3])}`.toLowerCase() : "";

      const queryStr = pos !== null
        ? `dbnsfp.genename:${normGene} AND (dbnsfp.hgvsp:"p.${cleanVar}" OR dbnsfp.aa.pos:${pos})`
        : `dbnsfp.genename:${normGene} AND dbnsfp.hgvsp:"p.${cleanVar}"`;
      const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=dbnsfp.alphamissense,dbnsfp.cadd,cadd.phred,cadd_phred,dbnsfp.hgvsp,dbnsfp.aa.pos&limit=50`;
      const res = await fetchWithRetry(url, { headers: { "Accept": "application/json" }, timeout: 8000 }, 1);
      if (res.ok) {
        const data = await res.json() as any;
        if (data.hits && Array.isArray(data.hits)) {
          for (const hit of data.hits) {
            const hgvsp = Array.isArray(hit.dbnsfp?.hgvsp) ? hit.dbnsfp.hgvsp : [hit.dbnsfp?.hgvsp];
            const matchesVar = hgvsp.some((h: any) => {
              if (typeof h !== "string") return false;
              const hl = h.toLowerCase();
              return hl.includes(cleanVarLower) || (term1 && hl.includes(term1));
            });
            
            // Strict No-Heuristics: ONLY accept data if this hit explicitly matches the requested variant substitution!
            if (matchesVar) {
              const amData = hit.dbnsfp?.alphamissense;
              const caddData = hit.dbnsfp?.cadd || hit.cadd;

              if (amData && amPathogenicity === null) {
                const rawAm = Array.isArray(amData) ? amData[0] : amData;
                amPathogenicity = safeParseFloat(rawAm.am_pathogenicity ?? rawAm.score ?? rawAm.pathogenicity);
                amClass = rawAm.am_class ? String(rawAm.am_class) : (rawAm.pred ? String(rawAm.pred) : null);
              }
              if (caddData && caddPhred === null) {
                const rawCadd = Array.isArray(caddData) ? caddData[0] : caddData;
                caddPhred = safeParseFloat(rawCadd.phred ?? rawCadd.cadd_phred ?? hit.cadd_phred ?? hit.cadd?.phred);
              }
              if (hit._id && typeof hit._id === "string" && hit._id.startsWith("chr")) {
                const m = hit._id.match(/chr([0-9XYM]+):g\.(\d+)([A-Z]+)>([A-Z]+)/i);
                if (m) {
                  gnomadVariantId = `${m[1]}-${m[2]}-${m[3]}-${m[4]}`;
                }
              }
            }
            if (amPathogenicity !== null && caddPhred !== null) break;
          }
        }
      }
    } catch (_) {}
  }

  const hasAnyData = amPathogenicity !== null || caddPhred !== null || Boolean(transcriptId);
  return {
    available: hasAnyData,
    amPathogenicity,
    amClass,
    caddPhred,
    gnomadVariantId,
    /**
     * The MyVariant.info `_id` is hg19 by default — its query service has no assembly
     * parameter at all — so this coordinate is GRCh37 and must be labelled as such. It was
     * previously returned untagged and consumed as though it were GRCh38.
     */
    gnomadVariantAssembly: gnomadVariantId ? ("GRCh37" as const) : null,
    transcriptId,
    maneRefSeqId,
    isManeSelect: Boolean(isManeSelect),
    isCanonical: Boolean(transcriptId),
    source: (amPathogenicity !== null || caddPhred !== null) ? "MyVariant.info & dbNSFP (VEP Fallback)" : "UniProt Transcript Fallback"
  };
}

export async function fetchPredictorData(gene: string, variant: string, uniprotId?: string): Promise<PredictorData> {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  const cacheKey = buildPredictorsKey(gene, variant, uniprotId);

  return getCachedOrFetch({
    key: cacheKey,
    source: "Ensembl VEP API",
    l1Cache: predictorCache,
    ttlSeconds: 14 * 24 * 60 * 60,
    fetcher: async () => {
      let queryTargets: string[] = [];
      if (uniprotId) {
        const transcripts = await getTranscriptsForProtein(uniprotId);
        if (transcripts.refseqId && transcripts.refseqId.startsWith("NM_")) {
          queryTargets.push(`${transcripts.refseqId}:p.${cleanVar}`);
          const cleanRefseq = transcripts.refseqId.split(".")[0];
          if (cleanRefseq !== transcripts.refseqId) {
            queryTargets.push(`${cleanRefseq}:p.${cleanVar}`);
          }
        }
        if (transcripts.ensemblId) {
          queryTargets.push(`${transcripts.ensemblId}:p.${cleanVar}`);
          const cleanEnsembl = transcripts.ensemblId.split(".")[0];
          if (cleanEnsembl !== transcripts.ensemblId) {
            queryTargets.push(`${cleanEnsembl}:p.${cleanVar}`);
          }
        }
      }
      queryTargets.push(`${normGene}:p.${cleanVar}`);

      let parsedData: any = null;
      let errorMsg = "";

      for (const target of queryTargets) {
        const url = `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(target)}?content-type=application/json&AlphaMissense=1&CADD=1&mane=1`;
        try {
          console.log(`[VEP Fetch] Querying target: ${target}`);
          const res = await fetchWithRetry(url, {
            headers: { "Accept": "application/json" },
            timeout: 8000
          }, 1);
          if (res.ok) {
            const data = await res.json() as any;
            parsedData = vepResponseSchema.parse(data);
            if (parsedData.length > 0 && parsedData[0].transcript_consequences) {
              console.log(`[VEP Fetch] Successfully resolved predictors via target: ${target}`);
              break;
            }
          } else {
            const errText = await res.text().catch(() => "");
            errorMsg = `Status ${res.status}: ${errText}`;
            if (res.status === 503 || res.status === 502) {
              console.warn(`[VEP Fetch] Ensembl REST returned HTTP ${res.status}, failing fast to secondary fallback.`);
              break;
            }
          }
        } catch (err: any) {
          errorMsg = err.message || String(err);
        }
      }

      try {
        if (parsedData && parsedData.length > 0 && parsedData[0].transcript_consequences) {
          const consequences = parsedData[0].transcript_consequences;
          const hasPredictor = (c: any) => c.alphamissense || c.cadd_phred !== undefined;
          let tc = consequences.find((c: any) => c.mane_select && hasPredictor(c));
          if (!tc) {
            tc = consequences.find((c: any) => c.mane_plus_clinical && hasPredictor(c));
          }
          if (!tc) {
            tc = consequences.find((c: any) => (c.canonical === 1 || c.canonical === true || String(c.canonical) === "1") && hasPredictor(c));
          }
          if (!tc) {
            tc = consequences.find((c: any) => typeof c.transcript_id === "string" && c.transcript_id.startsWith("NM_") && hasPredictor(c));
          }
          if (!tc) {
            tc = consequences.find(hasPredictor);
          }
          if (!tc) {
            tc = consequences[0];
          }
          if (tc) {
            const amPathogenicity = (tc.alphamissense && tc.alphamissense.am_pathogenicity !== undefined) ? safeParseFloat(tc.alphamissense.am_pathogenicity) : null;
            const amClass = (tc.alphamissense && tc.alphamissense.am_class) ? String(tc.alphamissense.am_class) : null;
            const caddPhred = tc.cadd_phred !== undefined ? safeParseFloat(tc.cadd_phred) : null;

            const chr = parsedData[0].seq_region_name;
            const startPos = parsedData[0].start;
            const alleleStr = parsedData[0].allele_string;
            let gnomadVariantId: string | null = null;
            if (chr && startPos && typeof alleleStr === "string") {
              const parts = alleleStr.split("/");
              if (parts.length >= 2) {
                gnomadVariantId = `${chr}-${startPos}-${parts[0]}-${parts[1]}`;
              }
            }

            let maneRefSeqId: string | undefined = undefined;
            if (tc.mane_select && typeof tc.mane_select === "string") {
              maneRefSeqId = tc.mane_select;
            } else if (tc.mane_select && typeof tc.mane_select === "object") {
              maneRefSeqId = tc.mane_select.refseq_match || tc.mane_select.id || undefined;
            } else if (tc.mane_plus_clinical && typeof tc.mane_plus_clinical === "string") {
              maneRefSeqId = tc.mane_plus_clinical;
            } else if (tc.mane_plus_clinical && typeof tc.mane_plus_clinical === "object") {
              maneRefSeqId = tc.mane_plus_clinical.refseq_match || tc.mane_plus_clinical.id || undefined;
            }

            const resVal = { 
              available: true, 
              amPathogenicity, 
              amClass, 
              caddPhred, 
              gnomadVariantId,
              /**
               * This path queries the GRCh38 Ensembl host (the URL above is hard-coded), so the
               * coordinate it derives is GRCh38. Stated explicitly rather than left implicit:
               * the build now travels with the coordinate, because the gate that consumes it
               * can no longer assume the request's declared build matches the coordinate's.
               */
              gnomadVariantAssembly: gnomadVariantId ? ("GRCh38" as const) : null,
              transcriptId: tc.transcript_id,
              isManeSelect: !!tc.mane_select,
              isManePlusClinical: !!tc.mane_plus_clinical,
              isCanonical: !!(tc.canonical === 1 || tc.canonical === true || String(tc.canonical) === "1"),
              maneRefSeqId,
              source: "Ensembl VEP API"
            };
            return resVal;
          }
        }
      } catch (err: any) {
        console.warn(`[Predictors Fetch Error] Failed to parse VEP predictors response: ${err.message}`);
      }

      console.log(`[VEP Fallback] Ensembl VEP unavailable or incomplete for ${normGene} ${cleanVar}; falling back to MyVariant & UniProt`);
      return await fetchPredictorsFallback(gene, variant, uniprotId);
    }
  });
}
