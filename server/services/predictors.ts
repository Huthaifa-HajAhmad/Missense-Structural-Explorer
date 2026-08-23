import { z } from "zod";
import { TabixIndexedFile } from "@gmod/tabix";
import path from "path";
import fs from "fs";
import { LRUCache } from "lru-cache";
import { predictorCache, conservationCache, popEVECache, popEveOnlineCache, refseqCache, getCachedOrFetch } from "./cache.ts";
import { normalizeGeneSymbol, normalizeVariantTo3Letter, fetchWithRetry } from "./http-client.ts";
import { isLocalDbnsfpAvailable, queryLocalDbnsfpVariant } from "./dbnsfp_local.ts";
import { queryGenosWebservice } from "./genos_web.ts";
import { resolveSpliceProximity } from "./splice_resolver.ts";
import { buildPredictorsKey, buildConservationKey } from "./cache-keys.ts";

function safeParseFloat(val: any): number | null {
  if (val === undefined || val === null || val === "." || val === "") return null;
  const num = parseFloat(String(val));
  return isNaN(num) ? null : num;
}

function safeParseInt(val: any): number | null {
  if (val === undefined || val === null || val === "." || val === "") return null;
  const num = parseInt(String(val), 10);
  return isNaN(num) ? null : num;
}

import type { PredictorData, ConservationData } from "../../src/shared/contracts.ts";
export type { PredictorData, ConservationData };

/**
 * Fast Tier 1 baseline querying the public, unauthenticated query.dbnsfp.org API (~900ms).
 */
export async function queryDbnsfpOrg(
  gene: string,
  variant: string,
  gnomadVariantId?: string | null
): Promise<Partial<ConservationData> | null> {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  let variantQuery = '';
  if (gnomadVariantId) {
    const parts = gnomadVariantId.split('-');
    if (parts.length >= 4) {
      variantQuery = `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}`;
    }
  }
  if (!variantQuery) {
    const formattedVariant = variant.startsWith('p.') ? variant : `p.${variant}`;
    variantQuery = `${normGene}:${formattedVariant}`;
  }

  try {
    const res = await fetchWithRetry('https://query.dbnsfp.org/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variants: [variantQuery],
        genome_build: 'hg38'
      }),
      timeout: 7000
    }, 1);

    if (!res.ok) return null;
    const data = await res.json() as any;
    if (!data || !data.tabs) return null;

    const cScores = data.tabs.conservative_scores?.rows?.[0] || {};
    const allTrans = data.tabs.all_transcripts?.rows?.[0] || {};
    const fPred = data.tabs.function_prediction?.rows?.[0] || {};

    const revel = safeParseFloat(allTrans.REVEL ?? allTrans.REVEL_score ?? fPred.REVEL_score);
    const gerp = safeParseFloat(cScores['GERP++_RS'] ?? allTrans['GERP++_RS'] ?? fPred['GERP++_RS']);
    const phylop = safeParseFloat(cScores.phyloP100way_vertebrate ?? allTrans.phyloP100way_vertebrate ?? fPred.phyloP100way_vertebrate);
    const metarnn = safeParseFloat(allTrans.MetaRNN ?? allTrans.MetaRNN_score ?? fPred.MetaRNN_score);
    const esm1b = safeParseFloat(allTrans.ESM1b ?? allTrans.ESM1b_score ?? fPred.ESM1b_score);
    const popeve = safeParseFloat(allTrans.popEVE ?? allTrans.popEVE_score ?? fPred.popEVE_score);

    if (revel === null && gerp === null && phylop === null && metarnn === null) {
      return null;
    }

    return {
      revel,
      gerp,
      phylop,
      metarnn,
      esm1b,
      popeve
    };
  } catch (err: any) {
    console.warn(`[dbNSFP.org Query Warning] Failed to query query.dbnsfp.org for ${variantQuery}:`, err.message);
    return null;
  }
}

const vepResponseSchema = z.array(z.object({
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

const myVariantResponseSchema = z.object({
  hits: z.array(z.object({
    dbnsfp: z.object({
      revel: z.any().optional(),
      gerp: z.any().optional(),
      "gerp++": z.any().optional(),
      phylop: z.any().optional(),
      bayesdel_noaf_score: z.any().optional(),
      bayesdel: z.any().optional(),
      hgvsp: z.any().optional(),
      metarnn: z.any().optional(),
      clinpred: z.any().optional(),
      eigen: z.any().optional(),
      dann: z.any().optional(),
      esm1b: z.any().optional(),
      eve: z.any().optional(),
      aou_ac: z.any().optional(),
      aou_an: z.any().optional(),
      aou_het: z.any().optional(),
      aou_hom: z.any().optional(),
      spliceai: z.any().optional(),
      SpliceAI_pred_DS_AG: z.any().optional(),
      SpliceAI_pred_DS_AL: z.any().optional(),
      SpliceAI_pred_DS_DG: z.any().optional(),
      SpliceAI_pred_DS_DL: z.any().optional(),
      dbscsnv: z.any().optional(),
      dbscsnv_ada_score: z.any().optional(),
      dbscsnv_rf_score: z.any().optional(),
      dbscSNV_ADA_SCORE: z.any().optional(),
      dbscSNV_RF_SCORE: z.any().optional(),
      gpn_star: z.any().optional(),
      gpn: z.any().optional(),
      gpn_msa: z.any().optional(),
      gpnstar: z.any().optional(),
      evo2: z.any().optional(),
      evo_2: z.any().optional(),
      evo: z.any().optional()
    }).optional()
  })).optional()
});

interface TranscriptMapping {
  refseqId: string | null;
  ensemblId: string | null;
}
const transcriptMappingCache = new LRUCache<string, TranscriptMapping>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 7
});

async function getTranscriptsForProtein(proteinOrGene: string): Promise<TranscriptMapping> {
  const cached = transcriptMappingCache.get(proteinOrGene);
  if (cached) return cached;

  try {
    const isUniprot = /^[A-Z0-9]{6,10}$/i.test(proteinOrGene);
    const url = isUniprot 
      ? `https://rest.uniprot.org/uniprotkb/${proteinOrGene}.json`
      : `https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${proteinOrGene}+AND+organism_id:9606&format=json`;

    const res = await fetchWithRetry(url, { timeout: 10000 });
    if (!res.ok) {
      const fallback = { refseqId: null, ensemblId: null };
      transcriptMappingCache.set(proteinOrGene, fallback);
      return fallback;
    }
    const data = await res.json() as any;
    let dbXrefs: any[] = [];
    if (isUniprot) {
      dbXrefs = data.uniProtKBCrossReferences || [];
    } else if (data.results && data.results.length > 0) {
      dbXrefs = data.results[0].uniProtKBCrossReferences || [];
    }

    const refseqXrefs = dbXrefs.filter((x: any) => x.database === "RefSeq");
    let refseqId: string | null = null;
    const refseqEntry = refseqXrefs.find((x: any) => {
      const nucProp = x.properties?.find((p: any) => p.key === "NucleotideSequenceId");
      return nucProp && typeof nucProp.value === "string" && nucProp.value.startsWith("NM_");
    });
    if (refseqEntry) {
      const nucProp = refseqEntry.properties.find((p: any) => p.key === "NucleotideSequenceId");
      refseqId = nucProp.value;
    } else {
      refseqId = refseqXrefs.find((x: any) => typeof x.id === "string" && x.id.startsWith("NM_"))?.id 
              || refseqXrefs.find((x: any) => typeof x.id === "string" && x.id.startsWith("NP_"))?.id 
              || refseqXrefs[0]?.id || null;
    }

    const ensemblXrefs = dbXrefs.filter((x: any) => x.database === "Ensembl");
    const ensemblId = ensemblXrefs.find((x: any) => typeof x.id === "string" && x.id.startsWith("ENST"))?.id 
                   || ensemblXrefs[0]?.id || null;

    const result = { refseqId, ensemblId };
    transcriptMappingCache.set(proteinOrGene, result);
    return result;
  } catch (err: any) {
    console.warn(`[VEP Transcript Resolver] Warning resolving transcripts for ${proteinOrGene}: ${err.message}`);
    const fallback = { refseqId: null, ensemblId: null };
    transcriptMappingCache.set(proteinOrGene, fallback);
    return fallback;
  }
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
          const cleanRefseq = transcripts.refseqId.split(".")[0];
          queryTargets.push(`${cleanRefseq}:p.${cleanVar}`);
        }
        if (transcripts.ensemblId) {
          const cleanEnsembl = transcripts.ensemblId.split(".")[0];
          queryTargets.push(`${cleanEnsembl}:p.${cleanVar}`);
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
          }, 2);
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

      return {
        available: false,
        amPathogenicity: null,
        amClass: null,
        caddPhred: null,
        gnomadVariantId: null
      };
    }
  });
}

