import { z } from "zod";
import { TabixIndexedFile } from "@gmod/tabix";
import path from "path";
import fs from "fs";
import { predictorCache, conservationCache, popEVECache, popEveOnlineCache, refseqCache } from "./cache.ts";
import { normalizeGeneSymbol, normalizeVariantTo3Letter, fetchWithRetry } from "./http-client.ts";
import { isLocalDbnsfpAvailable, queryLocalDbnsfpVariant } from "./dbnsfp_local.ts";
import { queryGenosWebservice } from "./genos_web.ts";

export interface PredictorData {
  available: boolean;
  amPathogenicity: number | null;
  amClass: string | null;
  caddPhred: number | null;
  gnomadVariantId?: string | null;
  eveScore?: number | null;
  eveClass?: string | null;
}
export interface ConservationData {
  available: boolean;
  revel: number | null;
  gerp: number | null;
  phylop: number | null;
  consurf: number | null;
  bayesdel?: number | null;
  metarnn?: number | null;
  metarnnPred?: string | null;
  clinpred?: number | null;
  clinpredPred?: string | null;
  eigenPhred?: number | null;
  eigenRaw?: number | null;
  dann?: number | null;
  esm1b?: number | null;
  esm1bPred?: string | null;
  popeve?: number | null;
  aouFrequency?: {
    aouAC: number | null;
    aouAN: number | null;
    aouHet: number | null;
    aouHom: number | null;
  } | null;
}

const vepResponseSchema = z.array(z.object({
  seq_region_name: z.string().optional(),
  start: z.number().optional(),
  allele_string: z.string().optional(),
  transcript_consequences: z.array(z.object({
    canonical: z.union([z.number(), z.boolean()]).optional(),
    mane_select: z.string().optional(),
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
      aou_hom: z.any().optional()
    }).optional()
  })).optional()
});

