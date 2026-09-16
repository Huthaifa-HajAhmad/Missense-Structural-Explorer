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

    it("should correctly handle reverse-strand transcripts (strand: -1)", async () => {
      const mockReverseResponse = {
        object_type: "Transcript",
        id: "ENST00000400000",
        strand: -1,
        Exon: [
          { id: "EXON_REV_2", start: 1000, end: 1200 }, // in reverse strand, this is Exon 2 (3' end of transcript)
          { id: "EXON_REV_1", start: 2000, end: 2200 }  // in reverse strand, this is Exon 1 (5' start of transcript)
        ]
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockReverseResponse
      });
      vi.stubGlobal("fetch", fetchMock);

      // Variant is at 2004 (4bp from 2000, which is the 5' donor of Exon 1 on reverse strand)
      const resDonor = await resolveSpliceProximity("ENST00000400000", 2004);
      expect(resDonor).toBeDefined();
      expect(resDonor!.distance).toBe(4);
      expect(resDonor!.isNearSpliceSite).toBe(true);
      expect(resDonor!.exonNumber).toBe(1);
      expect(resDonor!.totalExons).toBe(2);
      expect(resDonor!.junctionType).toBe("donor");
      expect(resDonor!.adjacentIntronNumber).toBe(1);
      expect(resDonor!.strand).toBe("-");

      // Variant at 2198 (2bp from 2200, which is the transcription start site / 5' terminal boundary)
      const resTSS = await resolveSpliceProximity("ENST00000400000", 2198);
      expect(resTSS).toBeDefined();
      expect(resTSS!.distance).toBe(2);
      expect(resTSS!.junctionType).toBe("terminal");
      expect(resTSS!.isNearSpliceSite).toBe(false); // Terminal boundary must never trigger splice proximity
    });

    it("should never flag single-exon genes as near splice site", async () => {
      const mockSingleExonResponse = {
        object_type: "Transcript",
        id: "ENST00000500000",
        strand: 1,
        Exon: [
          { id: "EXON_SINGLE", start: 1000, end: 2000 }
        ]
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSingleExonResponse
      });
      vi.stubGlobal("fetch", fetchMock);

      // Variant at 1002 (2bp from transcript start)
      const res = await resolveSpliceProximity("ENST00000500000", 1002);
      expect(res).toBeDefined();
      expect(res!.distance).toBe(2);
      expect(res!.totalExons).toBe(1);
      expect(res!.junctionType).toBe("terminal");
      expect(res!.isNearSpliceSite).toBe(false); // No splicing occurs in single-exon transcripts
      expect(res!.isCanonicalJunction).toBe(false); // A terminus is not an exon/intron junction
      expect(res!.adjacentIntronNumber).toBeNull();
    });

    it("marks a real donor/acceptor boundary as a canonical junction", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object_type: "Transcript",
          id: "ENST00000256078",
          strand: 1,
          Exon: [
            { id: "EXON1", start: 1000, end: 1200 },
            { id: "EXON2", start: 2000, end: 2200 }
          ]
        })
      });
      vi.stubGlobal("fetch", fetchMock);

      // 5bp from exon 1's end => a genuine donor junction.
      const donor = await resolveSpliceProximity("ENST00000256078", 1195);
      expect(donor!.junctionType).toBe("donor");
      expect(donor!.isCanonicalJunction).toBe(true);
    });

    it("leaves regionType null for positions outside the transcript span", async () => {
      // 5000 sits well downstream of the last exon (ending at 2200), matching neither
      // the exon loop nor any intron. It must not be reported as "exonic": that
      // produced payloads claiming "Region Type: Exonic" with no exon bounds.
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object_type: "Transcript",
          id: "ENST00000256078",
          strand: 1,
          Exon: [
            { id: "EXON1", start: 1000, end: 1200 },
            { id: "EXON2", start: 2000, end: 2200 }
          ]
        })
      });
      vi.stubGlobal("fetch", fetchMock);

      const offTranscript = await resolveSpliceProximity("ENST00000256078", 5000);
      expect(offTranscript).toBeDefined();
      expect(offTranscript!.regionType).toBeNull();
      expect(offTranscript!.exonNumber).toBeNull();
      expect(offTranscript!.exonStart).toBeNull();
      expect(offTranscript!.isCanonicalJunction).toBe(false);
      // Distance is still reported (fallback calculator); it just is not a junction hit.
      expect(offTranscript!.distance).toBeGreaterThan(0);
    });
  });
});
