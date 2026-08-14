import fs from "fs";
import path from "path";
import { fetchUniprotSequence } from "./uniprot.ts";

export interface DMSVariant {
  wt: string;
  pos: number;
  mut: string;
  dms_score: number;
}

export interface GeneDMSData {
  uniprotId: string;
  variants: DMSVariant[];
}

export interface BenchmarkResult {
  gene: string;
  uniprotId: string;
  variantCount: number;
  correlation: number;
  passed: boolean;
  baseline: number;
}

/**
 * Computes average fractional ranks for an array of numbers, correctly handling ties.
 */
export function computeRanks(arr: number[]): number[] {
  const n = arr.length;
  if (n === 0) return [];

  const indexed = arr.map((val, idx) => ({ val, idx }));
  indexed.sort((a, b) => a.val - b.val);

  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && indexed[j].val === indexed[i].val) {
      j++;
    }
    // Ranks of elements from i to j-1 are (i+1) to j.
    // Average rank is the sum of these ranks divided by count (j - i).
    // Sum = (j - i) * (i + 1 + j) / 2
    // Average = (i + 1 + j) / 2
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      ranks[indexed[k].idx] = avgRank;
    }
    i = j;
  }
  return ranks;
}

/**
 * Computes the Pearson correlation coefficient between two arrays.
 */
export function computePearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;

  const meanX = x.reduce((sum, val) => sum + val, 0) / n;
  const meanY = y.reduce((sum, val) => sum + val, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

/**
 * Computes the Spearman rank correlation coefficient between two arrays.
 */
export function computeSpearmanCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;
  const rx = computeRanks(x);
  const ry = computeRanks(y);
  return computePearsonCorrelation(rx, ry);
}

// Baselines for the Spearman correlation per gene based on ProteinGym benchmark bounds.
// Note: Some experimental scores are anti-correlated with LLR if lower score is better,
// so we typically correlation-check the absolute correlation magnitude or align direction.
// In ProteinGym, LLR is positive (higher = wildtype-like, lower = deleterious).
// DMS score is also positive/fitness (higher = functional, lower = deleterious).
// So they should be positively correlated.
export const RARE_DISEASE_DMS_BASELINES: Record<string, number> = {
  PAH: 0.35,
  CBS: 0.35,
  GDI1: 0.30,
  UBE3A: 0.30,
  CACNA1A: 0.30,
  KCNQ1: 0.30,
  SCN5A: 0.30,
  LMNA: 0.30,
  SGCB: 0.30,
  NPC1: 0.30
};

/**
 * Loads the curated ProteinGym rare disease DMS mutations corpus from disk.
 */
export function loadDMSCorpus(): Record<string, GeneDMSData> {
  const filePath = path.join(process.cwd(), "data", "proteingym_dms_rare_diseases.json");
  if (!fs.existsSync(filePath)) {
    throw new Error(`DMS corpus not found at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Runs the ProteinGym DMS substitutions regression-testing benchmark.
 * 
 * @param predictCallback Function that yields a prediction score (e.g. LLR) for a given gene variant.
 * @returns Scorecard of results per gene.
 */
export async function runProteinGymBenchmark(
  predictCallback: (gene: string, variant: string, uniprotId: string, sequence: string) => Promise<number | null>
): Promise<BenchmarkResult[]> {
  const corpus = loadDMSCorpus();
  const results: BenchmarkResult[] = [];

  for (const [gene, data] of Object.entries(corpus)) {
    const { uniprotId, variants } = data;
    let sequence = "";
    try {
      sequence = await fetchUniprotSequence(uniprotId);
    } catch (err: any) {
      console.warn(`[Benchmark] Could not fetch sequence for ${gene} (${uniprotId}):`, err.message);
      continue;
    }

    const dmsScores: number[] = [];
    const predictedScores: number[] = [];

    for (const v of variants) {
      const variantStr = `p.${v.wt}${v.pos}${v.mut}`;
      try {
        const pred = await predictCallback(gene, variantStr, uniprotId, sequence);
        if (pred !== null && !isNaN(pred)) {
          dmsScores.push(v.dms_score);
          predictedScores.push(pred);
        }
      } catch (err: any) {
        console.warn(`[Benchmark] Predictor error on ${gene} ${variantStr}:`, err.message);
      }
    }

    if (dmsScores.length < 3) {
      console.warn(`[Benchmark] Too few valid predictions for ${gene} (count: ${dmsScores.length})`);
      continue;
    }

    const correlation = computeSpearmanCorrelation(predictedScores, dmsScores);
    const baseline = RARE_DISEASE_DMS_BASELINES[gene] || 0.30;
    
    // We expect positive correlation because both LLR and DMS are higher for active/benign variants.
    // If it falls below baseline, it's a test regression.
    const passed = correlation >= baseline;

    results.push({
      gene,
      uniprotId,
      variantCount: dmsScores.length,
      correlation,
      passed,
      baseline
    });
  }

  return results;
}