export async function fetchPredictorData(gene: string, variant: string): Promise<PredictorData> {
  const cacheKey = `${gene}_${variant}`;
  const cached = predictorCache.get(cacheKey);
  if (cached) return cached;

  const cleanVar = normalizeVariantTo3Letter(variant);
  const normGene = normalizeGeneSymbol(gene);
  const url = `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(normGene)}:p.${encodeURIComponent(cleanVar)}?content-type=application/json&AlphaMissense=1&CADD=1&EVE=1&mane=1`;
  
  try {
    const res = await fetchWithRetry(url, {
      headers: { "Accept": "application/json" },
      timeout: 15000
    });
    if (res.ok) {
      const data = await res.json() as any;
      const parsedData = vepResponseSchema.parse(data);
      if (parsedData.length > 0 && parsedData[0].transcript_consequences) {
        const consequences = parsedData[0].transcript_consequences;
        const hasPredictor = (c: any) => c.alphamissense || c.cadd_phred !== undefined || c.eve_score !== undefined;
        let tc = consequences.find((c: any) => c.mane_select && hasPredictor(c));
        if (!tc) {
          tc = consequences.find((c: any) => (c.canonical === 1 || c.canonical === true || c.canonical === "1") && hasPredictor(c));
        }
        if (!tc) {
          tc = consequences.find(hasPredictor);
        }
        if (!tc) {
          tc = consequences[0];
        }
        if (tc) {
          const amPathogenicity = (tc.alphamissense && tc.alphamissense.am_pathogenicity !== undefined) ? parseFloat(tc.alphamissense.am_pathogenicity) : null;
          const amClass = (tc.alphamissense && tc.alphamissense.am_class) ? String(tc.alphamissense.am_class) : null;
          const caddPhred = tc.cadd_phred !== undefined ? parseFloat(tc.cadd_phred) : null;
          
          const eveScore = tc.eve_score !== undefined ? parseFloat(tc.eve_score) : null;
          const eveClass = tc.eve_class !== undefined ? String(tc.eve_class) : null;

          // Parse genomic coordinates from root VEP object to construct GRCh38 gnomAD-compatible variant ID
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

          const resVal = { available: true, amPathogenicity, amClass, caddPhred, gnomadVariantId, eveScore, eveClass };
          predictorCache.set(cacheKey, resVal);
          return resVal;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Predictors Fetch Error] Failed to fetch VEP predictors: ${err.message}`);
  }

  const defaultRes = {
    available: false,
    amPathogenicity: null,
    amClass: null,
    caddPhred: null,
    gnomadVariantId: null,
    eveScore: null,
    eveClass: null
  };
  predictorCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
  return defaultRes;
}

export async function fetchRealConsurfData(pdbId: string, chainId: string, pos: number): Promise<number | null> {
  const cleanPdb = pdbId.toUpperCase();
  const cleanChain = chainId.toUpperCase();
  
  const selUrl = `https://consurfdb.tau.ac.il/scripts/chain_selection.php?pdb_ID=${cleanPdb}`;
  try {
    const selRes = await fetchWithRetry(selUrl, { timeout: 10000 });
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
    const sumRes = await fetchWithRetry(sumUrl, { timeout: 10000 });
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
    const res = await fetchWithRetry(csvUrl, { timeout: 15000 });
    if (!res.ok) {
      popEveOnlineCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
      return null;
    }
    const csvText = await res.text();

    const match = variant.match(/([A-Z]{1,3})[=:/]?(\d+)[=:/]?([A-Z]{1,3})/i);
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

export async function fetchConservationData(
  gene: string,
  variant: string,
  pdbId?: string | null,
  chainId?: string | null,
  pos?: number | null,
  gnomadVariantId?: string | null,
  genosRec?: any | null,
  uniprotId?: string | null
): Promise<ConservationData> {
  const cacheKey = `${gene}_${variant}_${pdbId || ""}_${chainId || ""}_${pos || ""}_${gnomadVariantId || ""}`;
  const cached = conservationCache.get(cacheKey);
  if (cached) {
    if (cached.popeve !== null) {
      return cached;
    }
    const onlineScore = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
    if (onlineScore !== null) {
      cached.popeve = onlineScore;
      conservationCache.set(cacheKey, cached);
    }
    return cached;
  }

  const resolvedPos = (pos !== undefined && pos !== null) 
    ? pos 
    : (() => {
        const match = variant.match(/\d+/);
        return match ? parseInt(match[0], 10) : null;
      })();

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
    aouFrequency: null
  };

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

        const consurfPromise = (pdbId && chainId)
          ? fetchRealConsurfData(pdbId, chainId, resolvedPos)
          : Promise.resolve(null);

        const [popEVEScore, consurfVal] = await Promise.all([popEVEPromise, consurfPromise]);

        let popEVEVal = rec.popeve ?? popEVEScore;
        if (popEVEVal === null) {
          popEVEVal = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
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
          aouFrequency: {
            aouAC: rec.aou_ac,
            aouAN: rec.aou_an,
            aouHet: rec.aou_het,
            aouHom: rec.aou_hom
          }
        };
        conservationCache.set(cacheKey, resVal);
        return resVal;
      }
    } catch (err: any) {
      console.warn(`[Local dbNSFP Query Error] Fallback to remote: ${err.message}`);
    }
  }

  // Try Genos Web Query service before falling back to MyVariant.info
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
        aouFrequency: activeGenosRec.aou_ac !== null ? {
          aouAC: activeGenosRec.aou_ac,
          aouAN: activeGenosRec.aou_an,
          aouHet: activeGenosRec.aou_ac,
          aouHom: 0
        } : null
      };
      conservationCache.set(cacheKey, resVal);
      return resVal;
    }
  } catch (err: any) {
    console.warn(`[Genos Web Query Fallback Error] ${err.message}`);
  }

  const cleanVar = normalizeVariantTo3Letter(variant);
  const normGene = normalizeGeneSymbol(gene);
  const queryStr = (resolvedPos !== null)
    ? `dbnsfp.genename:${normGene} AND dbnsfp.aa.pos:${resolvedPos}`
    : `dbnsfp.genename:${normGene} AND dbnsfp.hgvsp:"p.${cleanVar}"`;
  const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=dbnsfp&limit=100`;
  
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
        const matchTerm = `p.${cleanVar}`;
        let hit = parsedData.hits.find(h => {
          const hgvspField = h.dbnsfp?.hgvsp;
          if (!hgvspField) return false;
          const hgvspArray = Array.isArray(hgvspField) ? hgvspField : [hgvspField];
          return hgvspArray.some(hVal => 
            typeof hVal === "string" && hVal.toLowerCase().includes(matchTerm.toLowerCase())
          );
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
            revel = rVal !== undefined && rVal !== null ? parseFloat(rVal) : null;
          }

          // Parse GERP score (handles multiple schema keys: gerp++, gerp++_rs, gerp.elements)
          let gerp: any = null;
          const gerpObj = dbnsfp["gerp++"] || dbnsfp.gerp || {};
          let gerpVal = gerpObj.rs !== undefined ? gerpObj.rs : (gerpObj.elements || gerpObj["gerp++_rs"] || null);
          if (Array.isArray(gerpVal)) gerpVal = gerpVal[0];
          gerp = gerpVal !== undefined && gerpVal !== null ? parseFloat(gerpVal) : null;

          // Parse PhyloP score (handles multiple schema keys: 100way_vertebrate, phylop100way_vertebrate, vertebrate)
          let phylop: any = null;
          if (dbnsfp.phylop) {
            let phylopVal = dbnsfp.phylop["100way_vertebrate"]?.score !== undefined 
              ? dbnsfp.phylop["100way_vertebrate"].score 
              : (dbnsfp.phylop.vertebrate || dbnsfp.phylop["phylop100way_vertebrate"] || null);
            if (Array.isArray(phylopVal)) phylopVal = phylopVal[0];
            phylop = phylopVal !== undefined && phylopVal !== null ? parseFloat(phylopVal) : null;
          }

          // Parse BayesDel score (handles both dbnsfp.bayesdel.no_af.score and dbnsfp.bayesdel_noaf_score formats)
          let bayesdel: number | null = null;
          if (dbnsfp.bayesdel?.no_af?.score !== undefined && dbnsfp.bayesdel?.no_af?.score !== null) {
            let bVal = dbnsfp.bayesdel.no_af.score;
            if (Array.isArray(bVal)) bVal = bVal[0];
            bayesdel = bVal !== undefined && bVal !== null && bVal !== "" ? parseFloat(bVal) : null;
          } else if (dbnsfp.bayesdel_noaf_score !== undefined && dbnsfp.bayesdel_noaf_score !== null) {
            let bVal = dbnsfp.bayesdel_noaf_score;
            if (Array.isArray(bVal)) bVal = bVal[0];
            bayesdel = bVal !== undefined && bVal !== null && bVal !== "" ? parseFloat(bVal) : null;
          }

          // Parse MetaRNN
          let metarnn: number | null = null;
          let metarnnPred: string | null = null;
          if (dbnsfp.metarnn) {
            let v = dbnsfp.metarnn.score;
            if (Array.isArray(v)) v = v[0];
            metarnn = v != null ? parseFloat(v) : null;
            let p = dbnsfp.metarnn.pred;
            if (Array.isArray(p)) p = p[0];
            metarnnPred = typeof p === "string" ? p : null;
          }

          // Parse ClinPred
          let clinpred: number | null = null;
          let clinpredPred: string | null = null;
          if (dbnsfp.clinpred) {
            clinpred = dbnsfp.clinpred.score != null ? parseFloat(dbnsfp.clinpred.score) : null;
            clinpredPred = typeof dbnsfp.clinpred.pred === "string" ? dbnsfp.clinpred.pred : null;
          }

          // Parse Eigen
          let eigenPhred: number | null = null;
          let eigenRaw: number | null = null;
          if (dbnsfp.eigen) {
            eigenPhred = dbnsfp.eigen.phred_coding != null ? parseFloat(dbnsfp.eigen.phred_coding) : null;
            eigenRaw = dbnsfp.eigen.raw_coding != null ? parseFloat(dbnsfp.eigen.raw_coding) : null;
          }

          // Parse DANN
          let dann: number | null = null;
          if (dbnsfp.dann) {
            let d = dbnsfp.dann.score;
            if (Array.isArray(d)) d = d[0];
            dann = d != null ? parseFloat(d) : null;
          }

          // Parse ESM-1b
          let esm1b: number | null = null;
          let esm1bPred: string | null = null;
          if (dbnsfp.esm1b) {
            let s = dbnsfp.esm1b.score;
            if (Array.isArray(s)) s = s[0];
            esm1b = s != null ? parseFloat(s) : null;
            let ep = dbnsfp.esm1b.pred;
            if (Array.isArray(ep)) ep = ep[0];
            esm1bPred = typeof ep === "string" ? ep : null;
          }

          // Parse EVE / popEVE fallback
          let finalPopEVE = popEVEScore;
          if (finalPopEVE === null && dbnsfp.eve?.score !== undefined) {
            let eVal = dbnsfp.eve.score;
            if (Array.isArray(eVal)) eVal = eVal[0];
            const parsed = parseFloat(eVal);
            if (!isNaN(parsed)) finalPopEVE = parsed;
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
            aouAC = val !== null && val !== "" ? parseInt(val, 10) : null;
          }
          if (dbnsfp.aou_an !== undefined) {
            let val = Array.isArray(dbnsfp.aou_an) ? dbnsfp.aou_an[0] : dbnsfp.aou_an;
            aouAN = val !== null && val !== "" ? parseInt(val, 10) : null;
          }
          if (dbnsfp.aou_het !== undefined) {
            let val = Array.isArray(dbnsfp.aou_het) ? dbnsfp.aou_het[0] : dbnsfp.aou_het;
            aouHet = val !== null && val !== "" ? parseInt(val, 10) : null;
          }
          if (dbnsfp.aou_hom !== undefined) {
            let val = Array.isArray(dbnsfp.aou_hom) ? dbnsfp.aou_hom[0] : dbnsfp.aou_hom;
            aouHom = val !== null && val !== "" ? parseInt(val, 10) : null;
          }

          const hasAou = aouAC !== null || aouAN !== null || aouHet !== null || aouHom !== null;

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
            esm1b,
            esm1bPred,
            popeve: finalPopEVE,
            aouFrequency: hasAou ? {
              aouAC,
              aouAN,
              aouHet,
              aouHom
            } : null
          };
          conservationCache.set(cacheKey, resVal);
          return resVal;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Conservation Fetch Error] Failed to fetch MyVariant conservation: ${err.message}`);
  }

  conservationCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
  return defaultRes;
}
