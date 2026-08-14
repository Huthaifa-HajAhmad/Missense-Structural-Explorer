import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateDistanceToSpliceSite,
  fetchTranscriptExons,
  resolveSpliceProximity
} from "./splice_resolver.ts";

describe("Splice Resolver and Distance Calculator Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("calculateDistanceToSpliceSite", () => {
    it("should return Infinity if exons list is empty", () => {
      expect(calculateDistanceToSpliceSite(100, [])).toBe(Infinity);
    });

    it("should calculate correct minimum distance to any start/end coordinate of exons", () => {
      const exons = [
        { start: 10, end: 50 },
        { start: 100, end: 150 }
      ];

      // Variant exactly on a boundary
      expect(calculateDistanceToSpliceSite(10, exons)).toBe(0);
      expect(calculateDistanceToSpliceSite(150, exons)).toBe(0);

      // Variant close to a boundary
      expect(calculateDistanceToSpliceSite(54, exons)).toBe(4);
      expect(calculateDistanceToSpliceSite(97, exons)).toBe(3);

      // Variant right in the middle
      expect(calculateDistanceToSpliceSite(75, exons)).toBe(25);
    });
  });

  describe("fetchTranscriptExons and resolveSpliceProximity", () => {
    it("should return null if Ensembl API returns non-OK status", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await fetchTranscriptExons("ENST00000300000");
      expect(result).toBeNull();
    });

    it("should resolve splice proximity and exon/intron structure correctly from mock API", async () => {
      const mockEnsemblResponse = {
        object_type: "Transcript",
        id: "ENST00000256078",
        strand: 1,
        Exon: [
          { id: "EXON1", start: 1000, end: 1200 },
          { id: "EXON2", start: 2000, end: 2200 }
        ]
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockEnsemblResponse
      });
      vi.stubGlobal("fetch", fetchMock);

      // Variant is at 1195 (5bp from exon 1 end / donor junction)
      const res = await resolveSpliceProximity("ENST00000256078", 1195);
      expect(res).toBeDefined();
      expect(res!.distance).toBe(5);
      expect(res!.isNearSpliceSite).toBe(true);
      expect(res!.exonNumber).toBe(1);
      expect(res!.totalExons).toBe(2);
      expect(res!.exonLength).toBe(201);
      expect(res!.junctionType).toBe("donor");
      expect(res!.adjacentIntronNumber).toBe(1);
      expect(res!.regionType).toBe("exonic");

      // Variant is in Intron 1 at 1500 (300bp from boundaries)
      const resFar = await resolveSpliceProximity("ENST00000256078", 1500);
      expect(resFar).toBeDefined();
      expect(resFar!.distance).toBe(300);
      expect(resFar!.isNearSpliceSite).toBe(false);
      expect(resFar!.regionType).toBe("intronic");
      expect(resFar!.intronNumber).toBe(1);
    });
  });
});
