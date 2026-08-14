import { describe, it, expect, vi } from "vitest";
import {
  computeRanks,
  computePearsonCorrelation,
  computeSpearmanCorrelation,
  runProteinGymBenchmark,
  loadDMSCorpus
} from "./benchmark-proteingym.ts";

// Mock fetchUniprotSequence so tests do not hit the live UniProt API
vi.mock("./uniprot.ts", () => ({
  fetchUniprotSequence: vi.fn().mockResolvedValue("MGEKSLVGYW")
}));

describe("ProteinGym Substitutions Benchmark - Math & Engine Unit Tests", () => {
  describe("Spearman Rank Calculations", () => {
    it("should compute average fractional ranks correctly, including ties", () => {
      // Normal sorted array with no ties
      expect(computeRanks([10, 20, 30])).toEqual([1, 2, 3]);

      // Array with ties
      // 10 is smallest -> rank 1
      // 20 and 20 tie for index 1 and 2 (1-based: 2 and 3) -> average rank is 2.5
      // 30 is largest -> rank 4
      expect(computeRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);

      // All ties
      expect(computeRanks([5, 5, 5, 5])).toEqual([2.5, 2.5, 2.5, 2.5]);

      // Empty array
      expect(computeRanks([])).toEqual([]);
    });

    it("should compute Pearson correlation correctly", () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 4, 6, 8, 10]; // perfect correlation
      expect(computePearsonCorrelation(x, y)).toBeCloseTo(1.0, 5);

      const yInv = [5, 4, 3, 2, 1]; // perfect inverse correlation
      expect(computePearsonCorrelation(x, yInv)).toBeCloseTo(-1.0, 5);

      const zeroY = [3, 3, 3, 3, 3]; // no variance
      expect(computePearsonCorrelation(x, zeroY)).toBe(0);
    });

    it("should compute Spearman rank correlation correctly", () => {
      const x = [10, 20, 30, 40];
      const y = [15, 25, 35, 45]; // same relative order
      expect(computeSpearmanCorrelation(x, y)).toBeCloseTo(1.0, 5);

      const yTied = [10, 20, 20, 40];
      expect(computeSpearmanCorrelation(x, yTied)).toBeCloseTo(0.94868, 5);
    });
  });

  describe("Benchmark Engine Core Runner", () => {
    it("should load the curated DMS corpus JSON correctly", () => {
      const corpus = loadDMSCorpus();
      expect(corpus).toBeDefined();
      expect(corpus.PAH).toBeDefined();
      expect(corpus.PAH.uniprotId).toBe("P00439");
      expect(corpus.PAH.variants.length).toBe(10);
    });

    it("should successfully run the benchmark using mock predictions and compute scores", async () => {
      // Mock predictor callback that correlates positively with the dms_score
      const mockPredictor = async (gene: string, variant: string, uniprotId: string, sequence: string) => {
        // Find variant in loaded corpus to return a correlating score
        const corpus = loadDMSCorpus();
        const dmsData = corpus[gene];
        if (dmsData) {
          const match = dmsData.variants.find(v => `p.${v.wt}${v.pos}${v.mut}` === variant);
          if (match) {
            // Return score highly correlated with dms_score (e.g. scale by 2 + small noise)
            return match.dms_score * 2.0;
          }
        }
        return 0.0;
      };

      const results = await runProteinGymBenchmark(mockPredictor);
      
      expect(results.length).toBeGreaterThanOrEqual(10);
      
      // Since predictions were perfectly linearly correlated to DMS scores,
      // Spearman correlation should be close to 1.0 (and thus pass baseline)
      for (const res of results) {
        expect(res.correlation).toBeCloseTo(1.0, 4);
        expect(res.passed).toBe(true);
      }
    });

    it("should flag failed genes when predictions are poorly correlated with DMS scores", async () => {
      // Mock predictor that returns random/uncorrelated scores
      let toggle = 1;
      const mockUncorrelatedPredictor = async () => {
        toggle = -toggle;
        return toggle * 5.0;
      };

      const results = await runProteinGymBenchmark(mockUncorrelatedPredictor);
      
      for (const res of results) {
        // For uncorrelated scores, the correlation should be near-zero or negative, failing baseline
        expect(res.passed).toBe(false);
      }
    });
  });
});