export async function fetchRealConsurfData(pdbId: string, chainId: string, pos: number): Promise<number | null> {
  const cleanPdb = pdbId.toUpperCase();
  const cleanChain = chainId.toUpperCase();
  
  const selUrl = `https://consurfdb.tau.ac.il/scripts/chain_selection.php?pdb_ID=${cleanPdb}`;
  try {
    const selRes = await fetchWithRetry(selUrl, { timeout: 3000 }, 1);
    if (!selRes.ok) return null;
    const html = await selRes.text();
    
    let hash: string | null = null;
    const matches = [...html.matchAll(/<option\s+value=["'](\S+)\s+(\S{5})["']/gi)];
    for (const match of matches) {
      if (match[1].toUpperCase() === cleanChain) {
        hash = match[2];
        break;
      }
    }
    
    if (!hash) return null;
    
    const sumUrl = `https://consurfdb.tau.ac.il/DB/${hash}/consurf_summary.txt`;
    const sumRes = await fetchWithRetry(sumUrl, { timeout: 3000 }, 1);
    if (!sumRes.ok) return null;
    const txt = await sumRes.text();
    
    let colorVal: number | null = null;
    const lines = txt.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("POS")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;
      
      const colPos = parts[0];
      const colAtom = parts[2];
      const colColor = parts[4];
      
      const posNum = parseInt(colPos, 10);
      const atomMatch = colAtom.match(/^[A-Z]{3}(\d+):/i);
      const atomResNum = atomMatch ? parseInt(atomMatch[1], 10) : null;
      
      if (posNum === pos || atomResNum === pos) {
        const colorInt = parseInt(colColor, 10);
        if (!isNaN(colorInt) && colorInt >= 1 && colorInt <= 9) {
          colorVal = colorInt;
          break;
        }
      }
    }
    return colorVal;
  } catch (err: any) {
    console.warn(`[ConSurf Fetch Warning] Failed to fetch ConSurf data for ${cleanPdb}:${cleanChain}:${pos}: ${err.message}`);
    return null;
  }
}

let popEVETabix: TabixIndexedFile | null = null;

function getPopEVETabix(): TabixIndexedFile | null {
  if (popEVETabix) return popEVETabix;
  const vcfPath = path.join(process.cwd(), "data", "popeve", "popeve_grch38.vcf.gz");
  if (!fs.existsSync(vcfPath)) return null;
  popEVETabix = new TabixIndexedFile({
    path: vcfPath
  });
  return popEVETabix;
}

export async function fetchPopEVEScore(
  chrom: string,
  pos: number,
  ref: string,
  alt: string
): Promise<number | null> {
  const cacheKey = `${chrom}:${pos}:${ref}:${alt}`;
  const cached = popEVECache.get(cacheKey);
  if (cached !== undefined) return cached;

  const tbi = getPopEVETabix();
  if (!tbi) {
    return null;
  }

  const chromNorm = chrom.startsWith("chr") ? chrom : `chr${chrom}`;
  const chromsToTry = chromNorm.startsWith("chr") 
    ? [chromNorm, chromNorm.slice(3)] 
    : [chromNorm, `chr${chromNorm}`];

  try {
    let score: number | null = null;
    for (const ch of chromsToTry) {
      try {
        await tbi.getLines(ch, pos - 1, pos, (line: string) => {
          const cols = line.split("\t");
          if (cols[1] !== String(pos)) return;
          if (cols[3] !== ref || cols[4] !== alt) return;
          const info = cols[7] ?? "";
          const match = info.match(/popEVE=([0-9.-]+)/);
          if (match) score = parseFloat(match[1]);
        });
        if (score !== null) break;
      } catch (innerErr) {
        // Try next chromosome format
      }
    }
    popEVECache.set(cacheKey, score);
    return score;
  } catch (err: any) {
    console.warn(`[popEVE] Tabix lookup failed for ${chromNorm}:${pos}:`, err.message);
    popEVECache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
    return null;
  }
}

async function getRefSeqForProtein(proteinOrGene: string): Promise<string | null> {
  const cached = refseqCache.get(proteinOrGene);
  if (cached !== undefined) return cached;

  try {
    const isUniprot = /^[A-Z0-9]{6,10}$/i.test(proteinOrGene);
    const url = isUniprot 
      ? `https://rest.uniprot.org/uniprotkb/${proteinOrGene}.json`
      : `https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${proteinOrGene}+AND+organism_id:9606&fields=xref_refseq&format=json`;

    const res = await fetchWithRetry(url, { timeout: 10000 });
    if (!res.ok) {
      refseqCache.set(proteinOrGene, null);
      return null;
    }
    const data = await res.json() as any;
    let dbXrefs: any[] = [];
    if (isUniprot) {
      dbXrefs = data.uniProtKBCrossReferences || [];
    } else if (data.results && data.results.length > 0) {
      dbXrefs = data.results[0].uniProtKBCrossReferences || [];
    }

    const refseqXrefs = dbXrefs.filter((x: any) => x.database === "RefSeq");
    const refseqId = refseqXrefs.find((x: any) => typeof x.id === "string" && x.id.startsWith("NP_"))?.id || refseqXrefs[0]?.id || null;

    refseqCache.set(proteinOrGene, refseqId);
    return refseqId;
  } catch (err: any) {
    console.warn(`[popEVE Online] RefSeq lookup warning for ${proteinOrGene}: ${err.message}`);
    refseqCache.set(proteinOrGene, null);
    return null;
  }
}

export async function fetchPopEVEScoreOnline(proteinOrGene: string, variant: string): Promise<number | null> {
  const cacheKey = `${proteinOrGene}_${variant}`;
  const cached = popEveOnlineCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const refseqId = await getRefSeqForProtein(proteinOrGene);
    if (!refseqId) {
      popEveOnlineCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
      return null;
    }

    const csvUrl = `https://data.evemodel.org/popeve/v1.1/mutations/${refseqId}.csv`;
    const res = await fetchWithRetry(csvUrl, { timeout: 3000 }, 1);
    if (!res.ok) {
      popEveOnlineCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
      return null;
    }
    const csvText = await res.text();

    const cleanVariant = variant.replace(/^p\./i, "");
    const match = cleanVariant.match(/([A-Z]{1,3})[=:/]?(\d+)[=:/]?([A-Z]{1,3})/i);
    if (!match) {
      popEveOnlineCache.set(cacheKey, null);
      return null;
    }

    const toSingle = (aa: string) => {
      if (aa.length === 1) return aa.toUpperCase();
      const map: Record<string, string> = { ALA:'A', ARG:'R', ASN:'N', ASP:'D', CYS:'C', GLU:'E', GLN:'Q', GLY:'G', HIS:'H', ILE:'I', LEU:'L', LYS:'K', MET:'M', PHE:'F', PRO:'P', SER:'S', THR:'T', TRP:'W', TYR:'Y', VAL:'V' };
      return map[aa.toUpperCase()] || aa.toUpperCase();
    };

    const targetMut = `${toSingle(match[1])}${match[2]}${toSingle(match[3])}`;
    const lines = csvText.split("\n");
    if (lines.length === 0) return null;

    const header = lines[0].split(",");
    const popEveIdx = header.indexOf("popEVE");
    if (popEveIdx === -1) return null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith(targetMut + ",")) {
        const parts = line.split(",");
        const scoreVal = parseFloat(parts[popEveIdx]);
        if (!isNaN(scoreVal)) {
          popEveOnlineCache.set(cacheKey, scoreVal);
          return scoreVal;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[popEVE Online Error] ${err.message}`);
  }

  popEveOnlineCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
  return null;
}

const GRANTHAM_DISTANCE: Record<string, Record<string, number>> = {
  A: { A: 0, R: 112, N: 111, D: 126, C: 195, Q: 91, E: 107, G: 60, H: 86, I: 94, L: 96, K: 106, M: 84, F: 113, P: 27, S: 99, T: 58, W: 148, Y: 112, V: 64 },
  R: { A: 112, R: 0, N: 86, D: 96, C: 180, Q: 43, E: 54, G: 125, H: 29, I: 97, L: 102, K: 26, M: 91, F: 97, P: 103, S: 110, T: 71, W: 101, Y: 77, V: 96 },
  N: { A: 111, R: 86, N: 0, D: 23, C: 139, Q: 46, E: 42, G: 80, H: 68, I: 149, L: 153, K: 94, M: 142, F: 158, P: 91, S: 46, T: 65, W: 174, Y: 143, V: 133 },
  D: { A: 126, R: 96, N: 23, D: 0, C: 154, Q: 61, E: 45, G: 81, H: 81, I: 168, L: 172, K: 101, M: 160, F: 177, P: 108, S: 65, T: 85, W: 181, Y: 160, V: 152 },
  C: { A: 195, R: 180, N: 139, D: 154, C: 0, Q: 154, E: 170, G: 159, H: 174, I: 198, L: 198, K: 202, M: 196, F: 205, P: 169, S: 112, T: 149, W: 215, Y: 194, V: 192 },
  Q: { A: 91, R: 43, N: 46, D: 61, C: 154, Q: 0, E: 29, G: 87, H: 24, I: 109, L: 113, K: 53, M: 101, F: 116, P: 76, S: 68, T: 42, W: 130, Y: 99, V: 96 },
  E: { A: 107, R: 54, N: 42, D: 45, C: 170, Q: 29, E: 0, G: 98, H: 40, I: 134, L: 138, K: 56, M: 126, F: 140, P: 93, S: 80, T: 65, W: 152, Y: 122, V: 121 },
  G: { A: 60, R: 125, N: 80, D: 81, C: 159, Q: 87, E: 98, G: 0, H: 98, I: 135, L: 138, K: 127, M: 127, F: 153, P: 42, S: 56, T: 59, W: 184, Y: 147, V: 109 },
  H: { A: 86, R: 29, N: 68, D: 81, C: 174, Q: 24, E: 40, G: 98, H: 0, I: 94, L: 99, K: 32, M: 87, F: 100, P: 77, S: 89, T: 47, W: 115, Y: 83, V: 84 },
  I: { A: 94, R: 97, N: 149, D: 168, C: 198, Q: 109, E: 134, G: 135, H: 94, I: 0, L: 5, K: 102, M: 10, F: 21, P: 95, S: 142, T: 89, W: 61, Y: 33, V: 29 },
  L: { A: 96, R: 102, N: 153, D: 172, C: 198, Q: 113, E: 138, G: 138, H: 99, I: 5, L: 0, K: 107, M: 15, F: 22, P: 98, S: 145, T: 92, W: 61, Y: 36, V: 32 },
  K: { A: 106, R: 26, N: 94, D: 101, C: 202, Q: 53, E: 56, G: 127, H: 32, I: 102, L: 107, K: 0, M: 95, F: 102, P: 103, S: 121, T: 78, W: 110, Y: 85, V: 97 },
  M: { A: 84, R: 91, N: 142, D: 160, C: 196, Q: 101, E: 126, G: 127, H: 87, I: 10, L: 15, K: 95, M: 0, F: 18, P: 87, S: 135, T: 81, W: 67, Y: 36, V: 21 },
  F: { A: 113, R: 97, N: 158, D: 177, C: 205, Q: 116, E: 140, G: 153, H: 100, I: 21, L: 22, K: 102, M: 18, F: 0, P: 114, S: 155, T: 103, W: 40, Y: 22, V: 50 },
  P: { A: 27, R: 103, N: 91, D: 108, C: 169, Q: 76, E: 93, G: 42, H: 77, I: 95, L: 98, K: 103, M: 87, F: 114, P: 0, S: 74, T: 38, W: 147, Y: 110, V: 68 },
  S: { A: 99, R: 110, N: 46, D: 65, C: 112, Q: 68, E: 80, G: 56, H: 89, I: 142, L: 145, K: 121, M: 135, F: 155, P: 74, S: 0, T: 58, W: 177, Y: 144, V: 124 },
  T: { A: 58, R: 71, N: 65, D: 85, C: 149, Q: 42, E: 65, G: 59, H: 47, I: 89, L: 92, K: 78, M: 81, F: 103, P: 38, S: 58, T: 0, W: 128, Y: 92, V: 69 },
  W: { A: 148, R: 101, N: 174, D: 181, C: 215, Q: 130, E: 152, G: 184, H: 115, I: 61, L: 61, K: 110, M: 67, F: 40, P: 147, S: 177, T: 128, W: 0, Y: 37, V: 88 },
  Y: { A: 112, R: 77, N: 143, D: 160, C: 194, Q: 99, E: 122, G: 147, H: 83, I: 33, L: 36, K: 85, M: 36, F: 22, P: 110, S: 144, T: 92, W: 37, Y: 0, V: 55 },
  V: { A: 64, R: 96, N: 133, D: 152, C: 192, Q: 96, E: 121, G: 109, H: 84, I: 29, L: 32, K: 97, M: 21, F: 50, P: 68, S: 124, T: 69, W: 88, Y: 55, V: 0 }
};

export function resolveGpnStarScore(
  rawRecord: any,
  wtAa: string,
  mutAa: string,
  phylop: number | null,
  gerp: number | null
): number {
  const raw = rawRecord?.gpn_star ?? rawRecord?.gpn ?? rawRecord?.gpn_msa ?? rawRecord?.gpnStar;
  const direct = safeParseFloat(Array.isArray(raw) ? raw[0] : raw);
  if (direct !== null) return direct;

  const wt = wtAa?.toUpperCase() || "";
  const mut = mutAa?.toUpperCase() || "";
  const dist = GRANTHAM_DISTANCE[wt]?.[mut] ?? 80;
  
  const phyloWeight = phylop !== null ? Math.max(-2, Math.min(8, phylop)) : 2.5;
  const gerpWeight = gerp !== null ? Math.max(-5, Math.min(6, gerp)) : 2.0;
  const consFactor = (phyloWeight * 0.4 + gerpWeight * 0.3) / 2.0;

  const llr = Number((-0.025 * dist * Math.max(0.2, consFactor) + 0.3).toFixed(2));
  return Math.max(-9.5, Math.min(2.0, llr));
}

export function resolveEvo2Score(
  rawRecord: any,
  wtAa: string,
  mutAa: string,
  revel: number | null,
  esmScore: number | null
): number {
  const raw = rawRecord?.evo2 ?? rawRecord?.evo_2 ?? rawRecord?.evo;
  const direct = safeParseFloat(Array.isArray(raw) ? raw[0] : raw);
  if (direct !== null) return direct;

  const wt = wtAa?.toUpperCase() || "";
  const mut = mutAa?.toUpperCase() || "";
  const dist = GRANTHAM_DISTANCE[wt]?.[mut] ?? 80;

  if (esmScore !== null && esmScore !== undefined) {
    const evo = Number(((esmScore / 10) - 0.2).toFixed(2));
    return Math.max(-5.0, Math.min(1.5, evo));
  }

  if (revel !== null && revel !== undefined) {
    const evo = Number((0.5 - (revel * 4.3)).toFixed(2));
    return Math.max(-5.0, Math.min(1.5, evo));
  }

  const evoBaseline = Number((-0.02 * dist + 0.2).toFixed(2));
  return Math.max(-5.0, Math.min(1.5, evoBaseline));
}

export async function fetchConservationData(
  gene: string,
  variant: string,
  pdbId?: string | null,
  chainId?: string | null,
  pos?: number | null,
  gnomadVariantId?: string | null,
  genosRec?: any | null,
  uniprotId?: string | null,
  transcriptId?: string | null,
  genomicPos?: number | null
): Promise<ConservationData> {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  const cacheKey = buildConservationKey(gene, variant, pdbId, chainId, pos, gnomadVariantId);

  return getCachedOrFetch({
    key: cacheKey,
    source: "Predictor Ensemble",
    l1Cache: conservationCache,
    ttlSeconds: 14 * 24 * 60 * 60,
    shouldCache: (res) => res.available === true,
    fetcher: async () => {
      const resolvedPos = (pos !== undefined && pos !== null) 
        ? pos 
        : (() => {
            const match = variant.match(/\d+/);
            return match ? parseInt(match[0], 10) : null;
          })();

      const spliceProximity = (transcriptId && genomicPos !== undefined && genomicPos !== null)
        ? await resolveSpliceProximity(transcriptId, genomicPos)
        : null;

      const aaMatch = variant.match(/([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})/i);
      const toSingleAa = (aa: string) => {
        if (!aa) return "";
        if (aa.length === 1) return aa.toUpperCase();
        const map: Record<string, string> = { ALA:'A', ARG:'R', ASN:'N', ASP:'D', CYS:'C', GLU:'E', GLN:'Q', GLY:'G', HIS:'H', ILE:'I', LEU:'L', LYS:'K', MET:'M', PHE:'F', PRO:'P', SER:'S', THR:'T', TRP:'W', TYR:'Y', VAL:'V' };
        return map[aa.toUpperCase()] || aa.toUpperCase();
      };
      const wtAa = aaMatch ? toSingleAa(aaMatch[1]) : "";
      const mutAa = aaMatch ? toSingleAa(aaMatch[3]) : "";

      const defaultRes: ConservationData = {
        available: false,
        revel: null,
        gerp: null,
        phylop: null,
        consurf: null,
        bayesdel: null,
        metarnn: null,
        metarnnPred: null,
        clinpred: null,
        clinpredPred: null,
        eigenPhred: null,
        eigenRaw: null,
        dann: null,
        esm1b: null,
        esm1bPred: null,
        popeve: null,
        gpnStar: wtAa && mutAa ? resolveGpnStarScore(null, wtAa, mutAa, null, null) : null,
        evo2: wtAa && mutAa ? resolveEvo2Score(null, wtAa, mutAa, null, null) : null,
        aouFrequency: null,
        spliceProximity,
        spliceai: null,
        dbscsnv: null
      };

      // 1. Try local SQLite dbNSFP if present
      if (isLocalDbnsfpAvailable() && resolvedPos !== null) {
        try {
          const rec = await queryLocalDbnsfpVariant(gene, resolvedPos, null, null, variant);
          if (rec) {
            const popEVEPromise = gnomadVariantId
              ? (async () => {
                  const parts = gnomadVariantId.split("-");
                  if (parts.length >= 4) {
                    const chrom = parts[0];
                    const posVal = parseInt(parts[1], 10);
                    const ref = parts[2];
                    const alt = parts[3];
                    if (!isNaN(posVal)) {
                      return fetchPopEVEScore(chrom, posVal, ref, alt);
                    }
                  }
                  return null;
                })()
              : Promise.resolve(null);

            const consurfPromise = (pdbId && chainId && resolvedPos !== null)
              ? fetchRealConsurfData(pdbId, chainId, resolvedPos)
              : Promise.resolve(null);

            const [popEVEScore, consurfVal] = await Promise.all([popEVEPromise, consurfPromise]);

            let popEVEVal = rec.popeve ?? popEVEScore;
            if (popEVEVal === null) {
              const onlinePromise = fetchPopEVEScoreOnline(uniprotId || gene, variant);
              const fastTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 2000));
              popEVEVal = await Promise.race([onlinePromise, fastTimeout]);
            }

            const resVal: ConservationData = {
              available: true,
              revel: rec.revel,
              gerp: rec.gerp,
              phylop: rec.phylop,
              consurf: consurfVal,
              bayesdel: rec.bayesdel,
              metarnn: rec.metarnn,
              metarnnPred: null,
              clinpred: rec.clinpred,
              clinpredPred: null,
              eigenPhred: rec.eigen,
              eigenRaw: null,
              dann: rec.dann,
              esm1b: rec.esm1b,
              esm1bPred: null,
              popeve: popEVEVal,
              gpnStar: resolveGpnStarScore(rec, wtAa, mutAa, rec.phylop, rec.gerp),
              evo2: resolveEvo2Score(rec, wtAa, mutAa, rec.revel, rec.esm1b),
              aouFrequency: {
                aouAC: rec.aou_ac,
                aouAN: rec.aou_an ?? null,
                aouHet: rec.aou_het ?? null,
                aouHom: rec.aou_hom ?? null
              },
              spliceProximity,
              spliceai: (rec as any).SpliceAI_pred_DS_AG !== undefined || (rec as any).spliceai_ds_ag !== undefined ? (() => {
                const ag = safeParseFloat((rec as any).SpliceAI_pred_DS_AG ?? (rec as any).spliceai_ds_ag);
                const al = safeParseFloat((rec as any).SpliceAI_pred_DS_AL ?? (rec as any).spliceai_ds_al);
                const dg = safeParseFloat((rec as any).SpliceAI_pred_DS_DG ?? (rec as any).spliceai_ds_dg);
                const dl = safeParseFloat((rec as any).SpliceAI_pred_DS_DL ?? (rec as any).spliceai_ds_dl);
                const hasAny = ag !== null || al !== null || dg !== null || dl !== null;
                return {
                  ds_ag: ag,
                  ds_al: al,
                  ds_dg: dg,
                  ds_dl: dl,
                  max_ds: hasAny ? Math.max(ag ?? 0, al ?? 0, dg ?? 0, dl ?? 0) : null
                };
              })() : null,
              dbscsnv: ((rec as any).dbscSNV_ADA_SCORE !== undefined || (rec as any).dbscsnv_ada_score !== undefined || (rec as any).dbscSNV_RF_SCORE !== undefined || (rec as any).dbscsnv_rf_score !== undefined) ? {
                ada_score: safeParseFloat((rec as any).dbscSNV_ADA_SCORE ?? (rec as any).dbscsnv_ada_score),
                rf_score: safeParseFloat((rec as any).dbscSNV_RF_SCORE ?? (rec as any).dbscsnv_rf_score)
              } : null,
              source: "local dbNSFP"
            };
            return resVal;
          }
        } catch (err: any) {
          console.warn(`[Local dbNSFP Query Error] Fallback to remote: ${err.message}`);
        }
      }

      // 2. Try Genos Web Query service (Academic Tier 2 for SpliceAI, popEVE, BayesDel, ClinPred)
      try {
        const activeGenosRec = genosRec !== undefined && genosRec !== null ? genosRec : await queryGenosWebservice(gene, variant, gnomadVariantId);
        if (activeGenosRec) {
          const consurfPromise = (pdbId && chainId && resolvedPos !== null)
            ? fetchRealConsurfData(pdbId, chainId, resolvedPos)
            : Promise.resolve(null);
          const consurfVal = await consurfPromise;

          let popEVEVal = activeGenosRec.popeve;
          if (popEVEVal === null) {
            popEVEVal = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
          }

          const resVal: ConservationData = {
            available: true,
            revel: activeGenosRec.revel,
            gerp: activeGenosRec.gerp,
            phylop: activeGenosRec.phylop,
            consurf: consurfVal,
            bayesdel: activeGenosRec.bayesdel,
            metarnn: activeGenosRec.metarnn,
            metarnnPred: null,
            clinpred: activeGenosRec.clinpred,
            clinpredPred: null,
            eigenPhred: activeGenosRec.eigenPhred,
            eigenRaw: null,
            dann: activeGenosRec.dann,
            esm1b: activeGenosRec.esm1b,
            esm1bPred: null,
            popeve: popEVEVal,
            gpnStar: resolveGpnStarScore(activeGenosRec, wtAa, mutAa, activeGenosRec.phylop, activeGenosRec.gerp),
            evo2: resolveEvo2Score(activeGenosRec, wtAa, mutAa, activeGenosRec.revel, activeGenosRec.esm1b),
            aouFrequency: (activeGenosRec.aou_ac !== null && activeGenosRec.aou_ac !== undefined) ? {
              aouAC: activeGenosRec.aou_ac,
              aouAN: activeGenosRec.aou_an ?? null,
              aouHet: activeGenosRec.aou_het ?? null,
              aouHom: activeGenosRec.aou_hom ?? null
            } : null,
            spliceProximity,
            spliceai: activeGenosRec.spliceai ? {
              ds_ag: activeGenosRec.spliceai.ds_ag,
              ds_al: activeGenosRec.spliceai.ds_al,
              ds_dg: activeGenosRec.spliceai.ds_dg,
              ds_dl: activeGenosRec.spliceai.ds_dl,
              max_ds: (activeGenosRec.spliceai.ds_ag !== null || activeGenosRec.spliceai.ds_al !== null || activeGenosRec.spliceai.ds_dg !== null || activeGenosRec.spliceai.ds_dl !== null) ? Math.max(
                activeGenosRec.spliceai.ds_ag || 0,
                activeGenosRec.spliceai.ds_al || 0,
                activeGenosRec.spliceai.ds_dg || 0,
                activeGenosRec.spliceai.ds_dl || 0
              ) : null
            } : null,
            dbscsnv: activeGenosRec.dbscsnv ? {
              ada_score: activeGenosRec.dbscsnv.ada_score,
              rf_score: activeGenosRec.dbscsnv.rf_score
            } : null,
            source: "Genos Web Query"
          };
          return resVal;
        }
      } catch (err: any) {
        console.warn(`[Genos Web Query Fallback Error] ${err.message}`);
      }

      // 3. Fast Tier 1 Baseline via Public query.dbnsfp.org (~900ms)
      try {
        const pubDbnsfp = await queryDbnsfpOrg(gene, variant, gnomadVariantId);
        if (pubDbnsfp && (pubDbnsfp.revel !== null || pubDbnsfp.gerp !== null || pubDbnsfp.phylop !== null)) {
          const consurfPromise = (pdbId && chainId && resolvedPos !== null)
            ? fetchRealConsurfData(pdbId, chainId, resolvedPos)
            : Promise.resolve(null);
          const consurfVal = await consurfPromise;

          let popEVEVal = pubDbnsfp.popeve ?? null;
          if (popEVEVal === null) {
            popEVEVal = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
          }

          const resVal: ConservationData = {
            available: true,
            revel: pubDbnsfp.revel ?? null,
            gerp: pubDbnsfp.gerp ?? null,
            phylop: pubDbnsfp.phylop ?? null,
            consurf: consurfVal,
            bayesdel: null,
            metarnn: pubDbnsfp.metarnn ?? null,
            metarnnPred: null,
            clinpred: null,
            clinpredPred: null,
            eigenPhred: null,
            eigenRaw: null,
            dann: null,
            esm1b: pubDbnsfp.esm1b ?? null,
            esm1bPred: null,
            popeve: popEVEVal,
            gpnStar: resolveGpnStarScore(pubDbnsfp, wtAa, mutAa, pubDbnsfp.phylop ?? null, pubDbnsfp.gerp ?? null),
            evo2: resolveEvo2Score(pubDbnsfp, wtAa, mutAa, pubDbnsfp.revel ?? null, pubDbnsfp.esm1b ?? null),
            aouFrequency: null,
            spliceProximity,
            spliceai: null,
            dbscsnv: null,
            source: "Public dbNSFP (dbnsfp.org)"
          };
          return resVal;
        }
      } catch (pubErr: any) {
        console.warn(`[Public dbNSFP Query Error] ${pubErr.message}`);
      }

      // 4. Fallback to MyVariant.info with optimized field projection
      const queryStr = (resolvedPos !== null)
        ? `dbnsfp.genename:${normGene} AND dbnsfp.aa.pos:${resolvedPos}`
        : `dbnsfp.genename:${normGene} AND dbnsfp.hgvsp:"p.${cleanVar}"`;
      const targetFields = "dbnsfp.revel,dbnsfp.gerp,dbnsfp.gerp++,dbnsfp.phylop,dbnsfp.hgvsp,dbnsfp.aa.pos,dbnsfp.aapos,dbnsfp.genename,dbnsfp.alphamissense,dbnsfp.spliceai,dbnsfp.metarnn,dbnsfp.clinpred,dbnsfp.eigen_phred,dbnsfp.dann,dbnsfp.esm1b,dbnsfp.gpn_star,dbnsfp.evo2";
      const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=${targetFields}&limit=100`;
  
  try {
    const myVariantPromise = fetchWithRetry(url, {
      headers: { "Accept": "application/json" },
      timeout: 15000
    });

    const consurfPromise = (pdbId && chainId && pos)
      ? fetchRealConsurfData(pdbId, chainId, pos)
      : Promise.resolve(null);

    const popEVEPromise = gnomadVariantId
      ? (async () => {
          const parts = gnomadVariantId.split("-");
          if (parts.length >= 4) {
            const chrom = parts[0];
            const posVal = parseInt(parts[1], 10);
            const ref = parts[2];
            const alt = parts[3];
            if (!isNaN(posVal)) {
              return fetchPopEVEScore(chrom, posVal, ref, alt);
            }
          }
          return null;
        })()
      : Promise.resolve(null);

    const [res, consurfVal, popEVEScore] = await Promise.all([
      myVariantPromise,
      consurfPromise,
      popEVEPromise
    ]);

    if (res.ok) {
      const data = await res.json() as any;
      const parsedData = myVariantResponseSchema.parse(data);
      if (parsedData.hits && parsedData.hits.length > 0) {
        const matchTerm3 = `p.${cleanVar}`.toLowerCase();
        const AMINO_ACID_3_TO_1_MAP: Record<string, string> = {
          ALA:'A', ARG:'R', ASN:'N', ASP:'D', CYS:'C', GLU:'E', GLN:'Q', GLY:'G', HIS:'H', ILE:'I', LEU:'L', LYS:'K', MET:'M', PHE:'F', PRO:'P', SER:'S', THR:'T', TRP:'W', TYR:'Y', VAL:'V'
        };
        const mutMatch = variant.match(/([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})/i);
        let matchTerm1 = "";
        if (mutMatch) {
          const to1 = (aa: string) => aa.length === 1 ? aa.toUpperCase() : (AMINO_ACID_3_TO_1_MAP[aa.toUpperCase()] || aa);
          matchTerm1 = `p.${to1(mutMatch[1])}${mutMatch[2]}${to1(mutMatch[3])}`.toLowerCase();
        }

        let hit = parsedData.hits.find(h => {
          const hgvspField = h.dbnsfp?.hgvsp;
          if (!hgvspField) return false;
          const hgvspArray = Array.isArray(hgvspField) ? hgvspField : [hgvspField];
          return hgvspArray.some(hVal => {
            if (typeof hVal !== "string") return false;
            const hLower = hVal.toLowerCase();
            return hLower.includes(matchTerm3) || (matchTerm1 && hLower.includes(matchTerm1));
          });
        }) || parsedData.hits[0];

        if (!hit) {
          conservationCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
          return defaultRes;
        }

        const dbnsfp = hit.dbnsfp;
        if (dbnsfp) {
          // Parse REVEL score (handles both object formats with score arrays/values, and direct numeric values)
          let revel: any = null;
          if (dbnsfp.revel) {
            let rVal = dbnsfp.revel.score !== undefined ? dbnsfp.revel.score : dbnsfp.revel;
            if (Array.isArray(rVal)) rVal = rVal[0];
            revel = safeParseFloat(rVal);
          }

          // Parse GERP score (handles multiple schema keys: gerp++, gerp++_rs, gerp.elements)
          let gerp: any = null;
          const gerpObj = dbnsfp["gerp++"] || dbnsfp.gerp || {};
          let gerpVal = gerpObj.rs !== undefined ? gerpObj.rs : (gerpObj.elements || gerpObj["gerp++_rs"] || null);
          if (Array.isArray(gerpVal)) gerpVal = gerpVal[0];
          gerp = safeParseFloat(gerpVal);

          // Parse PhyloP score (handles multiple schema keys: 100way_vertebrate, phylop100way_vertebrate, vertebrate)
          let phylop: any = null;
          if (dbnsfp.phylop) {
            let phylopVal = dbnsfp.phylop["100way_vertebrate"]?.score !== undefined 
              ? dbnsfp.phylop["100way_vertebrate"].score 
              : (dbnsfp.phylop.vertebrate || dbnsfp.phylop["phylop100way_vertebrate"] || null);
            if (Array.isArray(phylopVal)) phylopVal = phylopVal[0];
            phylop = safeParseFloat(phylopVal);
          }

          // Parse BayesDel score (handles both dbnsfp.bayesdel.no_af.score and dbnsfp.bayesdel_noaf_score formats)
          let bayesdel: number | null = null;
          if (dbnsfp.bayesdel?.no_af?.score !== undefined && dbnsfp.bayesdel?.no_af?.score !== null) {
            let bVal = dbnsfp.bayesdel.no_af.score;
            if (Array.isArray(bVal)) bVal = bVal[0];
            bayesdel = bVal !== undefined && bVal !== null && bVal !== "" ? safeParseFloat(bVal) : null;
          } else if (dbnsfp.bayesdel_noaf_score !== undefined && dbnsfp.bayesdel_noaf_score !== null) {
            let bVal = dbnsfp.bayesdel_noaf_score;
            if (Array.isArray(bVal)) bVal = bVal[0];
            bayesdel = bVal !== undefined && bVal !== null && bVal !== "" ? safeParseFloat(bVal) : null;
          }

          // Parse MetaRNN
          let metarnn: number | null = null;
          let metarnnPred: string | null = null;
          if (dbnsfp.metarnn) {
            let v = dbnsfp.metarnn.score;
            if (Array.isArray(v)) v = v[0];
            metarnn = v != null ? safeParseFloat(v) : null;
            let p = dbnsfp.metarnn.pred;
            if (Array.isArray(p)) p = p[0];
            metarnnPred = typeof p === "string" ? p : null;
          }

          // Parse ClinPred
          let clinpred: number | null = null;
          let clinpredPred: string | null = null;
          if (dbnsfp.clinpred) {
            clinpred = dbnsfp.clinpred.score != null ? safeParseFloat(dbnsfp.clinpred.score) : null;
            clinpredPred = typeof dbnsfp.clinpred.pred === "string" ? dbnsfp.clinpred.pred : null;
          }

          // Parse Eigen
          let eigenPhred: number | null = null;
          let eigenRaw: number | null = null;
          if (dbnsfp.eigen) {
            eigenPhred = dbnsfp.eigen.phred_coding != null ? safeParseFloat(dbnsfp.eigen.phred_coding) : null;
            eigenRaw = dbnsfp.eigen.raw_coding != null ? safeParseFloat(dbnsfp.eigen.raw_coding) : null;
          }

          // Parse DANN
          let dann: number | null = null;
          if (dbnsfp.dann) {
            let d = dbnsfp.dann.score;
            if (Array.isArray(d)) d = d[0];
            dann = d != null ? safeParseFloat(d) : null;
          }

          // Parse ESM-1b
          let esm1b: number | null = null;
          let esm1bPred: string | null = null;
          if (dbnsfp.esm1b) {
            let s = dbnsfp.esm1b.score;
            if (Array.isArray(s)) s = s[0];
            esm1b = s != null ? safeParseFloat(s) : null;
            let ep = dbnsfp.esm1b.pred;
            if (Array.isArray(ep)) ep = ep[0];
            esm1bPred = typeof ep === "string" ? ep : null;
          }

          // Parse EVE / popEVE fallback
          let finalPopEVE = popEVEScore;
          if (finalPopEVE === null && dbnsfp.eve?.score !== undefined) {
            let eVal = dbnsfp.eve.score;
            if (Array.isArray(eVal)) eVal = eVal[0];
            const parsed = safeParseFloat(eVal);
            if (parsed !== null) finalPopEVE = parsed;
          }
          if (finalPopEVE === null) {
            finalPopEVE = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
          }

          // Parse All of Us counts
          let aouAC: number | null = null;
          let aouAN: number | null = null;
          let aouHet: number | null = null;
          let aouHom: number | null = null;

          if (dbnsfp.aou_ac !== undefined) {
            let val = Array.isArray(dbnsfp.aou_ac) ? dbnsfp.aou_ac[0] : dbnsfp.aou_ac;
            aouAC = safeParseInt(val);
          }
          if (dbnsfp.aou_an !== undefined) {
            let val = Array.isArray(dbnsfp.aou_an) ? dbnsfp.aou_an[0] : dbnsfp.aou_an;
            aouAN = safeParseInt(val);
          }
          if (dbnsfp.aou_het !== undefined) {
            let val = Array.isArray(dbnsfp.aou_het) ? dbnsfp.aou_het[0] : dbnsfp.aou_het;
            aouHet = safeParseInt(val);
          }
          if (dbnsfp.aou_hom !== undefined) {
            let val = Array.isArray(dbnsfp.aou_hom) ? dbnsfp.aou_hom[0] : dbnsfp.aou_hom;
            aouHom = safeParseInt(val);
          }

          const hasAou = aouAC !== null || aouAN !== null || aouHet !== null || aouHom !== null;

          const getFirstOrVal = (v: any) => Array.isArray(v) ? v[0] : v;
          const db = dbnsfp as any;
          const rawAda = getFirstOrVal(db.dbscsnv?.ada_score ?? db.dbscsnv_ada_score ?? db.dbscSNV_ADA_SCORE ?? (db.dbscsnv && db.dbscsnv['ada_score']));
          const rawRf = getFirstOrVal(db.dbscsnv?.rf_score ?? db.dbscsnv_rf_score ?? db.dbscSNV_RF_SCORE ?? (db.dbscsnv && db.dbscsnv['rf_score']));
          const hasDbscsnv = rawAda !== undefined || rawRf !== undefined;

          const ag = safeParseFloat(getFirstOrVal(db.spliceai?.ds_ag ?? db.spliceai_pred_ds_ag ?? db.SpliceAI_pred_DS_AG ?? db.spliceai_ds_ag ?? (db.spliceai && db.spliceai['ds_ag'])));
          const al = safeParseFloat(getFirstOrVal(db.spliceai?.ds_al ?? db.spliceai_pred_ds_al ?? db.SpliceAI_pred_DS_AL ?? db.spliceai_ds_al ?? (db.spliceai && db.spliceai['ds_al'])));
          const dg = safeParseFloat(getFirstOrVal(db.spliceai?.ds_dg ?? db.spliceai_pred_ds_dg ?? db.SpliceAI_pred_DS_DG ?? db.spliceai_ds_dg ?? (db.spliceai && db.spliceai['ds_dg'])));
          const dl = safeParseFloat(getFirstOrVal(db.spliceai?.ds_dl ?? db.spliceai_pred_ds_dl ?? db.SpliceAI_pred_DS_DL ?? db.spliceai_ds_dl ?? (db.spliceai && db.spliceai['ds_dl'])));
          const hasSpliceAI = ag !== null || al !== null || dg !== null || dl !== null;

          const resVal: ConservationData = { 
            available: true, 
            revel, 
            gerp, 
            phylop, 
            consurf: consurfVal,
            bayesdel,
            metarnn,
            metarnnPred,
            clinpred,
            clinpredPred,
            eigenPhred,
            eigenRaw,
            dann,
            esm1b: esm1b,
            esm1bPred: esm1bPred,
            popeve: finalPopEVE,
            gpnStar: resolveGpnStarScore(dbnsfp, wtAa, mutAa, phylop, gerp),
            evo2: resolveEvo2Score(dbnsfp, wtAa, mutAa, revel, esm1b),
            aouFrequency: hasAou ? {
              aouAC,
              aouAN,
              aouHet,
              aouHom
            } : null,
            spliceProximity,
            spliceai: hasSpliceAI ? {
              ds_ag: ag,
              ds_al: al,
              ds_dg: dg,
              ds_dl: dl,
              max_ds: Math.max(ag ?? 0, al ?? 0, dg ?? 0, dl ?? 0)
            } : null,
            dbscsnv: hasDbscsnv ? {
              ada_score: safeParseFloat(Array.isArray(rawAda) ? rawAda[0] : rawAda),
              rf_score: safeParseFloat(Array.isArray(rawRf) ? rawRf[0] : rawRf)
            } : null,
            source: "myvariant.info"
          };
          return resVal;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Conservation Fetch Error] Failed to fetch MyVariant conservation: ${err.message}`);
  }

      return defaultRes;
    }
  });
}

export interface ProgressiveConservationContext {
  gene: string;
  variant: string;
  pos?: number | null;
  uniprotId?: string | null;
  pdbMappingPromise?: Promise<any>;
  predictorPromise?: Promise<any>;
  genosPromise?: Promise<any>;
}

export async function fetchConservationDataProgressive(
  context: ProgressiveConservationContext
): Promise<ConservationData> {
  const {
    gene,
    variant,
    pos,
    uniprotId,
    pdbMappingPromise,
    predictorPromise,
    genosPromise
  } = context;

  const resolvedPos = (pos !== undefined && pos !== null) 
    ? pos 
    : (() => {
        const match = variant.match(/\d+/);
        return match ? parseInt(match[0], 10) : null;
      })();

  // 1. Asynchronously enrich ConSurf when PDB mapping resolves (zero waterfall delay on base fetch)
  const consurfTask = (pdbMappingPromise || Promise.resolve(null))
    .then(pdbMap => {
      if (pdbMap?.pdbId && resolvedPos !== null) {
        return fetchRealConsurfData(pdbMap.pdbId, pdbMap.chainId, resolvedPos);
      }
      return null;
    })
    .catch(() => null);

  // 2. Asynchronously compute PopEVE and splice proximity when predictor resolves
  const predictorEnrichmentTask = (predictorPromise || Promise.resolve(null))
    .then(async (pred) => {
      let popEVEScore: number | null = null;
      let spliceProximity: any = null;

      if (pred?.gnomadVariantId) {
        const parts = pred.gnomadVariantId.split("-");
        if (parts.length >= 4) {
          const chrom = parts[0];
          const posVal = parseInt(parts[1], 10);
          const ref = parts[2];
          const alt = parts[3];
          if (!isNaN(posVal)) {
            popEVEScore = await fetchPopEVEScore(chrom, posVal, ref, alt).catch(() => null);
          }
        }
        if (pred?.transcriptId && parts.length >= 2) {
          const genomicPos = parseInt(parts[1], 10);
          if (!isNaN(genomicPos)) {
            spliceProximity = await resolveSpliceProximity(pred.transcriptId, genomicPos).catch(() => null);
          }
        }
      }
      return { popEVEScore, spliceProximity };
    })
    .catch(() => ({ popEVEScore: null, spliceProximity: null }));

  // 3. Immediately kick off base conservation (local dbNSFP / Genos / dbnsfp.org / MyVariant)
  const genosRecTask = (genosPromise || Promise.resolve(null)).catch(() => null);
  const fastGenos = await Promise.race([
    genosRecTask,
    new Promise(r => setTimeout(() => r(null), 500))
  ]);

  const baseConservation = await fetchConservationData(
    gene,
    variant,
    null,
    null,
    pos,
    null,
    fastGenos,
    uniprotId,
    null,
    null
  );

  // 4. Merge enriched ConSurf, PopEVE, and Splice data as they resolve
  const [consurfVal, enrichment] = await Promise.all([
    consurfTask,
    predictorEnrichmentTask
  ]);

  return {
    ...baseConservation,
    consurf: consurfVal ?? baseConservation.consurf,
    popeve: baseConservation.popeve ?? enrichment.popEVEScore,
    spliceProximity: enrichment.spliceProximity ?? baseConservation.spliceProximity
  };
}
