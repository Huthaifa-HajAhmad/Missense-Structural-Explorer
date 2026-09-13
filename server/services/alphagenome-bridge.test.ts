import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  calculateAlphaGenomeAcmgStrength,
  generateAtlasUrls,
  fetchAlphaGenome,
  fetchAlphaGenomeRegionSaturation,
  clearAlphaGenomeCache,
  setAlphaGenomeMockProvider,
  setAlphaGenomeRegionMockProvider,
  alphagenomeCache,
  alphagenomeRegionCache
} from "./alphagenome-bridge.ts";
import { defaultCacheRegistry } from "./cache-registry.ts";

describe("AlphaGenome Bridge Service Tests", () => {
  beforeEach(() => {
    clearAlphaGenomeCache();
    setAlphaGenomeMockProvider(null);
    setAlphaGenomeRegionMockProvider(null);
    vi.restoreAllMocks();
  });

  describe("calculateAlphaGenomeAcmgStrength", () => {
    it("should classify extreme Phred scores as PP3_Strong", () => {
      expect(calculateAlphaGenomeAcmgStrength(42.0)).toBe("PP3_Strong");
      expect(calculateAlphaGenomeAcmgStrength(35.0)).toBe("PP3_Strong");
    });

    it("should classify high Phred scores as PP3_Moderate", () => {
      expect(calculateAlphaGenomeAcmgStrength(28.5)).toBe("PP3_Moderate");
      expect(calculateAlphaGenomeAcmgStrength(25.0)).toBe("PP3_Moderate");
    });

    it("should classify elevated Phred scores as PP3_Supporting", () => {
      expect(calculateAlphaGenomeAcmgStrength(18.2)).toBe("PP3_Supporting");
      expect(calculateAlphaGenomeAcmgStrength(15.0)).toBe("PP3_Supporting");
    });

    it("should classify intermediate Phred scores as indeterminate", () => {
      expect(calculateAlphaGenomeAcmgStrength(11.0)).toBe("indeterminate");
      expect(calculateAlphaGenomeAcmgStrength(9.5)).toBe("indeterminate");
      expect(calculateAlphaGenomeAcmgStrength(null)).toBe("indeterminate");
      expect(calculateAlphaGenomeAcmgStrength(undefined)).toBe("indeterminate");
    });

    it("should classify low Phred scores as BP4_Supporting and BP4_Moderate", () => {
      expect(calculateAlphaGenomeAcmgStrength(7.2)).toBe("BP4_Supporting");
      expect(calculateAlphaGenomeAcmgStrength(5.0)).toBe("BP4_Moderate");
      expect(calculateAlphaGenomeAcmgStrength(2.1)).toBe("BP4_Moderate");
    });

    it("should return indeterminate for invalid negative Phred scores", () => {
      expect(calculateAlphaGenomeAcmgStrength(-1.0)).toBe("indeterminate");
      expect(calculateAlphaGenomeAcmgStrength(-99.0)).toBe("indeterminate");
      expect(calculateAlphaGenomeAcmgStrength(NaN)).toBe("indeterminate");
    });
  });

  describe("generateAtlasUrls", () => {
    it("should construct valid, encoded deep-link URLs", () => {
      const urls = generateAtlasUrls("chr9", 128225994, "G", "A");
      expect(urls.variantUrl).toBe(
        "https://deepmind.google.com/science/alphagenome/atlas/variant/chr9:128225994:G%3EA"
      );
      expect(urls.trackPredictionsUrl).toBe(
        "https://deepmind.google.com/science/alphagenome/atlas/track-predictions?v=chr9:128225994:G%3EA"
      );
      expect(urls.locusUrl).toBe(
        "https://deepmind.google.com/science/alphagenome/atlas/locus?interval=chr9:128205994-128245994"
      );
      expect(urls.variantStr).toBe("chr9:128225994:G>A");
    });

    it("should clamp locus start to 1 for mutations near chromosome start", () => {
      const urls = generateAtlasUrls("chr1", 5000, "C", "T");
      expect(urls.locusUrl).toContain("chr1:1-25000");
    });
  });

  describe("CacheRegistry Integration", () => {
    it("should clear alphagenomeCache when defaultCacheRegistry.clearAll is called", async () => {
      setAlphaGenomeMockProvider(async () => {
        return {
          status: "live",
          aviPhred: 20.0,
          acmgStrength: "PP3_Supporting"
        };
      });

      await fetchAlphaGenome("chr1", 1000, "A", "G");
      expect(alphagenomeCache.size).toBe(1);

      defaultCacheRegistry.clearAll();
      expect(alphagenomeCache.size).toBe(0);
    });
  });

  describe("fetchAlphaGenome", () => {
    it("should return unavailable status when coordinates are invalid", async () => {
      const res = await fetchAlphaGenome("", 0, "", "");
      expect(res?.status).toBe("unavailable");
      expect(res?.aviPhred).toBeNull();
    });

    it("should return clean standby state when API key is unconfigured", async () => {
      const originalKey = process.env.ALPHAGENOME_API_KEY;
      const originalUrl = process.env.ALPHAGENOME_API_URL;
      delete process.env.ALPHAGENOME_API_KEY;
      delete process.env.ALPHAGENOME_API_URL;

      try {
        const res = await fetchAlphaGenome("chr9", 128225994, "G", "A");
        expect(res?.status).toBe("unavailable");
        expect(res?.aviPhred).toBeNull();
        expect(res?.atlasUrl).toContain("alphagenome/atlas/track-predictions");
        expect(res?.message).toContain("Key Required / Standby");
      } finally {
        if (originalKey) process.env.ALPHAGENOME_API_KEY = originalKey;
        if (originalUrl) process.env.ALPHAGENOME_API_URL = originalUrl;
      }
    });

    it("should successfully fetch and map live AlphaGenome data from provider", async () => {
      setAlphaGenomeMockProvider(async (chrom, pos, ref, alt) => {
        return {
          status: "live",
          aviPhred: 34.2,
          aviRaw: 0.88,
          aviQuantile: 0.00038,
          topPercentile: 0.038,
          topModality: "ChIP-TF",
          topFeatureImportance: 0.42,
          featureAttributions: {
            fi_CHIP_TF: 0.42,
            fi_MERGED_SPLICING: 0.18,
            fi_ALPHAMISSENSE: 0.15,
            fi_DNASE: 0.11,
            fi_CACTUS_241_WAY: 0.08
          },
          acmgStrength: "PP3_Moderate",
          atlasUrl: "https://deepmind.google.com/science/alphagenome/atlas/track-predictions?v=chr9:128225994:G%3EA",
          message: null
        };
      });

      const res = await fetchAlphaGenome("chr9", 128225994, "G", "A");
      expect(res?.status).toBe("live");
      expect(res?.aviPhred).toBe(34.2);
      expect(res?.topModality).toBe("ChIP-TF");
      expect(res?.topPercentile).toBe(0.038);
      expect(res?.acmgStrength).toBe("PP3_Moderate");
      expect(res?.featureAttributions?.fi_CHIP_TF).toBe(0.42);
      expect(res?.atlasUrl).toContain("alphagenome/atlas");
    });

    it("should cache successful responses and return from cache without re-invoking provider", async () => {
      let callCount = 0;
      setAlphaGenomeMockProvider(async () => {
        callCount++;
        return {
          status: "live",
          aviPhred: 22.5,
          aviRaw: 0.65,
          topPercentile: 0.56,
          topModality: "Splicing",
          acmgStrength: "PP3_Supporting"
        };
      });

      const first = await fetchAlphaGenome("chr11", 5225488, "A", "T");
      expect(callCount).toBe(1);
      expect(first?.aviPhred).toBe(22.5);

      const second = await fetchAlphaGenome("chr11", 5225488, "A", "T");
      expect(callCount).toBe(1); // returned from LRU cache
      expect(second?.aviPhred).toBe(22.5);
    });

    it("should handle timeout signals gracefully without throwing unhandled exceptions", async () => {
      setAlphaGenomeMockProvider(async () => {
        // simulate slow response
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return {
          status: "live",
          aviPhred: 10,
          acmgStrength: "indeterminate"
        };
      });

      // Pass an already-aborted signal
      const controller = new AbortController();
      controller.abort();

      const res = await fetchAlphaGenome("chr1", 1000, "A", "G", controller.signal);
      expect(res?.status).toBe("unavailable");
      expect(res?.message).toMatch(/timeout|abort|unavailable/i);
    });

    it("should gracefully handle provider exceptions and return unavailable status", async () => {
      setAlphaGenomeMockProvider(async () => {
        throw new Error("Network connection refused");
      });

      const res = await fetchAlphaGenome("chr7", 55181378, "C", "T");
      expect(res?.status).toBe("unavailable");
      expect(res?.aviPhred).toBeNull();
      expect(res?.message).toContain("Network connection refused");
    });

    it("should handle HTTP 500 errors gracefully", async () => {
      const originalKey = process.env.ALPHAGENOME_API_KEY;
      process.env.ALPHAGENOME_API_KEY = "test_key_abc";

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error"
      });

      try {
        const res = await fetchAlphaGenome("chr2", 2000, "C", "G");
        expect(res?.status).toBe("unavailable");
        expect(res?.message).toContain("500");
      } finally {
        global.fetch = originalFetch;
        if (originalKey) {
          process.env.ALPHAGENOME_API_KEY = originalKey;
        } else {
          delete process.env.ALPHAGENOME_API_KEY;
        }
      }
    });
  });

  describe("fetchAlphaGenomeRegionSaturation", () => {
    it("should return unavailable status when coordinates are invalid", async () => {
      const res = await fetchAlphaGenomeRegionSaturation({
        chrom: "",
        start: 0,
        end: -10
      });
      expect(res.status).toBe("unavailable");
      expect(res.positions).toEqual([]);
      expect(res.message).toMatch(/invalid/i);
    });

    it("should return clean standby state when unconfigured without API key", async () => {
      const originalKey = process.env.ALPHAGENOME_API_KEY;
      const originalUrl = process.env.ALPHAGENOME_API_URL;
      delete process.env.ALPHAGENOME_API_KEY;
      delete process.env.ALPHAGENOME_API_URL;

      try {
        const res = await fetchAlphaGenomeRegionSaturation({
          chrom: "chr9",
          start: 128225895,
          end: 128226050,
          exonNumber: 4,
          exonStart: 128225910,
          exonEnd: 128226035,
          strand: "+"
        });
        expect(res.status).toBe("unavailable");
        expect(res.atlasLocusUrl).toContain("chr9");
        expect(res.atlasLocusUrl).toContain("128225895-128226050");
        expect(res.message).toContain("Key Required / Standby");
        expect(res.positions).toEqual([]);
      } finally {
        if (originalKey) process.env.ALPHAGENOME_API_KEY = originalKey;
        if (originalUrl) process.env.ALPHAGENOME_API_URL = originalUrl;
      }
    });

    it("should return mock provider response and cache in alphagenomeRegionCache", async () => {
      setAlphaGenomeRegionMockProvider(async (params) => {
        return {
          status: "live",
          chrom: params.chrom,
          start: params.start,
          end: params.end,
          positions: [
            {
              pos: 100,
              ref: "A",
              isExonic: true,
              codonIndex: 1,
              codonPosition: 1,
              variants: {
                A: { alt: "A", phred: null, acmgStrength: "indeterminate" },
                C: { alt: "C", phred: 25.0, acmgStrength: "PP3_Moderate", topModality: "fi_MERGED_SPLICING" },
                G: { alt: "G", phred: 18.0, acmgStrength: "PP3_Supporting", topModality: "fi_CHIP_TF" },
                T: { alt: "T", phred: 5.0, acmgStrength: "BP4_Moderate", topModality: null }
              },
              meanPhred: 16.0,
              maxPhred: 25.0,
              topModality: "fi_MERGED_SPLICING"
            }
          ]
        };
      });

      const res = await fetchAlphaGenomeRegionSaturation({
        chrom: "chr1",
        start: 100,
        end: 100
      });

      expect(res.status).toBe("live");
      expect(res.positions.length).toBe(1);
      expect(res.positions[0].maxPhred).toBe(25.0);
      expect(alphagenomeRegionCache.size).toBe(1);

      // Verify cached hit
      const cached = await fetchAlphaGenomeRegionSaturation({
        chrom: "chr1",
        start: 100,
        end: 100
      });
      expect(cached.status).toBe("live");
    });

    it("should clear alphagenomeRegionCache when clearAlphaGenomeCache is called", async () => {
      setAlphaGenomeRegionMockProvider(async (params) => {
        return {
          status: "live",
          chrom: params.chrom,
          start: params.start,
          end: params.end,
          positions: []
        };
      });

      await fetchAlphaGenomeRegionSaturation({ chrom: "chr5", start: 200, end: 250 });
      expect(alphagenomeRegionCache.size).toBe(1);

      clearAlphaGenomeCache();
      expect(alphagenomeRegionCache.size).toBe(0);
    });

    it("should return unavailable status when start is greater than end", async () => {
      const res = await fetchAlphaGenomeRegionSaturation({
        chrom: "chr1",
        start: 500,
        end: 400
      });

      expect(res.status).toBe("unavailable");
      expect(res.message).toMatch(/start must be less than or equal to end/i);
    });

    it("should separate cache entries when different exon boundaries are provided for the same interval", async () => {
      let callCount = 0;
      setAlphaGenomeRegionMockProvider(async (params) => {
        callCount++;
        return {
          status: "live",
          chrom: params.chrom,
          start: params.start,
          end: params.end,
          positions: []
        };
      });

      // First query with exon 1 bounds
      await fetchAlphaGenomeRegionSaturation({
        chrom: "chr7",
        start: 1000,
        end: 1100,
        exonNumber: 1,
        exonStart: 1000,
        exonEnd: 1050
      });

      // Second query with exon 2 bounds for the same genomic window
      await fetchAlphaGenomeRegionSaturation({
        chrom: "chr7",
        start: 1000,
        end: 1100,
        exonNumber: 2,
        exonStart: 1051,
        exonEnd: 1100
      });

      // Both should have generated distinct cache keys and called the provider twice
      expect(callCount).toBe(2);
      expect(alphagenomeRegionCache.size).toBe(2);
    });
  });
});
