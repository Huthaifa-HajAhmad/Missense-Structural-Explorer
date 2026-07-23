import { normalizeGeneSymbol, fetchWithRetry } from "./http-client.ts";
import { isLocalDbnsfpAvailable, queryLocalDbnsfpVariant, queryLocalDbnsfpLandscape } from "./dbnsfp_local.ts";
import { landscapeCache } from "./cache.ts";

export interface LandscapePositionData {
  residx: number;
  revelMean: number | null;
  revelMedian: number | null;
  revelMin: number | null;
  revelMax: number | null;
  revelCount: number;
  amMean: number | null;
  amMedian: number | null;
  amMin: number | null;
  amMax: number | null;
  amCount: number;
  gerp: number | null;
  phylop: number | null;
}

function getMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[half];
  }
  return (sorted[half - 1] + sorted[half]) / 2.0;
}

export async function fetchLocalPopulationFrequencies(gene: string, pos: number, variant?: string | null): Promise<{
  gnomad: any | null;
  aou: any | null;
} | null> {
  if (!isLocalDbnsfpAvailable()) return null;
  const rec = await queryLocalDbnsfpVariant(gene, pos, null, null, variant);
  if (!rec) return null;

  return {
    gnomad: {
      maxAF: rec.gnomad_an ? (rec.gnomad_ac || 0) / rec.gnomad_an : null,
      groupMaxAF: rec.gnomad_an ? (rec.gnomad_ac || 0) / rec.gnomad_an : null,
      genomeAF: rec.gnomad_an ? (rec.gnomad_ac || 0) / rec.gnomad_an : null,
      exomeAF: rec.gnomad_an ? (rec.gnomad_ac || 0) / rec.gnomad_an : null,
      genomeAC: rec.gnomad_ac,
      exomeAC: 0,
      genomeAN: rec.gnomad_an,
      exomeAN: 0,
      nHomozygous: rec.gnomad_hom,
      dataset: "gnomad_r4_local"
    },
    aou: {
      aouAC: rec.aou_ac,
      aouAN: rec.aou_an,
      aouHet: rec.aou_het,
      aouHom: rec.aou_hom
    }
  };
}

