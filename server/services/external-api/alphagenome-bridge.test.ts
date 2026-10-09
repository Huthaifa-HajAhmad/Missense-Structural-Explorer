import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateAlphaGenomeAcmgStrength,
  generateAtlasUrls,
  fetchAlphaGenome,
  fetchAlphaGenomeRegionSaturation,
  clearAlphaGenomeCache,
  setAlphaGenomeMockProvider,
  setAlphaGenomeRegionMockProvider,
  alphagenomeCache,
  alphagenomeRegionCache,
  resolveAlphaGenomeAccess
} from "./alphagenome-bridge.ts";
import { defaultCacheRegistry } from "../infra/cache-registry.ts";

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
      const originalUrl = process.env.ALPHAGENOME_API_URL;
      process.env.ALPHAGENOME_API_KEY = "test_key_abc";
      process.env.ALPHAGENOME_API_URL = "https://mock.alphagenome.test/v1";

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
        if (originalUrl) {
          process.env.ALPHAGENOME_API_URL = originalUrl;
        } else {
          delete process.env.ALPHAGENOME_API_URL;
        }
      }
    });

    it("should bypass uncredentialed standby cache when called subsequently with an API key", async () => {
      const originalKey = process.env.ALPHAGENOME_API_KEY;
      delete process.env.ALPHAGENOME_API_KEY;

      try {
        // 1. Initial query without API key returns Standby
        const standbyRes = await fetchAlphaGenome("chr19", 45000000, "A", "G");
        expect(standbyRes?.status).toBe("unavailable");
        expect(standbyRes?.message).toContain("Standby");

        // 2. Mock provider or gRPC response for subsequent credentialed call
        setAlphaGenomeMockProvider(async () => ({
          status: "live",
          aviPhred: 32.1,
          acmgStrength: "PP3_Moderate"
        }));

        // 3. Second query with apiKey bypasses standby cache
        const liveRes = await fetchAlphaGenome("chr19", 45000000, "A", "G", {
          apiKey: "valid_secret_key"
        });
        expect(liveRes?.status).toBe("live");
        expect(liveRes?.aviPhred).toBe(32.1);
      } finally {
        if (originalKey) process.env.ALPHAGENOME_API_KEY = originalKey;
      }
    });

    it("should cache negative unindexed responses and return them without repeating network queries", async () => {
      let callCount = 0;
      setAlphaGenomeMockProvider(async () => {
        callCount++;
        return {
          status: "unavailable",
          aviPhred: null,
          acmgStrength: "indeterminate",
          message: "Variant not indexed in AlphaGenome Atlas."
        };
      });

      const first = await fetchAlphaGenome("chr8", 12345678, "C", "T", { apiKey: "key_abc" });
      expect(callCount).toBe(1);
      expect(first?.status).toBe("unavailable");
      expect(first?.message).toContain("not indexed");

      const second = await fetchAlphaGenome("chr8", 12345678, "C", "T", { apiKey: "key_abc" });
      expect(callCount).toBe(1); // Cached negative hit
      expect(second?.status).toBe("unavailable");
      expect(second?.message).toContain("not indexed");
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

    it("should return unavailable status when interval exceeds 5,000 bp", async () => {
      const res = await fetchAlphaGenomeRegionSaturation({
        chrom: "chr1",
        start: 1000,
        end: 7000
      });

      expect(res.status).toBe("unavailable");
      expect(res.message).toMatch(/cannot exceed 5,000 bp/i);
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

    it("should query native gRPC client when apiKey is provided without apiUrl", async () => {
      const mockScoreBuf = Buffer.alloc(4);
      mockScoreBuf.writeFloatLE(0.72, 0);

      const mockCalibratedBuf = Buffer.alloc(4);
      mockCalibratedBuf.writeFloatLE(0.999, 0);

      const mockFiBuf = Buffer.alloc(18 * 4);
      mockFiBuf.writeFloatLE(0.88, 10 * 4); // ALPHAMISSENSE

      const mockClient = {
        GetDenseVariantScores: vi.fn((req, md, opts, callback) => {
          callback(null, {
            scores: [
              {
                variant_scorer: { name: "AVI_SCORE" },
                scores: mockScoreBuf,
                calibrated_scores: mockCalibratedBuf
              },
              {
                variant_scorer: { name: "AVI_SCORE_FEATURE_IMPORTANCE" },
                scores: mockFiBuf
              }
            ]
          });
        })
      };

      const { setAtlasGrpcClientFactory } = await import("./alphagenome-client.ts");
      setAtlasGrpcClientFactory(() => mockClient);

      try {
        const res = await fetchAlphaGenome("chr20", 23369727, "C", "T", {
          apiKey: "test-user-api-key"
        });

        expect(mockClient.GetDenseVariantScores).toHaveBeenCalledOnce();
        expect(res).not.toBeNull();
        expect(res?.status).toBe("live");
        expect(res?.aviPhred).toBeCloseTo(30.0, 1);
        expect(res?.topModality).toBe("AlphaMissense");
      } finally {
        setAtlasGrpcClientFactory(null);
      }
    });
  });

  describe("the server's key only goes to the server's endpoint", () => {
    const SERVER_KEY = "server_secret_key";
    const SERVER_URL = "https://alphagenome.server.test/v1";
    let saved: { key?: string; url?: string };

    beforeEach(() => {
      saved = { key: process.env.ALPHAGENOME_API_KEY, url: process.env.ALPHAGENOME_API_URL };
      process.env.ALPHAGENOME_API_KEY = SERVER_KEY;
      process.env.ALPHAGENOME_API_URL = SERVER_URL;
    });

    afterEach(() => {
      if (saved.key === undefined) delete process.env.ALPHAGENOME_API_KEY; else process.env.ALPHAGENOME_API_KEY = saved.key;
      if (saved.url === undefined) delete process.env.ALPHAGENOME_API_URL; else process.env.ALPHAGENOME_API_URL = saved.url;
    });

    it("uses the server key for the server endpoint, including a request that names it", () => {
      expect(resolveAlphaGenomeAccess(null, null)).toEqual({ apiKey: SERVER_KEY, endpoint: SERVER_URL, customEndpoint: false });
      expect(resolveAlphaGenomeAccess(null, "https://AlphaGenome.server.test/v1/")).toMatchObject({ apiKey: SERVER_KEY, customEndpoint: false });
    });

    it("sends no key to a request-chosen endpoint unless the request brought its own", () => {
      expect(resolveAlphaGenomeAccess(null, "https://attacker.example/collect")).toEqual({
        apiKey: null, endpoint: "https://attacker.example/collect", customEndpoint: true,
      });
      expect(resolveAlphaGenomeAccess("user_own_key", "https://lab-proxy.example")).toMatchObject({ apiKey: "user_own_key", customEndpoint: true });
    });

    it("strips the server key even when a caller already merged it into apiKey", () => {
      expect(resolveAlphaGenomeAccess(SERVER_KEY, "https://attacker.example/collect").apiKey).toBeNull();
    });

    it("a request-chosen endpoint receives no Authorization header and its answer stays out of the shared cache", async () => {
      const originalFetch = global.fetch;
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ avi_phred: 30, avi_raw: 0.5 }) });
      global.fetch = fetchMock as unknown as typeof fetch;
      try {
        const res = await fetchAlphaGenome("chr3", 3000, "A", "G", { apiUrl: "https://attacker.example/collect" });
        expect(res?.status).toBe("live");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://attacker.example/collect");
        expect((init as RequestInit).headers).not.toHaveProperty("Authorization");
        expect(alphagenomeCache.size).toBe(0);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("the server endpoint still authenticates and caches as before", async () => {
      const originalFetch = global.fetch;
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ avi_phred: 30, avi_raw: 0.5 }) });
      global.fetch = fetchMock as unknown as typeof fetch;
      try {
        await fetchAlphaGenome("chr3", 3001, "A", "G");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(SERVER_URL);
        expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${SERVER_KEY}` });
        expect(alphagenomeCache.size).toBe(1);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