export async function fetchLandscapeData(
  gene: string,
  startPos?: number,
  endPos?: number
): Promise<LandscapePositionData[]> {
  const normGene = normalizeGeneSymbol(gene);

  if (isLocalDbnsfpAvailable()) {
    const localLandscape = await queryLocalDbnsfpLandscape(normGene, startPos, endPos);
    if (localLandscape) {
      return localLandscape;
    }
  }
  
  // First, check if the full protein landscape is cached
  const fullCacheKey = `${normGene}_full`;
  const cachedFull = landscapeCache.get(fullCacheKey);
  if (cachedFull) {
    if (startPos !== undefined && endPos !== undefined) {
      return cachedFull.filter(item => item.residx >= startPos && item.residx <= endPos);
    }
    return cachedFull;
  }

  // If a specific window was requested and cached, return it
  if (startPos !== undefined && endPos !== undefined) {
    const windowCacheKey = `${normGene}_${startPos}_${endPos}`;
    const cachedWindow = landscapeCache.get(windowCacheKey);
    if (cachedWindow) return cachedWindow;
  }

  // Build the query: if startPos & endPos are passed, query that range. Otherwise query the entire gene.
  const queryStr = (startPos !== undefined && endPos !== undefined)
    ? `dbnsfp.genename:${normGene} AND dbnsfp.aa.pos:[${startPos} TO ${endPos}]`
    : `dbnsfp.genename:${normGene}`;

  // Increase the size to 5000 for full exonic query
  const sizeLimit = (startPos !== undefined && endPos !== undefined) ? 1000 : 5000;
  const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=dbnsfp.revel,dbnsfp.alphamissense,dbnsfp.gerp%2B%2B,dbnsfp.gerp,dbnsfp.phylop,dbnsfp.aa.pos&size=${sizeLimit}`;

  const result: LandscapePositionData[] = [];
  const landscapeMap = new Map<number, {
    revelScores: number[];
    amScores: number[];
    gerpScores: number[];
    phylopScores: number[];
  }>();

  try {
    const res = await fetchWithRetry(url, {
      headers: { "Accept": "application/json" },
      timeout: 15000
    });
    if (res.ok) {
      const data = await res.json() as any;
      if (data.hits && Array.isArray(data.hits)) {
        data.hits.forEach((hit: any) => {
          const dbnsfp = hit.dbnsfp;
          if (!dbnsfp) return;

          const posList = Array.isArray(dbnsfp.aa?.pos)
            ? dbnsfp.aa.pos
            : (dbnsfp.aa?.pos ? [dbnsfp.aa.pos] : []);
          
          posList.forEach((posVal: any) => {
            const pos = parseInt(posVal, 10);
            if (isNaN(pos)) return;

            // If we are filtering by start/end range, skip positions outside range
            if (startPos !== undefined && endPos !== undefined) {
              if (pos < startPos || pos > endPos) return;
            }

            if (!landscapeMap.has(pos)) {
              landscapeMap.set(pos, {
                revelScores: [],
                amScores: [],
                gerpScores: [],
                phylopScores: []
              });
            }

            const posData = landscapeMap.get(pos)!;

            // Parse REVEL
            if (dbnsfp.revel) {
              let revVal = dbnsfp.revel.score !== undefined ? dbnsfp.revel.score : dbnsfp.revel;
              if (Array.isArray(revVal)) revVal = revVal[0];
              const val = parseFloat(revVal);
              if (!isNaN(val)) posData.revelScores.push(val);
            }

            // Parse AlphaMissense
            if (dbnsfp.alphamissense) {
              let amVal = dbnsfp.alphamissense.score !== undefined ? dbnsfp.alphamissense.score : dbnsfp.alphamissense;
              if (Array.isArray(amVal)) amVal = amVal[0];
              const val = parseFloat(amVal);
              if (!isNaN(val)) posData.amScores.push(val);
            }

            // Parse GERP++ / GERP
            const gerpObj = dbnsfp['gerp++'] || {};
            let gerpVal = gerpObj.rs !== undefined ? gerpObj.rs : null;
            if (gerpVal === null && dbnsfp.gerp?.['91_mammals']?.score !== undefined) {
              gerpVal = dbnsfp.gerp['91_mammals'].score;
            }
            if (gerpVal !== null) {
              const val = parseFloat(Array.isArray(gerpVal) ? gerpVal[0] : gerpVal);
              if (!isNaN(val)) posData.gerpScores.push(val);
            }

            // Parse PhyloP
            if (dbnsfp.phylop) {
              let phylopVal = dbnsfp.phylop['100way_vertebrate']?.score !== undefined
                ? dbnsfp.phylop['100way_vertebrate'].score
                : (dbnsfp.phylop.vertebrate || dbnsfp.phylop['phylop100way_vertebrate'] || null);
              if (phylopVal !== null) {
                const val = parseFloat(Array.isArray(phylopVal) ? phylopVal[0] : phylopVal);
                if (!isNaN(val)) posData.phylopScores.push(val);
              }
            }
          });
        });
      }
    }
  } catch (err: any) {
    console.warn(`[Landscape Fetch Error] Failed to fetch dbNSFP landscape: ${err.message}`);
  }

  /**
   * Aggregation Rationale (L-11 & N2-4):
   * For every residue position, up to 19 distinct amino acid substitutions exist across multiple canonical/non-canonical transcripts.
   * - REVEL & AlphaMissense: Use max (worst-case pathogenicity per position) for conservative clinical utility.
   * - GERP++ & PhyloP: Use mean (typical conservation level per position) to capture average local evolutionary selection pressure.
   * - Median: Represents robust central tendency less skewed by single extreme substitutions (e.g. Proline insertion).
   * - Min / Max: Establishes the exact score range bound for all possible variants at this position.
   * - Count: Tracks total transcript variants evaluated to signal data completeness.
   */
  for (const [pos, d] of landscapeMap.entries()) {
    const revelCount = d.revelScores.length;
    const amCount = d.amScores.length;

    const revelMean = revelCount > 0 ? d.revelScores.reduce((a, b) => a + b, 0) / revelCount : null;
    const revelMedian = getMedian(d.revelScores);
    const revelMin = revelCount > 0 ? Math.min(...d.revelScores) : null;
    const revelMax = revelCount > 0 ? Math.max(...d.revelScores) : null;

    const amMean = amCount > 0 ? d.amScores.reduce((a, b) => a + b, 0) / amCount : null;
    const amMedian = getMedian(d.amScores);
    const amMin = amCount > 0 ? Math.min(...d.amScores) : null;
    const amMax = amCount > 0 ? Math.max(...d.amScores) : null;

    const gerp = d.gerpScores.length > 0 ? d.gerpScores.reduce((a, b) => a + b, 0) / d.gerpScores.length : null;
    const phylop = d.phylopScores.length > 0 ? d.phylopScores.reduce((a, b) => a + b, 0) / d.phylopScores.length : null;

    result.push({
      residx: pos,
      revelMean,
      revelMedian,
      revelMin,
      revelMax,
      revelCount,
      amMean,
      amMedian,
      amMin,
      amMax,
      amCount,
      gerp,
      phylop
    });
  }

  // Sort by residue index position
  result.sort((a, b) => a.residx - b.residx);

  // If startPos & endPos were specified, fill in any missing positions in that range as empty entries
  if (startPos !== undefined && endPos !== undefined) {
    const resultMap = new Map(result.map(item => [item.residx, item]));
    const filledResult: LandscapePositionData[] = [];
    for (let pos = startPos; pos <= endPos; pos++) {
      const existing = resultMap.get(pos);
      if (existing) {
        filledResult.push(existing);
      } else {
        filledResult.push({
          residx: pos,
          revelMean: null,
          revelMedian: null,
          revelMin: null,
          revelMax: null,
          revelCount: 0,
          amMean: null,
          amMedian: null,
          amMin: null,
          amMax: null,
          amCount: 0,
          gerp: null,
          phylop: null
        });
      }
    }
    const windowCacheKey = `${normGene}_${startPos}_${endPos}`;
    landscapeCache.set(windowCacheKey, filledResult);
    return filledResult;
  }

  // Cache full protein
  landscapeCache.set(fullCacheKey, result);
  return result;
}
